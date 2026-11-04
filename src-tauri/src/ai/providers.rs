//! Which AI services Zara can talk to, and what each one needs.
//!
//! Most services speak the same "chat completions" dialect, so one client
//! covers OpenRouter, OpenAI, NVIDIA, Groq, Mistral, xAI, DeepSeek, a local Ollama
//! server and any custom address. Anthropic and Google have their own wire formats
//! and their own clients (Google's is what lets Gemini and Gemma search the web).
//!
//! What the user chooses lives in `settings.json` (never a secret): the service,
//! the model, an optional fallback model, and for custom and local servers the
//! address. The API key for each service is kept apart, in Windows Credential
//! Manager under that service's own account, so a key is only ever sent to the
//! service it belongs to.

use super::llm::AiError;
use serde::{Deserialize, Serialize};

/// The setting that holds which service is chosen.
pub const SETTING_PROVIDER: &str = "zara-ai-provider";

// Model, fallback and address are remembered per service, so switching to another
// service and back does not lose what was set for each.

/// The setting that holds a service's model.
pub fn model_setting(provider: ProviderId) -> String {
    format!("zara-ai-model-{}", serde_name(provider))
}

/// The setting that holds a service's fallback model.
pub fn fallback_model_setting(provider: ProviderId) -> String {
    format!("zara-ai-fallback-model-{}", serde_name(provider))
}

/// The setting that holds which service a service's fallback model is on. Absent
/// means the same service.
pub fn fallback_provider_setting(provider: ProviderId) -> String {
    format!("zara-ai-fallback-provider-{}", serde_name(provider))
}

/// The setting that holds the address of a custom or local server.
pub fn base_url_setting(provider: ProviderId) -> String {
    format!("zara-ai-base-url-{}", serde_name(provider))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ProviderId {
    #[serde(rename = "openrouter")]
    OpenRouter,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "nvidia")]
    Nvidia,
    #[serde(rename = "groq")]
    Groq,
    #[serde(rename = "mistral")]
    Mistral,
    #[serde(rename = "xai")]
    Xai,
    #[serde(rename = "deepseek")]
    DeepSeek,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "custom")]
    Custom,
}

/// How requests to a service are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Wire {
    /// `POST {base}/chat/completions`, `Authorization: Bearer`.
    ChatCompletions,
    /// Anthropic's Messages API: `POST {base}/messages`, `x-api-key`.
    AnthropicMessages,
    /// The Gemini API: `POST {base}/models/{model}:generateContent`, `x-goog-api-key`.
    GeminiGenerateContent,
}

pub struct ProviderSpec {
    pub id: ProviderId,
    pub label: &'static str,
    /// The API root, so that `{base_url}/chat/completions` (or `/messages`) is the
    /// endpoint. Empty for a custom server, whose address the user gives.
    pub base_url: &'static str,
    pub wire: Wire,
    /// False only for a local server that needs no key.
    pub key_required: bool,
    /// Whether the user can give the address (a custom or local server).
    pub base_url_editable: bool,
    /// Where to get a key; empty when there is none to get.
    pub key_help_url: &'static str,
    /// Whether the service can search the web for a request (see `chat`).
    pub supports_web_search: bool,
    /// Models offered as suggestions. The first is the default.
    pub suggested_models: &'static [&'static str],
    /// The Credential Manager account that holds this service's key.
    pub secret_account: &'static str,
}

