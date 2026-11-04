//! The Gemini API's own client, used for Google (Gemini and Gemma models alike).
//!
//! Google's chat-completions compatibility endpoint has no way to switch on Google
//! Search grounding for chat, which is how these models search the web, so Zara
//! talks to `generateContent` directly: system text is a top-level
//! `systemInstruction`, turns are `contents` made of `parts`, images are
//! `inline_data` parts, the key travels in `x-goog-api-key`, and Google Search is
//! the `google_search` tool. The transport (retries, the idle timeout, reading
//! lines) is shared with the other clients in `llm.rs`.

use super::llm::{
    classify_error, normalize_history, send_once, shorten, stream_once_with, AiError, ChatPrompt,
    InlineData, LlmClient, RetryPolicy, Role, StreamEvent,
};
use super::tuning::Tuning;
use serde_json::{json, Value};
use std::time::Duration;

/// How many pages Google may be credited with at the foot of a searched answer.
const MAX_SOURCES: usize = 4;

pub struct GeminiClient {
    http: reqwest::Client,
    /// The API root, such as `https://generativelanguage.googleapis.com/v1beta`.
    base_url: String,
    model: String,
    api_key: String,
    /// The user's settings for this model (thinking, temperature and so on), applied to every chat.
    tuning: Tuning,
    retry: RetryPolicy,
    text_timeout: Duration,
    attachment_timeout: Duration,
}

impl GeminiClient {
    pub fn new(base_url: String, api_key: String, model: &str) -> Result<Self, AiError> {
        if api_key.trim().is_empty() {
            return Err(AiError::KeyMissing);
        }
        let model = model.trim().trim_start_matches("models/");
        if model.is_empty() {
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
            // A search or an image makes the model take longer before it says anything.
            attachment_timeout: Duration::from_secs(90),
        })
    }

    /// The same client, answering with the user's settings for its model.
    pub fn with_tuning(mut self, tuning: Tuning) -> Self {
        self.tuning = tuning;
        self
    }

    /// The `generateContent` body for a chat, with the user's settings applied when `tuned`.
    fn chat_body(&self, prompt: &ChatPrompt<'_>, tuned: bool) -> Value {
        let mut body = build_generate_content_body(prompt);
        if tuned {
            self.tuning.apply(&mut body);
        }
        body
    }

    /// One non-streamed chat. `tuned` applies the user's settings for the model; titles
    /// and connection checks are sent without them.
    async fn send_chat(&self, prompt: ChatPrompt<'_>, tuned: bool) -> Result<String, AiError> {
        let body = self.chat_body(&prompt, tuned);
        let timeout = self.idle_timeout(&prompt);
        let mut attempt = 0;
        loop {
            let request = self.request("generateContent").timeout(timeout).json(&body);
            let (result, server_hint) = send_once(request, &self.model, parse_generate_content_response).await;
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

    fn url(&self, action: &str) -> String {
        format!("{}/models/{}:{action}", self.base_url.trim_end_matches('/'), self.model)
    }

    fn request(&self, action: &str) -> reqwest::RequestBuilder {
        self.http.post(self.url(action)).header("x-goog-api-key", &self.api_key)
    }

    fn idle_timeout(&self, prompt: &ChatPrompt<'_>) -> Duration {
        if prompt.attachment.is_some() || prompt.web_search { self.attachment_timeout } else { self.text_timeout }
    }
}

fn user_parts(text: &str, attachment: Option<&InlineData>) -> Value {
    match attachment {
        None => json!([{ "text": text }]),
        Some(data) => json!([
            { "inline_data": { "mime_type": data.mime_type, "data": data.base64 } },
            { "text": text }
        ]),
    }
}

/// The JSON body for `generateContent`: the system text on its own, then strictly
/// alternating turns starting with the user's, and Google Search when the request
/// is allowed to search.
pub fn build_generate_content_body(prompt: &ChatPrompt<'_>) -> Value {
    let mut contents: Vec<Value> = normalize_history(prompt.history)
        .iter()
        .map(|turn| {
            let role = if turn.role == Role::User { "user" } else { "model" };
            json!({ "role": role, "parts": [{ "text": turn.text }] })
        })
        .collect();

    // A history ending on a user turn would put two user turns in a row.
    let mut message = prompt.message.to_string();
    if matches!(contents.last(), Some(last) if last["role"] == "user") {
        let previous = contents.pop().expect("checked above");
        let previous_text = previous["parts"][0]["text"].as_str().unwrap_or_default();
        message = format!("{previous_text}\n\n{message}");
    }
    contents.push(json!({ "role": "user", "parts": user_parts(&message, prompt.attachment) }));

    let mut body = json!({ "contents": contents });
    if !prompt.system.trim().is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": prompt.system }] });
    }
    if prompt.web_search {
        body["tools"] = json!([{ "google_search": {} }]);
    }
    body
}

