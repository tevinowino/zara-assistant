//! Puts together the client the assistant talks to from what the user chose:
//! the right kind of client for the service, and a fallback model that is tried
//! when the main one cannot answer.

use super::anthropic::AnthropicClient;
use super::gemini::GeminiClient;
use super::llm::{AiError, ChatCompletionsClient, ChatPrompt, InlineData, LlmClient};
use super::providers::{self, AiConfig, Wire};
use super::tuning::Tuning;
use std::sync::atomic::{AtomicBool, Ordering};

/// A client for whichever service is chosen.
pub enum ConfiguredClient {
    ChatCompletions(ChatCompletionsClient),
    Anthropic(AnthropicClient),
    Gemini(GeminiClient),
}

impl LlmClient for ConfiguredClient {
    async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
        match self {
            Self::ChatCompletions(client) => client.chat(prompt).await,
            Self::Anthropic(client) => client.chat(prompt).await,
            Self::Gemini(client) => client.chat(prompt).await,
        }
    }

    async fn chat_streaming(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
    ) -> Result<String, AiError> {
        match self {
            Self::ChatCompletions(client) => client.chat_streaming(prompt, on_progress).await,
            Self::Anthropic(client) => client.chat_streaming(prompt, on_progress).await,
            Self::Gemini(client) => client.chat_streaming(prompt, on_progress).await,
        }
    }

    async fn chat_streaming_with_reasoning(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
        on_reasoning: &(dyn Fn(&str) + Sync),
    ) -> Result<String, AiError> {
        match self {
            Self::ChatCompletions(client) => {
                client.chat_streaming_with_reasoning(prompt, on_progress, on_reasoning).await
            }
            Self::Anthropic(client) => {
                client.chat_streaming_with_reasoning(prompt, on_progress, on_reasoning).await
            }
            Self::Gemini(client) => {
                client.chat_streaming_with_reasoning(prompt, on_progress, on_reasoning).await
            }
        }
    }

    async fn generate(&self, prompt: &str, attachment: Option<&InlineData>) -> Result<String, AiError> {
        match self {
            Self::ChatCompletions(client) => client.generate(prompt, attachment).await,
            Self::Anthropic(client) => client.generate(prompt, attachment).await,
            Self::Gemini(client) => client.generate(prompt, attachment).await,
        }
    }
}

/// A main client and an optional fallback. When the main one fails in a way
/// another model might get past (it is overloaded, rate limited, unavailable,
/// declined, or returned nothing), the same request goes to the fallback. Failures
/// no other model could fix, such as a rejected key, are reported as they are.
pub struct WithFallback<C: LlmClient> {
    primary: C,
    fallback: Option<C>,
}

impl<C: LlmClient> WithFallback<C> {
    pub fn new(primary: C, fallback: Option<C>) -> Self {
        Self { primary, fallback }
    }
}

impl<C: LlmClient> LlmClient for WithFallback<C> {
    async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
        match self.primary.chat(prompt).await {
            Err(error) if error.allows_fallback() => match &self.fallback {
                Some(fallback) => fallback.chat(prompt).await,
                None => Err(error),
            },
            other => other,
        }
    }

    async fn chat_streaming(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
    ) -> Result<String, AiError> {
        self.chat_streaming_with_reasoning(prompt, on_progress, &|_| {}).await
    }

    async fn chat_streaming_with_reasoning(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
        on_reasoning: &(dyn Fn(&str) + Sync),
    ) -> Result<String, AiError> {
        // Once text has been shown, a second model's answer would be tacked on after
        // it, so the fallback only runs when nothing was shown yet.
        let shown = AtomicBool::new(false);
        let watching = |text: &str| {
            shown.store(true, Ordering::Relaxed);
            on_progress(text);
        };
        match self.primary.chat_streaming_with_reasoning(prompt, &watching, on_reasoning).await {
            Err(error) if error.allows_fallback() && !shown.load(Ordering::Relaxed) => match &self.fallback {
                Some(fallback) => fallback.chat_streaming_with_reasoning(prompt, on_progress, on_reasoning).await,
                None => Err(error),
            },
            other => other,
        }
    }

    async fn generate(&self, prompt: &str, attachment: Option<&InlineData>) -> Result<String, AiError> {
        match self.primary.generate(prompt, attachment).await {
            Err(error) if error.allows_fallback() => match &self.fallback {
                Some(fallback) => fallback.generate(prompt, attachment).await,
                None => Err(error),
            },
            other => other,
        }
    }
}

