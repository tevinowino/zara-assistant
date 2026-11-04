//! The language-model boundary.
//!
//! `LlmClient` is the narrow interface the rest of the assistant talks to;
//! `ChatCompletionsClient` implements it over the OpenAI-compatible chat-completions
//! API that OpenRouter, OpenAI, Google, NVIDIA and many others offer (see
//! `providers`); Anthropic's own wire format has its own client. Everything that
//! can be decided without the network (building the request, interpreting a
//! response, deciding whether to retry) is a pure function, so it is tested
//! directly and the network tests only cover the transport.
//!
//! Notes on the wire format:
//! - The API key travels in the `Authorization` header, never in the URL, so it
//!   cannot end up in logs or error messages that include the URL.
//! - The persona goes in a leading `system` message.
//! - Images are inline `image_url` parts holding a base64 data URL. The model
//!   accepts text, images and video but not audio, so Zara has no voice input.
//! - OpenRouter can answer HTTP 200 with an `error` object when the upstream
//!   provider fails after accepting the request; that is treated like the
//!   matching HTTP error.

use super::tuning::Tuning;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};
use std::future::Future;
use std::time::Duration;

/// Everything that can go wrong talking to the model, each with the message the
/// user sees. The variants carry no secrets.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AiError {
    #[error("Add your API key in Settings to use Zara.")]
    KeyMissing,
    #[error("The AI service rejected the API key. Check it in Settings.")]
    InvalidKey,
    #[error("Your account with the AI service is out of credits. Add credits with your provider.")]
    OutOfCredits,
    #[error("The AI service is limiting requests right now. Try again in a moment.")]
    RateLimited,
    #[error("The model \"{0}\" is not available for this key.")]
    ModelUnavailable(String),
    #[error("The model declined to answer this ({0}).")]
    Blocked(String),
    #[error("The model returned an empty reply. Try rephrasing.")]
    EmptyReply,
    #[error("Could not reach the AI service. Check your internet connection.")]
    Network,
    #[error("The model took too long to respond.")]
    Timeout,
    #[error("The AI service had a problem (HTTP {0}). Try again shortly.")]
    Server(u16),
    #[error("The AI service could not process the request: {0}")]
    BadRequest(String),
    #[error("Could not capture the screen: {0}")]
    Capture(String),
    /// The user stopped the question, or asked another that replaced it.
    #[error("Stopped.")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

impl AiError {
    /// A stable identifier the frontend switches on (for example to show the API
    /// key onboarding card for `key-missing`).
    pub fn kind(&self) -> &'static str {
        match self {
            AiError::KeyMissing => "key-missing",
            AiError::InvalidKey => "invalid-key",
            AiError::OutOfCredits => "out-of-credits",
            AiError::RateLimited => "rate-limited",
            AiError::ModelUnavailable(_) => "model-unavailable",
            AiError::Blocked(_) => "blocked",
            AiError::EmptyReply => "empty-reply",
            AiError::Network => "network",
            AiError::Timeout => "timeout",
            AiError::Server(_) => "server",
            AiError::BadRequest(_) => "bad-request",
            AiError::Capture(_) => "capture",
            AiError::Cancelled => "cancelled",
            AiError::Other(_) => "other",
        }
    }

    /// Worth trying again after a pause: the failure is about the moment, not
    /// the request.
    /// Whether another model might succeed where this one failed: it is overloaded,
    /// rate limited, unavailable, declined, or returned nothing. A rejected key or
    /// an empty balance would fail for any model.
    pub fn allows_fallback(&self) -> bool {
        matches!(
            self,
            AiError::ModelUnavailable(_)
                | AiError::RateLimited
                | AiError::Blocked(_)
                | AiError::EmptyReply
                | AiError::Network
                | AiError::Timeout
                | AiError::Server(_)
                | AiError::BadRequest(_)
        )
    }

    pub(super) fn is_transient(&self) -> bool {
        matches!(self, AiError::RateLimited | AiError::Server(_) | AiError::Network | AiError::Timeout)
    }
}

impl Serialize for AiError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AiError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Model,
}

/// One earlier turn of the conversation, as the frontend holds it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Turn {
    pub role: Role,
    pub text: String,
}

/// Binary content sent inline with a request: a screenshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineData {
    pub mime_type: String,
    pub base64: String,
}

/// One chat request: persona, earlier turns, the new message, and optionally an
/// attached image. It only borrows, so it is freely copied (a fallback model gets the same request).
#[derive(Clone, Copy)]
pub struct ChatPrompt<'a> {
    pub system: &'a str,
    pub history: &'a [Turn],
    pub message: &'a str,
    pub attachment: Option<&'a InlineData>,
    /// Let the provider search the web for this request and add the results to
    /// what the model sees (OpenRouter's `web` plugin).
    pub web_search: bool,
}

/// How many results the provider adds when a request searches the web.
const WEB_SEARCH_MAX_RESULTS: u32 = 5;

/// What the assistant needs from a model. Implemented over HTTP by
/// `ChatCompletionsClient` and by a scripted fake in the chat tests.
pub trait LlmClient: Send + Sync {
    fn chat(&self, prompt: ChatPrompt<'_>) -> impl Future<Output = Result<String, AiError>> + Send;

    /// Like `chat`, but calls `on_progress` with the whole reply so far each time
    /// more of it arrives, so the UI can show it as it is written. The default
    /// delivers the finished reply in one call, so a client that cannot stream
    /// still works.
    fn chat_streaming(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
    ) -> impl Future<Output = Result<String, AiError>> + Send {
        async move {
            let reply = self.chat(prompt).await?;
            on_progress(&reply);
            Ok(reply)
        }
    }

    /// Like `chat_streaming`, and also calls `on_reasoning` with the model's own
    /// reasoning so far, for the services that send it ahead of the answer. The
    /// default ignores reasoning, so a client that has none still works.
    fn chat_streaming_with_reasoning(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
        _on_reasoning: &(dyn Fn(&str) + Sync),
    ) -> impl Future<Output = Result<String, AiError>> + Send {
        self.chat_streaming(prompt, on_progress)
    }

    /// A single prompt with no history, for titles and connection checks.
    fn generate(
        &self,
        prompt: &str,
        attachment: Option<&InlineData>,
    ) -> impl Future<Output = Result<String, AiError>> + Send;
}

/// The model expects the first turn to be the user's and strictly alternating
/// roles, but the frontend sends "the last N messages", which can start on an
/// assistant turn. Drops leading model turns and empty turns, and merges runs of
/// the same role.
pub fn normalize_history(history: &[Turn]) -> Vec<Turn> {
    let mut normalized: Vec<Turn> = Vec::new();
    for turn in history {
        if turn.text.trim().is_empty() {
            continue;
        }
        match normalized.last_mut() {
            Some(last) if last.role == turn.role => {
                last.text.push_str("\n\n");
                last.text.push_str(&turn.text);
            }
            None if turn.role == Role::Model => {}
            _ => normalized.push(turn.clone()),
        }
    }
    normalized
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Model => "assistant",
    }
}

