/**
 * Search benchmark: compares the devdocs AI Search prototype against the
 * production Cloudflare Docs Algolia DocSearch index.
 *
 * Usage:
 *   pnpm tsx bin/search-benchmark/run.ts [--k 10] [--queries path.json] [--judge]
 *
 * Auth for the prototype:
 *   - Set CF_ACCESS_TOKEN, or the script will shell out to
 *     `cloudflared access token -app=<worker>` automatically.
 *
 * Optional LLM relevance judge (nDCG):
 *   - Set JUDGE_API_KEY (OpenAI-compatible). Optionally JUDGE_BASE_URL
 *     (default https://api.openai.com/v1) and JUDGE_MODEL (default gpt-4o-mini).
 *   - Enable with --judge.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The AI Search instance under test. Override with --proto-origin to benchmark
// a different deployment (each has its own Cloudflare Access org / token).
let PROTOTYPE_ORIGIN =
	"https://devdocs-ai-search-prototype.tteles-individual-account.workers.dev";
// Which prototype adapter/protocol to use, and whether it needs Access auth.
let PROTO_ENGINE: "devdocs" | "blog" = "devdocs";
let PROTO_AUTH = true;
const PROD_ORIGIN = "https://developers.cloudflare.com";

// Algolia DocSearch credentials scraped from the public prod site bundle.
const ALGOLIA = {
	appId: "D32WIYFTUF",
	apiKey: "5cec275adc19dd3bc17617f7d9cf312a",
	indexName: "prod_devdocs",
};

const UA = "curl/8.7.1"; // prototype bot-protection rejects urllib/python UAs

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
	k: number;
	queriesPath: string;
	judge: boolean;
	/** Pause between queries (ms) to avoid overloading the prototype backend. */
	delayMs: number;
	/** Per-request timeout (ms). */
	timeoutMs: number;
	/** Which adapter powers the "prototype" slot. */
	protoEngine: "devdocs" | "blog";
	/** Skip the prod/Algolia comparator (for non-docs corpora, e.g. the blog). */
	skipProd: boolean;
	/** Whether the prototype endpoint needs a cf-access-token (Access). */
	protoAuth: boolean;
}

