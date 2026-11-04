// What the settings screen knows about the AI services Zara can use. The list
// itself lives in the backend (src-tauri/src/ai/providers.rs); this is its shape
// over IPC, plus the names of the settings that hold the user's choice.

export type ProviderId =
	| "openrouter"
	| "openai"
	| "anthropic"
	| "google"
	| "nvidia"
	| "groq"
	| "mistral"
	| "xai"
	| "deepseek"
	| "ollama"
	| "custom";

/** One service, and what is saved for it. */
export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** False for a local server that works without a key. */
	keyRequired: boolean;
	/** The user gives the address (a custom or local server). */
	baseUrlEditable: boolean;
	defaultBaseUrl: string;
	/** Where to get a key; empty when there is nothing to get. */
	keyHelpUrl: string;
	/** The service can search the web for a request. */
	supportsWebSearch: boolean;
	/** The model used when none is chosen; empty when there is none to suggest. */
	defaultModel: string;
	suggestedModels: string[];
	/** A key is saved for it. The key itself never reaches the page. */
	hasKey: boolean;
	/** Its model: the one chosen, else its default. */
	model: string;
	fallbackModel: string | null;
	/** The service the backup model is on, when it is not this one. */
	fallbackProvider: ProviderId | null;
	/** The address of a custom or local server, when one was given. */
	baseUrl: string | null;
	/** The settings saved for each of its models (how hard it thinks and so on), by model name. */
	tuning: Record<string, TuningValues>;
}

/** What one setting of a model is set to. Numbers for sliders and counts, text for choices and JSON. */
export type TuningValue = string | number | boolean;

/** The settings chosen for one model, by setting id. A setting not here is left at its default. */
export type TuningValues = Record<string, TuningValue>;

/** One setting a model accepts, as the backend describes it (src-tauri/src/ai/tuning.rs). */
export type ControlInfo = {
	id: string;
	label: string;
	help: string;
	group: "reasoning" | "sampling" | "output" | "advanced";
	/** What is used when nothing is chosen, if the app needs one. */
	fallback: string | null;
	/** The value the Fast preset gives this setting for this model; null when the preset leaves it alone. */
	fast: string | null;
} & (
	| { type: "choice"; choices: { value: string; label: string }[] }
	| { type: "toggle" }
	| { type: "number"; min: number; max: number; step: number; whole: boolean }
	| { type: "json" }
);

export interface AiSettingsView {
	/** The service the assistant is using. */
	provider: ProviderId;
	providers: ProviderInfo[];
}

/** The settings that hold one service's choices; the backend reads the same names. */
export function aiSettingKeys(provider: ProviderId) {
	return {
		model: `zara-ai-model-${provider}`,
		fallbackModel: `zara-ai-fallback-model-${provider}`,
		fallbackProvider: `zara-ai-fallback-provider-${provider}`,
		baseUrl: `zara-ai-base-url-${provider}`
	};
}

/** The setting that holds which service is chosen. */
export const AI_PROVIDER_SETTING = "zara-ai-provider";

/** The names on tiles and menus; the full names are long ("Custom (OpenAI-compatible)"). */
const SHORT_NAMES: Partial<Record<ProviderId, string>> = {
	google: "Google",
	ollama: "Ollama",
	custom: "Custom"
};

export function shortName(service: ProviderInfo): string {
	return SHORT_NAMES[service.id] ?? service.label;
}

export type Readiness = "ready" | "needs-key" | "needs-setup";

/** Whether a service has what it needs to be used, or what it is missing. */
export function readinessOf(service: ProviderInfo): Readiness {
	if (service.keyRequired && !service.hasKey) return "needs-key";
	if (service.model.trim() === "") return "needs-setup";
	if (service.baseUrlEditable && service.defaultBaseUrl === "" && !service.baseUrl)
		return "needs-setup";
	return "ready";
}