/// A user message: plain text, or text followed by the attached image.
fn user_content(text: &str, attachment: Option<&InlineData>) -> Value {
    match attachment {
        None => json!(text),
        Some(data) => json!([
            { "type": "text", "text": text },
            { "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", data.mime_type, data.base64) } }
        ]),
    }
}

/// The JSON body for `chat/completions` with the conversation so far.
pub fn build_chat_body(model: &str, prompt: &ChatPrompt<'_>) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    if !prompt.system.trim().is_empty() {
        messages.push(json!({ "role": "system", "content": prompt.system }));
    }
    messages.extend(
        normalize_history(prompt.history)
            .iter()
            .map(|turn| json!({ "role": role_name(turn.role), "content": turn.text })),
    );

    // A history ending on a user turn would put two user turns in a row.
    let mut message = prompt.message.to_string();
    if matches!(messages.last(), Some(last) if last["role"] == "user") {
        let previous = messages.pop().expect("checked above");
        let previous_text = previous["content"].as_str().unwrap_or_default();
        message = format!("{previous_text}\n\n{message}");
    }
    messages.push(json!({ "role": "user", "content": user_content(&message, prompt.attachment) }));

    let mut body = json!({ "model": model, "messages": messages });
    if prompt.web_search {
        body["plugins"] = json!([{ "id": "web", "max_results": WEB_SEARCH_MAX_RESULTS }]);
    }
    body
}

/// The JSON body for a one-off prompt.
pub fn build_generate_body(model: &str, prompt: &str, attachment: Option<&InlineData>) -> Value {
    json!({ "model": model, "messages": [{ "role": "user", "content": user_content(prompt, attachment) }] })
}

pub(super) fn shorten(text: &str, max_chars: usize) -> String {
    let single_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= max_chars {
        single_line
    } else {
        format!("{}\u{2026}", single_line.chars().take(max_chars).collect::<String>().trim_end())
    }
}

/// The text of `message.content`, which providers return either as a string or
/// as a list of typed parts.
pub(super) fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect(),
        _ => String::new(),
    }
}

/// The reasoning inside a message's `content` when the service sends it as typed
/// chunks, as Mistral does: `{"type":"thinking","thinking":[{"type":"text","text":".."}]}`.
fn thinking_text(content: &Value) -> String {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "thinking")
        .flat_map(|part| part["thinking"].as_array().into_iter().flatten())
        .filter_map(|piece| piece["text"].as_str())
        .collect()
}

/// Turns an HTTP status and body into either the reply text or a classified error.
pub fn parse_response(status: u16, body: &str, model: &str) -> Result<String, AiError> {
    if !(200..300).contains(&status) {
        return Err(classify_error(status, body, model));
    }
    let value: Value = serde_json::from_str(body).map_err(|_| AiError::EmptyReply)?;

    // The upstream provider failed after the service accepted the request.
    if value["error"].is_object() {
        let embedded_status = value["error"]["code"].as_u64().and_then(|code| u16::try_from(code).ok());
        return Err(classify_error(embedded_status.unwrap_or(502), body, model));
    }

    // `message.reasoning` is the model's scratch work, not the answer, and is
    // deliberately not read.
    let choice = &value["choices"][0];
    let text = content_text(&choice["message"]["content"]);
    if !text.trim().is_empty() {
        return Ok(text);
    }
    if let Some(refusal) = choice["message"]["refusal"].as_str().filter(|r| !r.trim().is_empty()) {
        return Err(AiError::Blocked(shorten(refusal, 120)));
    }
    if choice["finish_reason"] == "content_filter" {
        return Err(AiError::Blocked("content filter".into()));
    }
    Err(AiError::EmptyReply)
}

pub(super) fn classify_error(status: u16, body: &str, model: &str) -> AiError {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
        .unwrap_or_default();
    let lowered = message.to_lowercase();
    match status {
        401 => AiError::InvalidKey,
        402 => AiError::OutOfCredits,
        403 if lowered.contains("moderation") || lowered.contains("flagged") => {
            AiError::Blocked("flagged by moderation".into())
        }
        403 if lowered.contains("key") => AiError::InvalidKey,
        404 => AiError::ModelUnavailable(model.to_string()),
        400 if lowered.contains("not a valid model") => AiError::ModelUnavailable(model.to_string()),
        // Google reports a wrong key as a plain bad request.
        400 if lowered.contains("api key not valid") => AiError::InvalidKey,
        408 => AiError::Timeout,
        429 => AiError::RateLimited,
        500..=599 => AiError::Server(status),
        400..=499 if !message.is_empty() => AiError::BadRequest(shorten(&message, 200)),
        _ => AiError::Server(status),
    }
}

/// How persistently to retry transient failures.
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    /// Delay before the first retry; doubles each time.
    pub base_delay: Duration,
    /// Never wait longer than this, even if the server asks.
    pub max_delay: Duration,
}

impl RetryPolicy {
    pub fn standard() -> Self {
        Self { max_attempts: 3, base_delay: Duration::from_millis(600), max_delay: Duration::from_secs(8) }
    }

    pub(super) fn delay_for(&self, retry_number: u32, server_hint: Option<Duration>) -> Duration {
        let exponential = self.base_delay.saturating_mul(2u32.saturating_pow(retry_number));
        server_hint.unwrap_or(exponential).min(self.max_delay)
    }
}

/// What one line of a streamed (server-sent events) response means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    /// More of the reply.
    Text(String),
    /// More of the model's reasoning, which comes before the reply and is not part of it.
    Reasoning(String),
    /// The stream is finished.
    Done,
    /// The provider failed partway; carries the classified error.
    Failed(AiError),
    /// A keep-alive comment, a role-only chunk, or anything else with no text.
    Ignore,
}

/// Reads one line of the chat-completions event stream.
pub fn parse_stream_line(line: &str, model: &str) -> StreamEvent {
    let Some(payload) = line.strip_prefix("data:") else {
        // Comments such as ": OPENROUTER PROCESSING" keep the connection warm.
        return StreamEvent::Ignore;
    };
    let payload = payload.trim();
    if payload == "[DONE]" {
        return StreamEvent::Done;
    }
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return StreamEvent::Ignore;
    };
    if value["error"].is_object() {
        let status = value["error"]["code"].as_u64().and_then(|code| u16::try_from(code).ok());
        return StreamEvent::Failed(classify_error(status.unwrap_or(502), payload, model));
    }
    let choice = &value["choices"][0];
    let text = content_text(&choice["delta"]["content"]);
    if !text.is_empty() {
        return StreamEvent::Text(text);
    }
    let thinking = thinking_text(&choice["delta"]["content"]);
    if !thinking.is_empty() {
        return StreamEvent::Reasoning(thinking);
    }
    // OpenRouter and most others call it `reasoning`; DeepSeek, Groq and local
    // servers call it `reasoning_content`.
    let reasoning = ["reasoning", "reasoning_content"]
        .iter()
        .find_map(|field| choice["delta"][*field].as_str().filter(|piece| !piece.is_empty()));
    if let Some(piece) = reasoning {
        return StreamEvent::Reasoning(piece.to_string());
    }
    if choice["finish_reason"] == "content_filter" {
        return StreamEvent::Failed(AiError::Blocked("content filter".into()));
    }
    StreamEvent::Ignore
}