function parseArgs(): Args {
	const argv = process.argv.slice(2);
	const args: Args = {
		k: 10,
		queriesPath: join(__dirname, "queries.json"),
		judge: false,
		delayMs: 1500,
		timeoutMs: 25000,
		protoEngine: "devdocs",
		skipProd: false,
		protoAuth: true,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--proto-origin") PROTOTYPE_ORIGIN = argv[++i].replace(/\/$/, "");
		else if (a === "--k") args.k = Number(argv[++i]);
		else if (a === "--queries") args.queriesPath = argv[++i];
		else if (a === "--judge") args.judge = true;
		else if (a === "--delay") args.delayMs = Number(argv[++i]);
		else if (a === "--timeout") args.timeoutMs = Number(argv[++i]);
		else if (a === "--proto-engine")
			args.protoEngine = argv[++i] as Args["protoEngine"];
		else if (a === "--skip-prod") args.skipProd = true;
		else if (a === "--no-proto-auth") args.protoAuth = false;
	}
	if (args.protoEngine === "blog") {
		// The blog search worker is public (no Cloudflare Access) and is a
		// different corpus than the docs, so there is no Algolia comparator.
		if (!process.argv.includes("--proto-origin"))
			PROTOTYPE_ORIGIN =
				"https://cloudflare-blog-public-endpoint.mrk.workers.dev";
		args.protoAuth = false;
		args.skipProd = true;
	}
	if (!process.argv.includes("--queries") && args.protoEngine === "blog") {
		args.queriesPath = join(__dirname, "queries-blog.json");
	}
	PROTO_ENGINE = args.protoEngine;
	PROTO_AUTH = args.protoAuth;
	return args;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryCase {
	query: string;
	product?: string;
}

interface Hit {
	/** Normalized path, no origin, no trailing slash, no anchor. */
	path: string;
	/** Path including anchor. */
	pathWithAnchor: string;
	/** Best available human-readable title from hierarchy. */
	title: string;
	raw: unknown;
}

interface EngineResult {
	hits: Hit[];
	latencyMs: number;
	error?: string;
	retried?: boolean;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAccessToken(): string {
	if (process.env.CF_ACCESS_TOKEN) return process.env.CF_ACCESS_TOKEN.trim();
	try {
		const out = execFileSync(
			"cloudflared",
			["access", "token", `-app=${PROTOTYPE_ORIGIN}`],
			{ encoding: "utf8" },
		);
		return out.trim();
	} catch {
		throw new Error(
			"No CF_ACCESS_TOKEN set and `cloudflared access token` failed. " +
				`Run: cloudflared access login ${PROTOTYPE_ORIGIN}`,
		);
	}
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

function normalize(url: string): { path: string; pathWithAnchor: string } {
	let u = url;
	// Strip known origins to make paths comparable.
	for (const origin of [PROTOTYPE_ORIGIN, PROD_ORIGIN]) {
		if (u.startsWith(origin)) u = u.slice(origin.length);
	}
	// Prototype sometimes returns bare relative paths already.
	if (/^https?:\/\//.test(u)) {
		try {
			const parsed = new URL(u);
			u = parsed.pathname + parsed.hash;
		} catch {
			/* leave as-is */
		}
	}
	const [pathPart, anchor] = u.split("#");
	let path = pathPart.toLowerCase();
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	const pathWithAnchor = anchor ? `${path}#${anchor.toLowerCase()}` : path;
	return { path, pathWithAnchor };
}

function hierarchyTitle(h: Record<string, string | null> | undefined): string {
	if (!h) return "";
	const levels = ["lvl6", "lvl5", "lvl4", "lvl3", "lvl2", "lvl1", "lvl0"];
	const parts: string[] = [];
	for (const lvl of ["lvl0", "lvl1", "lvl2"]) {
		if (h[lvl]) parts.push(h[lvl] as string);
	}
	if (parts.length) return parts.join(" › ");
	for (const lvl of levels) if (h[lvl]) return h[lvl] as string;
	return "";
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchPrototypeOnce(
	query: string,
	k: number,
	token: string,
	timeoutMs: number,
): Promise<EngineResult> {
	const start = performance.now();
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		// Build the request per engine.
		let res: Response;
		const authHeaders = PROTO_AUTH ? { "cf-access-token": token } : {};
		if (PROTO_ENGINE === "blog") {
			// Public @cloudflare/ai-search-snippet endpoint (blog.cloudflare.com).
			res = await fetch(`${PROTOTYPE_ORIGIN}/search?lang=en-us`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"cf-ai-search-source": "snippet-search",
					"User-Agent": UA,
					...authHeaders,
				},
				body: JSON.stringify({
					messages: [{ role: "user", content: query }],
					stream: false,
					ai_search_options: {
						retrieval: { metadata_only: true, max_num_results: k },
					},
				}),
				redirect: "manual",
				signal: ac.signal,
			});
		} else {
			res = await fetch(
				`${PROTOTYPE_ORIGIN}/api/ai-search/search?q=${encodeURIComponent(query)}&max=${k}`,
				{
					headers: { "User-Agent": UA, ...authHeaders },
					redirect: "manual",
					signal: ac.signal,
				},
			);
		}
		const latencyMs = performance.now() - start;
		if (res.status !== 200) {
			return {
				hits: [],
				latencyMs,
				error: `HTTP ${res.status}${res.status === 302 ? " (token expired?)" : res.status === 403 ? " (UA blocked?)" : ""}`,
			};
		}
		let hits: Hit[];
		if (PROTO_ENGINE === "blog") {
			const data = (await res.json()) as {
				result?: {
					chunks?: Array<{
						item?: { key?: string; metadata?: { title?: string } };
					}>;
				};
			};
			hits = (data.result?.chunks ?? []).slice(0, k).map((c) => {
				const { path, pathWithAnchor } = normalize(c.item?.key ?? "");
				return {
					path,
					pathWithAnchor,
					title: c.item?.metadata?.title ?? "",
					raw: c,
				};
			});
		} else {
			const data = (await res.json()) as {
				hits?: Array<{
					url: string;
					hierarchy?: Record<string, string | null>;
				}>;
			};
			hits = (data.hits ?? []).slice(0, k).map((h) => {
				const { path, pathWithAnchor } = normalize(h.url);
				return {
					path,
					pathWithAnchor,
					title: hierarchyTitle(h.hierarchy),
					raw: h,
				};
			});
		}
		return { hits, latencyMs };
	} catch (e) {
		const aborted = ac.signal.aborted;
		return {
			hits: [],
			latencyMs: performance.now() - start,
			error: aborted ? `timeout after ${timeoutMs}ms` : String(e),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The prototype backend degrades under sustained load (a request that hits the
 * timeout can trip it into transient HTTP 500s). Retry transient failures once
 * with a cooldown so the reported latency reflects steady-state, not the
 * backend's failure mode.
 */
async function searchPrototype(
	query: string,
	k: number,
	token: string,
	timeoutMs = 25000,
): Promise<EngineResult> {
	let last = await searchPrototypeOnce(query, k, token, timeoutMs);
	const transient =
		last.error &&
		(last.error.startsWith("HTTP 5") || last.error.startsWith("timeout"));
	if (transient) {
		await sleep(3000);
		const retry = await searchPrototypeOnce(query, k, token, timeoutMs);
		if (!retry.error) return { ...retry, retried: true };
		return { ...last, retried: true };
	}
	return last;
}

async function searchProd(query: string, k: number): Promise<EngineResult> {
	const url = `https://${ALGOLIA.appId}-dsn.algolia.net/1/indexes/${ALGOLIA.indexName}/query`;
	const start = performance.now();
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"X-Algolia-Application-Id": ALGOLIA.appId,
				"X-Algolia-API-Key": ALGOLIA.apiKey,
				"Content-Type": "application/json",
				"User-Agent": UA,
			},
			body: JSON.stringify({ query, hitsPerPage: k }),
		});
		const latencyMs = performance.now() - start;
		if (res.status !== 200) {
			return { hits: [], latencyMs, error: `HTTP ${res.status}` };
		}
		const data = (await res.json()) as {
			hits?: Array<{ url: string; hierarchy?: Record<string, string | null> }>;
		};
		const hits: Hit[] = (data.hits ?? []).slice(0, k).map((h) => {
			const { path, pathWithAnchor } = normalize(h.url);
			return {
				path,
				pathWithAnchor,
				title: hierarchyTitle(h.hierarchy),
				raw: h,
			};
		});
		return { hits, latencyMs };
	} catch (e) {
		return { hits: [], latencyMs: performance.now() - start, error: String(e) };
	}
}