const PROVIDERS: [ProviderSpec; 11] = [
    ProviderSpec {
        id: ProviderId::OpenRouter,
        label: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://openrouter.ai/keys",
        supports_web_search: true,
        suggested_models: &[
            "google/gemma-4-31b-it",
            "openai/gpt-4o-mini",
            "anthropic/claude-sonnet-4.5",
            "google/gemini-2.5-flash",
            "meta-llama/llama-3.3-70b-instruct",
        ],
        // Kept as the account the first build used, so an existing key still works.
        secret_account: "openrouter-api-key",
    },
    ProviderSpec {
        id: ProviderId::OpenAi,
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://platform.openai.com/api-keys",
        supports_web_search: false,
        suggested_models: &["gpt-4o-mini", "gpt-4o"],
        secret_account: "openai-api-key",
    },
    ProviderSpec {
        id: ProviderId::Anthropic,
        label: "Anthropic",
        base_url: "https://api.anthropic.com/v1",
        wire: Wire::AnthropicMessages,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://console.anthropic.com/settings/keys",
        supports_web_search: false,
        suggested_models: &["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
        secret_account: "anthropic-api-key",
    },
    ProviderSpec {
        id: ProviderId::Google,
        label: "Google (Gemini API)",
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        wire: Wire::GeminiGenerateContent,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://aistudio.google.com/apikey",
        // Google Search grounding, for Gemini and for Gemma 4 alike.
        supports_web_search: true,
        // From Google's model page (stable models first). Gemma is not on that page but is
        // served by the same API; "Load available models" shows what a key can really use.
        suggested_models: &[
            "gemini-3.8-flash",
            "gemini-4-argon",
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemma-4-31b-it",
            "gemini-flash-latest",
        ],
        secret_account: "google-api-key",
    },
    ProviderSpec {
        id: ProviderId::Nvidia,
        label: "NVIDIA",
        base_url: "https://integrate.api.nvidia.com/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://build.nvidia.com/settings/api-keys",
        supports_web_search: false,
        suggested_models: &["meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct"],
        secret_account: "nvidia-api-key",
    },
    ProviderSpec {
        id: ProviderId::Groq,
        label: "Groq",
        base_url: "https://api.groq.com/openai/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://console.groq.com/keys",
        supports_web_search: false,
        // From Groq's reasoning page: the reasoning models take an effort (see `tuning`).
        suggested_models: &[
            "llama-3.3-70b-versatile",
            "openai/gpt-oss-20b",
            "openai/gpt-oss-120b",
            "qwen/qwen3.8-27b",
            "meta-models/muse-spark-open",
        ],
        secret_account: "groq-api-key",
    },
    ProviderSpec {
        id: ProviderId::Mistral,
        label: "Mistral",
        base_url: "https://api.mistral.ai/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://console.mistral.ai/api-keys",
        supports_web_search: false,
        suggested_models: &["mistral-large-latest", "mistral-small-latest"],
        secret_account: "mistral-api-key",
    },
    ProviderSpec {
        id: ProviderId::Xai,
        label: "xAI",
        base_url: "https://api.x.ai/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://console.x.ai",
        supports_web_search: false,
        suggested_models: &["grok-3", "grok-3-mini"],
        secret_account: "xai-api-key",
    },
    ProviderSpec {
        id: ProviderId::DeepSeek,
        label: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        wire: Wire::ChatCompletions,
        key_required: true,
        base_url_editable: false,
        key_help_url: "https://platform.deepseek.com/api_keys",
        supports_web_search: false,
        suggested_models: &["deepseek-chat", "deepseek-reasoner"],
        secret_account: "deepseek-api-key",
    },
    ProviderSpec {
        id: ProviderId::Ollama,
        label: "Ollama (on this PC)",
        base_url: "http://localhost:11434/v1",
        wire: Wire::ChatCompletions,
        key_required: false,
        base_url_editable: true,
        key_help_url: "",
        supports_web_search: false,
        suggested_models: &["llama3.2", "gemma3"],
        secret_account: "ollama-api-key",
    },
    ProviderSpec {
        id: ProviderId::Custom,
        label: "Custom (OpenAI-compatible)",
        base_url: "",
        wire: Wire::ChatCompletions,
        key_required: false,
        base_url_editable: true,
        key_help_url: "",
        supports_web_search: false,
        suggested_models: &[],
        secret_account: "custom-api-key",
    },
];

/// Every service, in the order the settings list shows them.
pub fn all() -> &'static [ProviderSpec] {
    &PROVIDERS
}

pub fn spec(id: ProviderId) -> &'static ProviderSpec {
    PROVIDERS.iter().find(|provider| provider.id == id).expect("every ProviderId has a spec")
}

impl ProviderSpec {
    /// The model used when the user has not chosen one; empty when there is none.
    pub fn default_model(&self) -> &'static str {
        self.suggested_models.first().copied().unwrap_or("")
    }
}

impl ProviderId {
    pub fn from_setting(value: &str) -> Option<Self> {
        PROVIDERS.iter().find(|provider| serde_name(provider.id) == value.trim()).map(|p| p.id)
    }
}

/// The name a service goes by in settings and over IPC.
pub fn serde_name(id: ProviderId) -> &'static str {
    match id {
        ProviderId::OpenRouter => "openrouter",
        ProviderId::OpenAi => "openai",
        ProviderId::Anthropic => "anthropic",
        ProviderId::Google => "google",
        ProviderId::Nvidia => "nvidia",
        ProviderId::Groq => "groq",
        ProviderId::Mistral => "mistral",
        ProviderId::Xai => "xai",
        ProviderId::DeepSeek => "deepseek",
        ProviderId::Ollama => "ollama",
        ProviderId::Custom => "custom",
    }
}

