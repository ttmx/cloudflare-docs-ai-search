# Basic local AI Search reindexing plan

## Goal

Build a laptop-local prototype for docs change detection and reindex notification:

1. Build the docs site locally or in CI so `dist/` exists.
2. Discover indexable pages from rendered `dist/**/*.html`, but prefer original source Markdown/MDX for search text when a source file exists.
3. Hash the selected search text, not full rendered HTML chrome.
4. Compare those hashes against a previous manifest stored locally on this laptop.
5. Generate a page/section-level diff with stable section item keys and source URLs.
6. Send that diff in one API call to a configurable endpoint.
7. Save the latest manifest locally after a successful dry run or send.

This intentionally avoids R2, Queues, and deployment plumbing for now.

## Explicit indexing model

Use **diff-driven indexing only**.

The AI Search instance must use built-in storage and the Items API. Do not use AI Search crawler mode for this flow.

Crawler mode is intentionally out of scope because it independently discovers and syncs pages, which can race with or duplicate the build-generated diff. The docs build pipeline should be the authoritative source of what changed. Reindexing should happen only when the local/CI hash diff emits a changed or deleted page event.

Required shape:

1. Initial indexing sends all included pages as `docs.page.changed` events to the reindex endpoint.
2. Subsequent runs compare selected search-document hashes against local state.
3. Changed pages are uploaded/replaced through the Items API as section-level items.
4. Deleted pages remove all section items for that page key prefix.
5. No crawler-backed AI Search instance should be used by the Worker binding.
6. Scope can be narrowed for prototype runs with `--include-path-prefix`; the current low-resource prototype scope is `/ai-search/` only.

## Local state

Use a local, gitignored directory:

```txt
.ai-search/
  page-hashes.json      # Last accepted manifest
  latest-page-hashes.json
  docs-search-events.jsonl
```

## Search text extraction

Rendered HTML is used as the authoritative page inventory because it reflects final routes, redirects, and `noindex` state. The text uploaded to AI Search should use the cleanest available source in this order:

1. Source Markdown/MDX under `src/content/docs` when a rendered page maps to one of:
   - `src/content/docs/<path>.mdx`
   - `src/content/docs/<path>.md`
   - `src/content/docs/<path>/index.mdx`
   - `src/content/docs/<path>/index.md`
2. Curated source projections for generated pages that do not have docs Markdown, such as AI model catalog JSON, changelog data, video metadata, fields references, and navigation/index data. The prototype now includes curated extractors for AI model catalogs, Workers AI model pages, license notices, changelog post pages, Ruleset Engine field references, videos, and the primary generated landing/index pages.
3. Cleaned rendered HTML as the fallback only.

This avoids repeatedly indexing footer/sidebar/navbar content and avoids syntax-highlighted HTML for normal MDX pages. In the current build, this covers all `/ai-search/` pages and roughly 79% of full-site indexable pages.

Fallback HTML extraction must remove global chrome and known high-noise content such as raw model responses, sidebars, breadcrumbs, scripts, styles, and oversized code blocks. Large sections are capped before hashing/upload.

## Page category indexing strategies

A dry-run audit of the current build found 8,105 indexable HTML pages. About 6,416 of them map directly to source Markdown/MDX under `src/content/docs` and should use the source Markdown path. The remaining generated/non-doc-source pages need page-type-specific strategies before full-site indexing.

Index at the most specific stable target that users can land on:

- For Markdown/MDX docs, index `h1`/`h2`/`h3` sections with anchor URLs, not only whole pages.
- For generated reference pages, index logical records such as model examples, rules fields, changelog posts, video entries, and glossary terms.
- The prototype should upload one AI Search item per section/record, using stable Markdown item keys such as `docs/path/index.anchor.md` and source URLs with `#anchor`, so search results can direct users to the right paragraph instead of only the page.