/// Turns the bytes of a response, arriving in arbitrary pieces, into whole lines.
/// It works on bytes, not text, because a piece can end in the middle of a
/// multi-byte character; a newline byte never appears inside one, so a complete
/// line is always valid text.
#[derive(Default)]
pub struct LineBuffer {
    pending: Vec<u8>,
}

impl LineBuffer {
    /// Adds a piece and returns the lines it completed, without line endings.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.pending.drain(..=end).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            lines.push(String::from_utf8_lossy(&line).into_owned());
        }
        lines
    }

    /// The last line, when the stream ended without a final newline.
    pub fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            return None;
        }
        let line = String::from_utf8_lossy(&self.pending).trim_end_matches('\r').to_string();
        self.pending.clear();
        Some(line)
    }
}

/// What has been read of a streamed reply so far.
#[derive(Default)]
pub(super) struct StreamProgress {
    reply: String,
    reasoning: String,
    finished: bool,
    failure: Option<AiError>,
}

impl StreamProgress {
    fn is_over(&self) -> bool {
        self.finished || self.failure.is_some()
    }

    /// Takes in one line of the stream, telling `on_progress` when text was added.
    fn absorb(
        &mut self,
        line: &str,
        model: &str,
        parse: fn(&str, &str) -> StreamEvent,
        on_progress: &(dyn Fn(&str) + Sync),
        on_reasoning: &(dyn Fn(&str) + Sync),
    ) {
        match parse(line, model) {
            StreamEvent::Text(piece) => {
                self.reply.push_str(&piece);
                on_progress(&self.reply);
            }
            StreamEvent::Reasoning(piece) => {
                self.reasoning.push_str(&piece);
                on_reasoning(&self.reasoning);
            }
            StreamEvent::Done => self.finished = true,
            StreamEvent::Failed(error) => self.failure = Some(error),
            StreamEvent::Ignore => {}
        }
    }
}

/// Longest a streamed reply may take in total, however steadily it trickles.
const STREAM_DEADLINE: Duration = Duration::from_secs(300);

/// One request and its outcome, with any retry hint the server gave. `parse` turns a
/// status and body into the reply text or a classified error.
pub(super) async fn send_once(
    request: reqwest::RequestBuilder,
    model: &str,
    parse: fn(u16, &str, &str) -> Result<String, AiError>,
) -> (Result<String, AiError>, Option<Duration>) {
    let response = request.send().await;
    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return (Err(AiError::Timeout), None),
        Err(_) => return (Err(AiError::Network), None),
    };
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(Duration::from_secs);
    match response.text().await {
        Ok(text) => (parse(status, &text, model), retry_after),
        Err(error) if error.is_timeout() => (Err(AiError::Timeout), retry_after),
        Err(_) => (Err(AiError::Network), retry_after),
    }
}

/// One attempt at a streamed reply. Returns the outcome, any retry hint from
/// the server, and whether any text was already handed to `on_progress`: once
/// it has, the attempt cannot be retried without repeating text. `parse` reads one
/// line of the service's event stream.
pub(super) async fn stream_once_with(
    request: reqwest::RequestBuilder,
    idle_timeout: Duration,
    model: &str,
    parse: fn(&str, &str) -> StreamEvent,
    on_progress: &(dyn Fn(&str) + Sync),
    on_reasoning: &(dyn Fn(&str) + Sync),
) -> (Result<String, AiError>, Option<Duration>, bool) {
    let started = tokio::time::Instant::now();
    let request = request.send();
    let mut response = match tokio::time::timeout(idle_timeout, request).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) if error.is_timeout() => return (Err(AiError::Timeout), None, false),
        Ok(Err(_)) => return (Err(AiError::Network), None, false),
        Err(_) => return (Err(AiError::Timeout), None, false),
    };
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(Duration::from_secs);
    if !(200..300).contains(&status) {
        let text = response.text().await.unwrap_or_default();
        return (Err(classify_error(status, &text, model)), retry_after, false);
    }

    let mut progress = StreamProgress::default();
    let mut lines = LineBuffer::default();
    while !progress.is_over() {
        if started.elapsed() > STREAM_DEADLINE {
            progress.failure = Some(AiError::Timeout);
            break;
        }
        match tokio::time::timeout(idle_timeout, response.chunk()).await {
            Ok(Ok(Some(piece))) => {
                for line in lines.push(&piece) {
                    progress.absorb(&line, model, parse, on_progress, on_reasoning);
                }
            }
            Ok(Ok(None)) => break,
            Ok(Err(error)) if error.is_timeout() => progress.failure = Some(AiError::Timeout),
            Ok(Err(_)) => progress.failure = Some(AiError::Network),
            Err(_) => progress.failure = Some(AiError::Timeout),
        }
    }
    if let Some(last) = lines.finish() {
        progress.absorb(&last, model, parse, on_progress, on_reasoning);
    }

    let delivered = !progress.reply.is_empty();
    match progress.failure {
        Some(error) => (Err(error), retry_after, delivered),
        None if progress.reply.trim().is_empty() => (Err(AiError::EmptyReply), retry_after, false),
        None => (Ok(progress.reply), retry_after, delivered),
    }
}

/// A client for any service that speaks the chat-completions dialect.
pub struct ChatCompletionsClient {
    http: reqwest::Client,
    /// The API root; requests go to `{base_url}/chat/completions`.
    base_url: String,
    model: String,
    /// None for a local server that needs no key: no `Authorization` header is sent.
    api_key: Option<String>,
    /// Whether the service understands OpenRouter's `plugins` field. Sent to no one else.
    web_plugin: bool,
    /// The user's settings for this model (effort, temperature and so on), applied to every chat.
    tuning: Tuning,
    retry: RetryPolicy,
    text_timeout: Duration,
    attachment_timeout: Duration,
}

impl ChatCompletionsClient {
    /// A client for `base_url` (an API root such as `https://api.openai.com/v1`).
    /// `api_key` is None only for a service that needs none.
    pub fn for_service(
        base_url: String,
        api_key: Option<String>,
        model: &str,
        web_plugin: bool,
    ) -> Result<Self, AiError> {
        if model.trim().is_empty() {
            return Err(AiError::Other("No model is configured. Choose one in Settings.".into()));
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| AiError::Network)?;
        Ok(Self {
            http,
            base_url,
            model: model.to_string(),
            api_key: api_key.map(|key| key.trim().to_string()).filter(|key| !key.is_empty()),
            web_plugin,
            tuning: Tuning::default(),
            retry: RetryPolicy::standard(),
            text_timeout: Duration::from_secs(60),
            attachment_timeout: Duration::from_secs(90),
        })
    }

