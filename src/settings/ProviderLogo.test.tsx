import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderLogo, PROVIDER_TAGLINES } from "./ProviderLogo";
import type { ProviderId } from "../ai/providers";

const ALL: ProviderId[] = [
	"openrouter",
	"openai",
	"anthropic",
	"google",
	"nvidia",
	"groq",
	"mistral",
	"xai",
	"deepseek",
	"ollama",
	"custom"
];

describe("ProviderLogo", () => {
	it("draws a mark for every service, including the custom one", () => {
		for (const id of ALL) {
			const { container, unmount } = render(<ProviderLogo provider={id} />);

			expect(container.querySelector("svg"), `${id} has no mark`).not.toBeNull();
			unmount();
		}
	});

	it("hides the mark from assistive technology, because the service's name is always beside it", () => {
		const { container } = render(<ProviderLogo provider="openai" />);

		expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
	});

	it("draws in the text colour, so it reads on the dark and the light theme", () => {
		const { container } = render(<ProviderLogo provider="anthropic" />);

		const svg = container.querySelector("svg") as SVGElement;
		expect(svg.getAttribute("fill")).toBe("currentColor");
	});

	it("takes the size it is given", () => {
		const { container } = render(<ProviderLogo provider="groq" size={28} />);

		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.style.width).toBe("28px");
		expect(wrapper.style.height).toBe("28px");
	});
});

describe("PROVIDER_TAGLINES", () => {
	it("has a short line for every service", () => {
		for (const id of ALL) {
			expect(PROVIDER_TAGLINES[id].length, `${id} has no tagline`).toBeGreaterThan(8);
			expect(PROVIDER_TAGLINES[id].length).toBeLessThan(50);
		}
	});
});
