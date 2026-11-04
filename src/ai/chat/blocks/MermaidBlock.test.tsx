import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeMermaid = {
	initialize: vi.fn(),
	parse: vi.fn(async (_source: string, _options?: unknown) => true),
	render: vi.fn(async (_id: string, _source: string) => ({
		svg: '<svg viewBox="0 0 800 400" width="800" height="400"><text>Request</text></svg>'
	}))
};

vi.mock("./loaders", async (importOriginal) => ({
	...(await importOriginal<typeof import("./loaders")>()),
	loadMermaid: async () => fakeMermaid
}));

import { MermaidBlock } from "./MermaidBlock";

const flowchart = "flowchart TD\nA[Request] --> B{Cache hit?}";

function lookAtWidth(width: number) {
	const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => width
	});
	return () => {
		if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
		else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
	};
}

let restoreWidth: (() => void) | null = null;

beforeEach(() => {
	fakeMermaid.initialize.mockClear();
	fakeMermaid.parse.mockClear();
	fakeMermaid.render.mockClear();
	fakeMermaid.parse.mockResolvedValue(true);
	document.documentElement.style.setProperty("--zara-text", "#ffffff");
	document.documentElement.style.setProperty("--zara-bg-expanded", "rgba(0, 0, 0, 0.92)");
});

afterEach(() => {
	restoreWidth?.();
	restoreWidth = null;
	document.documentElement.style.removeProperty("--zara-text");
	document.documentElement.style.removeProperty("--zara-bg-expanded");
});

describe("MermaidBlock", () => {
	it("draws the diagram once it has been rendered", async () => {
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);

		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
		expect(container.querySelector(".zai-diagram")).not.toBeNull();
	});

	it("themes the diagram from the notch's own colours", async () => {
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);
		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		const config = fakeMermaid.initialize.mock.calls.at(-1)?.[0];

		expect(config.theme).toBe("base");
		expect(config.themeVariables.primaryTextColor).toBe("#ffffff");
		expect(config.securityLevel).toBe("strict");
	});

	it("draws labels as SVG text so they survive sanitising", async () => {
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);
		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		const config = fakeMermaid.initialize.mock.calls.at(-1)?.[0];

		expect(config.flowchart.htmlLabels).toBe(false);
		expect(config.htmlLabels).toBe(false);
	});

	it("lets the model colour flowchart nodes with the accent names", async () => {
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);
		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		const drawnSource = fakeMermaid.render.mock.calls[0][1];

		expect(drawnSource.startsWith(flowchart)).toBe(true);
		expect(drawnSource).toContain("classDef green fill:");
	});

	it("checks the model's own source before adding anything to it", async () => {
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);
		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		expect(fakeMermaid.parse.mock.calls[0][0]).toBe(flowchart);
	});

	it("sizes the diagram to its own shape at the width it is drawn", async () => {
		restoreWidth = lookAtWidth(400);
		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={300} />);

		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		// 800 x 400 drawn 400 wide is 200 tall.
		await waitFor(() =>
			expect((container.querySelector(".zai-diagram") as HTMLElement).style.height).toBe("200px")
		);
	});

	it("shows a fallback card for a diagram with invalid syntax", async () => {
		fakeMermaid.parse.mockResolvedValue(false);

		render(<MermaidBlock data={{ source: "flowchart ???" }} height={200} />);

		expect(await screen.findByText("Invalid diagram syntax.")).toBeInTheDocument();
		expect(fakeMermaid.render).not.toHaveBeenCalled();
	});

	it("shows a fallback card when drawing fails", async () => {
		fakeMermaid.render.mockRejectedValueOnce(new Error("could not lay out"));

		render(<MermaidBlock data={{ source: flowchart }} height={200} />);

		expect(await screen.findByText("could not lay out")).toBeInTheDocument();
	});

	it("removes scripts and event handlers that come back in the drawing", async () => {
		fakeMermaid.render.mockResolvedValueOnce({
			svg: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="alert(1)" /></svg>'
		});

		const { container } = render(<MermaidBlock data={{ source: flowchart }} height={200} />);
		await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("[onclick]")).toBeNull();
	});
});
