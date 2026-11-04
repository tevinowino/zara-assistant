//! One chat turn with the assistant.
//!
//! A normal question costs exactly one model call. Extra context is on demand:
//! if the model's first reply is only the screen or notes token (see
//! `protocol`), a second call runs with that context attached. A turn can ask
//! for the screen or the notes, not both; the user can ask twice.
//!
//! The model's reply is untrusted input. Text on a web page the user is looking
//! at can try to make the model save memories or edit notes, so every side
//! effect is capped per reply, length-limited by the stores, and reported back
//! to the user (the UI shows what changed, with an undo).

use super::llm::{AiError, ChatPrompt, InlineData, LlmClient, Turn};
use super::memories::MemoryStore;
use super::notes::{build_context_block, NotesStore};
use super::protocol::{
    build_assistant_prompt, extract_memory_requests, extract_note_actions, parse_notes_request,
    parse_screen_request, parse_web_search_request, resolve_screen_aware_answer, visible_so_far,
    MEMORY_CAPABILITY_INSTRUCTION, NOTES_ATTACHED_INSTRUCTION, NOTES_CAPABILITY_INSTRUCTION,
    SCREEN_ATTACHED_INSTRUCTION, SCREEN_CAPABILITY_INSTRUCTION, SYSTEM_PERSONA,
    WEB_SEARCH_ATTACHED_INSTRUCTION, WEB_SEARCH_CAPABILITY_INSTRUCTION,
};
use serde::Serialize;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Most memories, and most of each kind of note change, one reply may make.
const MAX_SIDE_EFFECTS_PER_KIND: usize = 5;

const NOTES_UNCLEAR_ANSWER: &str =
    "I looked at your notes but couldn't put together a clear answer \u{2014} could you try asking again?";
const WEB_SEARCH_UNCLEAR_ANSWER: &str =
    "I searched the web but couldn't put together a clear answer \u{2014} could you try asking again?";
const SCREEN_UNAVAILABLE_NOTE: &str = "The screen is unavailable right now \u{2014} answer as best you can without it, and briefly let the user know you couldn't see their screen.";

/// Takes a picture of what the user is looking at.
pub trait ScreenCapturer: Send + Sync {
    fn capture(&self) -> impl Future<Output = Result<InlineData, AiError>> + Send;
}

/// Progress the UI can show while a turn runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatStatus {
    LookingAtScreen,
    ReadingNotes,
    SearchingWeb,
}

impl ChatStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatStatus::LookingAtScreen => "looking-at-screen",
            ChatStatus::ReadingNotes => "reading-notes",
            ChatStatus::SearchingWeb => "searching-web",
        }
    }
}

/// The least time between two reports of the model's reasoning. A reasoning model
/// streams thousands of small pieces, and each report carries all of the reasoning
/// so far, so reporting every piece would bury the panel in messages that grow ever
/// longer, and it would stop answering while it dealt with them.
const REASONING_REPORT_INTERVAL: Duration = Duration::from_millis(100);

/// The reasoning waiting to be reported, and when something was last reported.
#[derive(Default)]
struct ReasoningReport {
    latest: String,
    /// `latest` has been reported.
    sent: bool,
    last_sent: Option<Instant>,
}

/// What a turn tells the panel while it runs, besides its status: the visible
/// answer as it grows, and the model's own reasoning as it grows.
///
/// A turn can call the model more than once (it asks for the screen, then answers
/// with it), and each call reports only its own reasoning. This joins them, in
/// order, with a blank line between, so the panel hears one growing text. The
/// reasoning is reported at most every `REASONING_REPORT_INTERVAL`, with the last
/// of it always reported when a call ends.
struct TurnListeners<'a> {
    on_text: &'a (dyn Fn(&str) + Sync),
    on_reasoning: &'a (dyn Fn(&str) + Sync),
    /// The reasoning of the calls that have finished.
    settled_reasoning: Mutex<String>,
    reasoning_report: Mutex<ReasoningReport>,
}

impl<'a> TurnListeners<'a> {
    fn new(on_text: &'a (dyn Fn(&str) + Sync), on_reasoning: &'a (dyn Fn(&str) + Sync)) -> Self {
        Self {
            on_text,
            on_reasoning,
            settled_reasoning: Mutex::new(String::new()),
            reasoning_report: Mutex::new(ReasoningReport::default()),
        }
    }

    /// The reasoning of the call in progress is now `reasoning`; it is reported now,
    /// or with the next report if one went out a moment ago.
    fn report_reasoning(&self, reasoning: &str) {
        let mut report = self.reasoning_report.lock().expect("the reasoning lock is never poisoned");
        report.latest = self.joined_with(reasoning);
        report.sent = false;
        if report.last_sent.is_none_or(|at| at.elapsed() >= REASONING_REPORT_INTERVAL) {
            self.send_reasoning(&mut report);
        }
    }

    /// Reports whatever has not been reported yet.
    fn flush_reasoning(&self) {
        let mut report = self.reasoning_report.lock().expect("the reasoning lock is never poisoned");
        if !report.sent && !report.latest.is_empty() {
            self.send_reasoning(&mut report);
        }
    }

    fn send_reasoning(&self, report: &mut ReasoningReport) {
        (self.on_reasoning)(&report.latest);
        report.sent = true;
        report.last_sent = Some(Instant::now());
    }

    /// The text of the calls so far, joined, with `current` last.
    fn joined_with(&self, current: &str) -> String {
        let settled = self.settled_reasoning.lock().expect("the reasoning lock is never poisoned");
        if settled.is_empty() {
            current.to_string()
        } else {
            format!("{settled}\n\n{current}")
        }
    }

