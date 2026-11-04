//! The Anthropic client. Anthropic's Messages API is not the chat-completions
//! dialect: the system prompt is a top-level field, replies are lists of content
//! blocks, images are `source` blocks, a reply must say how long it may be, the
//! key travels in `x-api-key`, and the event stream has its own event types. The
//! transport (retries, the idle timeout, reading lines) is shared with the other
//! client in `llm.rs`.

use super::llm::{
    classify_error, normalize_history, send_once, shorten, stream_once_with, AiError, ChatPrompt,
    InlineData, LlmClient, RetryPolicy, Role, StreamEvent,
};
use super::tuning::Tuning;
use serde_json::{json, Value};
use std::time::Duration;

/// The API version header Anthropic requires on every request.
const API_VERSION: &str = "2023-06-01";

/// The most a reply may run to, in tokens. Anthropic requires one; this is far
/// above what a notch panel shows.
const MAX_REPLY_TOKENS: u32 = 4096;

pub struct AnthropicClient {
    http: reqwest::Client,
    /// The API root; requests go to `{base_url}/messages`.
    base_url: String,
    model: String,
    api_key: String,
    /// The user's settings for this model (effort, thinking and so on), applied to every chat.
    tuning: Tuning,
    retry: RetryPolicy,
    text_timeout: Duration,
    attachment_timeout: Duration,
}

impl AnthropicClient {
    pub fn new(base_url: String, api_key: String, model: &str) -> Result<Self, AiError> {
        if api_key.trim().is_empty() {
            return Err(AiError::KeyMissing);
        }
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
            api_key: api_key.trim().to_string(),
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

    /// The `messages` body for a chat, with the user's settings applied when `tuned`.
    fn chat_body(&self, prompt: &ChatPrompt<'_>, stream: bool, tuned: bool) -> Value {
        let mut body = build_messages_body(&self.model, prompt, stream);
        if tuned {
            self.tuning.apply(&mut body);
            make_room_for_thinking(&mut body);
        }
        body
    }

    /// One non-streamed chat. `tuned` applies the user's settings for the model; titles
    /// and connection checks are sent without them.
    async fn send_chat(&self, prompt: ChatPrompt<'_>, tuned: bool) -> Result<String, AiError> {
        let body = self.chat_body(&prompt, false, tuned);
        let timeout = self.idle_timeout(prompt.attachment.is_some());
        let mut attempt = 0;
        loop {
            let request = self.request().timeout(timeout).json(&body);
            let (result, server_hint) = send_once(request, &self.model, parse_messages_response).await;
            match result {
                Err(error) if error.is_transient() && attempt + 1 < self.retry.max_attempts => {
                    tokio::time::sleep(self.retry.delay_for(attempt, server_hint)).await;
                    attempt += 1;
                }
                other => return other,
            }
        }
    }

    #[cfg(test)]
    fn with_retry_and_timeouts(mut self, retry: RetryPolicy, timeout: Duration) -> Self {
        self.retry = retry;
        self.text_timeout = timeout;
        self.attachment_timeout = timeout;
        self
    }

    fn url(&self) -> String {
        format!("{}/messages", self.base_url.trim_end_matches('/'))
    }

    fn request(&self) -> reqwest::RequestBuilder {
        self.http
            .post(self.url())
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
    }

    fn idle_timeout(&self, has_image: bool) -> Duration {
        if has_image { self.attachment_timeout } else { self.text_timeout }
    }
}

/// A user message: plain text, or the image followed by the text (Anthropic reads
/// best with the image first).
fn user_content(text: &str, attachment: Option<&InlineData>) -> Value {
    match attachment {
        None => json!(text),
        Some(data) => json!([
            { "type": "image", "source": { "type": "base64", "media_type": data.mime_type, "data": data.base64 } },
            { "type": "text", "text": text }
        ]),
    }
}

/// The JSON body for `messages`: the system prompt on its own, then strictly
/// alternating turns starting with the user's.
pub fn build_messages_body(model: &str, prompt: &ChatPrompt<'_>, stream: bool) -> Value {
    let mut messages: Vec<Value> = normalize_history(prompt.history)
        .iter()
        .map(|turn| {
            let role = if turn.role == Role::User { "user" } else { "assistant" };
            json!({ "role": role, "content": turn.text })
        })
        .collect();

    // A history ending on a user turn would put two user turns in a row.
    let mut message = prompt.message.to_string();
    if matches!(messages.last(), Some(last) if last["role"] == "user") {
        let previous = messages.pop().expect("checked above");
        let previous_text = previous["content"].as_str().unwrap_or_default();
        message = format!("{previous_text}\n\n{message}");
    }
    messages.push(json!({ "role": "user", "content": user_content(&message, prompt.attachment) }));

    let mut body = json!({ "model": model, "max_tokens": MAX_REPLY_TOKENS, "messages": messages });
    if !prompt.system.trim().is_empty() {
        body["system"] = json!(prompt.system);
    }
    if stream {
        body["stream"] = json!(true);
    }
    body
}

/// Thinking tokens count toward `max_tokens`, and a thinking budget must be smaller
/// than it, so a budget at or above the limit gets the usual reply allowance on top.
fn make_room_for_thinking(body: &mut Value) {
    let budget = body["thinking"]["budget_tokens"].as_u64();
    let limit = body["max_tokens"].as_u64().unwrap_or(0);
    if let Some(budget) = budget.filter(|budget| *budget >= limit) {
        body["max_tokens"] = json!(budget + u64::from(MAX_REPLY_TOKENS));
    }
}

/// The text of a finished (non-streamed) reply, or the reason there is none.
pub fn parse_messages_response(status: u16, body: &str, model: &str) -> Result<String, AiError> {
    if !(200..300).contains(&status) {
        return Err(classify_error(status, body, model));
    }
    let value: Value = serde_json::from_str(body).map_err(|_| AiError::EmptyReply)?;
    if value["type"] == "error" {
        return Err(classify_error(500, body, model));
    }
    let text: String = value["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect()
        })
        .unwrap_or_default();
    if !text.trim().is_empty() {
        return Ok(text);
    }
    if value["stop_reason"] == "refusal" {
        return Err(AiError::Blocked(shorten("the model refused", 120)));
    }
    Err(AiError::EmptyReply)
}

