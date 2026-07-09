import matter from "gray-matter";
import type { Nodes, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { RawSection } from "../types";
import {
	MAX_SECTION_TEXT_LENGTH,
	normalizeText,
	sha256,
	slugifyHeading,
	truncateText,
} from "../shared";

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);
const mdxProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);

// MDX import/export statements and `{/* … */}` expressions carry no search text.
const SCAFFOLDING_NODE_TYPES = new Set(["mdxjsEsm", "mdxFlowExpression"]);

export function parseDoc(content: string, mdx: boolean): Root {
	return (mdx ? mdxProcessor : markdownProcessor).parse(content);
}

export function nodeText(node: Nodes): string {
	return normalizeText(toString(node));
}

function isContentNode(node: RootContent) {
	return !SCAFFOLDING_NODE_TYPES.has(node.type);
}

/**
 * Split a Markdown/MDX document into search sections, one per h1–h3 heading
 * (plus a leading section for any content before the first heading). The parsed
 * frontmatter is prepended to every section so page metadata stays searchable.
 */
export function extractSections(
	source: string,
	pageTitle: string,
	mdx: boolean,
): RawSection[] {
	const { content, matter: frontmatter } = matter(source);
	const nodes = parseDoc(content, mdx).children.filter(isContentNode);

	type Group = {
		heading: string;
		anchor: string;
		// Heading depth (1 = h1, 2 = h2, 3 = h3). The leading pre-heading group is
		// page-level content, so it takes level 1 like the whole-page item.
		level: number;
		nodes: RootContent[];
	};
	const groups: Group[] = [
		{ heading: pageTitle, anchor: "", level: 1, nodes: [] },
	];

	for (const node of nodes) {
		if (node.type === "heading" && node.depth <= 3) {
			const heading = nodeText(node);
			groups.push({
				heading,
				anchor: slugifyHeading(heading),
				level: node.depth,
				nodes: [node],
			});
		} else {
			groups[groups.length - 1].nodes.push(node);
		}
	}

	const prefix = frontmatter.trim();
	const makeSection = (
		anchor: string,
		heading: string,
		body: string,
		level: number,
	): RawSection => {
		const text = truncateText(
			[prefix, body].filter(Boolean).join("\n\n"),
			MAX_SECTION_TEXT_LENGTH,
		);
		return { anchor, heading, text, hash: sha256(text), level };
	};

	const sections: RawSection[] = [];
	for (const group of groups) {
		const body = group.nodes
			.map((node) => nodeText(node))
			.filter(Boolean)
			.join("\n\n");
		if (!normalizeText(body)) continue;
		sections.push(makeSection(group.anchor, group.heading, body, group.level));
	}

	// Component-only pages (no headings or prose) still get one section so they
	// remain findable by title/description from frontmatter.
	if (sections.length === 0 && prefix) {
		return [makeSection("", pageTitle, "", 1)];
	}

	return sections;
}

/** Extract the plain text of a whole document, optionally dropping code blocks. */
export function documentText(
	source: string,
	mdx: boolean,
	{ dropCode = false } = {},
): string {
	const { content } = matter(source);
	const nodes = parseDoc(content, mdx).children.filter(
		(node) => isContentNode(node) && !(dropCode && node.type === "code"),
	);
	return nodes
		.map((node) => nodeText(node))
		.filter(Boolean)
		.join("\n\n");
}