/// What one response, or one chunk of a streamed one, carries.
struct Candidate {
    /// The visible text.
    text: String,
    /// The model's thought summary, which Google marks with `thought: true`.
    reasoning: String,
    /// The pages Google Search drew on, as markdown links, once the answer is complete.
    sources: String,
    /// Why the answer ended, when it has.
    finish_reason: Option<String>,
}

fn read_candidate(value: &Value) -> Candidate {
    let candidate = &value["candidates"][0];
    let mut text = String::new();
    let mut reasoning = String::new();
    for part in candidate["content"]["parts"].as_array().into_iter().flatten() {
        let Some(piece) = part["text"].as_str() else { continue };
        if part["thought"] == true {
            reasoning.push_str(piece);
        } else {
            text.push_str(piece);
        }
    }
    let finish_reason = candidate["finishReason"].as_str().map(str::to_owned);
    Candidate { text, reasoning, sources: sources_line(candidate), finish_reason }
}

/// "Sources: [site](link) · [site](link)" from the grounding metadata, or nothing
/// when the answer was not grounded. Google's links go through its own redirect,
/// which is why the page's title (its domain) is what is shown.
fn sources_line(candidate: &Value) -> String {
    let mut seen: Vec<&str> = Vec::new();
    let mut links: Vec<String> = Vec::new();
    for chunk in candidate["groundingMetadata"]["groundingChunks"].as_array().into_iter().flatten() {
        let Some(uri) = chunk["web"]["uri"].as_str() else { continue };
        if seen.contains(&uri) || links.len() == MAX_SOURCES {
            continue;
        }
        seen.push(uri);
        let title = chunk["web"]["title"].as_str().unwrap_or("source").replace(['[', ']'], "");
        links.push(format!("[{title}]({uri})"));
    }
    if links.is_empty() { String::new() } else { format!("\n\nSources: {}", links.join(" \u{b7} ")) }
}

/// Whether the model refused: the prompt was blocked, or the answer was cut for safety.
fn refusal(value: &Value, finish_reason: Option<&str>) -> Option<AiError> {
    if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
        return Some(AiError::Blocked(shorten(&reason.to_lowercase().replace('_', " "), 120)));
    }
    match finish_reason {
        Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" | "RECITATION") => {
            Some(AiError::Blocked("content filter".into()))
        }
        _ => None,
    }
}

/// The text of a finished (non-streamed) reply, or the reason there is none.
pub fn parse_generate_content_response(status: u16, body: &str, model: &str) -> Result<String, AiError> {
    if !(200..300).contains(&status) {
        return Err(classify_error(status, body, model));
    }
    let value: Value = serde_json::from_str(body).map_err(|_| AiError::EmptyReply)?;
    if value["error"].is_object() {
        let embedded = value["error"]["code"].as_u64().and_then(|code| u16::try_from(code).ok());
        return Err(classify_error(embedded.unwrap_or(502), body, model));
    }
    let candidate = read_candidate(&value);
    if !candidate.text.trim().is_empty() {
        return Ok(format!("{}{}", candidate.text, candidate.sources));
    }
    Err(refusal(&value, candidate.finish_reason.as_deref()).unwrap_or(AiError::EmptyReply))
}

