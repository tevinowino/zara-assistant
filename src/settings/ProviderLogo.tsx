import type { ComponentType, SVGProps } from "react";
import { Plug } from "../icons/glyphs";
import OpenAiMark from "../assets/providers/openai.svg?react";
import AnthropicMark from "../assets/providers/anthropic.svg?react";
import GeminiMark from "../assets/providers/gemini.svg?react";
import NvidiaMark from "../assets/providers/nvidia.svg?react";
import GroqMark from "../assets/providers/groq.svg?react";
import MistralMark from "../assets/providers/mistral.svg?react";
import XaiMark from "../assets/providers/xai.svg?react";
import DeepSeekMark from "../assets/providers/deepseek.svg?react";
import OllamaMark from "../assets/providers/ollama.svg?react";
import OpenRouterMark from "../assets/providers/openrouter.svg?react";
import type { ProviderId } from "../ai/providers";

// The marks are monochrome and draw in the current text colour, so they sit in the
// Settings window's black and white and read in the light theme too. Each is a
// trademark of its owner and is used only to identify the service.

const MARKS: Record<ProviderId, ComponentType<SVGProps<SVGSVGElement>>> = {
	openrouter: OpenRouterMark,
	openai: OpenAiMark,
	anthropic: AnthropicMark,
	google: GeminiMark,
	nvidia: NvidiaMark,
	groq: GroqMark,
	mistral: MistralMark,
	xai: XaiMark,
	deepseek: DeepSeekMark,
	ollama: OllamaMark,
	// A custom server has no brand: a plain plug says "bring your own".
	custom: Plug as unknown as ComponentType<SVGProps<SVGSVGElement>>
};

/** One line on what each service is, shown under its name. */
export const PROVIDER_TAGLINES: Record<ProviderId, string> = {
	openrouter: "One key for hundreds of models",
	openai: "GPT models",
	anthropic: "Claude models",
	google: "Gemini and Gemma models",
	nvidia: "Open models hosted by NVIDIA",
	groq: "Very fast open models",
	mistral: "Mistral's own models",
	xai: "Grok models",
	deepseek: "DeepSeek models",
	ollama: "Models running on this PC",
	custom: "Any OpenAI-compatible server"
};

interface ProviderLogoProps {
	provider: ProviderId;
	/** Width and height in CSS pixels. */
	size?: number;
}

/** A service's mark at a fixed size. Hidden from screen readers: the name is always next to it. */
export function ProviderLogo({ provider, size = 20 }: ProviderLogoProps) {
	const Mark = MARKS[provider];
	return (
		<span
			className="provider-logo"
			aria-hidden="true"
			style={{ width: `${size}px`, height: `${size}px` }}
		>
			<Mark width="100%" height="100%" fill="currentColor" />
		</span>
	);
}
