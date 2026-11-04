import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { applyTheme, initTheme } from "./theme";
import { setInvokeHandler } from "./test/shims/tauriCore";
import { emitTauriEvent } from "./test/shims/tauriEvent";

describe("applyTheme", () => {
	afterEach(() => {
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.className = "";
	});

	it("tells Glisse components to use their light palette in light mode", async () => {
		await applyTheme("light", "#007aff", 0.8, 0.5, 0.15);

		expect(document.documentElement.dataset.theme).toBe("light");
	});

	it("tells Glisse components to use their dark palette in dark mode", async () => {
		await applyTheme("dark", "#007aff", 0.8, 0.5, 0.15);

		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("follows the brightness of a custom colour rather than the OS", async () => {
		await applyTheme("custom", "#007aff", 0.8, 0.5, 0.9);
		expect(document.documentElement.dataset.theme).toBe("light");

		await applyTheme("custom", "#007aff", 0.8, 0.5, 0.1);
		expect(document.documentElement.dataset.theme).toBe("dark");
	});
});

describe("initTheme glass setting", () => {
	afterEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("data-glass");
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.className = "";
	});

	it("draws glass from the saved setting as soon as the page starts", () => {
		localStorage.setItem(
			"zara-glass",
			JSON.stringify({ enabled: true, edgeShine: 0.9, sheen: 0.3, edgeWidthPx: 2 })
		);
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.dataset.glass).toBe("on");
		expect(document.documentElement.style.getPropertyValue("--glass-shine")).toBe("0.9");
		stop();
	});

	it("is not glass when nothing was saved", () => {
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.dataset.glass).toBe("off");
		stop();
	});

	it("changes to glass when another window saves the setting", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const stop = initTheme();
		await waitFor(() => expect(document.documentElement.dataset.glass).toBe("off"));

		emitTauriEvent("settings-changed", {
			key: "zara-glass",
			value: JSON.stringify({ enabled: true, edgeShine: 0.5, sheen: 0.5, edgeWidthPx: 1.5 })
		});

		await waitFor(() => expect(document.documentElement.dataset.glass).toBe("on"));
		stop();
	});
});