/// The client for one service and model: its address, key, and the user's settings
/// for that model (a setting that suits one model is an error for another).
fn build_one(config: &AiConfig, key: Option<String>) -> Result<ConfiguredClient, AiError> {
    let spec = providers::spec(config.provider);
    let root = config.api_root()?;
    let key = key.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    if spec.key_required && key.is_none() {
        return Err(AiError::KeyMissing);
    }
    let model = config.model.as_str();
    let saved = config.tuning.get(model).and_then(|values| values.as_object()).cloned().unwrap_or_default();
    let tuning = Tuning::resolve(config.provider, model, &saved);
    match spec.wire {
        Wire::ChatCompletions => ChatCompletionsClient::for_service(root, key, model, spec.supports_web_search)
            .map(|client| ConfiguredClient::ChatCompletions(client.with_tuning(tuning))),
        Wire::AnthropicMessages => AnthropicClient::new(root, key.unwrap_or_default(), model)
            .map(|client| ConfiguredClient::Anthropic(client.with_tuning(tuning))),
        Wire::GeminiGenerateContent => GeminiClient::new(root, key.unwrap_or_default(), model)
            .map(|client| ConfiguredClient::Gemini(client.with_tuning(tuning))),
    }
}

/// The client for `config`, using `key` for its service (None for one that needs
/// none). A fallback on another service has no key here, so it is left out; see
/// `build_client_with_keys`.
pub fn build_client(config: &AiConfig, key: Option<String>) -> Result<WithFallback<ConfiguredClient>, AiError> {
    build_client_with_keys(config, &|provider| if provider == config.provider { key.clone() } else { None })
}

/// The client for `config`, with `key_of` giving the key saved for each service.
/// A fallback on the same service as the main model must build, or this fails. One
/// on another service is best effort: without its key or address it is left out, so
/// the main model still answers.
pub fn build_client_with_keys(
    config: &AiConfig,
    key_of: &dyn Fn(providers::ProviderId) -> Option<String>,
) -> Result<WithFallback<ConfiguredClient>, AiError> {
    let primary = build_one(config, key_of(config.provider))?;
    let fallback = match &config.fallback {
        None => None,
        Some(target) => match build_one(target, key_of(target.provider)) {
            Ok(client) => Some(client),
            Err(error) if target.provider == config.provider => return Err(error),
            Err(_) => None,
        },
    };
    Ok(WithFallback::new(primary, fallback))
}

/// The most models a listing is cut to, so a service with thousands cannot flood the picker.
const MAX_LISTED_MODELS: usize = 500;

/// The model ids in a `/models` listing. Services that follow OpenAI's shape put
/// them in `data[].id`; Google prefixes each with `models/`, which is dropped.
/// Sorted, without repeats, and cut to a sensible length.
pub fn parse_model_list(body: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = value["data"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model["id"].as_str())
                .map(|id| id.strip_prefix("models/").unwrap_or(id).to_string())
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    ids.truncate(MAX_LISTED_MODELS);
    ids
}