    /// The same client, answering with the user's settings for its model.
    pub fn with_tuning(mut self, tuning: Tuning) -> Self {
        self.tuning = tuning;
        self
    }

    /// A client that must have a key (the tests use this).
    #[cfg(test)]
    pub fn with_base_url(api_key: String, model: &str, base_url: String) -> Result<Self, AiError> {
        if api_key.trim().is_empty() {
            return Err(AiError::KeyMissing);
        }
        Self::for_service(base_url, Some(api_key), model, false)
    }

    /// The request body for `prompt`, without `plugins` unless this service takes them.
    fn body_for(&self, prompt: &ChatPrompt<'_>) -> Value {
        let mut body = build_chat_body(&self.model, prompt);
        if !self.web_plugin {
            if let Some(object) = body.as_object_mut() {
                object.remove("plugins");
            }
        }
        self.tuning.apply(&mut body);
        body
    }

    /// Adds the key, when there is one.
    fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.api_key {
            Some(key) => request.bearer_auth(key),
            None => request,
        }
    }

    #[cfg(test)]
    fn with_retry_and_timeouts(mut self, retry: RetryPolicy, text_timeout: Duration) -> Self {
        self.retry = retry;
        self.text_timeout = text_timeout;
        self.attachment_timeout = text_timeout;
        self
    }

    fn url(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }

    async fn post_once(&self, body: &Value, timeout: Duration) -> (Result<String, AiError>, Option<Duration>) {
        let request = self.authorize(self.http.post(self.url())).timeout(timeout).json(body);
        send_once(request, &self.model, parse_response).await
    }

    /// One attempt at a streamed reply; see `stream_once_with`.
    async fn stream_once(
        &self,
        body: &Value,
        idle_timeout: Duration,
        on_progress: &(dyn Fn(&str) + Sync),
        on_reasoning: &(dyn Fn(&str) + Sync),
    ) -> (Result<String, AiError>, Option<Duration>, bool) {
        let request = self.authorize(self.http.post(self.url())).json(body);
        stream_once_with(request, idle_timeout, &self.model, parse_stream_line, on_progress, on_reasoning)
            .await
    }

    async fn post(&self, body: Value, timeout: Duration) -> Result<String, AiError> {
        let mut attempt = 0;
        loop {
            let (result, server_hint) = self.post_once(&body, timeout).await;
            match result {
                Err(error) if error.is_transient() && attempt + 1 < self.retry.max_attempts => {
                    tokio::time::sleep(self.retry.delay_for(attempt, server_hint)).await;
                    attempt += 1;
                }
                other => return other,
            }
        }
    }
}

impl LlmClient for ChatCompletionsClient {
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
        let idle_timeout =
            if prompt.attachment.is_some() { self.attachment_timeout } else { self.text_timeout };
        let mut body = self.body_for(&prompt);
        body["stream"] = json!(true);
        let mut attempt = 0;
        loop {
            let (result, server_hint, delivered) =
                self.stream_once(&body, idle_timeout, on_progress, on_reasoning).await;
            match result {
                // Retrying after text has been shown would repeat it.
                Err(error)
                    if !delivered && error.is_transient() && attempt + 1 < self.retry.max_attempts =>
                {
                    tokio::time::sleep(self.retry.delay_for(attempt, server_hint)).await;
                    attempt += 1;
                }
                other => return other,
            }
        }
    }

    async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
        let timeout = if prompt.attachment.is_some() { self.attachment_timeout } else { self.text_timeout };
        self.post(self.body_for(&prompt), timeout).await
    }

    async fn generate(&self, prompt: &str, attachment: Option<&InlineData>) -> Result<String, AiError> {
        let timeout = if attachment.is_some() { self.attachment_timeout } else { self.text_timeout };
        self.post(build_generate_body(&self.model, prompt, attachment), timeout).await
    }
}

/// A short topic title for a conversation, from its first exchange.
pub fn title_prompt(first_user_message: &str, first_assistant_reply: &str) -> String {
    format!(
        "Summarize the topic of this exchange in 3-6 words, suitable as a short conversation title. Reply with ONLY the title text \u{2014} no quotes, no ending punctuation, no explanation.\n\nUser: {first_user_message}\nAssistant: {first_assistant_reply}"
    )
}

/// Asks the model for a title and cleans it up. An empty or absurdly long
/// answer yields `None` so the caller keeps its placeholder.
pub async fn generate_title(
    client: &impl LlmClient,
    first_user_message: &str,
    first_assistant_reply: &str,
) -> Result<Option<String>, AiError> {
    let raw = client.generate(&title_prompt(first_user_message, first_assistant_reply), None).await?;
    let title = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '.').trim().to_string();
    if title.is_empty() || title.chars().count() > 80 {
        return Ok(None);
    }
    Ok(Some(title))
}