// ---------------------------------------------------------------------------
// Overlap metrics
// ---------------------------------------------------------------------------

function overlapMetrics(a: Hit[], b: Hit[]) {
	const setA = new Set(a.map((h) => h.path));
	const setB = new Set(b.map((h) => h.path));
	const inter = [...setA].filter((p) => setB.has(p));
	const union = new Set([...setA, ...setB]);
	const jaccard = union.size ? inter.length / union.size : 0;
	const overlapCoef = Math.min(setA.size, setB.size)
		? inter.length / Math.min(setA.size, setB.size)
		: 0;
	// Top-1 agreement.
	const top1Same = a[0] && b[0] && a[0].path === b[0].path;
	return { shared: inter.length, jaccard, overlapCoef, top1Same };
}

// ---------------------------------------------------------------------------
// LLM relevance judge (optional) -> nDCG
// ---------------------------------------------------------------------------

async function judgeRelevance(query: string, hits: Hit[]): Promise<number[]> {
	const apiKey = process.env.JUDGE_API_KEY!;
	const baseUrl = process.env.JUDGE_BASE_URL ?? "https://api.openai.com/v1";
	const model = process.env.JUDGE_MODEL ?? "gpt-4o-mini";
	const listing = hits
		.map((h, i) => `${i + 1}. ${h.title || h.path} (${h.path})`)
		.join("\n");
	const prompt = `You are grading Cloudflare documentation search results.
Query: "${query}"

Rate each result's relevance to the query on a 0-3 scale:
3 = directly and completely answers the query
2 = relevant and useful, partially answers
1 = tangentially related
0 = not relevant

Results:
${listing}

Respond with ONLY a JSON array of integers, one per result, in order. Example: [3,2,0,1]`;

	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
		}),
	});
	const data = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const content = data.choices?.[0]?.message?.content ?? "[]";
	const match = content.match(/\[[\s\S]*?\]/);
	let grades: number[] = [];
	try {
		grades = JSON.parse(match ? match[0] : content);
	} catch {
		grades = [];
	}
	// Pad/truncate to hits length.
	return hits.map((_, i) => Number(grades[i] ?? 0));
}