/// The HTTP status an Anthropic error type stands for, so it is classified like
/// the same failure anywhere else.
fn status_for_error_type(kind: &str) -> u16 {
    match kind {
        "authentication_error" => 401,
        "permission_error" => 403,
        "not_found_error" => 404,
        "rate_limit_error" => 429,
        "overloaded_error" => 529,
        "invalid_request_error" => 400,
        _ => 500,
    }
}

/// Reads one line of Anthropic's event stream. Only the JSON on `data:` lines
/// matters; the `event:` lines repeat the type that is also inside it.
pub fn parse_stream_line(line: &str, model: &str) -> StreamEvent {
    let Some(payload) = line.strip_prefix("data:") else {
        return StreamEvent::Ignore;
    };
    let Ok(value) = serde_json::from_str::<Value>(payload.trim()) else {
        return StreamEvent::Ignore;
    };
    match value["type"].as_str() {
        Some("content_block_delta") if value["delta"]["type"] == "text_delta" => {
            match value["delta"]["text"].as_str() {
                Some(text) if !text.is_empty() => StreamEvent::Text(text.to_string()),
                _ => StreamEvent::Ignore,
            }
        }
        // A summary of Claude's thinking, sent when the user asked to see it.
        Some("content_block_delta") if value["delta"]["type"] == "thinking_delta" => {
            match value["delta"]["thinking"].as_str() {
                Some(text) if !text.is_empty() => StreamEvent::Reasoning(text.to_string()),
                _ => StreamEvent::Ignore,
            }
        }
        Some("message_stop") => StreamEvent::Done,
        Some("error") => {
            let status = status_for_error_type(value["error"]["type"].as_str().unwrap_or_default());
            StreamEvent::Failed(classify_error(status, &value.to_string(), model))
        }
        _ => StreamEvent::Ignore,
    }
}

