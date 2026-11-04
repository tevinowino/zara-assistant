import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { initTheme } from "./theme";
import { setInvokeHandler } from "./test/shims/tauriCore";
import { emitTauriEvent } from "./test/shims/tauriEvent";

describe("initTheme glow setting", () => {
	afterEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("data-glow");
		document.documentElement.removeAttribute("data-glass");
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.removeAttribute("style");
		document.documentElement.className = "";
	});

	it("draws the saved glow colour as soon as the page starts", () => {
		localStorage.setItem(
			"zara-glow",
			JSON.stringify({ enabled: true, color: "#ff7a59", intensity: 0.8 })
		);
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.dataset.glow).toBe("on");
		expect(document.documentElement.style.getPropertyValue("--glow-color")).toBe("#ff7a59");
		expect(document.documentElement.style.getPropertyValue("--glow-intensity")).toBe("0.8");
		stop();
	});

	it("is not glowing when nothing was saved", () => {
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.dataset.glow).toBe("off");
		stop();
	});

	it("follows the theme accent when the saved glow has no colour", () => {
		localStorage.setItem(
			"zara-glow",
			JSON.stringify({ enabled: true, color: null, intensity: 0.5 })
		);
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.style.getPropertyValue("--glow-color")).toBe(
			"var(--zara-accent, #007aff)"
		);
		stop();
	});

	it("changes the glow when another window saves it", async () => {
		setInvokeHandler("load_settings", () => ({}));
		const stop = initTheme();
		await waitFor(() => expect(document.documentElement.dataset.glow).toBe("off"));

		emitTauriEvent("settings-changed", {
			key: "zara-glow",
			value: JSON.stringify({ enabled: true, color: "#22c55e", intensity: 0.4 })
		});

		await waitFor(() => expect(document.documentElement.dataset.glow).toBe("on"));
		expect(document.documentElement.style.getPropertyValue("--glow-color")).toBe("#22c55e");
		stop();
	});

	it("draws glass and glow independently", () => {
		localStorage.setItem("zara-glass", JSON.stringify({ enabled: true }));
		setInvokeHandler("load_settings", () => ({}));

		const stop = initTheme();

		expect(document.documentElement.dataset.glass).toBe("on");
		expect(document.documentElement.dataset.glow).toBe("off");
		stop();
	});
});