/// Cheap round trip used by "Test connection" in Settings.
pub async fn test_connection(client: &impl LlmClient) -> Result<(), AiError> {
    let reply = client.generate("Hello", None).await?;
    if reply.trim().is_empty() {
        return Err(AiError::EmptyReply);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    fn ok_reply(text: &str) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({
            "choices": [{ "message": { "role": "assistant", "content": text }, "finish_reason": "stop" }]
        }))
    }

    fn fast_retry() -> RetryPolicy {
        RetryPolicy { max_attempts: 3, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(20) }
    }

    async fn client_for(server: &MockServer) -> ChatCompletionsClient {
        ChatCompletionsClient::with_base_url("test-key".into(), "test/model", format!("{}/v1", server.uri()))
            .unwrap()
            .with_retry_and_timeouts(fast_retry(), Duration::from_secs(5))
    }

    fn prompt<'a>(message: &'a str, history: &'a [Turn]) -> ChatPrompt<'a> {
        ChatPrompt { system: "be kind", history, message, attachment: None, web_search: false }
    }

    // ---- request building ----

    #[test]
    fn history_starting_with_a_model_turn_drops_it() {
        let history = [turn(Role::Model, "stale"), turn(Role::User, "hi"), turn(Role::Model, "hello")];

        let normalized = normalize_history(&history);

        assert_eq!(normalized, vec![turn(Role::User, "hi"), turn(Role::Model, "hello")]);
    }

    #[test]
    fn consecutive_turns_of_one_role_are_merged_and_empty_turns_dropped() {
        let history = [
            turn(Role::User, "one"),
            turn(Role::User, "two"),
            turn(Role::Model, "   "),
            turn(Role::Model, "answer"),
        ];

        let normalized = normalize_history(&history);

        assert_eq!(normalized, vec![turn(Role::User, "one\n\ntwo"), turn(Role::Model, "answer")]);
    }

    #[test]
    fn the_request_names_the_model_and_carries_the_persona_history_and_new_message() {
        let history = [turn(Role::User, "hi"), turn(Role::Model, "hello")];

        let body = build_chat_body("google/gemma-4-31b-it", &prompt("what next?", &history));

        assert_eq!(body["model"], "google/gemma-4-31b-it");
        assert_eq!(body["messages"][0], json!({ "role": "system", "content": "be kind" }));
        assert_eq!(body["messages"][1], json!({ "role": "user", "content": "hi" }));
        assert_eq!(body["messages"][2], json!({ "role": "assistant", "content": "hello" }));
        assert_eq!(body["messages"][3], json!({ "role": "user", "content": "what next?" }));
    }

    #[test]
    fn a_history_ending_on_a_user_turn_does_not_produce_two_user_turns_in_a_row() {
        let history = [turn(Role::User, "unanswered")];

        let body = build_chat_body("m", &prompt("follow up", &history));

        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2, "the persona plus one merged user turn");
        assert_eq!(messages[1]["content"], "unanswered\n\nfollow up");
    }

    #[test]
    fn a_blank_persona_adds_no_system_message() {
        let chat = ChatPrompt { system: "  ", history: &[], message: "hello", attachment: None, web_search: false };

        let body = build_chat_body("m", &chat);

        assert_eq!(body["messages"], json!([{ "role": "user", "content": "hello" }]));
    }

    #[test]
    fn an_attachment_is_sent_as_an_inline_data_url_after_the_text() {
        let image = InlineData { mime_type: "image/jpeg".into(), base64: "QUJD".into() };
        let chat = ChatPrompt { system: "", history: &[], message: "what is this?", attachment: Some(&image), web_search: false };

        let body = build_chat_body("m", &chat);

        assert_eq!(
            body["messages"][0]["content"],
            json!([
                { "type": "text", "text": "what is this?" },
                { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,QUJD" } }
            ])
        );
    }

    #[test]
    fn a_one_off_prompt_is_a_single_user_message() {
        let body = build_generate_body("m", "name this", None);

        assert_eq!(body, json!({ "model": "m", "messages": [{ "role": "user", "content": "name this" }] }));
    }

    // ---- response interpretation ----

    #[test]
    fn a_normal_reply_returns_its_text() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Hello there"},"finish_reason":"stop"}]}"#;

        assert_eq!(parse_response(200, body, "m").unwrap(), "Hello there");
    }

    #[test]
    fn content_given_as_typed_parts_is_joined() {
        let body = r#"{"choices":[{"message":{"content":[{"type":"text","text":"Hello "},{"type":"text","text":"there"}]}}]}"#;

        assert_eq!(parse_response(200, body, "m").unwrap(), "Hello there");
    }

    #[test]
    fn reasoning_is_not_part_of_the_answer() {
        let body = r#"{"choices":[{"message":{"content":"Answer","reasoning":"musing about it"}}]}"#;

        assert_eq!(parse_response(200, body, "m").unwrap(), "Answer");
    }

    #[test]
    fn a_reply_cut_off_by_the_token_limit_still_returns_what_it_has() {
        let body = r#"{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}"#;

        assert_eq!(parse_response(200, body, "m").unwrap(), "partial");
    }

    #[test]
    fn a_refusal_is_reported_as_blocked() {
        let body = r#"{"choices":[{"message":{"content":null,"refusal":"I can't help with that."}}]}"#;

        assert_eq!(parse_response(200, body, "m"), Err(AiError::Blocked("I can't help with that.".into())));
    }

    #[test]
    fn a_content_filter_stop_with_no_text_is_reported_as_blocked() {
        let body = r#"{"choices":[{"message":{"content":""},"finish_reason":"content_filter"}]}"#;

        assert_eq!(parse_response(200, body, "m"), Err(AiError::Blocked("content filter".into())));
    }

    #[test]
    fn no_choices_and_garbage_are_an_empty_reply() {
        assert_eq!(parse_response(200, "{}", "m"), Err(AiError::EmptyReply));
        assert_eq!(parse_response(200, r#"{"choices":[]}"#, "m"), Err(AiError::EmptyReply));
        assert_eq!(parse_response(200, "not json", "m"), Err(AiError::EmptyReply));
    }

    #[test]
    fn an_error_inside_a_successful_response_is_classified_by_its_own_code() {
        let rate_limited = r#"{"error":{"code":429,"message":"Provider returned error"}}"#;
        let no_code = r#"{"error":{"message":"upstream exploded"}}"#;

        assert_eq!(parse_response(200, rate_limited, "m"), Err(AiError::RateLimited));
        assert_eq!(parse_response(200, no_code, "m"), Err(AiError::Server(502)));
    }

    #[test]
    fn http_errors_are_classified() {
        assert_eq!(parse_response(401, r#"{"error":{"message":"No auth credentials found"}}"#, "m"), Err(AiError::InvalidKey));
        assert_eq!(parse_response(402, "{}", "m"), Err(AiError::OutOfCredits));
        assert_eq!(parse_response(404, "{}", "gemma-x"), Err(AiError::ModelUnavailable("gemma-x".into())));
        assert_eq!(
            parse_response(400, r#"{"error":{"message":"foo/bar is not a valid model ID","code":400}}"#, "foo/bar"),
            Err(AiError::ModelUnavailable("foo/bar".into()))
        );
        assert_eq!(parse_response(408, "{}", "m"), Err(AiError::Timeout));
        assert_eq!(parse_response(429, "{}", "m"), Err(AiError::RateLimited));
        assert_eq!(parse_response(503, "{}", "m"), Err(AiError::Server(503)));
        assert_eq!(
            parse_response(400, r#"{"error":{"message":"Request payload size exceeds the limit"}}"#, "m"),
            Err(AiError::BadRequest("Request payload size exceeds the limit".into()))
        );
    }

    #[test]
    fn a_403_is_a_key_problem_or_a_moderation_block_depending_on_its_message() {
        let key = r#"{"error":{"message":"Key limit exceeded"}}"#;
        let moderated = r#"{"error":{"message":"Your input was flagged by moderation"}}"#;

        assert_eq!(parse_response(403, key, "m"), Err(AiError::InvalidKey));
        assert_eq!(parse_response(403, moderated, "m"), Err(AiError::Blocked("flagged by moderation".into())));
    }

    #[test]
    fn a_very_long_error_message_is_shortened() {
        let body = format!(r#"{{"error":{{"message":"{}"}}}}"#, "x".repeat(1000));

        let AiError::BadRequest(message) = parse_response(400, &body, "m").unwrap_err() else {
            panic!("expected a bad request");
        };

        assert!(message.chars().count() <= 201);
    }

    #[test]
    fn errors_serialize_with_a_kind_and_a_user_message() {
        let value = serde_json::to_value(AiError::KeyMissing).unwrap();

        assert_eq!(value["kind"], "key-missing");
        assert_eq!(value["message"], "Add your API key in Settings to use Zara.");
    }

    #[test]
    fn a_model_id_with_a_provider_prefix_and_variant_suffix_is_accepted() {
        assert!(ChatCompletionsClient::with_base_url("key".into(), "google/gemma-4-31b-it:free", "https://openrouter.ai/api/v1".to_string()).is_ok());
        assert_eq!(
            ChatCompletionsClient::with_base_url("key".into(), "  ", "https://openrouter.ai/api/v1".to_string()).err(),
            Some(AiError::Other("No model is configured. Choose one in Settings.".into()))
        );
    }

    #[test]
    fn a_blank_api_key_is_reported_as_missing() {
        assert_eq!(ChatCompletionsClient::with_base_url("   ".into(), "m", "https://openrouter.ai/api/v1".to_string()).err(), Some(AiError::KeyMissing));
    }

    #[test]
    fn retry_delays_double_and_respect_the_server_hint_up_to_the_cap() {
        let policy = RetryPolicy { max_attempts: 4, base_delay: Duration::from_millis(100), max_delay: Duration::from_secs(1) };

        assert_eq!(policy.delay_for(0, None), Duration::from_millis(100));
        assert_eq!(policy.delay_for(2, None), Duration::from_millis(400));
        assert_eq!(policy.delay_for(10, None), Duration::from_secs(1));
        assert_eq!(policy.delay_for(0, Some(Duration::from_millis(700))), Duration::from_millis(700));
        assert_eq!(policy.delay_for(0, Some(Duration::from_secs(60))), Duration::from_secs(1));
    }

    // ---- transport (a local mock server) ----

    #[tokio::test]
    async fn a_chat_request_sends_the_key_as_a_bearer_token_and_returns_the_reply() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .respond_with(ok_reply("Hi from Gemma"))
            .expect(1)
            .mount(&server)
            .await;
        let client = client_for(&server).await;

        let reply = client.chat(prompt("hello", &[])).await.unwrap();

        assert_eq!(reply, "Hi from Gemma");
        let received = &server.received_requests().await.unwrap()[0];
        assert!(!received.url.to_string().contains("test-key"), "the key must never be in the URL");
        let sent: Value = serde_json::from_slice(&received.body).unwrap();
        assert_eq!(sent["model"], "test/model");
    }

    #[tokio::test]
    async fn a_rejected_key_fails_immediately_without_retrying() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": { "message": "bad key" } })))
            .expect(1)
            .mount(&server)
            .await;
        let client = client_for(&server).await;

        let result = client.chat(prompt("hello", &[])).await;

        assert_eq!(result, Err(AiError::InvalidKey));
    }

    #[tokio::test]
    async fn an_account_out_of_credits_fails_immediately_without_retrying() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(402).set_body_json(json!({ "error": { "message": "Insufficient credits" } })))
            .expect(1)
            .mount(&server)
            .await;
        let client = client_for(&server).await;

        let result = client.chat(prompt("hello", &[])).await;

        assert_eq!(result, Err(AiError::OutOfCredits));
    }

    #[tokio::test]
    async fn a_rate_limit_is_retried_and_then_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST")).respond_with(ok_reply("second time lucky")).mount(&server).await;
        let client = client_for(&server).await;

        let reply = client.chat(prompt("hello", &[])).await.unwrap();

        assert_eq!(reply, "second time lucky");
        assert_eq!(server.received_requests().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn an_upstream_failure_reported_inside_a_200_is_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "error": { "code": 503, "message": "overloaded" } })))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST")).respond_with(ok_reply("recovered")).mount(&server).await;
        let client = client_for(&server).await;

        let reply = client.chat(prompt("hello", &[])).await.unwrap();

        assert_eq!(reply, "recovered");
    }

    #[tokio::test]
    async fn a_server_that_keeps_failing_is_given_up_on_after_the_attempt_limit() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(503)).mount(&server).await;
        let client = client_for(&server).await;

        let result = client.chat(prompt("hello", &[])).await;

        assert_eq!(result, Err(AiError::Server(503)));
        assert_eq!(server.received_requests().await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn a_slow_server_times_out() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ok_reply("too late").set_delay(Duration::from_millis(400)))
            .mount(&server)
            .await;
        let client = ChatCompletionsClient::with_base_url("k".into(), "test/model", format!("{}/v1", server.uri()))
            .unwrap()
            .with_retry_and_timeouts(
                RetryPolicy { max_attempts: 1, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(1) },
                Duration::from_millis(80),
            );

        let result = client.chat(prompt("hello", &[])).await;

        assert_eq!(result, Err(AiError::Timeout));
    }

    #[tokio::test]
    async fn a_server_that_hangs_up_is_a_network_error() {
        // Accepts one connection and closes it without answering. (A closed port
        // would also work, but Windows retries those for about two seconds.)
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let _ = listener.accept();
        });
        let client = ChatCompletionsClient::with_base_url("k".into(), "m", format!("http://{address}/v1"))
            .unwrap()
            .with_retry_and_timeouts(
                RetryPolicy { max_attempts: 1, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(1) },
                Duration::from_secs(5),
            );

        let result = client.chat(prompt("hello", &[])).await;

        assert_eq!(result, Err(AiError::Network));
    }

    #[tokio::test]
    async fn a_screenshot_goes_to_the_server_as_an_image_part() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ok_reply("a desktop")).mount(&server).await;
        let client = client_for(&server).await;
        let image = InlineData { mime_type: "image/png".into(), base64: "QUJD".into() };

        let reply = client.generate("describe", Some(&image)).await.unwrap();

        assert_eq!(reply, "a desktop");
        let sent: Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
        assert_eq!(sent["messages"][0]["content"][1]["image_url"]["url"], "data:image/png;base64,QUJD");
    }

    #[tokio::test]
    async fn a_generated_title_is_stripped_of_quotes_and_trailing_punctuation() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ok_reply("\"Brewing green tea.\"")).mount(&server).await;
        let client = client_for(&server).await;

        let title = generate_title(&client, "how do I brew tea?", "Steep it").await.unwrap();

        assert_eq!(title, Some("Brewing green tea".to_string()));
    }

    #[tokio::test]
    async fn an_absurdly_long_title_is_discarded() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ok_reply(&"long ".repeat(40))).mount(&server).await;
        let client = client_for(&server).await;

        assert_eq!(generate_title(&client, "q", "a").await.unwrap(), None);
    }

    // ---- the real service (run by hand: `cargo test live_ -- --ignored`) ----

    /// Talks to OpenRouter for real, so it needs `OPENROUTER_API_KEY` in the
    /// environment (never in the repository) and spends a fraction of a cent.
    #[tokio::test]
    #[ignore = "needs OPENROUTER_API_KEY and network access"]
    async fn live_the_default_model_answers_with_the_persona_applied() {
        let key = std::env::var("OPENROUTER_API_KEY").expect("set OPENROUTER_API_KEY to run this test");
        let client = ChatCompletionsClient::with_base_url(key, "google/gemma-4-31b-it", "https://openrouter.ai/api/v1".to_string()).unwrap();
        let chat = ChatPrompt {
            system: "You are Zara. Reply with exactly one word.",
            history: &[turn(Role::User, "Hi"), turn(Role::Model, "Hello")],
            message: "What colour is a clear daytime sky?",
            attachment: None,
            web_search: false,
        };

        let reply = client.chat(chat).await.unwrap();

        assert!(reply.to_lowercase().contains("blue"), "unexpected reply: {reply:?}");
    }

    #[tokio::test]
    #[ignore = "needs network access"]
    async fn live_a_made_up_key_is_reported_as_invalid() {
        let client = ChatCompletionsClient::with_base_url("sk-or-v1-not-a-real-key".into(), "google/gemma-4-31b-it", "https://openrouter.ai/api/v1".to_string()).unwrap();

        let result = client.generate("Hello", None).await;

        assert_eq!(result, Err(AiError::InvalidKey));
    }

    #[tokio::test]
    async fn the_connection_test_succeeds_on_any_non_empty_reply_and_fails_on_a_rejected_key() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ok_reply("Hi!")).up_to_n_times(1).mount(&server).await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(403).set_body_json(json!({"error":{"message":"API key invalid"}}))).mount(&server).await;
        let client = client_for(&server).await;

        assert_eq!(test_connection(&client).await, Ok(()));
        assert_eq!(test_connection(&client).await, Err(AiError::InvalidKey));
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use std::sync::Mutex;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn data(text: &str) -> String {
        format!("data: {}\n\n", json!({ "choices": [{ "delta": { "content": text } }] }))
    }

    fn event_stream(body: String) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(body.into_bytes(), "text/event-stream")
    }

    fn fast_retry() -> RetryPolicy {
        RetryPolicy { max_attempts: 3, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(20) }
    }

    async fn client_for(server: &MockServer) -> ChatCompletionsClient {
        ChatCompletionsClient::with_base_url("test-key".into(), "test/model", format!("{}/v1", server.uri()))
            .unwrap()
            .with_retry_and_timeouts(fast_retry(), Duration::from_secs(5))
    }

    fn prompt() -> ChatPrompt<'static> {
        ChatPrompt { system: "be kind", history: &[], message: "hello", attachment: None, web_search: false }
    }

    // ---- reading lines of the stream ----

    #[test]
    fn a_data_line_with_text_is_text() {
        let line = r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Text("Hel".into()));
    }

    #[test]
    fn a_delta_with_reasoning_is_reasoning_not_text() {
        let line = r#"data: {"choices":[{"delta":{"content":"","reasoning":"The user wants"}}]}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Reasoning("The user wants".into()));
    }

    #[test]
    fn mistral_thinking_chunks_are_reasoning_and_its_text_chunks_are_the_answer() {
        let thinking = r#"data: {"choices":[{"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":"Checking units."}]}]}}]}"#;
        let answer = r#"data: {"choices":[{"delta":{"content":[{"type":"text","text":"Three."}]}}]}"#;

        assert_eq!(parse_stream_line(thinking, "m"), StreamEvent::Reasoning("Checking units.".into()));
        assert_eq!(parse_stream_line(answer, "m"), StreamEvent::Text("Three.".into()));
    }

    #[test]
    fn reasoning_sent_as_reasoning_content_is_read_too() {
        let line = r#"data: {"choices":[{"delta":{"reasoning_content":"Let me check"}}]}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Reasoning("Let me check".into()));
    }

    #[test]
    fn the_done_marker_ends_the_stream() {
        assert_eq!(parse_stream_line("data: [DONE]", "m"), StreamEvent::Done);
    }

    #[test]
    fn keep_alive_comments_and_role_only_chunks_are_ignored() {
        assert_eq!(parse_stream_line(": OPENROUTER PROCESSING", "m"), StreamEvent::Ignore);
        assert_eq!(parse_stream_line("", "m"), StreamEvent::Ignore);
        assert_eq!(
            parse_stream_line(r#"data: {"choices":[{"delta":{"role":"assistant","content":""}}]}"#, "m"),
            StreamEvent::Ignore
        );
        assert_eq!(parse_stream_line("data: not json", "m"), StreamEvent::Ignore);
    }

    #[test]
    fn an_error_object_in_the_stream_is_a_failure() {
        let line = r#"data: {"error":{"code":429,"message":"slow down"}}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Failed(AiError::RateLimited));
    }

    #[test]
    fn a_content_filter_finish_with_no_text_is_a_block() {
        let line = r#"data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}"#;

        assert!(matches!(parse_stream_line(line, "m"), StreamEvent::Failed(AiError::Blocked(_))));
    }

    #[test]
    fn a_line_split_across_pieces_comes_out_whole() {
        let mut buffer = LineBuffer::default();

        assert!(buffer.push(b"data: {\"a\"").is_empty());
        let lines = buffer.push(b":1}\n\ndata: next\n");

        assert_eq!(lines, vec!["data: {\"a\":1}", "", "data: next"]);
    }

    #[test]
    fn a_multi_byte_character_split_across_pieces_is_not_corrupted() {
        let text = "data: caf\u{e9} \u{1f600}\n";
        let bytes = text.as_bytes();
        let mut buffer = LineBuffer::default();

        // Split inside the two-byte e-acute and again inside the four-byte emoji.
        let mut lines = buffer.push(&bytes[..10]);
        lines.extend(buffer.push(&bytes[10..14]));
        lines.extend(buffer.push(&bytes[14..]));

        assert_eq!(lines, vec!["data: caf\u{e9} \u{1f600}"]);
    }

    #[test]
    fn carriage_returns_are_dropped_and_a_final_unterminated_line_is_kept() {
        let mut buffer = LineBuffer::default();

        let lines = buffer.push(b"data: one\r\ndata: two");

        assert_eq!(lines, vec!["data: one"]);
        assert_eq!(buffer.finish(), Some("data: two".to_string()));
        assert_eq!(buffer.finish(), None);
    }

    // ---- the request and the network ----

    #[tokio::test]
    async fn the_users_settings_for_the_model_are_in_the_request_but_not_in_a_title_prompt() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "reasoning_effort": "high", "temperature": 0.4 })))
            .respond_with(event_stream(format!("{}data: [DONE]\n\n", data("ok"))))
            .expect(1)
            .mount(&server)
            .await;
        let saved = serde_json::Map::from_iter([
            ("effort".to_string(), json!("high")),
            ("temperature".to_string(), json!(0.4)),
        ]);
        let tuning = Tuning::resolve(crate::ai::providers::ProviderId::Custom, "m", &saved);

        let reply = client_for(&server).await.with_tuning(tuning).chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Ok("ok".to_string()));
    }

    #[tokio::test]
    async fn the_request_asks_for_a_streamed_reply() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(body_partial_json(json!({ "stream": true })))
            .respond_with(event_stream(format!("{}data: [DONE]\n\n", data("ok"))))
            .expect(1)
            .mount(&server)
            .await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Ok("ok".to_string()));
    }

    #[tokio::test]
    async fn progress_is_reported_with_the_whole_reply_so_far() {
        let server = MockServer::start().await;
        let body = format!("{}{}{}data: [DONE]\n\n", data("Steep "), data("it for "), data("three minutes."));
        Mock::given(method("POST")).respond_with(event_stream(body)).mount(&server).await;
        let seen = Mutex::new(Vec::<String>::new());

        let reply = client_for(&server)
            .await
            .chat_streaming(prompt(), &|so_far| seen.lock().unwrap().push(so_far.to_string()))
            .await;

        assert_eq!(reply, Ok("Steep it for three minutes.".to_string()));
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["Steep ", "Steep it for ", "Steep it for three minutes."]
        );
    }

    #[tokio::test]
    async fn reasoning_is_reported_whole_so_far_and_is_kept_out_of_the_reply() {
        let server = MockServer::start().await;
        let reasoning = |piece: &str| {
            format!("data: {}\n\n", json!({ "choices": [{ "delta": { "reasoning": piece } }] }))
        };
        let body = format!(
            "{}{}{}data: [DONE]\n\n",
            reasoning("Check the "),
            reasoning("timer length."),
            data("Three minutes.")
        );
        Mock::given(method("POST")).respond_with(event_stream(body)).mount(&server).await;
        let thoughts = Mutex::new(Vec::<String>::new());

        let reply = client_for(&server)
            .await
            .chat_streaming_with_reasoning(prompt(), &|_| {}, &|so_far| {
                thoughts.lock().unwrap().push(so_far.to_string());
            })
            .await;

        assert_eq!(reply, Ok("Three minutes.".to_string()));
        assert_eq!(*thoughts.lock().unwrap(), vec!["Check the ", "Check the timer length."]);
    }

    #[tokio::test]
    async fn keep_alive_lines_do_not_disturb_the_reply() {
        let server = MockServer::start().await;
        let body = format!(
            ": OPENROUTER PROCESSING\n\n{}: still working\n\n{}data: [DONE]\n\n",
            data("A"),
            data("B")
        );
        Mock::given(method("POST")).respond_with(event_stream(body)).mount(&server).await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Ok("AB".to_string()));
    }

    #[tokio::test]
    async fn a_reply_without_a_done_marker_still_finishes_when_the_stream_closes() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(event_stream(data("Whole answer"))).mount(&server).await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Ok("Whole answer".to_string()));
    }

    #[tokio::test]
    async fn a_stream_with_no_text_is_an_empty_reply() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(event_stream("data: [DONE]\n\n".into())).mount(&server).await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Err(AiError::EmptyReply));
    }

    #[tokio::test]
    async fn a_rate_limit_before_any_text_is_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(event_stream(format!("{}data: [DONE]\n\n", data("second try"))))
            .mount(&server)
            .await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Ok("second try".to_string()));
    }

    #[tokio::test]
    async fn an_error_after_text_has_been_shown_is_not_retried() {
        let server = MockServer::start().await;
        let body = format!(
            "{}data: {}\n\n",
            data("Half an answ"),
            json!({ "error": { "code": 503, "message": "provider went away" } })
        );
        Mock::given(method("POST")).respond_with(event_stream(body)).expect(1).mount(&server).await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Err(AiError::Server(503)));
    }

    #[tokio::test]
    async fn a_rejected_key_is_reported_without_streaming() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(401)).expect(1).mount(&server).await;

        let reply = client_for(&server).await.chat_streaming(prompt(), &|_| {}).await;

        assert_eq!(reply, Err(AiError::InvalidKey));
    }
}