/// Asks the service at `root` which models it offers.
async fn fetch_model_list(root: &str, wire: Wire, key: Option<&str>) -> Result<Vec<String>, AiError> {
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AiError::Network)?;
    let mut request = http.get(format!("{}/models", root.trim_end_matches('/')));
    request = match (wire, key) {
        (Wire::AnthropicMessages, Some(key)) => {
            request.header("x-api-key", key).header("anthropic-version", "2023-06-01")
        }
        (Wire::ChatCompletions, Some(key)) => request.bearer_auth(key),
        (Wire::GeminiGenerateContent, Some(key)) => request.header("x-goog-api-key", key),
        (_, None) => request,
    };
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() { AiError::Timeout } else { AiError::Network }
    })?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|_| AiError::Network)?;
    if !(200..300).contains(&status) {
        return Err(super::llm::classify_error(status, &body, ""));
    }
    Ok(parse_model_list(&body))
}

/// The most pages of a Google model listing that are read, so a listing that never
/// ends cannot keep the request open.
const MAX_GOOGLE_LIST_PAGES: usize = 10;

/// Whether a model name looks like one that answers chat messages. Google lists
/// voice, image, video, music, embedding and agent models as able to "generate
/// content" too, so the name is what tells them apart.
fn looks_like_chat_model(id: &str) -> bool {
    const NOT_FOR_CHAT: [&str; 17] = [
        "-live",
        "native-audio",
        "-tts",
        "transcribe",
        "-image",
        "nano-banana",
        "imagen",
        "-omni-",
        "veo",
        "lyria",
        "embedding",
        "robotics",
        "deep-research",
        "antigravity",
        "computer-use",
        "aqa",
        "learnlm",
    ];
    !NOT_FOR_CHAT.iter().any(|marker| id.contains(marker))
}

/// The models Google offers for chat, from its native listing: those that can
/// generate content and are not voice, image or other special-purpose models.
async fn fetch_google_models(native_root: &str, key: &str) -> Result<Vec<String>, AiError> {
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AiError::Network)?;
    let mut ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;

    for _ in 0..MAX_GOOGLE_LIST_PAGES {
        let mut parameters = vec![("pageSize", "1000")];
        if let Some(token) = &page_token {
            parameters.push(("pageToken", token.as_str()));
        }
        let url = reqwest::Url::parse_with_params(
            &format!("{}/models", native_root.trim_end_matches('/')),
            parameters,
        )
        .map_err(|_| AiError::Other("The Google address is not valid.".into()))?;
        let response = http.get(url).header("x-goog-api-key", key).send().await.map_err(|error| {
            if error.is_timeout() { AiError::Timeout } else { AiError::Network }
        })?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|_| AiError::Network)?;
        if !(200..300).contains(&status) {
            return Err(super::llm::classify_error(status, &body, ""));
        }

        let value: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
        for model in value["models"].as_array().into_iter().flatten() {
            let can_generate = model["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| methods.iter().any(|method| method == "generateContent"));
            let Some(name) = model["name"].as_str() else { continue };
            let id = name.strip_prefix("models/").unwrap_or(name);
            if can_generate && looks_like_chat_model(id) {
                ids.push(id.to_string());
            }
        }
        page_token = value["nextPageToken"].as_str().filter(|token| !token.is_empty()).map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }
    ids.sort();
    ids.dedup();
    ids.truncate(MAX_LISTED_MODELS);
    Ok(ids)
}

