// Builds the answer the backend gives for `ai_get_settings`, so a test can say
// "OpenRouter is chosen and has a key" in one line. Technical boilerplate only:
// the choices a test cares about are passed in, never hidden here.

import type { AiSettingsView, ProviderId, ProviderInfo } from "../../ai/providers";

const BASE: Record<
	ProviderId,
	Omit<
		ProviderInfo,
		"model" | "hasKey" | "fallbackModel" | "fallbackProvider" | "baseUrl" | "tuning"
	>
> = {
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		keyHelpUrl: "https://openrouter.ai/keys",
		supportsWebSearch: true,
		defaultModel: "google/gemma-4-31b-it",
		suggestedModels: ["google/gemma-4-31b-it", "openai/gpt-4o-mini"]
	},
	openai: {
		id: "openai",
		label: "OpenAI",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.openai.com/v1",
		keyHelpUrl: "https://platform.openai.com/api-keys",
		supportsWebSearch: false,
		defaultModel: "gpt-4o-mini",
		suggestedModels: ["gpt-4o-mini", "gpt-4o"]
	},
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.anthropic.com/v1",
		keyHelpUrl: "https://console.anthropic.com/settings/keys",
		supportsWebSearch: false,
		defaultModel: "claude-sonnet-5-5",
		suggestedModels: ["claude-sonnet-5-5", "claude-haiku-5-5"]
	},
	google: {
		id: "google",
		label: "Google (Gemini API)",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
		keyHelpUrl: "https://aistudio.google.com/apikey",
		supportsWebSearch: true,
		defaultModel: "gemini-3.8-flash",
		suggestedModels: ["gemini-3.8-flash", "gemma-4-31b-it"]
	},
	nvidia: {
		id: "nvidia",
		label: "NVIDIA",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
		keyHelpUrl: "https://build.nvidia.com/settings/api-keys",
		supportsWebSearch: false,
		defaultModel: "meta/llama-3.3-70b-instruct",
		suggestedModels: ["meta/llama-3.3-70b-instruct"]
	},
	groq: {
		id: "groq",
		label: "Groq",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.groq.com/openai/v1",
		keyHelpUrl: "https://console.groq.com/keys",
		supportsWebSearch: false,
		defaultModel: "llama-3.3-70b-versatile",
		suggestedModels: ["llama-3.3-70b-versatile"]
	},
	mistral: {
		id: "mistral",
		label: "Mistral",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.mistral.ai/v1",
		keyHelpUrl: "https://console.mistral.ai/api-keys",
		supportsWebSearch: false,
		defaultModel: "mistral-large-latest",
		suggestedModels: ["mistral-large-latest"]
	},
	xai: {
		id: "xai",
		label: "xAI",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.x.ai/v1",
		keyHelpUrl: "https://console.x.ai",
		supportsWebSearch: false,
		defaultModel: "grok-3",
		suggestedModels: ["grok-3"]
	},
	deepseek: {
		id: "deepseek",
		label: "DeepSeek",
		keyRequired: true,
		baseUrlEditable: false,
		defaultBaseUrl: "https://api.deepseek.com/v1",
		keyHelpUrl: "https://platform.deepseek.com/api_keys",
		supportsWebSearch: false,
		defaultModel: "deepseek-chat",
		suggestedModels: ["deepseek-chat"]
	},
	ollama: {
		id: "ollama",
		label: "Ollama (on this PC)",
		keyRequired: false,
		baseUrlEditable: true,
		defaultBaseUrl: "http://localhost:11434/v1",
		keyHelpUrl: "",
		supportsWebSearch: false,
		defaultModel: "llama3.2",
		suggestedModels: ["llama3.2"]
	},
	custom: {
		id: "custom",
		label: "Custom (OpenAI-compatible)",
		keyRequired: false,
		baseUrlEditable: true,
		defaultBaseUrl: "",
		keyHelpUrl: "",
		supportsWebSearch: false,
		defaultModel: "",
		suggestedModels: []
	}
};

type Saved = Partial<
	Pick<
		ProviderInfo,
		"model" | "hasKey" | "fallbackModel" | "fallbackProvider" | "baseUrl" | "tuning"
	>
>;

/** The view with every service in it; `saved` overrides what is saved for any of them. */
export function aiSettingsView(
	provider: ProviderId = "openrouter",
	saved: Partial<Record<ProviderId, Saved>> = {}
): AiSettingsView {
	return {
		provider,
		providers: (Object.keys(BASE) as ProviderId[]).map((id) => ({
			...BASE[id],
			model: BASE[id].defaultModel,
			hasKey: false,
			fallbackModel: null,
			fallbackProvider: null,
			baseUrl: null,
			tuning: {},
			...saved[id]
		}))
	};
}
