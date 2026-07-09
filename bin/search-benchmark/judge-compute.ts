/**
 * Compute nDCG@k per engine from blind LLM grades produced by subagents.
 *
 * Reads <judgeDir>/mapping.json (qid -> {query, A, B}) and every
 * <judgeDir>/grades-*.json (qid -> {A:number[], B:number[]}), un-blinds A/B
 * back to proto/prod, and merges the relevance grades into the benchmark JSON
 * to produce a judged report + updated summary.
 *
 * Usage:
 *   tsx bin/search-benchmark/judge-compute.ts [benchJson] [--judge-dir /tmp/judge]
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Engine = "proto" | "prod";

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
const mean = (a: number[]) =>
	a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

function latestBench(): string {
	const dir = join(__dirname, "results");
	const files = readdirSync(dir)
		.filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
		.sort();
	if (!files.length) throw new Error("No bench-*.json in results/");
	return join(dir, files[files.length - 1]);
}

async function main() {
	const argv = process.argv.slice(2);
	let benchPath = "";
	let judgeDir = "/tmp/judge";
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--judge-dir") judgeDir = argv[++i];
		else if (!a.startsWith("--")) benchPath = a;
	}
	if (!benchPath) benchPath = latestBench();

	const mapping = JSON.parse(
		readFileSync(join(judgeDir, "mapping.json"), "utf8"),
	) as Record<string, { query: string; A: Engine; B: Engine }>;

	// Merge all grade files.
	const grades: Record<string, { A: number[]; B: number[] }> = {};
	for (const f of readdirSync(judgeDir)) {
		if (!/^grades-\d+\.json$/.test(f)) continue;
		const g = JSON.parse(readFileSync(join(judgeDir, f), "utf8")) as Record<
			string,
			{ A: number[]; B: number[] }
		>;
		Object.assign(grades, g);
	}

	const bench = JSON.parse(readFileSync(benchPath, "utf8")) as {
		k: number;
		rows: Array<{
			query: string;
			proto: { hits: unknown[]; error?: string };
			prod: { hits: unknown[]; error?: string };
			protoNdcg?: number;
			prodNdcg?: number;
		}>;
	};
	const k = bench.k ?? 10;

	const missing: string[] = [];
	const results: Array<{
		query: string;
		protoNdcg: number;
		prodNdcg: number;
		protoGrades: number[];
		prodGrades: number[];
	}> = [];

	bench.rows.forEach((row, i) => {
		const qid = `q${String(i).padStart(3, "0")}`;
		const map = mapping[qid];
		const g = grades[qid];
		if (!map || !g) {
			missing.push(qid);
			return;
		}
		// Un-blind A/B -> engine grades.
		const byEngine: Record<Engine, number[]> = {
			proto: map.A === "proto" ? g.A : g.B,
			prod: map.A === "prod" ? g.A : g.B,
		};
		const protoGrades = byEngine.proto ?? [];
		const prodGrades = byEngine.prod ?? [];
		const protoNdcg = ndcg(protoGrades);
		const prodNdcg = ndcg(prodGrades);
		row.protoNdcg = protoNdcg;
		row.prodNdcg = prodNdcg;
		results.push({
			query: row.query,
			protoNdcg,
			prodNdcg,
			protoGrades,
			prodGrades,
		});
	});

	if (missing.length) {
		console.warn(`⚠️  Missing grades for: ${missing.join(", ")}`);
	}

	const pN = results.map((r) => r.protoNdcg);
	const dN = results.map((r) => r.prodNdcg);
	const wins = results.filter((r) => r.protoNdcg > r.prodNdcg + 1e-6).length;
	const losses = results.filter((r) => r.prodNdcg > r.protoNdcg + 1e-6).length;
	const ties = results.length - wins - losses;

	// Mean of the top grade per query = "is the #1-ish result good?"
	const protoBestGrade = mean(
		results.map((r) => Math.max(0, ...r.protoGrades)),
	);
	const prodBestGrade = mean(results.map((r) => Math.max(0, ...r.prodGrades)));
	// Precision@3: fraction of top-3 results graded >=2.
	const p3 = (gs: number[]) =>
		gs.slice(0, 3).filter((g) => g >= 2).length / Math.min(3, gs.length || 1);
	const protoP3 = mean(results.map((r) => p3(r.protoGrades)));
	const prodP3 = mean(results.map((r) => p3(r.prodGrades)));

	console.log(`\n=== Relevance (blind LLM-judged, n=${results.length}) ===`);
	console.log(
		`nDCG@${k}       prototype ${mean(pN).toFixed(3)}   prod/algolia ${mean(dN).toFixed(3)}`,
	);
	console.log(
		`Precision@3   prototype ${protoP3.toFixed(3)}   prod/algolia ${prodP3.toFixed(3)}`,
	);
	console.log(
		`Best-hit grade prototype ${protoBestGrade.toFixed(2)}   prod/algolia ${prodBestGrade.toFixed(2)}  (0-3)`,
	);
	console.log(
		`Per-query: prototype better ${wins}, prod better ${losses}, tie ${ties}`,
	);

	// Biggest gaps either way.
	const sorted = [...results].sort(
		(a, b) => b.protoNdcg - b.prodNdcg - (a.protoNdcg - a.prodNdcg),
	);
	console.log(`\nBiggest prototype wins:`);
	for (const r of sorted.slice(0, 5))
		console.log(
			`  +${(r.protoNdcg - r.prodNdcg).toFixed(2)}  ${r.query}  (proto ${r.protoNdcg.toFixed(2)} vs prod ${r.prodNdcg.toFixed(2)})`,
		);
	console.log(`Biggest prod wins:`);
	for (const r of sorted.slice(-5).reverse())
		console.log(
			`  ${(r.protoNdcg - r.prodNdcg).toFixed(2)}  ${r.query}  (proto ${r.protoNdcg.toFixed(2)} vs prod ${r.prodNdcg.toFixed(2)})`,
		);

	// ----- nDCG distribution chart (SVG + best-effort PNG) -----
	await writeNdcgChart(benchPath, results);

	// Write judged report.
	const outPath = benchPath.replace(/\.json$/, "-judged.json");
	writeFileSync(
		outPath,
		JSON.stringify(
			{
				source: basename(benchPath),
				n: results.length,
				k,
				summary: {
					protoNdcg: mean(pN),
					prodNdcg: mean(dN),
					protoPrecisionAt3: protoP3,
					prodPrecisionAt3: prodP3,
					protoBestGrade,
					prodBestGrade,
					protoWins: wins,
					prodWins: losses,
					ties,
				},
				results,
			},
			null,
			2,
		),
	);
	console.log(`\nJudged report: ${outPath}`);
}

async function writeNdcgChart(
	benchPath: string,
	results: Array<{ protoNdcg: number; prodNdcg: number }>,
) {
	const proto = results.map((r) => r.protoNdcg).sort((a, b) => a - b);
	const prod = results.map((r) => r.prodNdcg).sort((a, b) => a - b);
	const n = results.length;
	const W = 1000;
	const H = 460;
	const padL = 60;
	const padR = 190;
	const top = 50;
	const botH = 320;
	const plotW = W - padL - padR;
	const x = (i: number) => padL + (n <= 1 ? 0 : (plotW * i) / (n - 1));
	const y = (v: number) => top + botH - botH * v;
	const poly = (data: number[], color: string) =>
		`<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${data
			.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
			.join(" ")}" />`;
	let grid = "";
	for (let t = 0; t <= 5; t++) {
		const v = t / 5;
		const gy = y(v);
		grid +=
			`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + plotW}" y2="${gy.toFixed(1)}" stroke="#e2e2e2" />` +
			`<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${v.toFixed(1)}</text>`;
	}
	const mp = mean(results.map((r) => r.protoNdcg));
	const md = mean(results.map((r) => r.prodNdcg));
	const COL = { proto: "#f6821f", prod: "#0051c3" };
	const leg =
		`<rect x="${padL + plotW + 20}" y="${top}" width="12" height="12" fill="${COL.proto}" /><text x="${padL + plotW + 38}" y="${top + 11}" font-size="12">Prototype  mean ${mp.toFixed(3)}</text>` +
		`<rect x="${padL + plotW + 20}" y="${top + 22}" width="12" height="12" fill="${COL.prod}" /><text x="${padL + plotW + 38}" y="${top + 33}" font-size="12">Prod (Algolia)  mean ${md.toFixed(3)}</text>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="white" />
<text x="${padL}" y="28" font-size="16" font-weight="bold" fill="#111">Relevance quality \u2014 blind LLM-judged nDCG@10 per query (sorted, n=${n})</text>
${grid}
${poly(proto, COL.proto)}
${poly(prod, COL.prod)}
${leg}
<text x="${padL}" y="${top + botH + 34}" font-size="11" fill="#666">Each line = per-query nDCG sorted ascending (distribution). Higher = better.</text>
</svg>`;
	const svgPath = benchPath.replace(/bench-(.*)\.json$/, "ndcg-$1.svg");
	writeFileSync(svgPath, svg);
	try {
		const { default: sharp } = await import("sharp");
		await sharp(Buffer.from(svg))
			.png()
			.toFile(svgPath.replace(/\.svg$/, ".png"));
	} catch {
		// sharp unavailable: SVG only.
	}
	console.log(`nDCG chart: ${svgPath}`);
}

main();