/// The models the chosen service offers, for the model picker.
pub async fn list_models(config: &AiConfig, key: Option<String>) -> Result<Vec<String>, AiError> {
    let spec = providers::spec(config.provider);
    let key = key.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    if spec.key_required && key.is_none() {
        return Err(AiError::KeyMissing);
    }
    if config.provider == providers::ProviderId::Google {
        let key = key.as_deref().unwrap_or_default();
        return fetch_google_models(&config.api_root()?, key).await;
    }
    fetch_model_list(&config.api_root()?, spec.wire, key.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::providers::{ProviderId, SETTING_PROVIDER};
    use std::collections::{HashMap, VecDeque};
    use std::sync::Mutex;

    // ---- the fallback ----

    /// Answers from a script, and for streaming shows the text first.
    struct Scripted {
        replies: Mutex<VecDeque<Result<String, AiError>>>,
        calls: Mutex<u32>,
        /// Text shown through `on_progress` before the reply is returned.
        shows_first: Option<String>,
    }

    impl Scripted {
        fn replying(replies: Vec<Result<String, AiError>>) -> Self {
            Self { replies: Mutex::new(replies.into()), calls: Mutex::new(0), shows_first: None }
        }
        fn showing_first(mut self, text: &str) -> Self {
            self.shows_first = Some(text.to_string());
            self
        }
        fn calls(&self) -> u32 {
            *self.calls.lock().unwrap()
        }
        fn next(&self) -> Result<String, AiError> {
            *self.calls.lock().unwrap() += 1;
            self.replies.lock().unwrap().pop_front().expect("the script ran out of replies")
        }
    }

    impl LlmClient for Scripted {
        async fn chat(&self, _prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            self.next()
        }
        async fn chat_streaming(
            &self,
            _prompt: ChatPrompt<'_>,
            on_progress: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            if let Some(text) = &self.shows_first {
                on_progress(text);
            }
            self.next()
        }
        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            self.next()
        }
    }

    fn prompt() -> ChatPrompt<'static> {
        ChatPrompt { system: "", history: &[], message: "hi", attachment: None, web_search: false }
    }

    #[tokio::test]
    async fn a_main_model_that_works_never_touches_the_fallback() {
        let client = WithFallback::new(
            Scripted::replying(vec![Ok("main".into())]),
            Some(Scripted::replying(vec![Ok("backup".into())])),
        );

        assert_eq!(client.chat(prompt()).await, Ok("main".to_string()));
        assert_eq!(client.fallback.as_ref().unwrap().calls(), 0);
    }

    #[tokio::test]
    async fn a_rate_limited_main_model_hands_the_request_to_the_fallback() {
        let client = WithFallback::new(
            Scripted::replying(vec![Err(AiError::RateLimited)]),
            Some(Scripted::replying(vec![Ok("backup".into())])),
        );

        assert_eq!(client.chat(prompt()).await, Ok("backup".to_string()));
    }

    #[tokio::test]
    async fn every_failure_another_model_might_get_past_uses_the_fallback() {
        for error in [
            AiError::ModelUnavailable("m".into()),
            AiError::RateLimited,
            AiError::Blocked("x".into()),
            AiError::EmptyReply,
            AiError::Network,
            AiError::Timeout,
            AiError::Server(503),
        ] {
            let client = WithFallback::new(
                Scripted::replying(vec![Err(error.clone())]),
                Some(Scripted::replying(vec![Ok("backup".into())])),
            );

            assert_eq!(client.chat(prompt()).await, Ok("backup".to_string()), "for {error:?}");
        }
    }

    #[tokio::test]
    async fn a_failure_no_other_model_could_fix_is_reported_without_trying_the_fallback() {
        for error in [AiError::InvalidKey, AiError::OutOfCredits, AiError::KeyMissing] {
            let client = WithFallback::new(
                Scripted::replying(vec![Err(error.clone())]),
                Some(Scripted::replying(vec![Ok("backup".into())])),
            );

            assert_eq!(client.chat(prompt()).await, Err(error.clone()), "for {error:?}");
            assert_eq!(client.fallback.as_ref().unwrap().calls(), 0);
        }
    }

    #[tokio::test]
    async fn with_no_fallback_the_original_error_is_reported() {
        let client: WithFallback<Scripted> =
            WithFallback::new(Scripted::replying(vec![Err(AiError::RateLimited)]), None);

        assert_eq!(client.chat(prompt()).await, Err(AiError::RateLimited));
    }

    #[tokio::test]
    async fn when_the_fallback_fails_too_its_error_is_reported() {
        let client = WithFallback::new(
            Scripted::replying(vec![Err(AiError::RateLimited)]),
            Some(Scripted::replying(vec![Err(AiError::ModelUnavailable("backup".into()))])),
        );

        assert_eq!(client.chat(prompt()).await, Err(AiError::ModelUnavailable("backup".into())));
    }

    #[tokio::test]
    async fn a_streamed_request_that_failed_before_any_text_uses_the_fallback() {
        let client = WithFallback::new(
            Scripted::replying(vec![Err(AiError::Server(503))]),
            Some(Scripted::replying(vec![Ok("backup".into())]).showing_first("backup")),
        );
        let seen = Mutex::new(Vec::<String>::new());

        let reply = client.chat_streaming(prompt(), &|text| seen.lock().unwrap().push(text.to_string())).await;

        assert_eq!(reply, Ok("backup".to_string()));
        assert_eq!(*seen.lock().unwrap(), vec!["backup"]);
    }

    #[tokio::test]
    async fn a_streamed_request_that_failed_after_text_was_shown_does_not_switch_models() {
        let client = WithFallback::new(
            Scripted::replying(vec![Err(AiError::Server(503))]).showing_first("Half an answ"),
            Some(Scripted::replying(vec![Ok("backup".into())])),
        );

        let reply = client.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Err(AiError::Server(503)));
        assert_eq!(client.fallback.as_ref().unwrap().calls(), 0);
    }

    #[tokio::test]
    async fn titles_and_connection_checks_use_the_fallback_too() {
        let client = WithFallback::new(
            Scripted::replying(vec![Err(AiError::Timeout)]),
            Some(Scripted::replying(vec![Ok("A title".into())])),
        );

        assert_eq!(client.generate("name this", None).await, Ok("A title".to_string()));
    }

    // ---- building a client from the user's choice ----

    fn config_from(settings: &[(&str, &str)]) -> AiConfig {
        let map: HashMap<String, String> =
            settings.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect();
        AiConfig::from_settings(&|key| map.get(key).cloned())
    }

    #[test]
    fn a_service_that_needs_a_key_refuses_to_start_without_one() {
        let result = build_client(&config_from(&[(SETTING_PROVIDER, "openai")]), None);

        assert_eq!(result.err(), Some(AiError::KeyMissing));
        assert_eq!(
            build_client(&config_from(&[(SETTING_PROVIDER, "openai")]), Some("   ".into())).err(),
            Some(AiError::KeyMissing)
        );
    }

    #[test]
    fn a_local_server_needs_no_key() {
        assert!(build_client(&config_from(&[(SETTING_PROVIDER, "ollama")]), None).is_ok());
    }

    #[test]
    fn anthropic_and_google_get_their_own_kind_of_client_and_everyone_else_the_common_one() {
        let anthropic = build_client(&config_from(&[(SETTING_PROVIDER, "anthropic")]), Some("k".into())).unwrap();
        let google = build_client(&config_from(&[(SETTING_PROVIDER, "google")]), Some("k".into())).unwrap();
        let openai = build_client(&config_from(&[(SETTING_PROVIDER, "openai")]), Some("k".into())).unwrap();

        assert!(matches!(anthropic.primary, ConfiguredClient::Anthropic(_)));
        assert!(matches!(google.primary, ConfiguredClient::Gemini(_)));
        assert!(matches!(openai.primary, ConfiguredClient::ChatCompletions(_)));
    }

    #[test]
    fn a_fallback_model_gets_a_client_of_the_same_service() {
        let config = config_from(&[
            (SETTING_PROVIDER, "anthropic"),
            ("zara-ai-model-anthropic", "claude-sonnet-5-5"),
            ("zara-ai-fallback-model-anthropic", "claude-haiku-5-5"),
        ]);

        let client = build_client(&config, Some("k".into())).unwrap();

        assert!(matches!(client.fallback, Some(ConfiguredClient::Anthropic(_))));
    }

    #[test]
    fn a_fallback_on_another_service_gets_that_services_kind_of_client_and_key() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-fallback-provider-openrouter", "google"),
            ("zara-ai-fallback-model-openrouter", "gemini-3.8-flash"),
        ]);

        let client = build_client_with_keys(&config, &|provider| match provider {
            ProviderId::OpenRouter => Some("or-key".to_string()),
            ProviderId::Google => Some("google-key".to_string()),
            _ => None,
        })
        .unwrap();

        assert!(matches!(client.primary, ConfiguredClient::ChatCompletions(_)));
        assert!(matches!(client.fallback, Some(ConfiguredClient::Gemini(_))));
    }

    #[test]
    fn a_fallback_on_another_service_without_its_key_is_left_out_and_the_main_model_still_builds() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-fallback-provider-openrouter", "google"),
            ("zara-ai-fallback-model-openrouter", "gemini-3.8-flash"),
        ]);

        let client = build_client(&config, Some("or-key".into())).unwrap();

        assert!(client.fallback.is_none());
    }

    #[test]
    fn a_fallback_on_the_same_service_that_cannot_be_built_is_still_an_error() {
        let config = AiConfig {
            fallback_model: Some("x".into()),
            fallback: Some(Box::new(AiConfig {
                provider: ProviderId::Custom,
                model: "x".into(),
                fallback_model: None,
                fallback_provider: None,
                fallback: None,
                base_url: None,
                tuning: Default::default(),
            })),
            provider: ProviderId::Custom,
            model: "m".into(),
            fallback_provider: None,
            base_url: Some("https://example.com/v1".into()),
            tuning: Default::default(),
        };

        assert!(build_client(&config, None).is_err());
    }

    #[test]
    fn the_fallback_uses_its_own_models_settings_not_the_main_models() {
        let config = config_from(&[
            (SETTING_PROVIDER, "openrouter"),
            ("zara-ai-model-openrouter", "openai/gpt-5"),
            ("zara-ai-fallback-provider-openrouter", "groq"),
            ("zara-ai-fallback-model-openrouter", "openai/gpt-oss-20b"),
            ("zara-ai-tuning-openrouter", r#"{"openai/gpt-5":{"effort":"high"}}"#),
            ("zara-ai-tuning-groq", r#"{"openai/gpt-oss-20b":{"effort":"low"}}"#),
        ]);

        let fallback = config.fallback.as_ref().expect("a fallback is configured");

        assert_eq!(fallback.provider, ProviderId::Groq);
        assert_eq!(fallback.tuning.get("openai/gpt-oss-20b").unwrap()["effort"], serde_json::json!("low"));
        assert!(fallback.tuning.get("openai/gpt-5").is_none());
    }

    #[test]
    fn no_fallback_model_means_no_fallback_client() {
        let client = build_client(&config_from(&[]), Some("k".into())).unwrap();

        assert!(client.fallback.is_none());
    }

    #[test]
    fn a_custom_server_without_an_address_is_refused_with_a_clear_message() {
        let config = config_from(&[(SETTING_PROVIDER, "custom"), ("zara-ai-model-custom", "my-model")]);

        assert_eq!(
            build_client(&config, None).err(),
            Some(AiError::Other("Enter the address of your server in Settings.".into()))
        );
    }

    #[test]
    fn a_custom_server_with_an_address_and_a_model_is_built() {
        let config = config_from(&[
            (SETTING_PROVIDER, "custom"),
            ("zara-ai-model-custom", "my-model"),
            ("zara-ai-base-url-custom", "https://llm.example.com/v1"),
        ]);

        assert!(build_client(&config, None).is_ok());
    }

    #[test]
    fn a_custom_server_with_no_model_asks_for_one() {
        let config = config_from(&[(SETTING_PROVIDER, "custom"), ("zara-ai-base-url-custom", "https://llm.example.com/v1")]);

        assert_eq!(
            build_client(&config, None).err(),
            Some(AiError::Other("No model is configured. Choose one in Settings.".into()))
        );
    }

    #[test]
    fn every_fixed_service_can_be_built_with_its_default_model() {
        for provider in providers::all().iter().filter(|p| !p.base_url_editable) {
            let config = AiConfig {
                provider: provider.id,
                model: provider.default_model().to_string(),
                fallback_model: None,
                fallback_provider: None,
                fallback: None,
                base_url: None,
                tuning: Default::default(),
            };

            assert!(build_client(&config, Some("k".into())).is_ok(), "{} failed", provider.label);
        }
        let _ = ProviderId::OpenRouter;
    }
}

#[cfg(test)]
mod model_list_tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn the_ids_in_a_listing_are_sorted_and_without_repeats() {
        let body = json!({ "data": [{ "id": "b-model" }, { "id": "a-model" }, { "id": "b-model" }] }).to_string();

        assert_eq!(parse_model_list(&body), vec!["a-model", "b-model"]);
    }

    #[test]
    fn googles_models_prefix_is_dropped() {
        let body = json!({ "data": [{ "id": "models/gemini-2.5-flash" }] }).to_string();

        assert_eq!(parse_model_list(&body), vec!["gemini-2.5-flash"]);
    }

    #[test]
    fn a_listing_that_is_not_in_the_expected_shape_gives_no_models() {
        assert!(parse_model_list("not json").is_empty());
        assert!(parse_model_list(r#"{"models":[]}"#).is_empty());
        assert!(parse_model_list(r#"{"data":[{"name":"x"}]}"#).is_empty());
    }

    #[test]
    fn a_huge_listing_is_cut() {
        let data: Vec<_> = (0..900).map(|n| json!({ "id": format!("model-{n:04}") })).collect();

        assert_eq!(parse_model_list(&json!({ "data": data }).to_string()).len(), MAX_LISTED_MODELS);
    }

    #[tokio::test]
    async fn a_chat_completions_service_is_asked_with_a_bearer_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("authorization", "Bearer sk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [{ "id": "m1" }] })))
            .expect(1)
            .mount(&server)
            .await;

        let models = fetch_model_list(&format!("{}/v1", server.uri()), Wire::ChatCompletions, Some("sk-test")).await;

        assert_eq!(models, Ok(vec!["m1".to_string()]));
    }

    #[tokio::test]
    async fn anthropic_is_asked_with_its_own_headers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("x-api-key", "sk-ant"))
            .and(header("anthropic-version", "2023-06-01"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [{ "id": "claude-x" }] })))
            .expect(1)
            .mount(&server)
            .await;

        let models = fetch_model_list(&format!("{}/v1", server.uri()), Wire::AnthropicMessages, Some("sk-ant")).await;

        assert_eq!(models, Ok(vec!["claude-x".to_string()]));
    }

    #[tokio::test]
    async fn a_local_server_with_no_key_is_asked_without_one() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [{ "id": "llama3.2" }] })))
            .mount(&server)
            .await;

        let models = fetch_model_list(&format!("{}/v1", server.uri()), Wire::ChatCompletions, None).await;

        assert_eq!(models, Ok(vec!["llama3.2".to_string()]));
        let received = server.received_requests().await.unwrap();
        assert!(received[0].headers.get("authorization").is_none());
    }

    #[tokio::test]
    async fn a_rejected_key_is_reported() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).respond_with(ResponseTemplate::new(401)).mount(&server).await;

        let models = fetch_model_list(&format!("{}/v1", server.uri()), Wire::ChatCompletions, Some("bad")).await;

        assert_eq!(models, Err(AiError::InvalidKey));
    }

    #[tokio::test]
    async fn a_service_that_needs_a_key_is_not_asked_without_one() {
        let config = AiConfig {
            provider: providers::ProviderId::OpenAi,
            model: "gpt-4o-mini".into(),
            fallback_model: None,
            fallback_provider: None,
            fallback: None,
            base_url: None,
            tuning: Default::default(),
        };

        assert_eq!(list_models(&config, None).await, Err(AiError::KeyMissing));
    }
}

