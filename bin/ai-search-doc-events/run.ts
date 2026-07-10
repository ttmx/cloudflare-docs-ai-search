import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "./args";
import { diffManifests, initialEvents, payloadFor, readManifest } from "./diff";
import { buildManifest } from "./manifest";
import { sendPayload } from "./send";

async function writeFileWithDir(path: string, contents: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

function writeJson(path: string, data: unknown) {
	return writeFileWithDir(path, `${JSON.stringify(data, null, "\t")}\n`);
}

export async function run() {
	const args = parseArgs();
	// --force-full-reindex ignores any previous manifest so every page is sent as
	// a change (a full re-index / rebuild-from-scratch). Otherwise diff against the
	// previous manifest; with no previous manifest, baseline (send nothing).
	const previous = args.forceFullReindex ? null : await readManifest(args.previous);
	const current = await buildManifest(args);
	const baseline = previous === null;
	const events = previous
		? diffManifests(previous, current)
		: args.forceFullReindex
			? initialEvents(current)
			: [];
	const payload = payloadFor(args, current, events, baseline);

	await writeJson(args.manifest, current);
	await writeFileWithDir(
		args.events,
		events.map((event) => JSON.stringify(event)).join("\n"),
	);

	const sent = events.length > 0 ? await sendPayload(args, payload) : false;
	let committed = false;

	if (args.commit) {
		await writeJson(args.previous, current);
		committed = true;
	}

	console.log(
		JSON.stringify(
			{
				...payload.summary,
				sent,
				committed,
				previous: args.previous,
				manifest: args.manifest,
				events: args.events,
			},
			null,
			2,
		),
	);

	// A failed enqueue used to return `sent: false` but leave the process exit
	// code at zero, making GitHub Actions report a green reindex even when every
	// batch received an Access 302. No events is a legitimate incremental no-op;
	// attempted delivery with any failed batch is not.
	if (events.length > 0 && !sent) {
		throw new Error(`Failed to enqueue one or more of ${events.length} reindex events`);
	}
}