#[cfg(test)]
mod web_search_request_tests {
    use super::*;

    fn body(web_search: bool) -> Value {
        let chat = ChatPrompt { system: "be kind", history: &[], message: "news?", attachment: None, web_search };
        build_chat_body("m", &chat)
    }

    #[test]
    fn a_request_that_searches_asks_the_provider_for_its_web_plugin() {
        let request = body(true);

        assert_eq!(request["plugins"], json!([{ "id": "web", "max_results": 5 }]));
    }

    #[test]
    fn an_ordinary_request_carries_no_plugin_and_so_costs_no_search() {
        assert!(body(false).get("plugins").is_none());
    }

    #[test]
    fn the_messages_are_the_same_with_or_without_a_search() {
        assert_eq!(body(true)["messages"], body(false)["messages"]);
    }
}

#[cfg(test)]
mod service_client_tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn searching_prompt() -> ChatPrompt<'static> {
        ChatPrompt { system: "", history: &[], message: "news?", attachment: None, web_search: true }
    }

    fn ok_reply() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({
            "choices": [{ "message": { "role": "assistant", "content": "hi" }, "finish_reason": "stop" }]
        }))
    }

    #[test]
    fn only_a_service_that_takes_the_web_plugin_is_sent_it() {
        let takes = ChatCompletionsClient::for_service("https://x.example/v1".into(), Some("k".into()), "m", true).unwrap();
        let does_not =
            ChatCompletionsClient::for_service("https://x.example/v1".into(), Some("k".into()), "m", false).unwrap();

        assert!(takes.body_for(&searching_prompt()).get("plugins").is_some());
        assert!(does_not.body_for(&searching_prompt()).get("plugins").is_none());
    }

    #[tokio::test]
    async fn a_service_with_no_key_is_called_without_an_authorization_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/v1/chat/completions")).respond_with(ok_reply()).expect(1).mount(&server).await;
        let client = ChatCompletionsClient::for_service(format!("{}/v1", server.uri()), None, "llama3.2", false).unwrap();

        let reply = client.generate("hello", None).await;

        assert_eq!(reply, Ok("hi".to_string()));
        let received = server.received_requests().await.unwrap();
        assert!(received[0].headers.get("authorization").is_none());
    }

    #[tokio::test]
    async fn a_service_with_a_key_is_called_with_it_as_a_bearer_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ok_reply()).mount(&server).await;
        let client =
            ChatCompletionsClient::for_service(format!("{}/v1", server.uri()), Some(" sk-test ".into()), "m", false)
                .unwrap();

        let _ = client.generate("hello", None).await;

        let received = server.received_requests().await.unwrap();
        assert_eq!(received[0].headers.get("authorization").unwrap(), "Bearer sk-test");
    }

    #[tokio::test]
    async fn the_request_path_is_chat_completions_under_whatever_root_the_service_has() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/openai/v1/chat/completions"))
            .respond_with(ok_reply())
            .expect(1)
            .mount(&server)
            .await;
        let client =
            ChatCompletionsClient::for_service(format!("{}/openai/v1/", server.uri()), Some("k".into()), "m", false)
                .unwrap();

        assert_eq!(client.generate("hello", None).await, Ok("hi".to_string()));
    }

    #[test]
    fn a_blank_model_is_refused_with_a_pointer_to_settings() {
        let result = ChatCompletionsClient::for_service("https://x.example/v1".into(), None, "  ", false);

        assert_eq!(
            result.err(),
            Some(AiError::Other("No model is configured. Choose one in Settings.".into()))
        );
    }

    #[test]
    fn a_service_that_needs_a_key_for_its_one_constructor_refuses_a_blank_one() {
        assert_eq!(
            ChatCompletionsClient::with_base_url("  ".into(), "m", "https://x.example/v1".into()).err(),
            Some(AiError::KeyMissing)
        );
    }
}