    /// The call that was running has finished with this reasoning.
    fn settle(&self, call_reasoning: &str) {
        if call_reasoning.trim().is_empty() {
            return;
        }
        let joined = self.joined_with(call_reasoning);
        *self.settled_reasoning.lock().expect("the reasoning lock is never poisoned") = joined;
    }
}

/// The result of a turn, as the frontend receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
    pub text: String,
    pub used_screen: bool,
    pub used_notes: bool,
    /// Facts newly saved to memory by this reply (duplicates are not listed).
    pub saved_memories: Vec<String>,
    /// Human-readable lines such as `Added: "buy milk"`.
    pub note_changes: Vec<String>,
}

pub struct ChatSession<'a, L: LlmClient, C: ScreenCapturer> {
    pub llm: &'a L,
    pub capture: &'a C,
    pub notes: &'a NotesStore,
    pub memories: &'a MemoryStore,
    /// The user allows web search: the model is told it can ask for one, and a
    /// request for one is carried out.
    pub web_search: bool,
}

impl<L: LlmClient, C: ScreenCapturer> ChatSession<'_, L, C> {
    /// The persona plus the user's saved memories and the capability
    /// instructions for this particular pass.
    fn persona(&self, memory_context: &str, extra: &[&str]) -> String {
        let mut sections = vec![SYSTEM_PERSONA, memory_context, MEMORY_CAPABILITY_INSTRUCTION];
        sections.extend_from_slice(extra);
        sections.retain(|section| !section.is_empty());
        sections.join("\n\n")
    }

    /// One model call. `listeners.on_text` hears the visible text of the reply as
    /// it grows: tags and request tokens are never in it (see `visible_so_far`),
    /// and it is only called when there is more to show than last time.
    /// `listeners.on_reasoning` hears the reasoning of the whole turn so far.
    async fn ask(
        &self,
        persona: &str,
        message: &str,
        history: &[Turn],
        attachment: Option<&InlineData>,
        web_search: bool,
        listeners: &TurnListeners<'_>,
    ) -> Result<String, AiError> {
        let system = build_assistant_prompt(persona);
        let shown = Mutex::new(String::new());
        let on_progress = |raw: &str| {
            let visible = visible_so_far(raw);
            let mut last = shown.lock().expect("the progress lock is never poisoned");
            if !visible.is_empty() && *last != visible {
                last.clone_from(&visible);
                (listeners.on_text)(&visible);
            }
        };
        let this_call_reasoning = Mutex::new(String::new());
        let on_reasoning = |reasoning: &str| {
            *this_call_reasoning.lock().expect("the reasoning lock is never poisoned") = reasoning.to_string();
            listeners.report_reasoning(reasoning);
        };
        let reply = self
            .llm
            .chat_streaming_with_reasoning(
                ChatPrompt { system: &system, history, message, attachment, web_search },
                &on_progress,
                &on_reasoning,
            )
            .await;
        listeners.settle(&this_call_reasoning.lock().expect("the reasoning lock is never poisoned"));
        listeners.flush_reasoning();
        reply
    }

    /// Runs one turn without reporting partial text. The notch always streams, so
    /// only the tests use this.
    #[cfg(test)]
    pub async fn run(
        &self,
        message: &str,
        history: &[Turn],
        on_status: &(dyn Fn(ChatStatus) + Sync),
    ) -> Result<ChatOutcome, AiError> {
        self.run_streaming(message, history, on_status, &|_| {}).await
    }

    /// Runs one turn. `on_status` is called when the turn needs extra context, and
    /// `on_text` with the answer's visible text each time it grows.
    #[cfg(test)]
    pub async fn run_streaming(
        &self,
        message: &str,
        history: &[Turn],
        on_status: &(dyn Fn(ChatStatus) + Sync),
        on_text: &(dyn Fn(&str) + Sync),
    ) -> Result<ChatOutcome, AiError> {
        self.run_with_reasoning(message, history, on_status, on_text, &|_| {}).await
    }

    /// Runs one turn like `run_streaming`, and tells `on_reasoning` the model's own
    /// reasoning, from every call the turn makes, each time it grows.
    pub async fn run_with_reasoning(
        &self,
        message: &str,
        history: &[Turn],
        on_status: &(dyn Fn(ChatStatus) + Sync),
        on_text: &(dyn Fn(&str) + Sync),
        on_reasoning: &(dyn Fn(&str) + Sync),
    ) -> Result<ChatOutcome, AiError> {
        let listeners = &TurnListeners::new(on_text, on_reasoning);
        let memory_context = self.memories.build_context_block();
        // One snapshot per turn: the numbering shown to the model and the
        // numbering used to resolve its edits are the same list, so "note 2"
        // cannot drift to a different note mid-turn.
        let notes_snapshot = self.notes.list();

        let mut capabilities = vec![SCREEN_CAPABILITY_INSTRUCTION, NOTES_CAPABILITY_INSTRUCTION];
        if self.web_search {
            capabilities.push(WEB_SEARCH_CAPABILITY_INSTRUCTION);
        }
        let first_persona = self.persona(&memory_context, &capabilities);
        let first_reply = self.ask(&first_persona, message, history, None, false, listeners).await?;
        let after_screen_check = parse_screen_request(&first_reply);
        let after_notes_check = parse_notes_request(&after_screen_check.text);
        // Each token is only ever the whole reply, so at most one of the three is requested.
        let after_search_check = parse_web_search_request(&after_notes_check.text);
        let search_requested = self.web_search && after_search_check.requested;

        if !after_screen_check.requested && !after_notes_check.requested && !search_requested {
            return Ok(self.finish(&after_notes_check.text, false, false, &notes_snapshot));
        }

        if search_requested {
            on_status(ChatStatus::SearchingWeb);
            let persona = self.persona(&memory_context, &[WEB_SEARCH_ATTACHED_INSTRUCTION]);
            let second_reply = self.ask(&persona, message, history, None, true, listeners).await?;
            // Never let a re-emitted token, or an empty reply, reach the user as the answer.
            let second = parse_web_search_request(&second_reply);
            if second.requested || second.text.trim().is_empty() {
                return Ok(self.finish(WEB_SEARCH_UNCLEAR_ANSWER, false, false, &notes_snapshot));
            }
            return Ok(self.finish(&second.text, false, false, &notes_snapshot));
        }

        if after_notes_check.requested {
            on_status(ChatStatus::ReadingNotes);
            let notes_context = build_context_block(&notes_snapshot);
            let persona =
                self.persona(&memory_context, &[NOTES_ATTACHED_INSTRUCTION, notes_context.as_str()]);
            let second_reply = self.ask(&persona, message, history, None, false, listeners).await?;
            // Never let a re-emitted token, or an empty reply, reach the user
            // as if it were the answer.
            let second = parse_notes_request(&second_reply);
            if second.requested || second.text.trim().is_empty() {
                return Ok(self.finish(NOTES_UNCLEAR_ANSWER, false, true, &notes_snapshot));
            }
            return Ok(self.finish(&second.text, false, true, &notes_snapshot));
        }

        on_status(ChatStatus::LookingAtScreen);
        match self.capture.capture().await {
            Ok(image) => {
                // A different persona from the first pass: one that says the
                // screen is already attached, not the "ask for it" instruction
                // that started this pass.
                let persona = self.persona(&memory_context, &[SCREEN_ATTACHED_INSTRUCTION]);
                let second_reply = self.ask(&persona, message, history, Some(&image), false, listeners).await?;
                let answer = resolve_screen_aware_answer(&second_reply);
                Ok(self.finish(&answer, true, false, &notes_snapshot))
            }
            Err(_) => {
                // The conversation still gets a text-only answer instead of
                // dead-ending in an error.
                let persona = self.persona(
                    &memory_context,
                    &[SCREEN_CAPABILITY_INSTRUCTION, SCREEN_UNAVAILABLE_NOTE],
                );
                let fallback = self.ask(&persona, message, history, None, false, listeners).await?;
                Ok(self.finish(&fallback, false, false, &notes_snapshot))
            }
        }
    }

    /// Applies the reply's tagged side effects and returns what the user sees.
    /// Every exit path goes through here, so a tag never reaches the user.
    fn finish(
        &self,
        raw_reply: &str,
        used_screen: bool,
        used_notes: bool,
        notes_snapshot: &[super::notes::Note],
    ) -> ChatOutcome {
        let memory = extract_memory_requests(raw_reply);
        let actions = extract_note_actions(&memory.text);

        let saved_memories: Vec<String> = memory
            .memories
            .iter()
            .take(MAX_SIDE_EFFECTS_PER_KIND)
            .filter_map(|fact| self.memories.add(fact))
            .map(|entry| entry.text)
            .collect();

        let mut note_changes = Vec::new();
        for text in actions.added.iter().take(MAX_SIDE_EFFECTS_PER_KIND) {
            if let Some(note) = self.notes.add(text, None, None) {
                note_changes.push(format!("Added: \"{}\"", note.title));
            }
        }
        let note_at = |position: u64| {
            usize::try_from(position).ok().and_then(|p| p.checked_sub(1)).and_then(|i| notes_snapshot.get(i))
        };
        for edit in actions.edited.iter().take(MAX_SIDE_EFFECTS_PER_KIND) {
            if let Some(note) = note_at(edit.position) {
                if self.notes.update(&note.id, &edit.text, None, None) {
                    note_changes.push(format!("Updated note {}", edit.position));
                }
            }
        }
        for position in actions.deleted.iter().take(MAX_SIDE_EFFECTS_PER_KIND) {
            if let Some(note) = note_at(*position) {
                if self.notes.delete(&note.id) {
                    note_changes.push(format!("Deleted note {position}"));
                }
            }
        }

        ChatOutcome { text: actions.text, used_screen, used_notes, saved_memories, note_changes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::llm::Role;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    struct SeenPrompt {
        system: String,
        message: String,
        had_attachment: bool,
    }

    /// Replies with a prepared script and records what it was asked.
    struct ScriptedLlm {
        replies: Mutex<VecDeque<Result<String, AiError>>>,
        seen: Mutex<Vec<SeenPrompt>>,
    }

    impl ScriptedLlm {
        fn replying(replies: Vec<Result<String, AiError>>) -> Self {
            Self { replies: Mutex::new(replies.into()), seen: Mutex::new(Vec::new()) }
        }
        fn texts(replies: &[&str]) -> Self {
            Self::replying(replies.iter().map(|r| Ok(r.to_string())).collect())
        }
        fn call_count(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }

    impl LlmClient for ScriptedLlm {
        async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            self.seen.lock().unwrap().push(SeenPrompt {
                system: prompt.system.to_string(),
                message: prompt.message.to_string(),
                had_attachment: prompt.attachment.is_some(),
            });
            self.replies.lock().unwrap().pop_front().expect("the script ran out of replies")
        }
        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            unreachable!("chat tests do not generate")
        }
    }

    struct FakeScreen {
        result: Result<InlineData, AiError>,
        captures: AtomicUsize,
    }

    impl FakeScreen {
        fn showing(base64: &str) -> Self {
            Self {
                result: Ok(InlineData { mime_type: "image/jpeg".into(), base64: base64.into() }),
                captures: AtomicUsize::new(0),
            }
        }
        fn broken() -> Self {
            Self { result: Err(AiError::Capture("no display".into())), captures: AtomicUsize::new(0) }
        }
        fn capture_count(&self) -> usize {
            self.captures.load(Ordering::SeqCst)
        }
    }

    impl ScreenCapturer for FakeScreen {
        async fn capture(&self) -> Result<InlineData, AiError> {
            self.captures.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    struct Fixture {
        _directory: tempfile::TempDir,
        notes: NotesStore,
        memories: MemoryStore,
    }

    fn fixture() -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let notes = NotesStore::open(directory.path());
        let memories = MemoryStore::open(directory.path());
        Fixture { _directory: directory, notes, memories }
    }

    async fn run_turn(
        fixture: &Fixture,
        llm: &ScriptedLlm,
        screen: &FakeScreen,
        message: &str,
    ) -> (Result<ChatOutcome, AiError>, Vec<ChatStatus>) {
        let statuses = Mutex::new(Vec::new());
        let session = ChatSession { llm, capture: screen, notes: &fixture.notes, memories: &fixture.memories, web_search: false };
        let result = session.run(message, &[], &|status| statuses.lock().unwrap().push(status)).await;
        (result, statuses.into_inner().unwrap())
    }

    #[tokio::test]
    async fn an_ordinary_question_costs_one_call_and_touches_nothing() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["Steep it for three minutes."]);
        let screen = FakeScreen::showing("IMG");

        let (result, statuses) = run_turn(&fixture, &llm, &screen, "how do I brew tea?").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.text, "Steep it for three minutes.");
        assert!(!outcome.used_screen && !outcome.used_notes);
        assert_eq!(llm.call_count(), 1);
        assert_eq!(screen.capture_count(), 0);
        assert!(statuses.is_empty());
    }

    #[tokio::test]
    async fn the_first_pass_offers_the_screen_notes_and_memory_instructions() {
        let fixture = fixture();
        fixture.memories.add("prefers concise answers").unwrap();
        let llm = ScriptedLlm::texts(&["ok"]);

        run_turn(&fixture, &llm, &FakeScreen::showing("IMG"), "hi").await.0.unwrap();

        let system = llm.seen.lock().unwrap()[0].system.clone();
        assert!(system.contains(SYSTEM_PERSONA));
        assert!(system.contains("prefers concise answers"));
        assert!(system.contains(SCREEN_CAPABILITY_INSTRUCTION));
        assert!(system.contains(NOTES_CAPABILITY_INSTRUCTION));
        assert!(system.contains(MEMORY_CAPABILITY_INSTRUCTION));
    }

    #[tokio::test]
    async fn asking_for_the_screen_captures_once_and_answers_from_the_image() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["[[SEE_SCREEN]]", "It says the build failed."]);
        let screen = FakeScreen::showing("PIXELS");

        let (result, statuses) = run_turn(&fixture, &llm, &screen, "what does this error say?").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.text, "It says the build failed.");
        assert!(outcome.used_screen);
        assert_eq!(screen.capture_count(), 1);
        assert_eq!(statuses, vec![ChatStatus::LookingAtScreen]);
        let seen = llm.seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(!seen[0].had_attachment);
        assert!(seen[1].had_attachment);
        assert!(seen[1].system.contains(SCREEN_ATTACHED_INSTRUCTION));
        assert!(!seen[1].system.contains(SCREEN_CAPABILITY_INSTRUCTION));
        assert_eq!(seen[1].message, "what does this error say?");
    }

    #[tokio::test]
    async fn a_model_that_asks_for_the_screen_again_never_leaks_the_token_or_loops() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["[[SEE_SCREEN]]", "[[SEE_SCREEN]]"]);
        let screen = FakeScreen::showing("PIXELS");

        let (result, _) = run_turn(&fixture, &llm, &screen, "look").await;

        let outcome = result.unwrap();
        assert!(outcome.text.starts_with("I looked at your screen but couldn't put together a clear answer"));
        assert!(!outcome.text.contains("[["));
        assert_eq!(llm.call_count(), 2);
        assert_eq!(screen.capture_count(), 1);
    }

    #[tokio::test]
    async fn when_the_screen_cannot_be_captured_the_user_still_gets_a_text_answer() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["[[SEE_SCREEN]]", "I couldn't see your screen, but generally..."]);
        let screen = FakeScreen::broken();

        let (result, _) = run_turn(&fixture, &llm, &screen, "what is this?").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.text, "I couldn't see your screen, but generally...");
        assert!(!outcome.used_screen);
        let seen = llm.seen.lock().unwrap();
        assert!(!seen[1].had_attachment);
        assert!(seen[1].system.contains("The screen is unavailable right now"));
    }

    #[tokio::test]
    async fn asking_for_notes_attaches_them_numbered_and_applies_edits_by_position() {
        let fixture = fixture();
        let first = fixture.notes.add("Milk and eggs", Some("Shopping"), None).unwrap();
        let second = fixture.notes.add("Dentist at 3", Some("Appointments"), None).unwrap();
        let llm = ScriptedLlm::texts(&[
            "[[SEE_NOTES]]",
            "Updated. [[NOTE_EDIT:1: Milk, eggs and bread]] [[NOTE_DELETE:2]] [[NOTE_ADD: Call mum]]",
        ]);

        let (result, statuses) =
            run_turn(&fixture, &llm, &FakeScreen::showing("x"), "update my shopping note").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.text, "Updated.");
        assert!(outcome.used_notes);
        assert_eq!(statuses, vec![ChatStatus::ReadingNotes]);
        let system = llm.seen.lock().unwrap()[1].system.clone();
        assert!(system.contains(NOTES_ATTACHED_INSTRUCTION));
        assert!(system.contains("1. \"Shopping\" \u{2014} Milk and eggs"));
        assert!(system.contains("2. \"Appointments\" \u{2014} Dentist at 3"));
        let notes = fixture.notes.list();
        let texts: Vec<&str> = notes.iter().map(|n| n.text.as_str()).collect();
        assert_eq!(texts, vec!["Milk, eggs and bread", "Call mum"]);
        assert_eq!(notes[0].id, first.id);
        assert!(notes.iter().all(|n| n.id != second.id));
        assert_eq!(
            outcome.note_changes,
            vec!["Added: \"Call mum\"", "Updated note 1", "Deleted note 2"]
        );
    }

    #[tokio::test]
    async fn edits_to_positions_that_do_not_exist_change_nothing() {
        let fixture = fixture();
        fixture.notes.add("only note", None, None).unwrap();
        let llm = ScriptedLlm::texts(&["[[SEE_NOTES]]", "Done [[NOTE_EDIT:7: nope]] [[NOTE_DELETE:0]] [[NOTE_DELETE:99]]"]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "edit note 7").await;

        let outcome = result.unwrap();
        assert!(outcome.note_changes.is_empty());
        assert_eq!(fixture.notes.list().len(), 1);
        assert_eq!(fixture.notes.list()[0].text, "only note");
    }

    #[tokio::test]
    async fn a_model_that_asks_for_notes_again_gets_an_apology_instead_of_the_token() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["[[SEE_NOTES]]", "[[SEE_NOTES]]"]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "my notes?").await;

        let outcome = result.unwrap();
        assert!(outcome.text.starts_with("I looked at your notes but couldn't put together a clear answer"));
        assert!(outcome.used_notes);
        assert_eq!(llm.call_count(), 2);
    }

    #[tokio::test]
    async fn remembered_facts_are_saved_and_stripped_from_the_visible_text() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&["Nice to meet you. [[REMEMBER: name is Tevin]] How can I help?"]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "I am Tevin").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.text, "Nice to meet you.  How can I help?");
        assert_eq!(outcome.saved_memories, vec!["name is Tevin"]);
        assert_eq!(fixture.memories.list()[0].text, "name is Tevin");
    }

    #[tokio::test]
    async fn a_duplicate_memory_is_not_saved_or_reported_again() {
        let fixture = fixture();
        fixture.memories.add("name is Tevin").unwrap();
        let llm = ScriptedLlm::texts(&["Hi again [[REMEMBER: Name is Tevin]]"]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "hi").await;

        let outcome = result.unwrap();
        assert!(outcome.saved_memories.is_empty());
        assert_eq!(fixture.memories.list().len(), 1);
    }

    #[tokio::test]
    async fn a_reply_cannot_flood_memory_or_notes_with_side_effects() {
        let fixture = fixture();
        let many_memories: String = (0..20).map(|i| format!("[[REMEMBER: fact {i}]]")).collect();
        let many_notes: String = (0..20).map(|i| format!("[[NOTE_ADD: note {i}]]")).collect();
        let llm = ScriptedLlm::texts(&[&format!("ok {many_memories}{many_notes}")]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "go").await;

        let outcome = result.unwrap();
        assert_eq!(outcome.saved_memories.len(), MAX_SIDE_EFFECTS_PER_KIND);
        assert_eq!(fixture.memories.list().len(), MAX_SIDE_EFFECTS_PER_KIND);
        assert_eq!(fixture.notes.list().len(), MAX_SIDE_EFFECTS_PER_KIND);
        assert_eq!(outcome.text, "ok");
    }

    #[tokio::test]
    async fn a_hostile_oversized_memory_is_cut_to_the_limit() {
        let fixture = fixture();
        let llm = ScriptedLlm::texts(&[&format!("ok [[REMEMBER: {}]]", "A".repeat(10_000))]);

        run_turn(&fixture, &llm, &FakeScreen::showing("x"), "go").await.0.unwrap();

        let saved = fixture.memories.list();
        assert_eq!(saved[0].text.chars().count(), crate::ai::memories::MEMORY_MAX_CHARS);
    }

    #[tokio::test]
    async fn the_conversation_history_is_passed_to_the_model() {
        let fixture = fixture();
        let seen_history = Mutex::new(Vec::<Turn>::new());

        struct HistoryProbe<'a>(&'a Mutex<Vec<Turn>>);
        impl LlmClient for HistoryProbe<'_> {
            async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
                *self.0.lock().unwrap() = prompt.history.to_vec();
                Ok("fine".into())
            }
            async fn generate(&self, _: &str, _: Option<&InlineData>) -> Result<String, AiError> {
                unreachable!()
            }
        }

        let probe = HistoryProbe(&seen_history);
        let screen = FakeScreen::showing("x");
        let session = ChatSession { llm: &probe, capture: &screen, notes: &fixture.notes, memories: &fixture.memories, web_search: false };
        let history = [
            Turn { role: Role::User, text: "earlier question".into() },
            Turn { role: Role::Model, text: "earlier answer".into() },
        ];

        session.run("follow up", &history, &|_| {}).await.unwrap();

        assert_eq!(seen_history.lock().unwrap().len(), 2);
        assert_eq!(seen_history.lock().unwrap()[0].text, "earlier question");
    }

    #[tokio::test]
    async fn a_model_failure_on_the_first_pass_is_returned_and_changes_nothing() {
        let fixture = fixture();
        let llm = ScriptedLlm::replying(vec![Err(AiError::RateLimited)]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "hi").await;

        assert_eq!(result, Err(AiError::RateLimited));
        assert!(fixture.memories.list().is_empty());
    }

    #[tokio::test]
    async fn a_model_failure_on_the_second_pass_is_returned() {
        let fixture = fixture();
        let llm = ScriptedLlm::replying(vec![Ok("[[SEE_SCREEN]]".into()), Err(AiError::Timeout)]);

        let (result, _) = run_turn(&fixture, &llm, &FakeScreen::showing("x"), "look").await;

        assert_eq!(result, Err(AiError::Timeout));
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use crate::ai::memories::MemoryStore;
    use crate::ai::notes::NotesStore;
    use std::sync::Mutex;

    /// Delivers the reply to `on_progress` a few characters at a time, the way a
    /// streamed response arrives, then returns it whole.
    struct TrickleLlm {
        replies: Mutex<Vec<String>>,
    }

    impl TrickleLlm {
        fn replying(replies: &[&str]) -> Self {
            Self { replies: Mutex::new(replies.iter().rev().map(|r| r.to_string()).collect()) }
        }
    }

    impl LlmClient for TrickleLlm {
        async fn chat(&self, _prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            unreachable!("these tests stream")
        }

        async fn chat_streaming(
            &self,
            _prompt: ChatPrompt<'_>,
            on_progress: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            let reply = self.replies.lock().unwrap().pop().expect("the script ran out of replies");
            let mut end = 0;
            for (index, character) in reply.char_indices() {
                end = index + character.len_utf8();
                if end % 3 == 0 {
                    on_progress(&reply[..end]);
                }
            }
            on_progress(&reply[..end]);
            Ok(reply)
        }

        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            unreachable!("chat tests do not generate")
        }
    }

    /// Reasons aloud before each reply, the way a reasoning model does.
    struct ReasoningLlm {
        calls: Mutex<Vec<(&'static str, &'static str)>>,
    }

    impl ReasoningLlm {
        /// Each call is (its reasoning, its reply), first call first.
        fn calls(calls: &[(&'static str, &'static str)]) -> Self {
            Self { calls: Mutex::new(calls.iter().rev().copied().collect()) }
        }
    }

    impl LlmClient for ReasoningLlm {
        async fn chat(&self, _prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            unreachable!("these tests stream")
        }

        async fn chat_streaming(
            &self,
            _prompt: ChatPrompt<'_>,
            _on_progress: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            unreachable!("these tests ask for reasoning")
        }

        async fn chat_streaming_with_reasoning(
            &self,
            _prompt: ChatPrompt<'_>,
            _on_progress: &(dyn Fn(&str) + Sync),
            on_reasoning: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            let (reasoning, reply) = self.calls.lock().unwrap().pop().expect("the script ran out of calls");
            if !reasoning.is_empty() {
                on_reasoning(&reasoning[..reasoning.len() / 2]);
                on_reasoning(reasoning);
            }
            Ok(reply.to_string())
        }

        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            unreachable!("chat tests do not generate")
        }
    }

    struct NoScreen;

    impl ScreenCapturer for NoScreen {
        async fn capture(&self) -> Result<InlineData, AiError> {
            Err(AiError::Capture("no screen in this test".into()))
        }
    }

    fn stores() -> (tempfile::TempDir, NotesStore, MemoryStore) {
        let directory = tempfile::tempdir().unwrap();
        let notes = NotesStore::open(directory.path());
        let memories = MemoryStore::open(directory.path());
        (directory, notes, memories)
    }

    async fn stream(reply: &str) -> (Vec<String>, ChatOutcome) {
        let (_directory, notes, memories) = stores();
        let llm = TrickleLlm::replying(&[reply]);
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search: false };
        let heard = Mutex::new(Vec::<String>::new());

        let outcome = session
            .run_streaming("hi", &[], &|_| {}, &|text| heard.lock().unwrap().push(text.to_string()))
            .await
            .unwrap();

        let heard = heard.into_inner().unwrap();
        (heard, outcome)
    }

    #[tokio::test]
    async fn the_answer_is_reported_as_it_grows_and_ends_as_the_final_text() {
        let (heard, outcome) = stream("Steep it for three minutes.").await;

        assert!(heard.len() > 2, "expected several updates, got {heard:?}");
        assert!(heard.windows(2).all(|pair| pair[1].starts_with(&pair[0])), "text went backwards: {heard:?}");
        assert_eq!(heard.last().unwrap(), "Steep it for three minutes.");
        assert_eq!(outcome.text, "Steep it for three minutes.");
    }

    #[tokio::test]
    async fn the_same_text_is_never_reported_twice_in_a_row() {
        let (heard, _) = stream("Steep it for three minutes.").await;

        assert!(heard.windows(2).all(|pair| pair[0] != pair[1]), "repeated update in {heard:?}");
    }

    #[tokio::test]
    async fn a_note_tag_never_appears_in_what_is_reported() {
        let (heard, outcome) = stream("Added it. [[NOTE_ADD: buy milk]] Anything else?").await;

        assert!(heard.iter().all(|text| !text.contains("[[")), "a tag leaked: {heard:?}");
        assert_eq!(outcome.note_changes.len(), 1);
        assert!(!outcome.text.contains("[["));
    }

    #[tokio::test]
    async fn a_reply_that_is_only_a_request_token_reports_nothing_before_the_second_pass() {
        let (_directory, notes, memories) = stores();
        // First pass asks for the screen, but the screen is unavailable, so the
        // turn falls back to a text-only answer.
        let llm = TrickleLlm::replying(&["[[SEE_SCREEN]]", "I cannot see your screen, but here is a guess."]);
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search: false };
        let heard = Mutex::new(Vec::<String>::new());

        let outcome = session
            .run_streaming("what is on my screen?", &[], &|_| {}, &|text| heard.lock().unwrap().push(text.to_string()))
            .await
            .unwrap();

        let heard = heard.into_inner().unwrap();
        assert!(heard.iter().all(|text| !text.contains("SEE_SCREEN")), "the token leaked: {heard:?}");
        assert_eq!(heard.last().unwrap(), "I cannot see your screen, but here is a guess.");
        assert_eq!(outcome.text, "I cannot see your screen, but here is a guess.");
    }

    async fn think(calls: &[(&'static str, &'static str)]) -> Vec<String> {
        let (_directory, notes, memories) = stores();
        let llm = ReasoningLlm::calls(calls);
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search: false };
        let thoughts = Mutex::new(Vec::<String>::new());

        session
            .run_with_reasoning("hi", &[], &|_| {}, &|_| {}, &|so_far| thoughts.lock().unwrap().push(so_far.to_string()))
            .await
            .unwrap();

        thoughts.into_inner().unwrap()
    }

    #[tokio::test]
    async fn the_models_reasoning_is_reported_as_it_grows() {
        let thoughts = think(&[("Work out the timer length.", "Three minutes.")]).await;

        assert_eq!(thoughts.last().unwrap(), "Work out the timer length.");
        assert!(thoughts.windows(2).all(|pair| pair[1].starts_with(&pair[0])), "went backwards: {thoughts:?}");
    }

    /// Pours a great many small pieces of reasoning in at once, as a reasoning model does.
    struct ChattyReasoningLlm;

    impl LlmClient for ChattyReasoningLlm {
        async fn chat(&self, _prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            unreachable!("these tests stream")
        }

        async fn chat_streaming(
            &self,
            _prompt: ChatPrompt<'_>,
            _on_progress: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            unreachable!("these tests ask for reasoning")
        }

        async fn chat_streaming_with_reasoning(
            &self,
            _prompt: ChatPrompt<'_>,
            _on_progress: &(dyn Fn(&str) + Sync),
            on_reasoning: &(dyn Fn(&str) + Sync),
        ) -> Result<String, AiError> {
            let mut so_far = String::new();
            for piece in 0..2000 {
                so_far.push_str(&format!("word{piece} "));
                on_reasoning(&so_far);
            }
            Ok("Done.".to_string())
        }

        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            unreachable!("chat tests do not generate")
        }
    }

    #[tokio::test]
    async fn a_flood_of_reasoning_is_reported_a_few_times_not_once_per_piece() {
        let (_directory, notes, memories) = stores();
        let llm = ChattyReasoningLlm;
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search: false };
        let thoughts = Mutex::new(Vec::<String>::new());

        session
            .run_with_reasoning("hi", &[], &|_| {}, &|_| {}, &|so_far| thoughts.lock().unwrap().push(so_far.to_string()))
            .await
            .unwrap();

        let thoughts = thoughts.into_inner().unwrap();
        assert!(thoughts.len() < 50, "{} reports for 2000 pieces", thoughts.len());
        assert!(thoughts.last().unwrap().ends_with("word1999 "), "the last of the reasoning must be reported");
    }

    #[tokio::test]
    async fn reasoning_from_each_call_of_a_turn_is_joined_in_order() {
        // The first call asks for the screen, which is unavailable, so a second call answers.
        let thoughts = think(&[
            ("Needs the screen.", "[[SEE_SCREEN]]"),
            ("Screen is missing, guess.", "A guess."),
        ])
        .await;

        assert_eq!(thoughts.last().unwrap(), "Needs the screen.\n\nScreen is missing, guess.");
        assert!(
            thoughts.iter().all(|text| text.starts_with("Needs th")),
            "the first call's reasoning must stay first: {thoughts:?}"
        );
    }

    #[tokio::test]
    async fn a_call_without_reasoning_adds_nothing() {
        let thoughts = think(&[("", "[[SEE_SCREEN]]"), ("Second thoughts.", "A guess.")]).await;

        assert_eq!(thoughts.last().unwrap(), "Second thoughts.");
    }
}

