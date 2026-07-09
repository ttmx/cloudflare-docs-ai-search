# Search benchmark: AI Search prototype vs. production Algolia

Compares two search backends for the Cloudflare docs over the same query set:

- **Prototype** — the AI Search prototype worker
  (`devdocs-ai-search-prototype…workers.dev`, `GET /api/ai-search/search`).
- **Prod** — the production Algolia DocSearch index (`prod_devdocs`) that powers
  the search box on <https://developers.cloudflare.com/>. Credentials are the
  public search-only key scraped from the live site bundle.

## Run

```bash
pnpm run search:benchmark              # default: 100 queries, k=10
pnpm run search:benchmark -- --k 20
pnpm run search:benchmark -- --queries ./my-queries.json
pnpm run search:benchmark -- --judge   # add LLM relevance grading (nDCG)
pnpm run search:benchmark -- --delay 2000   # ms pause between queries (default 1500)
pnpm run search:benchmark -- --timeout 25000 # per-request timeout ms (default 25000)
```

Reports are written to `bin/search-benchmark/results/bench-<timestamp>.{json,md}`
plus a latency chart `latency-<timestamp>.svg` (and `.png` if `sharp` is
available). The Markdown report embeds the chart and a side-by-side top-5 for
every query.

### Pacing and reliability (important)

The prototype backend **degrades under sustained back-to-back load**: an
uncached query can take several seconds, and once a request hits the timeout the
instance trips into transient HTTP 500s for a while. To get clean steady-state
numbers the runner:

- warms up both engines before timing;
- paces requests with `--delay` (default 1.5 s);
- retries a transient 5xx/timeout once after a 3 s cooldown;
- computes latency stats **only over queries where both engines succeeded**, and
  reports error/retry counts separately.

Note the prototype **caches results per query**, so re-running the same query set
makes it look fast. Vary the query set to measure cold/uncached latency.

## Auth for the prototype

The prototype worker is behind Cloudflare Access. Either:

- `export CF_ACCESS_TOKEN="$(cloudflared access token -app=https://devdocs-ai-search-prototype.tteles-individual-account.workers.dev)"`, or
- leave it unset — the script shells out to `cloudflared access token` itself
  (run `cloudflared access login <worker-url>` once first).

Requests are sent with a `curl/…` User-Agent because the worker's bot
protection 403s the default runtime UA.

## Metrics

- **Latency** — mean / p50 / p95 wall-clock per engine.
- **Result overlap** — mean shared URLs, Jaccard, overlap-coefficient, and
  top-1 agreement between the two result sets (path-level, anchors ignored).
- **Empty result sets** — queries that returned nothing.
- **Relevance (optional, `--judge`)** — an LLM grades each result 0–3 for the
  query; the script reports **nDCG@k** per engine and a per-query win/loss
  tally. This is the only metric that measures *quality* rather than agreement,
  which matters because the two engines overlap little (they are not ranking the
  same corpus the same way).

There are two ways to judge relevance.

#### Option A — inline OpenAI-compatible judge (`--judge`)

```bash
export JUDGE_API_KEY=sk-...
export JUDGE_BASE_URL=https://api.openai.com/v1   # optional
export JUDGE_MODEL=gpt-4o-mini                      # optional
pnpm run search:benchmark -- --judge
```

#### Option B — blind judging via the coding agent's own subagents (no API key)

This is how the checked-in results were produced. It grades **blind**: the two
engines are anonymized as "A"/"B" (randomized per query) so the judge can't
systematically favor one, and it splits the work across parallel subagents.

1. Run the benchmark to produce `results/bench-<ts>.json`.
2. Build blind judging batches:
   ```bash
   pnpm run search:judge:prepare -- --batch 10 --out /tmp/judge
   ```
   This writes `/tmp/judge/batch-*.json` (what each judge reads) and
   `/tmp/judge/mapping.json` (the secret A/B → proto/prod key).
3. For each `batch-N.json`, have a subagent read it, grade every result 0–3, and
   write `/tmp/judge/grades-N.json` as `{ qid: { A:[...], B:[...] } }`. Run the
   batches in parallel.
4. Un-blind and score:
   ```bash
   pnpm run search:judge:compute -- --judge-dir /tmp/judge
   ```
   This maps A/B back to the real engines, computes **nDCG@k**, **Precision@3**,
   per-query win/loss, and writes `results/bench-<ts>-judged.json` plus an
   `results/ndcg-<ts>.svg/.png` distribution chart.

Reliability vs. quality: queries where the prototype errored/returned nothing
score nDCG 0. Report both the raw number and the number excluding errored
queries so a reliability blip isn't confused with poor ranking.

## Query set

Two curated sets ship (each an array of `{ "query": "...", "product": "..." }`):

- `queries.json` (default, ~100) — **natural-language** queries: descriptive
  phrases and "how to X" style, spanning ~40 products.
- `queries-direct.json` (80) — **short/direct keyword** queries someone types
  when they roughly know what they want (product names, feature terms, error
  codes): `"r2"`, `"workers kv"`, `"mtls"`, `"error 1015"`, `"cron triggers"`.

### Benchmarking the blog search

`blog.cloudflare.com` search is *also* a Cloudflare AI Search instance
(`cf-blog-en-us`, hybrid vector+keyword), served by a **public** worker
`https://cloudflare-blog-public-endpoint.mrk.workers.dev` (POST `/search`,
`@cloudflare/ai-search-snippet` contract, `metadata_only` retrieval). Benchmark
it with the `blog` engine (no auth, no Algolia comparator, uses
`queries-blog.json` by default):

```bash
pnpm run search:benchmark -- --proto-engine blog --k 10 --delay 800
```

Finding (2026-07-06): the blog search is far faster than the devdocs AI Search
instances — p50 ~564ms vs 2342ms (new devdocs) / 4109ms (old prototype),
nearly matching Algolia keyword search (p50 371ms). Likely because it uses
`metadata_only` retrieval (no answer/snippet generation) over a smaller corpus.
Corpus differs (blog posts vs docs), so only latency is cross-comparable.

### Benchmarking a different AI Search deployment

Use `--proto-origin <url>` (each deployment has its own Access org; set
`CF_ACCESS_TOKEN` to that instance's `cloudflared access token`). Use
`--no-proto-auth` for a public endpoint and `--skip-prod` to drop the Algolia
comparator.

Run the direct set with:

```bash
pnpm run search:benchmark -- --queries bin/search-benchmark/queries-direct.json --delay 2000
pnpm run search:judge:prepare -- --out /tmp/judge-direct   # then subagents grade, then:
pnpm run search:judge:compute -- --judge-dir /tmp/judge-direct
```

**Query style changes the winner.** On natural-language queries the semantic
prototype ranks better (nDCG 0.85 vs 0.80, Precision@3 0.81 vs 0.48). On short
keyword/product-name queries the keyword engine (Algolia) is level-to-slightly
ahead (nDCG 0.92 vs 0.90) — it nails the exact product landing page. Always
report which set a number came from.
