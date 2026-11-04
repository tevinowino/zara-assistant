import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { fileURLToPath } from "node:url";
import { iconoirAlias } from "./iconoirAlias";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Component and library tests for src/. The pure-TypeScript tests in scripts/
// run under `bun test` (see bunfig.toml); the two runners have disjoint scopes.
//
// Tauri's JavaScript API is replaced with in-memory shims so a component can be
// rendered without a backend. Tests drive the shims through the helpers they
// export (setInvokeHandler, emitTauriEvent).
export default defineConfig({
	plugins: [react(), svgr()],
	resolve: {
		alias: [
			{ find: "@tauri-apps/api/core", replacement: fromRoot("./src/test/shims/tauriCore.ts") },
			{ find: "@tauri-apps/api/event", replacement: fromRoot("./src/test/shims/tauriEvent.ts") },
			{ find: "@tauri-apps/plugin-opener", replacement: fromRoot("./src/test/shims/pluginOpener.ts") },
			iconoirAlias
		]
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["./src/test/setup.ts"],
		css: false,
		// The first use of a lazily loaded library (syntax highlighting, charts,
		// diagrams) is slow when many jsdom workers run at once.
		testTimeout: 20_000
	}
});
