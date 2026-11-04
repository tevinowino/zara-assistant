import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StealthBadge, StealthRim } from "./StealthMark";

describe("StealthRim", () => {
	it("is violet while stealth is holding", () => {
		const { container } = render(<StealthRim active />);

		expect(container.querySelector(".stealth-rim")).toHaveAttribute("data-state", "active");
	});

	it("is amber when stealth was asked for but is not holding", () => {
		const { container } = render(<StealthRim active={false} />);

		expect(container.querySelector(".stealth-rim")).toHaveAttribute("data-state", "problem");
	});

	it("is purely decorative, so it is hidden from assistive technology", () => {
		const { container } = render(<StealthRim active />);

		expect(container.querySelector(".stealth-rim")).toHaveAttribute("aria-hidden", "true");
	});
});

describe("StealthBadge", () => {
	it("says Zara is hidden from screen capture while stealth is holding", () => {
		render(<StealthBadge active problem={null} />);

		expect(
			screen.getByRole("img", { name: "Stealth mode is on: Zara is hidden from screen capture" })
		).toBeInTheDocument();
	});

	it("says stealth is not holding, and why", () => {
		render(<StealthBadge active={false} problem="One window could not be hidden." />);

		expect(
			screen.getByRole("img", {
				name: "Stealth mode is on but not holding: One window could not be hidden."
			})
		).toBeInTheDocument();
	});

	it("says stealth is not holding even when no reason is known", () => {
		render(<StealthBadge active={false} problem={null} />);

		expect(
			screen.getByRole("img", { name: "Stealth mode is on but not holding" })
		).toBeInTheDocument();
	});

	it("is amber when not holding", () => {
		render(<StealthBadge active={false} problem={null} />);

		expect(screen.getByRole("img")).toHaveAttribute("data-state", "problem");
	});
});
