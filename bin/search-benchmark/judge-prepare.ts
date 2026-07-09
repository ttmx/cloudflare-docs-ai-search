/**
 * Prepare blind LLM-judging batches from a benchmark JSON report.
 *
 * For each query, the two engines' result lists are anonymized as "A" and "B"
 * (assignment randomized per query) so the judge cannot systematically favor
 * one. Writes:
 *   - <outDir>/batch-<n>.json   : what each subagent reads and grades
 *   - <outDir>/mapping.json     : qid -> { query, A: "proto"|"prod", B: ... }
 *
 * Usage:
 *   tsx bin/search-benchmark/judge-prepare.ts [benchJson] [--batch 10] [--out /tmp/judge]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchHit {
	path: string;
	title: string;
}
interface BenchRow {
	query: string;
	proto: { hits: BenchHit[]; error?: string };
	prod: { hits: BenchHit[]; error?: string };
}

function latestBench(): string {
	const dir = join(__dirname, "results");
	const files = readdirSync(dir)
		.filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
		.sort();
	if (!files.length) throw new Error("No bench-*.json in results/");
	return join(dir, files[files.length - 1]);
}

function main() {
	const argv = process.argv.slice(2);
	let benchPath = "";
	let batchSize = 10;
	let outDir = "/tmp/judge";
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--batch") batchSize = Number(argv[++i]);
		else if (a === "--out") outDir = argv[++i];
		else if (!a.startsWith("--")) benchPath = a;
	}
	if (!benchPath) benchPath = latestBench();

	const bench = JSON.parse(readFileSync(benchPath, "utf8")) as {
		rows: BenchRow[];
	};
	mkdirSync(outDir, { recursive: true });

	const mapping: Record<
		string,
		{ query: string; A: "proto" | "prod"; B: "proto" | "prod" }
	> = {};

	interface BatchItem {
		qid: string;
		query: string;
		A: Array<{ n: number; title: string; url: string }>;
		B: Array<{ n: number; title: string; url: string }>;
	}

	const items: BatchItem[] = bench.rows.map((r, i) => {
		const qid = `q${String(i).padStart(3, "0")}`;
		// Randomize A/B assignment per query.
		const protoIsA = Math.random() < 0.5;
		mapping[qid] = {
			query: r.query,
			A: protoIsA ? "proto" : "prod",
			B: protoIsA ? "prod" : "proto",
		};
		const fmt = (hits: BenchHit[]) =>
			hits.map((h, j) => ({
				n: j + 1,
				title: h.title || "(no title)",
				url: h.path,
			}));
		const protoList = fmt(r.proto.hits);
		const prodList = fmt(r.prod.hits);
		return {
			qid,
			query: r.query,
			A: protoIsA ? protoList : prodList,
			B: protoIsA ? prodList : protoList,
		};
	});

	writeFileSync(join(outDir, "mapping.json"), JSON.stringify(mapping, null, 2));

	let batchN = 0;
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		writeFileSync(
			join(outDir, `batch-${batchN}.json`),
			JSON.stringify(batch, null, 2),
		);
		batchN++;
	}

	console.log(
		`Prepared ${items.length} queries in ${batchN} batches of <=${batchSize} at ${outDir}`,
	);
	console.log(`Source: ${benchPath}`);
	console.log(
		`Batches: ${Array.from({ length: batchN }, (_, i) => `batch-${i}.json`).join(", ")}`,
	);
}

main();