#[cfg(test)]
mod google_model_list_tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn the_models_google_lists_for_chatting_are_kept() {
        for id in [
            "gemini-4-argon",
            "gemini-3.8-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-3-flash-preview",
            "gemini-3.1-pro-preview",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-flash-latest",
            "gemma-4-31b-it",
        ] {
            assert!(looks_like_chat_model(id), "{id} should be offered");
        }
    }

    #[test]
    fn the_models_that_cannot_chat_are_dropped() {
        for id in [
            "gemini-3.8-live",
            "gemini-3.8-live-extended-thinking",
            "gemini-3.1-flash-live-preview",
            "gemini-3.5-live-translate-preview",
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "gemini-3.8-flash-tts",
            "gemini-3.8-flash-lite-tts",
            "gemini-2.5-flash-preview-tts",
            "gemini-3.5-transcribe",
            "gemini-nano-banana-2.1",
            "gemini-3.1-flash-image",
            "gemini-3-pro-image",
            "gemini-2.5-flash-image",
            "gemini-omni-1.1-flash",
            "gemini-embedding-2",
            "gemini-embedding-001",
            "imagen-4.0-generate",
            "lyria-3.5",
            "lyria-realtime-exp",
            "gemini-robotics-er-2-preview",
            "deep-research-preview-04-2026",
            "antigravity-preview-09-2026",
            "gemini-2.5-computer-use-preview-10-2025",
            "veo-3.1-generate-preview",
        ] {
            assert!(!looks_like_chat_model(id), "{id} should not be offered");
        }
    }

    fn model(name: &str, methods: &[&str]) -> serde_json::Value {
        json!({ "name": format!("models/{name}"), "supportedGenerationMethods": methods })
    }

    #[tokio::test]
    async fn only_models_that_can_generate_content_and_chat_are_listed_with_the_prefix_dropped() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1beta/models"))
            .and(header("x-goog-api-key", "AIza-test"))
            .and(query_param("pageSize", "1000"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "models": [
                model("gemini-3.8-flash", &["generateContent", "countTokens"]),
                model("gemini-embedding-001", &["embedContent"]),
                model("gemini-3.8-flash-tts", &["generateContent"]),
                model("gemma-4-31b-it", &["generateContent"]),
                model("aqa", &["generateAnswer"]),
            ] })))
            .expect(1)
            .mount(&server)
            .await;

        let models = fetch_google_models(&format!("{}/v1beta", server.uri()), "AIza-test").await;

        assert_eq!(models, Ok(vec!["gemini-3.8-flash".to_string(), "gemma-4-31b-it".to_string()]));
    }

    #[tokio::test]
    async fn every_page_of_the_listing_is_read() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1beta/models"))
            .and(query_param("pageToken", "page-2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "models": [
                model("gemini-3.1-flash-lite", &["generateContent"]),
            ] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1beta/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "models": [model("gemini-4-argon", &["generateContent"])],
                "nextPageToken": "page-2"
            })))
            .mount(&server)
            .await;

        let models = fetch_google_models(&format!("{}/v1beta", server.uri()), "k").await;

        assert_eq!(models, Ok(vec!["gemini-3.1-flash-lite".to_string(), "gemini-4-argon".to_string()]));
    }

    #[tokio::test]
    async fn a_rejected_google_key_is_reported() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "error": { "code": 400, "message": "API key not valid. Please pass a valid API key." }
            })))
            .mount(&server)
            .await;

        let models = fetch_google_models(&format!("{}/v1beta", server.uri()), "bad").await;

        assert_eq!(models, Err(AiError::InvalidKey));
    }

    #[tokio::test]
    async fn a_listing_that_never_ends_is_cut_off() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "models": [model("gemini-3.8-flash", &["generateContent"])],
                "nextPageToken": "again"
            })))
            .mount(&server)
            .await;

        let models = fetch_google_models(&format!("{}/v1beta", server.uri()), "k").await;

        assert_eq!(models, Ok(vec!["gemini-3.8-flash".to_string()]));
        assert!(server.received_requests().await.unwrap().len() <= 10);
    }
}
