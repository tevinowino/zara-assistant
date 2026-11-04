import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real orb draws on a canvas, which jsdom cannot. This stand-in records what
// it was asked to draw so the tests can read it back.
vi.mock("thinking-orbs", () => ({
	ThinkingOrb: ({
		state,
		size,
		theme,
		color,
		paused
	}: {
		state: string;
		size: number;
		theme: string;
		color?: string;
		paused?: boolean;
	}) => (
		<canvas
			data-testid="orb"
			data-state={state}
			data-size={size}
			data-theme={theme}
			data-color={color}
			data-paused={paused ? "true" : "false"}
		/>
	)
}));

import { WritingIndicator, orbThemeForInk, useOrbTheme } from "./ThinkingStatus";

afterEach(() => {
	document.documentElement.style.removeProperty("--zara-text");
});

describe("orbThemeForInk", () => {
	it("draws light dots on a dark notch, whose text is light", () => {
		expect(orbThemeForInk("#ffffff")).toBe("dark");
		expect(orbThemeForInk("rgb(240, 240, 240)")).toBe("dark");
	});

	it("draws dark dots on a light notch, whose text is dark", () => {
		expect(orbThemeForInk("#1c1c1e")).toBe("light");
		expect(orbThemeForInk("rgba(0, 0, 0, 0.9)")).toBe("light");
	});

	it("assumes the usual dark notch when the colour cannot be read", () => {
		expect(orbThemeForInk("")).toBe("dark");
		expect(orbThemeForInk("hotpink")).toBe("dark");
	});
});

describe("useOrbTheme", () => {
	it("follows the notch's text colour", () => {
		document.documentElement.style.setProperty("--zara-text", "#1c1c1e");

		const { result } = renderHook(() => useOrbTheme());

		expect(result.current).toBe("light");
	});

	it("changes when the user switches theme while it is on screen", async () => {
		document.documentElement.style.setProperty("--zara-text", "#ffffff");
		const { result } = renderHook(() => useOrbTheme());
		expect(result.current).toBe("dark");

		act(() => document.documentElement.style.setProperty("--zara-text", "#1c1c1e"));

		await waitFor(() => expect(result.current).toBe("light"));
	});
});

describe("WritingIndicator", () => {
	it("shows a composing orb and tells assistive technology the answer is being written", () => {
		render(<WritingIndicator />);

		expect(screen.getByTestId("orb")).toHaveAttribute("data-state", "composing");
		expect(screen.getByRole("status")).toHaveTextContent("Zara is writing");
	});

	it("tints the orb blue, the panel's colour for what Zara has said", () => {
		render(<WritingIndicator />);

		expect(screen.getByTestId("orb")).toHaveAttribute("data-color", "#0a84ff");
	});
});
