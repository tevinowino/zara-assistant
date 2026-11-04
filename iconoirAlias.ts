import { fileURLToPath } from "node:url";

/**
 * Lets src/icons/glyphs.tsx import single Iconoir icons ("iconoir-icons/Settings") instead
 * of the package's index, which pulls in all 1,385 icons: that cost a build nothing (unused
 * icons are dropped) but made every test file load them all, doubling the test run's time.
 * Shared by vite.config.ts and vitest.config.ts so the app and its tests resolve alike.
 */
export const iconoirAlias = {
	find: /^iconoir-icons\/(.+)$/,
	replacement:
		fileURLToPath(new URL("./node_modules/iconoir-react/dist/esm/regular/", import.meta.url)) +
		"$1.mjs"
};