impl LlmClient for AnthropicClient {
    async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
        self.send_chat(prompt, true).await
    }

    async fn chat_streaming(
        &self,
        prompt: ChatPrompt<'_>,
        on_progress: &(dyn Fn(&str) + Sync),
    ) -> Result<String, AiError> {
        let body = self.chat_body(&prompt, true, true);
        let idle_timeout = self.idle_timeout(prompt.attachment.is_some());
        let mut attempt = 0;
        loop {
            let request = self.request().json(&body);
            let (result, server_hint, delivered) =
                stream_once_with(request, idle_timeout, &self.model, parse_stream_line, on_progress, &|_| {}).await;
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

    async fn generate(&self, prompt: &str, attachment: Option<&InlineData>) -> Result<String, AiError> {
        self.send_chat(ChatPrompt { system: "", history: &[], message: prompt, attachment, web_search: false }, false).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::llm::Turn;
    use std::sync::Mutex;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    fn prompt<'a>(message: &'a str, history: &'a [Turn]) -> ChatPrompt<'a> {
        ChatPrompt { system: "be kind", history, message, attachment: None, web_search: false }
    }

    fn fast_retry() -> RetryPolicy {
        RetryPolicy { max_attempts: 3, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(20) }
    }

    async fn client_for(server: &MockServer) -> AnthropicClient {
        AnthropicClient::new(format!("{}/v1", server.uri()), "sk-ant-test".into(), "claude-test")
            .unwrap()
            .with_retry_and_timeouts(fast_retry(), Duration::from_secs(5))
    }

    fn reply(text: &str) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({
            "type": "message", "role": "assistant",
            "content": [{ "type": "text", "text": text }], "stop_reason": "end_turn"
        }))
    }

    fn delta(text: &str) -> String {
        format!(
            "event: content_block_delta\ndata: {}\n\n",
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } })
        )
    }

    fn event_stream(body: String) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(body.into_bytes(), "text/event-stream")
    }

    // ---- the request ----

    #[test]
    fn the_system_prompt_is_its_own_field_not_a_message() {
        let body = build_messages_body("m", &prompt("hi", &[]), false);

        assert_eq!(body["system"], "be kind");
        assert_eq!(body["messages"], json!([{ "role": "user", "content": "hi" }]));
    }

    #[test]
    fn a_blank_system_prompt_is_left_out() {
        let chat = ChatPrompt { system: "  ", history: &[], message: "hi", attachment: None, web_search: false };

        assert!(build_messages_body("m", &chat, false).get("system").is_none());
    }

    #[test]
    fn a_reply_length_is_always_given_because_anthropic_requires_one() {
        assert_eq!(build_messages_body("m", &prompt("hi", &[]), false)["max_tokens"], 4096);
    }

    #[test]
    fn earlier_turns_alternate_and_the_model_role_is_called_assistant() {
        let history = [turn(Role::Model, "stale"), turn(Role::User, "hi"), turn(Role::Model, "hello")];

        let body = build_messages_body("m", &prompt("what next?", &history), false);

        assert_eq!(
            body["messages"],
            json!([
                { "role": "user", "content": "hi" },
                { "role": "assistant", "content": "hello" },
                { "role": "user", "content": "what next?" }
            ])
        );
    }

    #[test]
    fn a_history_ending_on_a_user_turn_is_merged_with_the_new_message() {
        let body = build_messages_body("m", &prompt("follow up", &[turn(Role::User, "unanswered")]), false);

        assert_eq!(body["messages"], json!([{ "role": "user", "content": "unanswered\n\nfollow up" }]));
    }

    #[test]
    fn an_image_is_a_base64_source_block_before_the_text() {
        let image = InlineData { mime_type: "image/jpeg".into(), base64: "QUJD".into() };
        let chat =
            ChatPrompt { system: "", history: &[], message: "what is this?", attachment: Some(&image), web_search: false };

        let body = build_messages_body("m", &chat, false);

        assert_eq!(
            body["messages"][0]["content"],
            json!([
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "QUJD" } },
                { "type": "text", "text": "what is this?" }
            ])
        );
    }

    #[test]
    fn a_streamed_request_says_so() {
        assert_eq!(build_messages_body("m", &prompt("hi", &[]), true)["stream"], true);
        assert!(build_messages_body("m", &prompt("hi", &[]), false).get("stream").is_none());
    }

    // ---- reading replies ----

    #[test]
    fn the_text_blocks_of_a_reply_are_joined() {
        let body = json!({ "content": [
            { "type": "text", "text": "Hello " },
            { "type": "tool_use", "id": "x" },
            { "type": "text", "text": "world" }
        ] })
        .to_string();

        assert_eq!(parse_messages_response(200, &body, "m"), Ok("Hello world".to_string()));
    }

    #[test]
    fn a_reply_with_no_text_is_empty_or_a_refusal() {
        let empty = json!({ "content": [], "stop_reason": "end_turn" }).to_string();
        let refusal = json!({ "content": [], "stop_reason": "refusal" }).to_string();

        assert_eq!(parse_messages_response(200, &empty, "m"), Err(AiError::EmptyReply));
        assert!(matches!(parse_messages_response(200, &refusal, "m"), Err(AiError::Blocked(_))));
    }

    #[test]
    fn http_errors_are_classified_like_any_other_service() {
        let body = json!({ "type": "error", "error": { "type": "authentication_error", "message": "invalid x-api-key" } })
            .to_string();

        assert_eq!(parse_messages_response(401, &body, "m"), Err(AiError::InvalidKey));
        assert_eq!(parse_messages_response(429, &body, "m"), Err(AiError::RateLimited));
        assert_eq!(parse_messages_response(404, &body, "claude-x"), Err(AiError::ModelUnavailable("claude-x".into())));
        assert_eq!(parse_messages_response(529, &body, "m"), Err(AiError::Server(529)));
    }

    #[test]
    fn stream_lines_give_text_and_the_end() {
        let text = format!(
            "data: {}",
            json!({ "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Hel" } })
        );

        assert_eq!(parse_stream_line(&text, "m"), StreamEvent::Text("Hel".into()));
        assert_eq!(parse_stream_line(r#"data: {"type":"message_stop"}"#, "m"), StreamEvent::Done);
    }

    #[test]
    fn stream_lines_with_no_text_are_ignored() {
        assert_eq!(parse_stream_line("event: ping", "m"), StreamEvent::Ignore);
        assert_eq!(parse_stream_line(r#"data: {"type":"ping"}"#, "m"), StreamEvent::Ignore);
        assert_eq!(parse_stream_line(r#"data: {"type":"message_start","message":{}}"#, "m"), StreamEvent::Ignore);
        assert_eq!(
            parse_stream_line(r#"data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{"}}"#, "m"),
            StreamEvent::Ignore
        );
    }

    #[test]
    fn an_error_event_in_the_stream_is_a_classified_failure() {
        let line = r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Failed(AiError::Server(529)));
    }

    // ---- the network ----

    #[tokio::test]
    async fn a_request_carries_the_key_the_version_and_a_path_under_the_root() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "sk-ant-test"))
            .and(header("anthropic-version", "2023-06-01"))
            .and(body_partial_json(json!({ "model": "claude-test" })))
            .respond_with(reply("Hello."))
            .expect(1)
            .mount(&server)
            .await;

        let answer = client_for(&server).await.chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("Hello.".to_string()));
    }

    #[tokio::test]
    async fn the_key_is_not_sent_as_a_bearer_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(reply("ok")).mount(&server).await;

        let _ = client_for(&server).await.chat(prompt("hi", &[])).await;

        let received = server.received_requests().await.unwrap();
        assert!(received[0].headers.get("authorization").is_none());
    }

    #[tokio::test]
    async fn an_overloaded_service_is_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(529)).up_to_n_times(1).mount(&server).await;
        Mock::given(method("POST")).respond_with(reply("second try")).mount(&server).await;

        let answer = client_for(&server).await.chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("second try".to_string()));
    }

    #[tokio::test]
    async fn a_rejected_key_is_reported_and_not_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(401)).expect(1).mount(&server).await;

        let answer = client_for(&server).await.chat(prompt("hi", &[])).await;

        assert_eq!(answer, Err(AiError::InvalidKey));
    }

    #[tokio::test]
    async fn a_streamed_reply_reports_progress_and_returns_the_whole_text() {
        let server = MockServer::start().await;
        let body = format!(
            "event: message_start\ndata: {{\"type\":\"message_start\",\"message\":{{}}}}\n\n{}{}event: message_stop\ndata: {{\"type\":\"message_stop\"}}\n\n",
            delta("Steep "),
            delta("it well.")
        );
        Mock::given(method("POST")).and(body_partial_json(json!({ "stream": true }))).respond_with(event_stream(body)).mount(&server).await;
        let seen = Mutex::new(Vec::<String>::new());

        let answer = client_for(&server)
            .await
            .chat_streaming(prompt("how?", &[]), &|so_far| seen.lock().unwrap().push(so_far.to_string()))
            .await;

        assert_eq!(answer, Ok("Steep it well.".to_string()));
        assert_eq!(*seen.lock().unwrap(), vec!["Steep ", "Steep it well."]);
    }

    #[tokio::test]
    async fn an_error_after_text_has_been_shown_is_not_retried() {
        let server = MockServer::start().await;
        let body = format!(
            "{}event: error\ndata: {{\"type\":\"error\",\"error\":{{\"type\":\"overloaded_error\",\"message\":\"x\"}}}}\n\n",
            delta("Half an answ")
        );
        Mock::given(method("POST")).respond_with(event_stream(body)).expect(1).mount(&server).await;

        let answer = client_for(&server).await.chat_streaming(prompt("hi", &[]), &|_| {}).await;

        assert_eq!(answer, Err(AiError::Server(529)));
    }

    #[tokio::test]
    async fn generate_asks_with_no_history_and_no_system_prompt() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(reply("A title")).mount(&server).await;

        let answer = client_for(&server).await.generate("name this", None).await;

        assert_eq!(answer, Ok("A title".to_string()));
        let received = server.received_requests().await.unwrap();
        let sent: Value = serde_json::from_slice(&received[0].body).unwrap();
        assert!(sent.get("system").is_none());
        assert_eq!(sent["messages"], json!([{ "role": "user", "content": "name this" }]));
    }

    #[test]
    fn a_streamed_thinking_summary_is_reasoning() {
        let line = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Weighing options."}}"#;

        assert_eq!(parse_stream_line(line, "m"), StreamEvent::Reasoning("Weighing options.".into()));
    }

    #[tokio::test]
    async fn the_users_settings_for_the_model_are_in_the_request() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({
                "output_config": { "effort": "low" },
                "thinking": { "type": "adaptive", "display": "summarized" },
                "temperature": 0.3
            })))
            .respond_with(reply("ok"))
            .expect(1)
            .mount(&server)
            .await;
        let saved = serde_json::Map::from_iter([
            ("effort".to_string(), json!("low")),
            ("thinking_display".to_string(), json!("summarized")),
            ("temperature".to_string(), json!(0.3)),
        ]);
        let tuning = Tuning::resolve(crate::ai::providers::ProviderId::Anthropic, "claude-test-5-5", &saved);

        let answer = client_for(&server).await.with_tuning(tuning).chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("ok".to_string()));
    }

    #[test]
    fn a_thinking_budget_gets_room_in_the_reply_limit() {
        let mut body = json!({ "max_tokens": 4096, "thinking": { "type": "enabled", "budget_tokens": 8000 } });

        make_room_for_thinking(&mut body);

        assert_eq!(body["max_tokens"], json!(8000 + 4096));
    }

    #[test]
    fn a_budget_below_the_limit_leaves_the_limit_alone() {
        let mut body = json!({ "max_tokens": 4096, "thinking": { "type": "enabled", "budget_tokens": 2000 } });

        make_room_for_thinking(&mut body);

        assert_eq!(body["max_tokens"], json!(4096));
    }

    #[test]
    fn a_blank_key_or_model_is_refused() {
        assert_eq!(
            AnthropicClient::new("https://api.anthropic.com/v1".into(), "  ".into(), "m").err(),
            Some(AiError::KeyMissing)
        );
        assert!(AnthropicClient::new("https://api.anthropic.com/v1".into(), "k".into(), " ").is_err());
    }
}
