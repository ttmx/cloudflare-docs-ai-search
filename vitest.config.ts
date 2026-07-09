import { defineConfig, defineProject } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { getViteConfig } from "astro/config";

import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	test: {
		projects: [
			defineConfig({
				plugins: [
					cloudflareTest({
						wrangler: { configPath: "./wrangler.jsonc" },
						// Run all bindings locally. The AI Search namespace binding has no
						// local simulator, so with remote bindings enabled the pool would
						// try to open an (Access-gated) remote proxy session for it — which
						// fails in CI without service-token credentials. Tests don't exercise
						// AI Search or the queue directly, so fully-local is what we want.
						remoteBindings: false,
					}),
				],
				test: {
					name: "Workers",
					include: ["**/*.worker.test.ts"],
					deps: {
						optimizer: {
							ssr: {
								enabled: true,
								include: ["node-html-parser", "yaml"],
							},
						},
					},
				},
			}),
			defineProject({
				test: {
					name: "Node",
					include: ["**/*.node.test.ts"],
					environment: "happy-dom",
				},
				plugins: [tsconfigPaths()],
			}),
			getViteConfig({
				test: {
					name: "Astro",
					include: ["**/*.astro.test.ts"],
				},
				plugins: [tsconfigPaths()],
			}),
		],
	},
});
