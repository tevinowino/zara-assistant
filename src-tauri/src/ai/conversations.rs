//! Saved chat conversations.
//!
//! A conversation is named once, from what it opened with, and is only renamed
//! again when the assistant upgrades that placeholder to a better title after
//! the first exchange; the title does not drift as the topic does.

use super::store::{one_line_title, system_clock, Clock, JsonArrayFile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

const TITLE_MAX_CHARS: usize = 48;
/// Safety nets against unbounded growth, far above normal use.
const MAX_CONVERSATIONS: usize = 500;
const MAX_MESSAGES_PER_CONVERSATION: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<StoredChatMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

fn derive_title(messages: &[StoredChatMessage]) -> String {
    messages
        .iter()
        .find(|m| m.role == "user")
        .map(|m| one_line_title(&m.text, TITLE_MAX_CHARS, "New chat"))
        .unwrap_or_else(|| "New chat".to_string())
}

/// Reads the conversations in someone else's `conversations.json` without
/// touching the file.
pub fn read_conversations_from(directory: &Path) -> Vec<StoredConversation> {
    JsonArrayFile::new(directory, "conversations.json").read_only()
}

pub struct ConversationStore {
    file: JsonArrayFile,
    conversations: Mutex<Vec<StoredConversation>>,
    clock: Clock,
}

impl ConversationStore {
    pub fn open(directory: &Path) -> Self {
        Self::open_with_clock(directory, system_clock())
    }

    pub fn open_with_clock(directory: &Path, clock: Clock) -> Self {
        let file = JsonArrayFile::new(directory, "conversations.json");
        let conversations = file.read::<StoredConversation>();
        Self { file, conversations: Mutex::new(conversations), clock }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<StoredConversation>> {
        self.conversations.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Newest first. Reversing before the stable sort makes two conversations
    /// updated in the same millisecond come out newest-first on the tie.
    pub fn list(&self) -> Vec<ConversationSummary> {
        let mut summaries: Vec<ConversationSummary> = self
            .lock()
            .iter()
            .rev()
            .map(|c| ConversationSummary { id: c.id.clone(), title: c.title.clone(), updated_at: c.updated_at })
            .collect();
        summaries.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        summaries
    }

    pub fn load(&self, id: &str) -> Option<StoredConversation> {
        self.lock().iter().find(|c| c.id == id).cloned()
    }

    /// Saves the messages of a conversation, creating it (titled from its first
    /// user message) if it is new.
    pub fn upsert(&self, id: &str, mut messages: Vec<StoredChatMessage>) -> StoredConversation {
        if messages.len() > MAX_MESSAGES_PER_CONVERSATION {
            let excess = messages.len() - MAX_MESSAGES_PER_CONVERSATION;
            messages.drain(..excess);
        }
        let now = (self.clock)();
        let mut conversations = self.lock();
        let saved = if let Some(existing) = conversations.iter_mut().find(|c| c.id == id) {
            existing.messages = messages;
            existing.updated_at = now;
            existing.clone()
        } else {
            let created = StoredConversation {
                id: id.to_string(),
                title: derive_title(&messages),
                created_at: now,
                updated_at: now,
                messages,
            };
            conversations.push(created.clone());
            if conversations.len() > MAX_CONVERSATIONS {
                conversations.sort_by_key(|c| c.updated_at);
                let excess = conversations.len() - MAX_CONVERSATIONS;
                conversations.drain(..excess);
            }
            created
        };
        self.file.write_or_record(&conversations);
        saved
    }

    /// Adds conversations written elsewhere, keeping their ids, titles and dates.
    /// Ids already present are skipped, so importing twice changes nothing.
    /// Returns how many were added.
    pub fn import(&self, incoming: Vec<StoredConversation>) -> usize {
        let mut conversations = self.lock();
        let mut added = 0;
        for mut conversation in incoming {
            if conversation.id.is_empty() || conversations.iter().any(|c| c.id == conversation.id) {
                continue;
            }
            if conversation.messages.len() > MAX_MESSAGES_PER_CONVERSATION {
                let excess = conversation.messages.len() - MAX_MESSAGES_PER_CONVERSATION;
                conversation.messages.drain(..excess);
            }
            if conversation.title.trim().is_empty() {
                conversation.title = derive_title(&conversation.messages);
            }
            conversations.push(conversation);
            added += 1;
        }
        if conversations.len() > MAX_CONVERSATIONS {
            conversations.sort_by_key(|c| c.updated_at);
            let excess = conversations.len() - MAX_CONVERSATIONS;
            conversations.drain(..excess);
        }
        if added > 0 {
            self.file.write_or_record(&conversations);
        }
        added
    }

    pub fn delete(&self, id: &str) -> bool {
        let mut conversations = self.lock();
        let before = conversations.len();
        conversations.retain(|c| c.id != id);
        let removed = conversations.len() != before;
        if removed {
            self.file.write_or_record(&conversations);
        }
        removed
    }

    /// Replaces a title. A no-op for a blank title or an unknown id (for example
    /// the conversation was deleted before an asynchronous title arrived).
    pub fn rename(&self, id: &str, title: &str) -> bool {
        let title = title.trim();
        if title.is_empty() {
            return false;
        }
        let mut conversations = self.lock();
        let Some(existing) = conversations.iter_mut().find(|c| c.id == id) else {
            return false;
        };
        existing.title = title.to_string();
        self.file.write_or_record(&conversations);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Arc;

    fn counting_clock() -> Clock {
        let tick = Arc::new(AtomicI64::new(1_000));
        Arc::new(move || tick.fetch_add(1, Ordering::SeqCst))
    }

    fn message(id: &str, role: &str, text: &str) -> StoredChatMessage {
        StoredChatMessage { id: id.into(), role: role.into(), text: text.into(), created_at: 1, kind: None }
    }

    #[test]
    fn a_new_conversation_is_titled_from_its_first_user_message() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());

        let saved = store.upsert(
            "c1",
            vec![message("m1", "user", "  How do I\nbrew   green tea? "), message("m2", "assistant", "Steep it.")],
        );

        assert_eq!(saved.title, "How do I brew green tea?");
    }

    #[test]
    fn a_conversation_with_no_user_message_is_called_new_chat() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());

        let saved = store.upsert("c1", vec![message("m1", "assistant", "Hello")]);

        assert_eq!(saved.title, "New chat");
    }

    #[test]
    fn a_long_first_message_is_shortened_with_an_ellipsis() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());

        let saved = store.upsert("c1", vec![message("m1", "user", &"word ".repeat(40))]);

        assert!(saved.title.ends_with('\u{2026}'));
        assert!(saved.title.chars().count() <= TITLE_MAX_CHARS + 1);
    }

    #[test]
    fn saving_again_keeps_the_original_title_and_updates_the_messages() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        store.upsert("c1", vec![message("m1", "user", "first question")]);

        let saved = store.upsert(
            "c1",
            vec![message("m1", "user", "first question"), message("m2", "assistant", "an answer")],
        );

        assert_eq!(saved.title, "first question");
        assert_eq!(saved.messages.len(), 2);
        assert!(saved.updated_at > saved.created_at);
    }

    #[test]
    fn conversations_are_listed_newest_first() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        store.upsert("old", vec![message("m", "user", "old one")]);
        store.upsert("new", vec![message("m", "user", "new one")]);

        let titles: Vec<String> = store.list().into_iter().map(|s| s.title).collect();

        assert_eq!(titles, vec!["new one", "old one"]);
    }

    #[test]
    fn two_conversations_updated_in_the_same_millisecond_list_newest_first() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), Arc::new(|| 5_000));
        store.upsert("a", vec![message("m", "user", "first inserted")]);
        store.upsert("b", vec![message("m", "user", "second inserted")]);

        let titles: Vec<String> = store.list().into_iter().map(|s| s.title).collect();

        assert_eq!(titles, vec!["second inserted", "first inserted"]);
    }

    #[test]
    fn rename_replaces_the_title_but_ignores_blank_titles_and_unknown_ids() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        store.upsert("c1", vec![message("m1", "user", "placeholder")]);

        assert!(store.rename("c1", "  Brewing tea  "));
        assert!(!store.rename("c1", "   "));
        assert!(!store.rename("missing", "Whatever"));

        assert_eq!(store.load("c1").unwrap().title, "Brewing tea");
    }

    #[test]
    fn delete_removes_only_the_named_conversation() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        store.upsert("a", vec![message("m", "user", "keep")]);
        store.upsert("b", vec![message("m", "user", "drop")]);

        assert!(store.delete("b"));
        assert!(!store.delete("b"));

        assert_eq!(store.list().len(), 1);
        assert!(store.load("a").is_some());
    }

    #[test]
    fn conversations_survive_a_restart_with_unicode_intact() {
        let directory = tempfile::tempdir().unwrap();
        {
            let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
            store.upsert("c1", vec![message("m1", "user", "caf\u{e9} \u{65e5}\u{672c}\u{8a9e} \u{1f389}")]);
        }

        let reopened = ConversationStore::open_with_clock(directory.path(), counting_clock());

        assert_eq!(reopened.load("c1").unwrap().messages[0].text, "caf\u{e9} \u{65e5}\u{672c}\u{8a9e} \u{1f389}");
    }

    #[test]
    fn a_conversation_keeps_only_its_most_recent_messages_beyond_the_ceiling() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        let many: Vec<StoredChatMessage> = (0..MAX_MESSAGES_PER_CONVERSATION + 10)
            .map(|i| message(&format!("m{i}"), "user", &format!("text {i}")))
            .collect();

        let saved = store.upsert("c1", many);

        assert_eq!(saved.messages.len(), MAX_MESSAGES_PER_CONVERSATION);
        assert_eq!(saved.messages[0].text, "text 10");
    }

    #[test]
    fn the_stored_json_matches_the_shape_electron_zara_wrote() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConversationStore::open_with_clock(directory.path(), counting_clock());
        store.upsert("c1", vec![message("m1", "user", "hello")]);

        let raw = std::fs::read_to_string(directory.path().join("conversations.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();

        assert_eq!(value[0]["id"], "c1");
        assert!(value[0]["createdAt"].is_i64());
        assert!(value[0]["updatedAt"].is_i64());
        assert_eq!(value[0]["messages"][0]["role"], "user");
        assert!(value[0]["messages"][0].get("kind").is_none());
    }
}