function dcg(grades: number[]): number {
	return grades.reduce(
		(sum, g, i) => sum + (Math.pow(2, g) - 1) / Math.log2(i + 2),
		0,
	);
}

function ndcg(grades: number[]): number {
	const ideal = [...grades].sort((a, b) => b - a);
	const idcg = dcg(ideal);
	return idcg === 0 ? 0 : dcg(grades) / idcg;
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function pct(arr: number[], p: number): number {
	if (!arr.length) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.min(
		sorted.length - 1,
		Math.floor((p / 100) * sorted.length),
	);
	return sorted[idx];
}
const mean = (a: number[]) =>
	a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

// ---------------------------------------------------------------------------
// SVG latency chart
// ---------------------------------------------------------------------------

/**
 * Two-panel SVG:
 *  (top)    sorted latency distribution (ascending) for both engines
 *  (bottom) per-query latency bars in query order
 */
function latencyChartSVG(protoLat: number[], prodLat: number[]): string {
	const W = 1000;
	const padL = 60;
	const padR = 170;
	const plotW = W - padL - padR;

	const allMax = Math.max(1, ...protoLat, ...prodLat);
	const axisMax = Math.ceil(allMax / 1000) * 1000;
	const COLOR = { proto: "#f6821f", prod: "#0051c3" };

	// Panel 1: sorted distribution
	const p1H = 300;
	const p1Top = 44;
	const sortedProto = [...protoLat].sort((a, b) => a - b);
	const sortedProd = [...prodLat].sort((a, b) => a - b);
	const n = Math.max(sortedProto.length, sortedProd.length);
	const x = (i: number) => padL + (n <= 1 ? 0 : (plotW * i) / (n - 1));
	const y1 = (v: number) => p1Top + p1H - (p1H * v) / axisMax;
	const line = (data: number[], color: string) =>
		`<polyline fill="none" stroke="${color}" stroke-width="2" points="${data
			.map((v, i) => `${x(i).toFixed(1)},${y1(v).toFixed(1)}`)
			.join(" ")}" />`;

	// Panel 2: per-query bars
	const p2Top = p1Top + p1H + 90;
	const p2H = 260;
	const m = protoLat.length;
	const group = plotW / Math.max(1, m);
	const barW = Math.max(1.5, (group - 2) / 2);
	const y2 = (v: number) => p2Top + p2H - (p2H * v) / axisMax;
	const bars = (data: number[], color: string, off: number) =>
		data
			.map((v, i) => {
				const bx = padL + i * group + off;
				const by = y2(v);
				return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${(p2Top + p2H - by).toFixed(1)}" fill="${color}" />`;
			})
			.join("");

	const ticks = 5;
	const grid = (top: number, h: number) =>
		Array.from({ length: ticks + 1 }, (_, t) => {
			const v = (axisMax * t) / ticks;
			const gy = top + h - (h * v) / axisMax;
			return (
				`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + plotW}" y2="${gy.toFixed(1)}" stroke="#e2e2e2" />` +
				`<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${(v / 1000).toFixed(1)}s</text>`
			);
		}).join("");

	const legend = (top: number) =>
		`<rect x="${padL + plotW + 20}" y="${top}" width="12" height="12" fill="${COLOR.proto}" />` +
		`<text x="${padL + plotW + 38}" y="${top + 11}" font-size="12" fill="#333">Prototype (AI Search)</text>` +
		`<rect x="${padL + plotW + 20}" y="${top + 22}" width="12" height="12" fill="${COLOR.prod}" />` +
		`<text x="${padL + plotW + 38}" y="${top + 33}" font-size="12" fill="#333">Prod (Algolia)</text>`;

	const H = p2Top + p2H + 40;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="white" />
<text x="${padL}" y="24" font-size="16" font-weight="bold" fill="#111">Search latency \u2014 sorted distribution (n=${protoLat.length})</text>
${grid(p1Top, p1H)}
${line(sortedProto, COLOR.proto)}
${line(sortedProd, COLOR.prod)}
${legend(p1Top)}
<text x="${padL}" y="${p2Top - 20}" font-size="16" font-weight="bold" fill="#111">Per-query latency (query order)</text>
${grid(p2Top, p2H)}
${bars(protoLat, COLOR.proto, 1)}
${bars(prodLat, COLOR.prod, 1 + barW)}
${legend(p2Top)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const args = parseArgs();
	const cases: QueryCase[] = JSON.parse(readFileSync(args.queriesPath, "utf8"));
	const token = args.protoAuth ? getAccessToken() : "";
	const noProd = args.skipProd;
	const emptyProd = (): EngineResult => ({ hits: [], latencyMs: 0 });
	const runProd = (q: string) => (noProd ? emptyProd() : searchProd(q, args.k));
	const doJudge = args.judge && !!process.env.JUDGE_API_KEY;
	console.log(
		`Engine: ${args.protoEngine} @ ${PROTOTYPE_ORIGIN}${noProd ? " (no prod comparator)" : " vs Algolia"}`,
	);
	if (args.judge && !doJudge) {
		console.warn(
			"⚠️  --judge given but JUDGE_API_KEY not set; skipping judge.",
		);
	}

	console.log(
		`Benchmarking ${cases.length} queries @ k=${args.k}${
			doJudge ? " with LLM judge" : ""
		}\n`,
	);

	interface Row {
		query: string;
		product?: string;
		proto: EngineResult;
		prod: EngineResult;
		overlap: ReturnType<typeof overlapMetrics>;
		protoNdcg?: number;
		prodNdcg?: number;
	}

	const rows: Row[] = [];

	// Warm up both engines so the first real query doesn't eat a cold start.
	await Promise.all([
		searchPrototype("cloudflare workers", args.k, token, args.timeoutMs),
		runProd("cloudflare workers"),
	]);

	let first = true;
	for (const c of cases) {
		// Pace requests so the prototype backend doesn't degrade under load.
		if (!first && args.delayMs > 0) await sleep(args.delayMs);
		first = false;
		// Run both engines in parallel per query.
		const [proto, prod] = await Promise.all([
			searchPrototype(c.query, args.k, token, args.timeoutMs),
			runProd(c.query),
		]);
		const overlap = overlapMetrics(proto.hits, prod.hits);
		const row: Row = {
			query: c.query,
			product: c.product,
			proto,
			prod,
			overlap,
		};

		if (doJudge) {
			const [pg, dg] = await Promise.all([
				proto.hits.length
					? judgeRelevance(c.query, proto.hits)
					: Promise.resolve([]),
				prod.hits.length
					? judgeRelevance(c.query, prod.hits)
					: Promise.resolve([]),
			]);
			row.protoNdcg = ndcg(pg);
			row.prodNdcg = ndcg(dg);
		}
		rows.push(row);

		const flags: string[] = [];
		if (proto.error) flags.push(`proto:${proto.error}`);
		if (proto.retried) flags.push("proto:retried");
		if (prod.error) flags.push(`prod:${prod.error}`);
		console.log(
			`• ${c.query.padEnd(42)} ` +
				`proto ${String(proto.hits.length).padStart(2)}h/${proto.latencyMs.toFixed(0).padStart(4)}ms  ` +
				`prod ${String(prod.hits.length).padStart(2)}h/${prod.latencyMs.toFixed(0).padStart(4)}ms  ` +
				`shared ${overlap.shared}/${args.k}` +
				(doJudge
					? `  nDCG proto ${row.protoNdcg!.toFixed(2)} / prod ${row.prodNdcg!.toFixed(2)}`
					: "") +
				(flags.length ? `  [${flags.join(", ")}]` : ""),
		);
	}

	// ----- Aggregates -----
	// Latency comparison uses only queries where BOTH engines succeeded, so
	// timeouts / transient 500s don't distort the steady-state numbers.
	const okRows = rows.filter((r) => !r.proto.error && !r.prod.error);
	const protoLat = okRows.map((r) => r.proto.latencyMs);
	const prodLat = okRows.map((r) => r.prod.latencyMs);
	const protoErrors = rows.filter((r) => r.proto.error).length;
	const prodErrors = rows.filter((r) => r.prod.error).length;
	const protoRetried = rows.filter((r) => r.proto.retried).length;
	const jaccards = rows.map((r) => r.overlap.jaccard);
	const overlaps = rows.map((r) => r.overlap.overlapCoef);
	const shared = rows.map((r) => r.overlap.shared);
	const top1Agree = rows.filter((r) => r.overlap.top1Same).length;
	const protoEmpty = rows.filter((r) => r.proto.hits.length === 0).length;
	const prodEmpty = rows.filter((r) => r.prod.hits.length === 0).length;

	console.log("\n=== Summary ===");
	console.log(`Queries: ${rows.length} @ k=${args.k}`);
	console.log(
		`Latency (ms)  prototype: mean ${mean(protoLat).toFixed(0)}  p50 ${pct(protoLat, 50).toFixed(0)}  p95 ${pct(protoLat, 95).toFixed(0)}`,
	);
	console.log(
		`Latency (ms)  prod/algolia: mean ${mean(prodLat).toFixed(0)}  p50 ${pct(prodLat, 50).toFixed(0)}  p95 ${pct(prodLat, 95).toFixed(0)}`,
	);
	console.log(
		`Result overlap  mean shared ${mean(shared).toFixed(1)}/${args.k}  Jaccard ${mean(jaccards).toFixed(3)}  overlap-coef ${mean(overlaps).toFixed(3)}`,
	);
	console.log(
		`Top-1 agreement: ${top1Agree}/${rows.length} (${((100 * top1Agree) / rows.length).toFixed(0)}%)`,
	);
	console.log(
		`Empty result sets  prototype: ${protoEmpty}  prod: ${prodEmpty}`,
	);
	console.log(
		`Errors  prototype: ${protoErrors} (retried ${protoRetried})  prod: ${prodErrors}   ` +
			`| latency computed over ${okRows.length} both-ok queries`,
	);
	if (doJudge) {
		const pN = rows.map((r) => r.protoNdcg ?? 0);
		const dN = rows.map((r) => r.prodNdcg ?? 0);
		const wins = rows.filter(
			(r) => (r.protoNdcg ?? 0) > (r.prodNdcg ?? 0) + 1e-6,
		).length;
		const losses = rows.filter(
			(r) => (r.prodNdcg ?? 0) > (r.protoNdcg ?? 0) + 1e-6,
		).length;
		console.log(
			`\nRelevance (LLM-judged nDCG@${args.k})  prototype: ${mean(pN).toFixed(3)}  prod/algolia: ${mean(dN).toFixed(3)}`,
		);
		console.log(
			`Per-query: prototype better on ${wins}, prod better on ${losses}, tie ${rows.length - wins - losses}`,
		);
	}

	// ----- Write reports -----
	const outDir = join(__dirname, "results");
	mkdirSync(outDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const jsonPath = join(outDir, `bench-${stamp}.json`);
	const mdPath = join(outDir, `bench-${stamp}.md`);

	writeFileSync(
		jsonPath,
		JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				k: args.k,
				judged: doJudge,
				summary: {
					protoLatency: {
						mean: mean(protoLat),
						p50: pct(protoLat, 50),
						p95: pct(protoLat, 95),
					},
					prodLatency: {
						mean: mean(prodLat),
						p50: pct(prodLat, 50),
						p95: pct(prodLat, 95),
					},
					meanShared: mean(shared),
					meanJaccard: mean(jaccards),
					meanOverlapCoef: mean(overlaps),
					top1Agreement: top1Agree / rows.length,
					protoEmpty,
					prodEmpty,
					...(doJudge
						? {
								protoNdcg: mean(rows.map((r) => r.protoNdcg ?? 0)),
								prodNdcg: mean(rows.map((r) => r.prodNdcg ?? 0)),
							}
						: {}),
				},
				rows: rows.map((r) => ({
					query: r.query,
					product: r.product,
					proto: {
						latencyMs: r.proto.latencyMs,
						error: r.proto.error,
						hits: r.proto.hits.map((h) => ({
							path: h.pathWithAnchor,
							title: h.title,
						})),
					},
					prod: {
						latencyMs: r.prod.latencyMs,
						error: r.prod.error,
						hits: r.prod.hits.map((h) => ({
							path: h.pathWithAnchor,
							title: h.title,
						})),
					},
					overlap: r.overlap,
					protoNdcg: r.protoNdcg,
					prodNdcg: r.prodNdcg,
				})),
			},
			null,
			2,
		),
	);

	// Markdown report with side-by-side top-5 for eyeballing.
	const md: string[] = [];
	md.push(`# Search benchmark — prototype vs. production\n`);
	md.push(
		`Generated: ${new Date().toISOString()}  ·  k=${args.k}  ·  ${rows.length} queries\n`,
	);
	md.push(`## Summary\n`);
	md.push(`| Metric | Prototype (AI Search) | Prod (Algolia) |`);
	md.push(`| --- | --- | --- |`);
	md.push(
		`| Latency mean (ms) | ${mean(protoLat).toFixed(0)} | ${mean(prodLat).toFixed(0)} |`,
	);
	md.push(
		`| Latency p95 (ms) | ${pct(protoLat, 95).toFixed(0)} | ${pct(prodLat, 95).toFixed(0)} |`,
	);
	md.push(`| Empty result sets | ${protoEmpty} | ${prodEmpty} |`);
	if (doJudge) {
		md.push(
			`| nDCG@${args.k} (LLM-judged) | ${mean(rows.map((r) => r.protoNdcg ?? 0)).toFixed(3)} | ${mean(rows.map((r) => r.prodNdcg ?? 0)).toFixed(3)} |`,
		);
	}
	md.push(``);
	md.push(
		`Result overlap: mean ${mean(shared).toFixed(1)}/${args.k} shared, Jaccard ${mean(jaccards).toFixed(3)}, top-1 agreement ${((100 * top1Agree) / rows.length).toFixed(0)}%.\n`,
	);
	md.push(`## Per-query top-5\n`);
	for (const r of rows) {
		md.push(`### ${r.query}`);
		if (doJudge)
			md.push(
				`nDCG — prototype ${r.protoNdcg?.toFixed(2)}, prod ${r.prodNdcg?.toFixed(2)}  ·  shared ${r.overlap.shared}/${args.k}\n`,
			);
		else
			md.push(
				`shared ${r.overlap.shared}/${args.k}, top-1 same: ${r.overlap.top1Same ? "yes" : "no"}\n`,
			);
		md.push(`| # | Prototype | Prod/Algolia |`);
		md.push(`| - | --- | --- |`);
		for (let i = 0; i < 5; i++) {
			const p = r.proto.hits[i];
			const d = r.prod.hits[i];
			const cell = (h?: Hit) =>
				h ? `${h.title || "—"}<br>\`${h.pathWithAnchor}\`` : "—";
			md.push(`| ${i + 1} | ${cell(p)} | ${cell(d)} |`);
		}
		md.push(``);
	}
	writeFileSync(mdPath, md.join("\n"));

	// Latency chart (SVG, plus a best-effort PNG render for previewability).
	const svg = latencyChartSVG(protoLat, prodLat);
	const svgPath = join(outDir, `latency-${stamp}.svg`);
	writeFileSync(svgPath, svg);
	let pngPath: string | undefined;
	try {
		const { default: sharp } = await import("sharp");
		pngPath = join(outDir, `latency-${stamp}.png`);
		await sharp(Buffer.from(svg)).png().toFile(pngPath);
	} catch {
		// sharp not available: SVG only.
	}
	md.push(
		`\n## Latency chart\n\n![latency](./latency-${stamp}.${pngPath ? "png" : "svg"})\n`,
	);
	writeFileSync(mdPath, md.join("\n"));

	console.log(
		`\nReports written:\n  ${jsonPath}\n  ${mdPath}\n  ${svgPath}${pngPath ? `\n  ${pngPath}` : ""}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
