import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_PANEL_HEIGHT, fitAiPanelHeight } from "./panelSize";

describe("fitAiPanelHeight", () => {
	it("gives the height the content asked for when it fits", () => {
		expect(fitAiPanelHeight(500, 900)).toBe(500);
	});

	it("never goes below the welcome height", () => {
		expect(fitAiPanelHeight(100, 900)).toBe(AI_PANEL_HEIGHT.welcome);
	});

	it("never goes above the tallest the panel may be", () => {
		expect(fitAiPanelHeight(2000, 2000)).toBe(AI_PANEL_HEIGHT.max);
	});

	it("keeps a margin below the panel inside a short window", () => {
		expect(fitAiPanelHeight(600, 420)).toBe(404);
	});

	it("still gives a usable panel when the window is very short", () => {
		expect(fitAiPanelHeight(600, 200)).toBe(AI_PANEL_HEIGHT.welcome);
	});

	it("keeps the welcome height for a window that only just fits it", () => {
		expect(fitAiPanelHeight(AI_PANEL_HEIGHT.welcome, 300)).toBe(AI_PANEL_HEIGHT.welcome);
	});
});

describe("the notch window height", () => {
	const root = process.cwd();
	const configuredHeight = (
		JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8")) as {
			app: { windows: { label: string; height: number }[] };
		}
	).app.windows.find((window) => window.label === "main")?.height;

	it("is the same in the window config and in the Rust code that resizes it", () => {
		const rust = readFileSync(resolve(root, "src-tauri/src/utils.rs"), "utf8");
		const match = rust.match(/pub const NOTCH_WINDOW_HEIGHT: f64 = (\d+(?:\.\d+)?);/);

		expect(match).not.toBeNull();
		expect(Number(match?.[1])).toBe(configuredHeight);
	});

	it("is tall enough for the tallest assistant panel", () => {
		expect(configuredHeight).toBeGreaterThanOrEqual(AI_PANEL_HEIGHT.max);
	});

	it("is not hard-coded anywhere else in the Rust code", () => {
		const commands = readFileSync(resolve(root, "src-tauri/src/commands.rs"), "utf8");
		const services = readFileSync(resolve(root, "src-tauri/src/services.rs"), "utf8");

		expect(commands).not.toMatch(/420\.0/);
		expect(services).not.toMatch(/420\.0/);
	});
});