/// Reads one line of Gemini's event stream. Every `data:` line is a whole response
/// holding the next piece of the answer; the stream has no end marker, it just ends.
pub fn parse_stream_line(line: &str, model: &str) -> StreamEvent {
    let Some(payload) = line.strip_prefix("data:") else {
        return StreamEvent::Ignore;
    };
    let Ok(value) = serde_json::from_str::<Value>(payload.trim()) else {
        return StreamEvent::Ignore;
    };
    if value["error"].is_object() {
        let status = value["error"]["code"].as_u64().and_then(|code| u16::try_from(code).ok());
        return StreamEvent::Failed(classify_error(status.unwrap_or(502), payload, model));
    }
    let candidate = read_candidate(&value);
    // The sources arrive with the last piece, so they are added once, after the words.
    let finished = candidate.finish_reason.is_some();
    let text = if finished { format!("{}{}", candidate.text, candidate.sources) } else { candidate.text };
    if !text.is_empty() {
        return StreamEvent::Text(text);
    }
    if !candidate.reasoning.is_empty() {
        return StreamEvent::Reasoning(candidate.reasoning);
    }
    match refusal(&value, candidate.finish_reason.as_deref()) {
        Some(error) => StreamEvent::Failed(error),
        None => StreamEvent::Ignore,
    }
}

