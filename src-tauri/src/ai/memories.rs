//! Durable facts about the user that the assistant carries across every
//! conversation. Each saved memory is added to every chat request, so the store
//! is capped and de-duplicated.

use super::store::{system_clock, truncate_chars, Clock, JsonArrayFile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// A safety net against unbounded prompt growth over months of use.
const MAX_MEMORIES: usize = 100;
/// Longest single fact kept. Memories are short statements; anything longer is
/// cut, which also limits what a hostile page on screen could make the model
/// save.
pub const MEMORY_MAX_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub text: String,
    pub created_at: i64,
}

/// Reads the memories in someone else's `memories.json` without touching the file.
pub fn read_memories_from(directory: &Path) -> Vec<MemoryEntry> {
    JsonArrayFile::new(directory, "memories.json").read_only()
}

pub struct MemoryStore {
    file: JsonArrayFile,
    memories: Mutex<Vec<MemoryEntry>>,
    clock: Clock,
}

impl MemoryStore {
    pub fn open(directory: &Path) -> Self {
        Self::open_with_clock(directory, system_clock())
    }

    pub fn open_with_clock(directory: &Path, clock: Clock) -> Self {
        let file = JsonArrayFile::new(directory, "memories.json");
        let memories = file.read::<MemoryEntry>();
        Self { file, memories: Mutex::new(memories), clock }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<MemoryEntry>> {
        self.memories.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Newest first (ties resolve newest-inserted first).
    pub fn list(&self) -> Vec<MemoryEntry> {
        let mut entries: Vec<MemoryEntry> = self.lock().iter().rev().cloned().collect();
        entries.sort_by_key(|e| std::cmp::Reverse(e.created_at));
        entries
    }

    /// Saves a fact. Returns `None` for blank text or a case-insensitive
    /// duplicate: the model is told not to re-save known memories, and this is
    /// the backstop that stops duplicate spam if it does anyway.
    pub fn add(&self, text: &str) -> Option<MemoryEntry> {
        let text = truncate_chars(text.trim(), MEMORY_MAX_CHARS);
        if text.is_empty() {
            return None;
        }
        let mut memories = self.lock();
        let lowered = text.to_lowercase();
        if memories.iter().any(|m| m.text.to_lowercase() == lowered) {
            return None;
        }
        let entry = MemoryEntry { id: uuid::Uuid::new_v4().to_string(), text, created_at: (self.clock)() };
        memories.push(entry.clone());
        if memories.len() > MAX_MEMORIES {
            memories.sort_by_key(|m| m.created_at);
            let excess = memories.len() - MAX_MEMORIES;
            memories.drain(..excess);
        }
        self.file.write_or_record(&memories);
        Some(entry)
    }

    /// Adds memories written elsewhere, keeping their ids and dates. A memory
    /// whose id is here, or whose text matches one already saved, is skipped.
    /// Returns how many were added.
    pub fn import(&self, incoming: Vec<MemoryEntry>) -> usize {
        let mut memories = self.lock();
        let mut added = 0;
        for mut entry in incoming {
            entry.text = truncate_chars(entry.text.trim(), MEMORY_MAX_CHARS);
            let lowered = entry.text.to_lowercase();
            if entry.id.is_empty()
                || entry.text.is_empty()
                || memories.iter().any(|m| m.id == entry.id || m.text.to_lowercase() == lowered)
            {
                continue;
            }
            memories.push(entry);
            added += 1;
        }
        if memories.len() > MAX_MEMORIES {
            memories.sort_by_key(|m| m.created_at);
            let excess = memories.len() - MAX_MEMORIES;
            memories.drain(..excess);
        }
        if added > 0 {
            self.file.write_or_record(&memories);
        }
        added
    }

    pub fn delete(&self, id: &str) -> bool {
        let mut memories = self.lock();
        let before = memories.len();
        memories.retain(|m| m.id != id);
        let removed = memories.len() != before;
        if removed {
            self.file.write_or_record(&memories);
        }
        removed
    }

    /// The section added to every chat request, or an empty string so an empty
    /// store never puts an empty header in the prompt.
    pub fn build_context_block(&self) -> String {
        let memories = self.lock();
        if memories.is_empty() {
            return String::new();
        }
        let lines = memories.iter().map(|m| format!("- {}", m.text)).collect::<Vec<_>>().join("\n");
        format!("Saved memories about this user, true across all conversations:\n{lines}")
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

    #[test]
    fn a_new_fact_is_saved_trimmed() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());

        let entry = store.add("  prefers concise answers  ").unwrap();

        assert_eq!(entry.text, "prefers concise answers");
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn blank_facts_and_case_insensitive_duplicates_are_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
        store.add("Is allergic to shellfish").unwrap();

        assert!(store.add("   ").is_none());
        assert!(store.add("is ALLERGIC to shellfish").is_none());
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn memories_are_listed_newest_first() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
        store.add("first").unwrap();
        store.add("second").unwrap();

        let texts: Vec<String> = store.list().into_iter().map(|m| m.text).collect();

        assert_eq!(texts, vec!["second", "first"]);
    }

    #[test]
    fn delete_removes_one_memory() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
        let keep = store.add("keep").unwrap();
        let drop = store.add("drop").unwrap();

        assert!(store.delete(&drop.id));
        assert!(!store.delete(&drop.id));

        let remaining = store.list();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, keep.id);
    }

    #[test]
    fn the_oldest_memories_are_dropped_beyond_the_ceiling() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
        for i in 0..(MAX_MEMORIES + 2) {
            store.add(&format!("fact {i}")).unwrap();
        }

        let facts = store.list();

        assert_eq!(facts.len(), MAX_MEMORIES);
        assert!(facts.iter().all(|m| m.text != "fact 0" && m.text != "fact 1"));
    }

    #[test]
    fn a_very_long_fact_is_cut_to_the_limit() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());

        let entry = store.add(&"a".repeat(MEMORY_MAX_CHARS * 3)).unwrap();

        assert_eq!(entry.text.chars().count(), MEMORY_MAX_CHARS);
    }

    #[test]
    fn the_context_block_lists_facts_in_saved_order_and_is_empty_when_there_are_none() {
        let directory = tempfile::tempdir().unwrap();
        let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
        assert_eq!(store.build_context_block(), "");
        store.add("name is Tevin").unwrap();
        store.add("lives in Nairobi").unwrap();

        assert_eq!(
            store.build_context_block(),
            "Saved memories about this user, true across all conversations:\n- name is Tevin\n- lives in Nairobi"
        );
    }

    #[test]
    fn memories_survive_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        {
            let store = MemoryStore::open_with_clock(directory.path(), counting_clock());
            store.add("likes tea").unwrap();
        }

        let reopened = MemoryStore::open_with_clock(directory.path(), counting_clock());

        assert_eq!(reopened.list()[0].text, "likes tea");
    }
}
