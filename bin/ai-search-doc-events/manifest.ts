import { readFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import fg from "fast-glob";
import { transformContent } from "./content-transformers";
import type { Args, Manifest, PageHash } from "./types";
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

async function pageFromHtml(
	dist: string,
	htmlFile: string,
	baseUrl: string,
	sourceDocsDir: string,
) {
	const path = htmlPathToDocsPath(dist, htmlFile);
	if (!shouldIndexHtmlPath(path)) return null;

	const html = await readFile(htmlFile, "utf8");
	const root = parse(html);

	const robots = meta(root, "robots");
	const refresh = root.querySelector('meta[http-equiv="refresh"]');
	if (robots?.includes("noindex") || refresh) return null;

	const title = normalizeText(
		root.querySelector("title")?.text.split("|")[0] ??
			root.querySelector("h1")?.text ??
			path,
	);
	const description = meta(root, "description");
	const source = await sourceMarkdownForPath(sourceDocsDir, path);
	const rawSections = await transformContent({
		path,
		title,
		description,
		sourceMarkdown: source?.content,
		sourceMarkdownPath: source?.file,
		root,
	});
	const text = rawSections.map((section) => section.text).join("\n\n");
	if (!text) return null;

	const url = absoluteUrl(baseUrl, path);
	const product = meta(root, "pcx_product");
	const contentType = meta(root, "pcx_content_type");
	const group = meta(root, "pcx_content_group");
	const tags = metaList(root, "pcx_tags");
	const additionalProducts = metaList(root, "pcx_additional_products");
	// Fold page-level fields (title, description, taxonomy) into the page hash so
	// an edit that only changes the description or metadata — not section text —
	// still produces a diff event and refreshes the whole-page item.
	const hash = sha256(
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
	);
	const page: PageHash = {
		path,
		url,
		key: docsPathToItemKey(path),
		title,
		description,
		product,
		contentType,
		group,
		tags,
		additionalProducts,
		hash,
		sections: addSectionRecordFields(path, url, rawSections),
	};

	return page;
}

export async function buildManifest(
	args: Pick<
		Args,
		"dist" | "sourceDocsDir" | "baseUrl" | "includePathPrefixes"
	>,
): Promise<Manifest> {
	const htmlFiles = await fg("**/*.html", {
		cwd: args.dist,
		absolute: true,
		ignore: ["404.html", "**/404/index.html"],
	});

	const pages: Record<string, PageHash> = {};
	for (const htmlFile of htmlFiles.sort()) {
		const page = await pageFromHtml(
			args.dist,
			htmlFile,
			args.baseUrl,
			args.sourceDocsDir,
		);
		if (!page) continue;
		if (
			args.includePathPrefixes.length > 0 &&
			!args.includePathPrefixes.some((prefix) => page.path.startsWith(prefix))
		) {
			continue;
		}
		pages[page.path] = page;
	}

	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		pages,
	};
}