| Category                                 |         Current count | Example paths                                                               | Strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------: | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source docs Markdown/MDX                 |                ~6,416 | `/ai-search/`, `/workers/`, `/r2/`                                          | Use source Markdown/MDX as the search document. Rendered HTML only discovers final URL/noindex/title. Strip frontmatter/import scaffolding, split by headings, cap oversized sections.                                                                                                                                                                                                                                                                             |
| Third-party/license notice pages         | small, but very large | `/realtime/realtimekit/legal/3rdparty/`, `/cloudflare-wan/legal/3rdparty/`  | Index the title, description, SDK/product overview, license names/counts, and package names listed under each license. Do **not** index license bodies/copyright grant text. Keep the page discoverable for queries like “RealtimeKit MIT license uuid”, but do not let license boilerplate dominate search.                                                                                                                                                       |
| Changelog post pages                     |                ~1,199 | `/changelog/post/...`                                                       | **Implemented.** Index only actual changelog posts, sourced from `src/content/changelog/**/*.mdx` frontmatter/body when a source file exists. Index title, date, product, summary/description, body, and source URL. Changelog listing, pagination, product/group listing, RSS/XML/feed pages remain excluded; individual posts carry the searchable content and listing pages duplicate it.                                                                       |
| AI model catalog pages                   |                  ~199 | `/ai/models/openai/gpt-5-nano/`                                             | Use curated `src/content/catalog-models/*.json` projection. Include model ID, display name, provider, task, description, context/output limits, ZDR/support flags, request formats, pricing/terms/external info links, schema field names/descriptions, small usage snippets, and example names/descriptions/input prompts/output excerpts. Exclude `raw_response`, streaming chunks, obfuscation fields, duplicated output, media payloads, and full raw schemas. |
| Workers AI legacy model pages            |                   ~80 | `/workers-ai/models/bge-m3/`                                                | Use curated `src/content/workers-ai-models/*.json` projection plus legacy model metadata. Include model name, author/provider, task, description, properties/capabilities, limits, input/output schema summaries, and concise code examples. Exclude generated HTML, full raw response payloads, and repetitive schema dumps.                                                                                                                                      |
| Ruleset Engine generated field reference |                  ~171 | `/ruleset-engine/rules-language/fields/reference/ip.src/`                   | **Implemented.** Uses `src/content/fields/index.yaml` to index field name, data type, categories, keywords, summary/description, plan label, example value, and example expression. Excludes repeated reference-table navigation and syntax-highlighted HTML markup that appears on every field page.                                                                                                                                                              |
| Video pages                              |                   ~31 | `/videos/load-balancing/`                                                   | **Implemented.** Uses `src/content/stream/**/index.{yaml,yml,json}` metadata. Indexes title, video ID, description, products/tags, chapters, and cleaned transcript when available. Does not index player/embed markup.                                                                                                                                                                                                                                            |
| Generated landing/index pages            |                 small | `/`, `/directory/`, `/glossary/`, `/plans/`, `/resources/`, `/agent-setup/` | **Implemented for the primary generated landing pages.** Uses concise structured projections for the home/sidebar links, directory cards, glossary terms, plan feature availability, video resources, and agent setup prompt/catalog data. These pages should still be treated as navigation aids with lower rank/boost than primary docs answers.                                                                                                                 |
| API/schema JSON endpoints                |       route-dependent | `/ai/models/.../schema-input.json`, Workers/Pages compatibility JSON        | Do not index standalone JSON endpoints by default. Fold concise schema summaries into their owning reference page when useful. Exclude raw JSON API/data endpoints from search items unless there is a user-facing reference page whose purpose is the JSON itself.                                                                                                                                                                                                |
| LLMS, prompt, RSS, XML, and feed routes  |       route-dependent | `/llms.txt`, `/workers/prompt.txt`, `/changelog/rss/...`                    | Exclude from AI Search page indexing. These are machine/feed artifacts or alternate representations, not search-result destinations. Their source content should already be represented by docs pages/posts.                                                                                                                                                                                                                                                       |
| Other generated/special pages            |  currently very small | `/realtime/realtimekit/broadcast-apis/`, support edge cases                 | Add explicit extractors as they appear. Until covered, fallback to cleaned HTML with strict caps and review dry-run output before full indexing.                                                                                                                                                                                                                                                                                                                   |

Full-site indexing should not run until the remaining API/schema JSON endpoints and other generated/special pages either have a curated extractor or an explicit exclude/summary-only policy, and until dry-run payload size and relevance have been reviewed.

## CLI shape

Add/extend a script that can be run after `pnpm run build`:

```bash
pnpm run ai-search:events -- \
  --dist dist \
  --source-docs-dir src/content/docs \
  --state-dir .ai-search \
  --events .ai-search/docs-search-events.jsonl \
  --send-url http://localhost:8787/reindex \
  --commit
```

Behavior:

- If no previous local manifest exists, generate one and treat it as a baseline unless `--send-initial` is passed.
- If a previous manifest exists, compare and emit changed/deleted page events.
- Changelog listing/pagination/feed pages are excluded (`/changelog/`, `/changelog/123/`, product/group listings, RSS/feed routes); only `/changelog/post/...` pages are included.
- Machine/feed/raw endpoint routes are excluded from the HTML inventory when present, including `.json`, `.xml`, `.rss`, `.txt`, and RSS/feed paths.
- If `--include-path-prefix` is passed, include only pages whose final docs path starts with this prefix after built-in route exclusions are applied. Repeat the flag for multiple prefixes.
- If `--send-url` is passed, POST one JSON payload containing the diff.
- If `--commit` is passed, update `.ai-search/page-hashes.json` after the send succeeds. If no send URL is used, commit immediately after generating the diff.

## API payload

Send one JSON payload:

```json
{
	"version": 1,
	"generatedAt": "2026-06-26T...Z",
	"baseUrl": "https://developers.cloudflare.com",
	"summary": {
		"pages": 5400,
		"changed": 3,
		"deleted": 1
	},
	"events": [
		{
			"type": "docs.page.changed",
			"path": "/workers/",
			"url": "https://developers.cloudflare.com/workers/",
			"key": "docs/workers/index.md",
			"previousHash": "...",
			"hash": "...",
			"changedSections": [
				{
					"anchor": "get-started",
					"heading": "Get started",
					"hash": "...",
					"key": "docs/workers/index.md#get-started",
					"url": "https://developers.cloudflare.com/workers/#get-started"
				}
			],
			"page": { "...": "full page manifest entry" }
		}
	]
}
```

## Validation

- Keep the script type-safe.
- Run Prettier and ESLint on edited files.
- Test with a synthetic `dist/` directory before trying a full docs build.
- For full-site work, dry-run manifests first; do not trigger full indexing until extractor coverage, payload size, and excluded/generated page handling have been reviewed.
