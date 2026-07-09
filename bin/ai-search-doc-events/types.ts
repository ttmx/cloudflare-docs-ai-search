import type { HTMLElement } from "node-html-parser";

export type RawSection = {
	anchor: string;
	heading: string;
	text: string;
	hash: string;
	// Heading depth (2 = h2, 3 = h3). Page-level items use level 1. Lets search
	// boost by depth, mirroring Algolia's lvlN. Optional: processors that don't
	// derive sections from headings may omit it.
	level?: number;
};

export type Section = RawSection & {
	key: string;
	url: string;
};

export type PageHash = {
	path: string;
	url: string;
	key: string;
	title: string;
	description?: string;
	product?: string;
	contentType?: string;
	group?: string;
	tags?: string[];
	additionalProducts?: string[];
	hash: string;
	sections: Section[];
};

export type Manifest = {
	version: 1;
	generatedAt: string;
	pages: Record<string, PageHash>;
};

export type PageChangeEvent = {
	type: "docs.page.changed" | "docs.page.deleted";
	path: string;
	url: string;
	key: string;
	hash?: string;
	// Sections added or modified since the previous manifest (the full section
	// list on a baseline). Upserted by the worker.
	changedSections?: Section[];
	// Section item keys present in the previous manifest but gone now (removed or
	// renamed headings). Deleted by the worker.
	removedSectionKeys?: string[];
	page?: PageHash;
};

export type Summary = {
	pages: number;
	changed: number;
	deleted: number;
	baseline: boolean;
	sent: boolean;
	committed: boolean;
};

export type DiffPayload = {
	version: 1;
	generatedAt: string;
	baseUrl: string;
	summary: Omit<Summary, "sent" | "committed">;
	events: PageChangeEvent[];
};

export type Args = {
	dist: string;
	sourceDocsDir: string;
	stateDir: string;
	previous: string;
	manifest: string;
	events: string;
	baseUrl: string;
	includePathPrefixes: string[];
	sendUrl?: string;
	sendTokenEnv?: string;
	batchSize: number;
	commit: boolean;
	sendInitial: boolean;
	// Reliable-send options (see send.ts).
	concurrency: number;
	maxRetries: number;
	resumeFile?: string;
};

export type ContentTransformerContext = {
	path: string;
	title: string;
	description?: string;
	sourceMarkdown?: string;
	sourceMarkdownPath?: string;
	root: HTMLElement;
};

export type ContentTransformer = {
	name: string;
	transform: (
		context: ContentTransformerContext,
	) => RawSection[] | undefined | Promise<RawSection[] | undefined>;
};