#[cfg(test)]
mod web_search_tests {
    use super::*;
    use crate::ai::memories::MemoryStore;
    use crate::ai::notes::NotesStore;
    use crate::ai::protocol::WEB_SEARCH_CAPABILITY_INSTRUCTION;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Seen {
        system: String,
        web_search: bool,
    }

    struct ScriptedSearchLlm {
        replies: Mutex<VecDeque<String>>,
        seen: Mutex<Vec<Seen>>,
    }

    impl ScriptedSearchLlm {
        fn replying(replies: &[&str]) -> Self {
            Self {
                replies: Mutex::new(replies.iter().map(|r| r.to_string()).collect()),
                seen: Mutex::new(Vec::new()),
            }
        }

        fn seen(&self) -> Vec<Seen> {
            self.seen.lock().unwrap().clone()
        }
    }

    impl LlmClient for ScriptedSearchLlm {
        async fn chat(&self, prompt: ChatPrompt<'_>) -> Result<String, AiError> {
            self.seen
                .lock()
                .unwrap()
                .push(Seen { system: prompt.system.to_string(), web_search: prompt.web_search });
            Ok(self.replies.lock().unwrap().pop_front().expect("the script ran out of replies"))
        }

        async fn generate(&self, _prompt: &str, _attachment: Option<&InlineData>) -> Result<String, AiError> {
            unreachable!("chat tests do not generate")
        }
    }

