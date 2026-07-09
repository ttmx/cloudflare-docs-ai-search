/**
 * Benchmark + profile buildManifest.
 *
 * Replicates manifest.ts::pageFromHtml exactly, but wraps each phase in a timer
 * so we can attribute wall-clock time to: glob, readFile(HTML), parse(HTML),
 * meta extraction, source-markdown read, transformContent, and hashing.
 *
 * Usage:
 *   pnpm exec tsx bin/ai-search-doc-events/bench-manifest.ts [--dist dir] [--limit N]
 *   node --cpu-prof --cpu-prof-dir /tmp --import tsx bin/ai-search-doc-events/bench-manifest.ts
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parse } from "node-html-parser";
import fg from "fast-glob";
import { transformContent } from "./content-transformers";
import {
	absoluteUrl,
	addSectionRecordFields,
	docsPathToItemKey,
	htmlPathToDocsPath,
	meta,
	metaList,
	normalizeText,
	sha256,
	shouldIndexHtmlPath,
	sourceMarkdownForPath,
} from "./shared";

const { values } = parseArgs({
	options: {
		dist: { type: "string", default: "dist" },
		"source-docs-dir": { type: "string", default: "src/content/docs" },
		"base-url": { type: "string", default: "https://developers.cloudflare.com" },
		limit: { type: "string" },
	},
});

const dist = values.dist;
const sourceDocsDir = values["source-docs-dir"];
const baseUrl = values["base-url"];
const limit = values.limit ? Number.parseInt(values.limit, 10) : Infinity;

// Nanosecond timers, accumulated per phase.
const t: Record<string, bigint> = {
	readHtml: 0n,
	parseHtml: 0n,
	meta: 0n,
	sourceRead: 0n,
	transform: 0n,
	hash: 0n,
	build: 0n,
};
const now = () => process.hrtime.bigint();
async function time<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
	const start = now();
	try {
		return await fn();
	} finally {
		t[key] += now() - start;
	}
}
const ms = (ns: bigint) => Number(ns / 1000n) / 1000;

let pages = 0;
let skippedNotIndexable = 0;
let skippedNoindex = 0;
let skippedNoText = 0;
let withSource = 0;
let totalSections = 0;
let totalTextBytes = 0;

const globStart = now();
const htmlFiles = await fg("**/*.html", {
	cwd: dist,
	absolute: true,
	ignore: ["404.html", "**/404/index.html"],
});
const globMs = ms(now() - globStart);
const sorted = htmlFiles.sort();
const toProcess = Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;

const buildStart = now();
for (const htmlFile of toProcess) {
	const path = htmlPathToDocsPath(dist, htmlFile);
	if (!shouldIndexHtmlPath(path)) {
		skippedNotIndexable++;
		continue;
	}

	const html = await time("readHtml", () => readFile(htmlFile, "utf8"));
	const root = await time("parseHtml", () => parse(html));

	const robots = await time("meta", () => meta(root, "robots"));
	const refresh = root.querySelector('meta[http-equiv="refresh"]');
	if (robots?.includes("noindex") || refresh) {
		skippedNoindex++;
		continue;
	}

	const title = normalizeText(
		root.querySelector("title")?.text.split("|")[0] ??
			root.querySelector("h1")?.text ??
			path,
	);
	const description = meta(root, "description");
	const source = await time("sourceRead", () =>
		sourceMarkdownForPath(sourceDocsDir, path),
	);
	const rawSections = await time("transform", () =>
		transformContent({
			path,
			title,
			description,
			sourceMarkdown: source?.content,
			sourceMarkdownPath: source?.file,
			root,
		}),
	);
	const text = (rawSections ?? []).map((s) => s.text).join("\n\n");
	if (!text) {
		skippedNoText++;
		continue;
	}
	if (source) withSource++;
	totalSections += rawSections?.length ?? 0;
	totalTextBytes += Buffer.byteLength(text);

	const url = absoluteUrl(baseUrl, path);
	const product = meta(root, "pcx_product");
	const contentType = meta(root, "pcx_content_type");
	const group = meta(root, "pcx_content_group");
	const tags = metaList(root, "pcx_tags");
	const additionalProducts = metaList(root, "pcx_additional_products");

	await time("hash", () =>
		sha256(
			[
				title,
				description ?? "",
				product ?? "",
				contentType ?? "",
				group ?? "",
				(tags ?? []).join(","),
				(additionalProducts ?? []).join(","),
				text,
			].join("\n"),
		),
	);
	// Match manifest.ts work (section record fields) even though we discard it.
	addSectionRecordFields(path, url, rawSections ?? []);
	pages++;
}
t.build = now() - buildStart;

const buildMs = ms(t.build);
const timed = ms(t.readHtml + t.parseHtml + t.meta + t.sourceRead + t.transform + t.hash);
const pct = (n: number) => ((n / buildMs) * 100).toFixed(1).padStart(5);
const row = (label: string, val: number) =>
	`  ${label.padEnd(14)} ${val.toFixed(0).padStart(8)} ms  ${pct(val).padStart(6)}%  ${(val / Math.max(pages, 1)).toFixed(3).padStart(8)} ms/page`;

console.log("\n=== buildManifest benchmark ===");
console.log(`dist:              ${dist}`);
console.log(`html files (glob): ${htmlFiles.length}  (${globMs.toFixed(0)} ms)`);
console.log(`processed:         ${toProcess.length}`);
console.log(`indexable pages:   ${pages}`);
console.log(`  skipped (not indexable): ${skippedNotIndexable}`);
console.log(`  skipped (noindex/refresh): ${skippedNoindex}`);
console.log(`  skipped (no text): ${skippedNoText}`);
console.log(`pages with source md: ${withSource} (${((withSource / Math.max(pages, 1)) * 100).toFixed(0)}%)`);
console.log(`total sections:    ${totalSections}  (avg ${(totalSections / Math.max(pages, 1)).toFixed(1)}/page)`);
console.log(`total text:        ${(totalTextBytes / 1024 / 1024).toFixed(1)} MiB`);
console.log(`\nloop wall time:    ${buildMs.toFixed(0)} ms  (${(buildMs / Math.max(pages, 1)).toFixed(3)} ms/page)`);
console.log(`\nphase breakdown (of loop wall time):`);
console.log(row("readHtml", ms(t.readHtml)));
console.log(row("parseHtml", ms(t.parseHtml)));
console.log(row("meta", ms(t.meta)));
console.log(row("sourceRead", ms(t.sourceRead)));
console.log(row("transform", ms(t.transform)));
console.log(row("hash", ms(t.hash)));
console.log(`  ${"(timed sum)".padEnd(14)} ${timed.toFixed(0).padStart(8)} ms  ${pct(timed).padStart(6)}%`);
console.log(`  ${"(untimed)".padEnd(14)} ${(buildMs - timed).toFixed(0).padStart(8)} ms  ${pct(buildMs - timed).padStart(6)}%  (glob/loop overhead, GC, querySelector for title/h1/refresh)`);
console.log(`\npeak RSS:          ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MiB`);