impl LlmClient for GeminiClient {
    async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
        self.send_chat(prompt, true).await
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
        let body = self.chat_body(&prompt, true);
        let idle_timeout = self.idle_timeout(&prompt);
        let mut attempt = 0;
        loop {
            let request = self.request("streamGenerateContent?alt=sse").json(&body);
            let (result, server_hint, delivered) = stream_once_with(
                request,
                idle_timeout,
                &self.model,
                parse_stream_line,
                on_progress,
                on_reasoning,
            )
            .await;
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
    use wiremock::matchers::{body_partial_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn turn(role: Role, text: &str) -> Turn {
        Turn { role, text: text.into() }
    }

    fn prompt<'a>(message: &'a str, history: &'a [Turn]) -> ChatPrompt<'a> {
        ChatPrompt { system: "be kind", history, message, attachment: None, web_search: false }
    }

    fn searching_prompt() -> ChatPrompt<'static> {
        ChatPrompt { system: "", history: &[], message: "who won?", attachment: None, web_search: true }
    }

    fn fast_retry() -> RetryPolicy {
        RetryPolicy { max_attempts: 3, base_delay: Duration::from_millis(1), max_delay: Duration::from_millis(20) }
    }

    async fn client_for(server: &MockServer) -> GeminiClient {
        GeminiClient::new(format!("{}/v1beta", server.uri()), "AIza-test".into(), "gemma-4-31b-it")
            .unwrap()
            .with_retry_and_timeouts(fast_retry(), Duration::from_secs(5))
    }

    fn reply(text: &str) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({
            "candidates": [{ "content": { "role": "model", "parts": [{ "text": text }] }, "finishReason": "STOP" }]
        }))
    }

    fn chunk(text: &str) -> String {
        format!("data: {}\r\n\r\n", json!({ "candidates": [{ "content": { "parts": [{ "text": text }] } }] }))
    }

    fn event_stream(body: String) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_raw(body.into_bytes(), "text/event-stream")
    }

    fn grounded(text: &str) -> Value {
        json!({ "candidates": [{
            "content": { "parts": [{ "text": text }] },
            "finishReason": "STOP",
            "groundingMetadata": {
                "webSearchQueries": ["euro 2024 winner"],
                "groundingChunks": [
                    { "web": { "uri": "https://vertexaisearch.example/a", "title": "bbc.com" } },
                    { "web": { "uri": "https://vertexaisearch.example/b", "title": "uefa.com" } },
                    { "web": { "uri": "https://vertexaisearch.example/a", "title": "bbc.com" } }
                ]
            }
        }] })
    }

    // ---- the request ----

    #[test]
    fn the_system_text_stands_alone_and_turns_use_the_model_role() {
        let history = [turn(Role::User, "hi"), turn(Role::Model, "hello")];

        let body = build_generate_content_body(&prompt("how are you?", &history));

        assert_eq!(body["systemInstruction"], json!({ "parts": [{ "text": "be kind" }] }));
        assert_eq!(
            body["contents"],
            json!([
                { "role": "user", "parts": [{ "text": "hi" }] },
                { "role": "model", "parts": [{ "text": "hello" }] },
                { "role": "user", "parts": [{ "text": "how are you?" }] }
            ])
        );
    }

    #[test]
    fn a_blank_system_prompt_is_left_out() {
        let chat = ChatPrompt { system: "  ", history: &[], message: "hi", attachment: None, web_search: false };

        assert!(build_generate_content_body(&chat).get("systemInstruction").is_none());
    }

    #[test]
    fn a_history_that_ends_on_the_user_is_merged_into_one_turn() {
        let history = [turn(Role::User, "first")];

        let body = build_generate_content_body(&prompt("second", &history));

        assert_eq!(body["contents"], json!([{ "role": "user", "parts": [{ "text": "first\n\nsecond" }] }]));
    }

    #[test]
    fn an_image_goes_ahead_of_the_text_as_inline_data() {
        let image = InlineData { mime_type: "image/png".into(), base64: "AAAA".into() };
        let chat =
            ChatPrompt { system: "", history: &[], message: "what is this?", attachment: Some(&image), web_search: false };

        let body = build_generate_content_body(&chat);

        assert_eq!(
            body["contents"][0]["parts"],
            json!([
                { "inline_data": { "mime_type": "image/png", "data": "AAAA" } },
                { "text": "what is this?" }
            ])
        );
    }

    #[test]
    fn google_search_is_switched_on_only_when_the_request_may_search() {
        assert_eq!(build_generate_content_body(&searching_prompt())["tools"], json!([{ "google_search": {} }]));
        assert!(build_generate_content_body(&prompt("hi", &[])).get("tools").is_none());
    }

    // ---- the reply ----

    #[test]
    fn the_answer_text_is_the_reply() {
        let body = json!({ "candidates": [{ "content": { "parts": [{ "text": "Hel" }, { "text": "lo" }] } }] });

        assert_eq!(parse_generate_content_response(200, &body.to_string(), "m"), Ok("Hello".into()));
    }

    #[test]
    fn a_thought_summary_is_not_part_of_the_answer() {
        let body = json!({ "candidates": [{ "content": { "parts": [
            { "text": "I should check the date.", "thought": true },
            { "text": "It is Tuesday." }
        ] } }] });

        assert_eq!(parse_generate_content_response(200, &body.to_string(), "m"), Ok("It is Tuesday.".into()));
    }

    #[test]
    fn a_grounded_answer_credits_each_page_once() {
        let answer = parse_generate_content_response(200, &grounded("Spain won.").to_string(), "m").unwrap();

        assert_eq!(
            answer,
            "Spain won.\n\nSources: [bbc.com](https://vertexaisearch.example/a) \u{b7} [uefa.com](https://vertexaisearch.example/b)"
        );
    }

    #[test]
    fn at_most_four_sources_are_credited() {
        let chunks: Vec<Value> = (0..6)
            .map(|n| json!({ "web": { "uri": format!("https://x.example/{n}"), "title": format!("site{n}") } }))
            .collect();
        let body = json!({ "candidates": [{
            "content": { "parts": [{ "text": "Answer." }] },
            "groundingMetadata": { "groundingChunks": chunks }
        }] });

        let answer = parse_generate_content_response(200, &body.to_string(), "m").unwrap();

        assert_eq!(answer.matches("](https://x.example/").count(), 4);
    }

    #[test]
    fn a_blocked_prompt_is_reported_as_blocked() {
        let body = json!({ "promptFeedback": { "blockReason": "PROHIBITED_CONTENT" } });

        assert!(matches!(
            parse_generate_content_response(200, &body.to_string(), "m"),
            Err(AiError::Blocked(_))
        ));
    }

    #[test]
    fn an_answer_cut_for_safety_is_reported_as_blocked() {
        let body = json!({ "candidates": [{ "finishReason": "SAFETY" }] });

        assert!(matches!(
            parse_generate_content_response(200, &body.to_string(), "m"),
            Err(AiError::Blocked(_))
        ));
    }

    #[test]
    fn a_reply_with_no_text_is_empty() {
        let body = json!({ "candidates": [{ "content": { "parts": [] }, "finishReason": "STOP" }] });

        assert_eq!(parse_generate_content_response(200, &body.to_string(), "m"), Err(AiError::EmptyReply));
    }

    #[test]
    fn a_wrong_key_is_an_invalid_key_even_though_google_calls_it_a_bad_request() {
        let body = r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#;

        assert_eq!(parse_generate_content_response(400, body, "m"), Err(AiError::InvalidKey));
    }

    #[test]
    fn a_quota_error_is_a_rate_limit() {
        let body = r#"{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}"#;

        assert_eq!(parse_generate_content_response(429, body, "m"), Err(AiError::RateLimited));
    }

    // ---- the stream ----

    #[test]
    fn a_streamed_line_with_text_is_text() {
        let line = format!("data: {}", json!({ "candidates": [{ "content": { "parts": [{ "text": "Hel" }] } }] }));

        assert_eq!(parse_stream_line(&line, "m"), StreamEvent::Text("Hel".into()));
    }

    #[test]
    fn a_streamed_thought_is_reasoning() {
        let line = format!(
            "data: {}",
            json!({ "candidates": [{ "content": { "parts": [{ "text": "Checking.", "thought": true }] } }] })
        );

        assert_eq!(parse_stream_line(&line, "m"), StreamEvent::Reasoning("Checking.".into()));
    }

    #[test]
    fn the_sources_ride_on_the_last_streamed_piece_only() {
        let middle = format!("data: {}", json!({ "candidates": [{ "content": { "parts": [{ "text": "Spain " }] } }] }));
        let last = format!("data: {}", grounded("won."));

        assert_eq!(parse_stream_line(&middle, "m"), StreamEvent::Text("Spain ".into()));
        match parse_stream_line(&last, "m") {
            StreamEvent::Text(text) => assert!(text.starts_with("won.\n\nSources: [bbc.com]"), "{text}"),
            other => panic!("expected text, got {other:?}"),
        }
    }

    #[test]
    fn other_lines_are_ignored() {
        assert_eq!(parse_stream_line("", "m"), StreamEvent::Ignore);
        assert_eq!(parse_stream_line(": keep-alive", "m"), StreamEvent::Ignore);
        assert_eq!(parse_stream_line("data: not json", "m"), StreamEvent::Ignore);
    }

    // ---- over the network ----

    #[tokio::test]
    async fn a_request_goes_to_the_models_path_with_the_key_in_the_google_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1beta/models/gemma-4-31b-it:generateContent"))
            .and(header("x-goog-api-key", "AIza-test"))
            .respond_with(reply("Hello."))
            .expect(1)
            .mount(&server)
            .await;

        let answer = client_for(&server).await.chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("Hello.".to_string()));
        let received = server.received_requests().await.unwrap();
        assert!(received[0].headers.get("authorization").is_none());
    }

    #[tokio::test]
    async fn a_searching_request_carries_the_google_search_tool() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "tools": [{ "google_search": {} }] })))
            .respond_with(ResponseTemplate::new(200).set_body_json(grounded("Spain won.")))
            .expect(1)
            .mount(&server)
            .await;

        let answer = client_for(&server).await.chat(searching_prompt()).await.unwrap();

        assert!(answer.starts_with("Spain won."));
        assert!(answer.contains("Sources: [bbc.com]"));
    }

    #[tokio::test]
    async fn a_model_name_given_with_the_models_prefix_is_not_doubled() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1beta/models/gemini-3.8-flash:generateContent"))
            .respond_with(reply("ok"))
            .expect(1)
            .mount(&server)
            .await;
        let client = GeminiClient::new(format!("{}/v1beta", server.uri()), "k".into(), "models/gemini-3.8-flash").unwrap();

        assert_eq!(client.chat(prompt("hi", &[])).await, Ok("ok".to_string()));
    }

    #[tokio::test]
    async fn an_overloaded_service_is_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(503)).up_to_n_times(1).mount(&server).await;
        Mock::given(method("POST")).respond_with(reply("second try")).mount(&server).await;

        let answer = client_for(&server).await.chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("second try".to_string()));
    }

    #[tokio::test]
    async fn a_streamed_reply_reports_progress_and_returns_the_whole_text() {
        let server = MockServer::start().await;
        let body = format!("{}{}", chunk("Steep "), chunk("it well."));
        Mock::given(method("POST"))
            .and(path("/v1beta/models/gemma-4-31b-it:streamGenerateContent"))
            .and(query_param("alt", "sse"))
            .respond_with(event_stream(body))
            .expect(1)
            .mount(&server)
            .await;
        let seen = Mutex::new(Vec::<String>::new());

        let answer = client_for(&server)
            .await
            .chat_streaming(prompt("how?", &[]), &|so_far| seen.lock().unwrap().push(so_far.to_string()))
            .await;

        assert_eq!(answer, Ok("Steep it well.".to_string()));
        assert_eq!(*seen.lock().unwrap(), vec!["Steep ", "Steep it well."]);
    }

    #[tokio::test]
    async fn streamed_thoughts_are_reported_apart_from_the_answer() {
        let server = MockServer::start().await;
        let thought = format!(
            "data: {}\r\n\r\n",
            json!({ "candidates": [{ "content": { "parts": [{ "text": "Look up the score.", "thought": true }] } }] })
        );
        Mock::given(method("POST")).respond_with(event_stream(format!("{thought}{}", chunk("Spain won.")))).mount(&server).await;
        let thoughts = Mutex::new(Vec::<String>::new());

        let answer = client_for(&server)
            .await
            .chat_streaming_with_reasoning(prompt("who won?", &[]), &|_| {}, &|so_far| {
                thoughts.lock().unwrap().push(so_far.to_string());
            })
            .await;

        assert_eq!(answer, Ok("Spain won.".to_string()));
        assert_eq!(*thoughts.lock().unwrap(), vec!["Look up the score."]);
    }

    #[tokio::test]
    async fn a_streamed_search_ends_with_its_sources() {
        let server = MockServer::start().await;
        let last = format!("data: {}\r\n\r\n", grounded("Spain won."));
        Mock::given(method("POST")).respond_with(event_stream(last)).mount(&server).await;

        let answer = client_for(&server).await.chat_streaming(searching_prompt(), &|_| {}).await.unwrap();

        assert!(answer.starts_with("Spain won.\n\nSources: [bbc.com]("), "{answer}");
    }

    #[tokio::test]
    async fn generate_asks_with_no_history_and_no_system_prompt() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(reply("A title")).mount(&server).await;

        let answer = client_for(&server).await.generate("name this", None).await;

        assert_eq!(answer, Ok("A title".to_string()));
        let received = server.received_requests().await.unwrap();
        let sent: Value = serde_json::from_slice(&received[0].body).unwrap();
        assert!(sent.get("systemInstruction").is_none());
        assert_eq!(sent["contents"], json!([{ "role": "user", "parts": [{ "text": "name this" }] }]));
    }

    #[tokio::test]
    async fn the_users_settings_for_the_model_are_in_the_request() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({
                "generationConfig": {
                    "thinkingConfig": { "thinkingLevel": "high", "includeThoughts": true },
                    "temperature": 0.2
                }
            })))
            .respond_with(reply("ok"))
            .expect(1)
            .mount(&server)
            .await;
        let saved = serde_json::Map::from_iter([
            ("thinking_level".to_string(), json!("high")),
            ("include_thoughts".to_string(), json!(true)),
            ("temperature".to_string(), json!(0.2)),
        ]);
        let tuning = Tuning::resolve(crate::ai::providers::ProviderId::Google, "gemini-3.8-flash", &saved);

        let answer = client_for(&server).await.with_tuning(tuning).chat(prompt("hi", &[])).await;

        assert_eq!(answer, Ok("ok".to_string()));
    }

    #[tokio::test]
    async fn generate_is_not_changed_by_the_users_settings() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(reply("A title")).mount(&server).await;
        let saved = serde_json::Map::from_iter([("max_tokens".to_string(), json!(16))]);
        let tuning = Tuning::resolve(crate::ai::providers::ProviderId::Google, "gemini-3.8-flash", &saved);

        let _ = client_for(&server).await.with_tuning(tuning).generate("name this", None).await;

        let received = server.received_requests().await.unwrap();
        let sent: Value = serde_json::from_slice(&received[0].body).unwrap();
        assert!(sent.get("generationConfig").is_none());
    }

    #[test]
    fn a_blank_key_or_model_is_refused() {
        let root = "https://generativelanguage.googleapis.com/v1beta";
        assert_eq!(GeminiClient::new(root.into(), "  ".into(), "m").err(), Some(AiError::KeyMissing));
        assert!(GeminiClient::new(root.into(), "k".into(), " ").is_err());
    }
}