/// What the user has chosen: the service, its model, a fallback and an address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConfig {
    pub provider: ProviderId,
    /// The model to use; the service's default when the user chose none.
    pub model: String,
    /// Tried when the main model cannot answer; never the same model on the same service.
    pub fallback_model: Option<String>,
    /// The service the fallback model is on, when it is not this one.
    pub fallback_provider: Option<ProviderId>,
    /// The fallback as something that can be built: its own service, model, address
    /// and settings. It has no fallback of its own.
    pub fallback: Option<Box<AiConfig>>,
    /// The address of a custom or local server, when the user gave one.
    pub base_url: Option<String>,
    /// The saved request settings of every model of this service, by model name
    /// (see `tuning`). The main and the fallback model each use their own entry.
    pub tuning: serde_json::Map<String, serde_json::Value>,
}

fn non_blank(value: Option<String>) -> Option<String> {
    value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

impl AiConfig {
    /// Reads the choice from settings. Anything missing or unrecognised falls back
    /// to OpenRouter with its default model, which is what the first build used.
    pub fn from_settings(get: &dyn Fn(&str) -> Option<String>) -> Self {
        let provider = get(SETTING_PROVIDER)
            .and_then(|value| ProviderId::from_setting(&value))
            .unwrap_or(ProviderId::OpenRouter);
        Self::for_provider(get, provider)
    }

    /// What is saved for one service, whether or not it is the chosen one.
    pub fn for_provider(get: &dyn Fn(&str) -> Option<String>, provider: ProviderId) -> Self {
        let model = non_blank(get(&model_setting(provider)))
            .unwrap_or_else(|| spec(provider).default_model().to_string());
        let fallback_provider = non_blank(get(&fallback_provider_setting(provider)))
            .and_then(|value| ProviderId::from_setting(&value))
            .filter(|other| *other != provider);
        let saved_fallback_model = non_blank(get(&fallback_model_setting(provider)));
        let fallback_model = match (saved_fallback_model, fallback_provider) {
            (Some(fallback), Some(_)) => Some(fallback),
            (Some(fallback), None) => Some(fallback).filter(|fallback| *fallback != model),
            // Another service with no model named: that service's own model.
            (None, Some(other)) => non_blank(get(&model_setting(other)))
                .or_else(|| Some(spec(other).default_model().to_string()))
                .filter(|fallback| !fallback.is_empty()),
            (None, None) => None,
        };
        let fallback = fallback_model.as_ref().map(|fallback| {
            Box::new(Self::target(get, fallback_provider.unwrap_or(provider), fallback.clone()))
        });
        let mut config = Self::target(get, provider, model);
        config.fallback_model = fallback_model;
        config.fallback_provider = fallback_provider;
        config.fallback = fallback;
        config
    }

    /// One service and model with its address and settings, and no fallback.
    fn target(get: &dyn Fn(&str) -> Option<String>, provider: ProviderId, model: String) -> Self {
        Self {
            provider,
            model,
            fallback_model: None,
            fallback_provider: None,
            fallback: None,
            base_url: non_blank(get(&base_url_setting(provider))),
            tuning: super::tuning::saved_for_provider(get, provider),
        }
    }

    /// The API root to send requests to, checked.
    pub fn api_root(&self) -> Result<String, AiError> {
        let spec = spec(self.provider);
        if !spec.base_url_editable {
            return Ok(spec.base_url.to_string());
        }
        match &self.base_url {
            Some(address) => validate_base_url(address),
            None if !spec.base_url.is_empty() => Ok(spec.base_url.to_string()),
            None => Err(AiError::Other("Enter the address of your server in Settings.".into())),
        }
    }
}

/// A server address that is safe to send a key to: `https`, or plain `http` only
/// to this computer. Trailing slashes are dropped.
pub fn validate_base_url(raw: &str) -> Result<String, AiError> {
    let invalid = || AiError::Other("That server address is not valid. Use an https:// address.".into());
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| invalid())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid());
    }
    let host = url.host_str().ok_or_else(invalid)?;
    let on_this_computer = matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1");
    match url.scheme() {
        "https" => {}
        "http" if on_this_computer => {}
        "http" => {
            return Err(AiError::Other(
                "Use an https:// address. Plain http is only allowed for a server on this computer.".into(),
            ))
        }
        _ => return Err(invalid()),
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn config_from(settings: &[(&str, &str)]) -> AiConfig {
        let map: HashMap<String, String> =
            settings.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect();
        AiConfig::from_settings(&|key| map.get(key).cloned())
    }

    fn model_key(provider: &str) -> String {
        format!("zara-ai-model-{provider}")
    }

    fn fallback_key(provider: &str) -> String {
        format!("zara-ai-fallback-model-{provider}")
    }

    fn address_key(provider: &str) -> String {
        format!("zara-ai-base-url-{provider}")
    }

    #[test]
    fn a_fallback_can_be_on_another_service() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-fallback-provider-openrouter", "anthropic"),
            ("zara-ai-fallback-model-openrouter", "claude-haiku-5-5"),
        ]);

        assert_eq!(config.fallback_provider, Some(ProviderId::Anthropic));
        assert_eq!(config.fallback_model.as_deref(), Some("claude-haiku-5-5"));
        let target = config.fallback.expect("there is a fallback");
        assert_eq!((target.provider, target.model.as_str()), (ProviderId::Anthropic, "claude-haiku-5-5"));
        assert!(target.fallback.is_none());
    }

    #[test]
    fn another_service_with_no_model_named_falls_back_to_that_services_own_model() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-fallback-provider-openrouter", "openai"),
            ("zara-ai-model-openai", "gpt-4o"),
        ]);

        assert_eq!(config.fallback_model.as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn naming_the_same_service_as_the_fallback_service_means_the_same_service() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openai"),
            ("zara-ai-fallback-provider-openai", "openai"),
            ("zara-ai-fallback-model-openai", "gpt-4o"),
        ]);

        assert_eq!(config.fallback_provider, None);
        assert_eq!(config.fallback.unwrap().provider, ProviderId::OpenAi);
    }

    #[test]
    fn the_same_model_on_another_service_is_a_real_fallback() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-model-openrouter", "gemma-4-31b-it"),
            ("zara-ai-fallback-provider-openrouter", "google"),
            ("zara-ai-fallback-model-openrouter", "gemma-4-31b-it"),
        ]);

        assert!(config.fallback.is_some());
    }

    #[test]
    fn with_nothing_saved_the_assistant_uses_openrouter_and_its_default_model() {
        let config = config_from(&[]);

        assert_eq!(config.provider, ProviderId::OpenRouter);
        assert_eq!(config.model, "google/gemma-4-31b-it");
        assert_eq!(config.fallback_model, None);
        assert_eq!(config.base_url, None);
    }

    #[test]
    fn the_chosen_service_and_model_are_used() {
        let config = config_from(&[(SETTING_PROVIDER, "anthropic"), (&model_key("anthropic"), "claude-haiku-5-5")]);

        assert_eq!(config.provider, ProviderId::Anthropic);
        assert_eq!(config.model, "claude-haiku-5-5");
    }

    #[test]
    fn a_service_with_no_model_chosen_gets_its_own_default() {
        let config = config_from(&[(SETTING_PROVIDER, "openai")]);

        assert_eq!(config.model, "gpt-4o-mini");
    }

    #[test]
    fn an_unknown_service_name_falls_back_to_openrouter() {
        assert_eq!(config_from(&[(SETTING_PROVIDER, "skynet")]).provider, ProviderId::OpenRouter);
    }

    #[test]
    fn a_blank_model_is_treated_as_none_chosen() {
        let config = config_from(&[(SETTING_PROVIDER, "openai"), (&model_key("openai"), "   ")]);

        assert_eq!(config.model, "gpt-4o-mini");
    }

    #[test]
    fn a_fallback_model_is_kept_when_it_differs_from_the_main_one() {
        let config = config_from(&[(&model_key("openrouter"), "a/main"), (&fallback_key("openrouter"), "b/backup")]);

        assert_eq!(config.fallback_model, Some("b/backup".to_string()));
    }

    #[test]
    fn a_fallback_the_same_as_the_main_model_is_dropped() {
        let config = config_from(&[(&model_key("openrouter"), "a/main"), (&fallback_key("openrouter"), "a/main")]);

        assert_eq!(config.fallback_model, None);
    }

    #[test]
    fn a_blank_fallback_means_none() {
        assert_eq!(config_from(&[(&fallback_key("openrouter"), "  ")]).fallback_model, None);
    }

    #[test]
    fn a_fixed_service_ignores_a_saved_address() {
        let config = config_from(&[(SETTING_PROVIDER, "openai"), (&address_key("openai"), "https://evil.example")]);

        assert_eq!(config.api_root().unwrap(), "https://api.openai.com/v1");
    }

    #[test]
    fn a_custom_server_uses_the_address_the_user_gave() {
        let config = config_from(&[(SETTING_PROVIDER, "custom"), (&address_key("custom"), "https://llm.example.com/v1/")]);

        assert_eq!(config.api_root().unwrap(), "https://llm.example.com/v1");
    }

    #[test]
    fn a_custom_server_with_no_address_asks_for_one() {
        let config = config_from(&[(SETTING_PROVIDER, "custom")]);

        assert_eq!(
            config.api_root(),
            Err(AiError::Other("Enter the address of your server in Settings.".into()))
        );
    }

    #[test]
    fn ollama_defaults_to_the_local_server_but_can_be_pointed_elsewhere() {
        let default = config_from(&[(SETTING_PROVIDER, "ollama")]);
        let moved = config_from(&[(SETTING_PROVIDER, "ollama"), (&address_key("ollama"), "http://127.0.0.1:9999/v1")]);

        assert_eq!(default.api_root().unwrap(), "http://localhost:11434/v1");
        assert_eq!(moved.api_root().unwrap(), "http://127.0.0.1:9999/v1");
    }

    #[test]
    fn plain_http_is_only_allowed_to_this_computer() {
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(validate_base_url("http://192.168.1.20:8080/v1").is_err());
        assert!(validate_base_url("http://llm.example.com/v1").is_err());
    }

    #[test]
    fn an_address_with_a_password_or_an_odd_scheme_is_refused() {
        assert!(validate_base_url("https://user:secret@llm.example.com/v1").is_err());
        assert!(validate_base_url("ftp://llm.example.com/v1").is_err());
        assert!(validate_base_url("file:///C:/secrets").is_err());
        assert!(validate_base_url("not a url").is_err());
    }

    #[test]
    fn every_service_has_its_own_key_account_and_name() {
        let accounts: HashSet<_> = all().iter().map(|provider| provider.secret_account).collect();
        let names: HashSet<_> = all().iter().map(|provider| serde_name(provider.id)).collect();

        assert_eq!(accounts.len(), all().len());
        assert_eq!(names.len(), all().len());
    }

    #[test]
    fn the_first_builds_openrouter_key_account_is_kept() {
        assert_eq!(spec(ProviderId::OpenRouter).secret_account, "openrouter-api-key");
    }

    #[test]
    fn every_name_reads_back_to_its_service() {
        for provider in all() {
            assert_eq!(ProviderId::from_setting(serde_name(provider.id)), Some(provider.id));
        }
    }

    #[test]
    fn every_fixed_service_has_an_address_and_a_default_model() {
        for provider in all().iter().filter(|p| !p.base_url_editable) {
            assert!(provider.base_url.starts_with("https://"), "{} needs an https address", provider.label);
            assert!(!provider.default_model().is_empty(), "{} needs a default model", provider.label);
        }
    }

    #[test]
    fn only_services_that_can_search_say_so() {
        let searching: Vec<_> = all().iter().filter(|p| p.supports_web_search).map(|p| p.id).collect();

        assert_eq!(searching, vec![ProviderId::OpenRouter, ProviderId::Google]);
    }

    #[test]
    fn a_service_that_needs_no_key_is_local_or_custom() {
        let keyless: Vec<_> = all().iter().filter(|p| !p.key_required).map(|p| p.id).collect();

        assert_eq!(keyless, vec![ProviderId::Ollama, ProviderId::Custom]);
    }

    #[test]
    fn each_service_remembers_its_own_model_when_another_is_chosen() {
        let settings = [
            (SETTING_PROVIDER, "openai"),
            (&model_key("openai") as &str, "gpt-4o"),
            (&model_key("anthropic") as &str, "claude-haiku-5-5"),
        ];
        let map: HashMap<String, String> =
            settings.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect();

        let openai = AiConfig::for_provider(&|key| map.get(key).cloned(), ProviderId::OpenAi);
        let anthropic = AiConfig::for_provider(&|key| map.get(key).cloned(), ProviderId::Anthropic);

        assert_eq!(openai.model, "gpt-4o");
        assert_eq!(anthropic.model, "claude-haiku-5-5");
    }

    #[test]
    fn the_per_service_setting_names_are_distinct_and_readable() {
        assert_eq!(model_setting(ProviderId::Anthropic), "zara-ai-model-anthropic");
        assert_eq!(fallback_model_setting(ProviderId::OpenRouter), "zara-ai-fallback-model-openrouter");
        assert_eq!(base_url_setting(ProviderId::Custom), "zara-ai-base-url-custom");
    }
}
