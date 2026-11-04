import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EdgeSurface } from "./EdgeSurface";

describe("EdgeSurface", () => {
	it("draws the surface, a glass layer and a glow layer, all hidden from assistive technology", () => {
		const { container } = render(<EdgeSurface edge="top" flares />);

		const surface = container.querySelector(".edge-surface.edge-surface--top.show-flares");
		const glass = container.querySelector(".edge-surface-glass");
		const glow = container.querySelector(".edge-surface-glow");
		expect(surface).toHaveAttribute("aria-hidden", "true");
		expect(glass).toHaveAttribute("aria-hidden", "true");
		expect(glow).toHaveAttribute("aria-hidden", "true");
		expect(glass?.parentElement).toBe(surface?.parentElement);
		expect(glow?.parentElement).toBe(surface?.parentElement);
	});

	it("puts the glow before the surface so it paints behind it", () => {
		const { container } = render(<EdgeSurface edge="top" />);

		const layers = Array.from(container.children).map((layer) => layer.className.split(" ")[0]);

		expect(layers).toEqual(["edge-surface-glow", "edge-surface", "edge-surface-glass"]);
	});

	it("leaves the flares off when asked", () => {
		const { container } = render(<EdgeSurface edge="left" flares={false} />);

		expect(container.querySelector(".edge-surface--left")).not.toHaveClass("show-flares");
	});
});
