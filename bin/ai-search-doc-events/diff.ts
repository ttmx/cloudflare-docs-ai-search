import { readFile } from "node:fs/promises";
import type {
	Args,
	DiffPayload,
	Manifest,
	PageChangeEvent,
	Summary,
} from "./types";

export async function readManifest(path: string): Promise<Manifest | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Manifest;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function initialEvents(current: Manifest) {
	return Object.values(current.pages).map((page): PageChangeEvent => {
		return {
			type: "docs.page.changed",
			path: page.path,
			url: page.url,
			key: page.key,
			hash: page.hash,
			changedSections: page.sections,
			page,
		};
	});
}

export function diffManifests(previous: Manifest, current: Manifest) {
	const events: PageChangeEvent[] = [];

	for (const page of Object.values(current.pages)) {
		const oldPage = previous.pages[page.path];
		if (oldPage?.hash === page.hash) continue;

		const oldSectionHashes = new Map(
			oldPage?.sections.map((section) => [section.key, section.hash]) ?? [],
		);
		const changedSections = page.sections.filter(
			(section) => oldSectionHashes.get(section.key) !== section.hash,
		);
		const newSectionKeys = new Set(page.sections.map((section) => section.key));
		const removedSectionKeys = (oldPage?.sections ?? [])
			.map((section) => section.key)
			.filter((key) => !newSectionKeys.has(key));

		events.push({
			type: "docs.page.changed",
			path: page.path,
			url: page.url,
			key: page.key,
			hash: page.hash,
			changedSections,
			removedSectionKeys,
			page,
		});
	}

	for (const oldPage of Object.values(previous.pages)) {
		if (current.pages[oldPage.path]) continue;
		events.push({
			type: "docs.page.deleted",
			path: oldPage.path,
			url: oldPage.url,
			key: oldPage.key,
			// Let the indexer enqueue one independently retryable delete per item
			// instead of discovering and deleting the whole page in one queue job.
			removedSectionKeys: oldPage.sections.map((section) => section.key),
		});
	}

	return events;
}

function summarize(
	current: Manifest,
	events: PageChangeEvent[],
	baseline: boolean,
): Omit<Summary, "sent" | "committed"> {
	return {
		pages: Object.keys(current.pages).length,
		changed: events.filter((event) => event.type === "docs.page.changed")
			.length,
		deleted: events.filter((event) => event.type === "docs.page.deleted")
			.length,
		baseline,
	};
}

export function payloadFor(
	args: Args,
	current: Manifest,
	events: PageChangeEvent[],
	baseline: boolean,
): DiffPayload {
	return {
		version: 1,
		generatedAt: current.generatedAt,
		baseUrl: args.baseUrl,
		summary: summarize(current, events, baseline),
		events,
	};
}