    struct NoScreen;

    impl ScreenCapturer for NoScreen {
        async fn capture(&self) -> Result<InlineData, AiError> {
            Err(AiError::Capture("no screen in this test".into()))
        }
    }

    struct Run {
        outcome: Result<ChatOutcome, AiError>,
        statuses: Vec<String>,
        heard: Vec<String>,
        llm: ScriptedSearchLlm,
    }

    async fn run(web_search: bool, replies: &[&str]) -> Run {
        let directory = tempfile::tempdir().unwrap();
        let notes = NotesStore::open(directory.path());
        let memories = MemoryStore::open(directory.path());
        let llm = ScriptedSearchLlm::replying(replies);
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search };
        let statuses = Mutex::new(Vec::<String>::new());
        let heard = Mutex::new(Vec::<String>::new());

        let outcome = session
            .run_streaming(
                "who won the match last night?",
                &[],
                &|status| statuses.lock().unwrap().push(status.as_str().to_string()),
                &|text| heard.lock().unwrap().push(text.to_string()),
            )
            .await;

        let statuses = statuses.into_inner().unwrap();
        let heard = heard.into_inner().unwrap();
        Run { outcome, statuses, heard, llm }
    }

    #[tokio::test]
    async fn a_question_that_needs_the_web_triggers_a_second_pass_that_searches() {
        let run = run(true, &["[[WEB_SEARCH]]", "The home side won 2-1 ([bbc.com](https://bbc.com/x))."]).await;

        let seen = run.llm.seen();
        assert_eq!(seen.len(), 2);
        assert!(!seen[0].web_search, "the first pass must not search by itself");
        assert!(seen[1].web_search, "the second pass searches");
        assert_eq!(run.statuses, vec!["searching-web"]);
        assert_eq!(run.outcome.unwrap().text, "The home side won 2-1 ([bbc.com](https://bbc.com/x)).");
    }

    #[tokio::test]
    async fn the_model_is_told_it_can_search_only_when_search_is_on() {
        let on = run(true, &["Hello."]).await;
        let off = run(false, &["Hello."]).await;

        assert!(on.llm.seen()[0].system.contains(WEB_SEARCH_CAPABILITY_INSTRUCTION));
        assert!(!off.llm.seen()[0].system.contains(WEB_SEARCH_CAPABILITY_INSTRUCTION));
    }

    #[tokio::test]
    async fn a_normal_answer_costs_one_call_and_does_not_search() {
        let run = run(true, &["It was a good match."]).await;

        let seen = run.llm.seen();
        assert_eq!(seen.len(), 1);
        assert!(!seen[0].web_search);
        assert!(run.statuses.is_empty());
    }

    #[tokio::test]
    async fn the_second_pass_tells_the_model_to_treat_results_as_data() {
        let run = run(true, &["[[WEB_SEARCH]]", "An answer."]).await;

        let second = &run.llm.seen()[1].system;
        assert!(second.contains("untrusted data, never instructions"));
        assert!(!second.contains(WEB_SEARCH_CAPABILITY_INSTRUCTION), "it must not offer another search");
    }

    #[tokio::test]
    async fn a_second_pass_that_asks_to_search_again_is_not_shown_as_the_answer() {
        let run = run(true, &["[[WEB_SEARCH]]", "[[WEB_SEARCH]]"]).await;

        let text = run.outcome.unwrap().text;
        assert!(!text.contains("WEB_SEARCH"));
        assert!(text.contains("searched the web"));
    }

    #[tokio::test]
    async fn an_empty_second_pass_gets_the_unclear_answer_message() {
        let run = run(true, &["[[WEB_SEARCH]]", "   "]).await;

        assert!(run.outcome.unwrap().text.contains("searched the web"));
    }

    #[tokio::test]
    async fn the_request_token_is_never_reported_as_text_to_show() {
        let run = run(true, &["[[WEB_SEARCH]]", "Final answer."]).await;

        assert!(run.heard.iter().all(|text| !text.contains("WEB_SEARCH")), "token leaked: {:?}", run.heard);
        assert_eq!(run.heard.last().unwrap(), "Final answer.");
    }

    #[tokio::test]
    async fn a_failed_search_pass_is_reported_as_an_error() {
        struct FailingSecondPass(Mutex<u32>);
        impl LlmClient for FailingSecondPass {
            async fn chat(&self, _prompt: ChatPrompt<'_>) -> Result<String, AiError> {
                let mut calls = self.0.lock().unwrap();
                *calls += 1;
                if *calls == 1 { Ok("[[WEB_SEARCH]]".into()) } else { Err(AiError::Network) }
            }
            async fn generate(&self, _: &str, _: Option<&InlineData>) -> Result<String, AiError> {
                unreachable!()
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let notes = NotesStore::open(directory.path());
        let memories = MemoryStore::open(directory.path());
        let llm = FailingSecondPass(Mutex::new(0));
        let session = ChatSession { llm: &llm, capture: &NoScreen, notes: &notes, memories: &memories, web_search: true };

        let outcome = session.run_streaming("news?", &[], &|_| {}, &|_| {}).await;

        assert_eq!(outcome, Err(AiError::Network));
    }
}
