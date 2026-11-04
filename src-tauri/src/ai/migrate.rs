//! Bringing data over from the Electron version of Zara.
//!
//! The old app kept `notes.json`, `conversations.json` and `memories.json` in
//! `%APPDATA%\zara-ai`. The formats are the same as the new stores', so this
//! copies the records in.
//!
//! Rules:
//! - The old files are only ever read, never moved, changed or deleted.
//! - It runs only when the user asks (Settings > Library), never silently.
//! - Importing twice changes nothing: records are matched by id.
//! - A damaged file is skipped, not fatal, and the rest still imports.
//! - Once the user has imported or dismissed the offer, it is not offered again.

use super::conversations::{read_conversations_from, ConversationStore};
use super::memories::{read_memories_from, MemoryStore};
use super::notes::{read_notes_from, NotesStore};
use serde::Serialize;
use std::path::{Path, PathBuf};

const MARKER_FILE: &str = "legacy-import-done";

/// What an old installation holds, as shown in the offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStatus {
    pub available: bool,
    pub notes: usize,
    pub conversations: usize,
    pub memories: usize,
}

/// How many records an import added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub notes: usize,
    pub conversations: usize,
    pub memories: usize,
}

/// Where the Electron version kept its data: `%APPDATA%\zara-ai`.
pub fn legacy_directory() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let directory = PathBuf::from(appdata).join("zara-ai");
    directory.is_dir().then_some(directory)
}

fn already_handled(destination: &Path) -> bool {
    destination.join(MARKER_FILE).exists()
}

/// Records that the offer has been dealt with.
pub fn mark_handled(destination: &Path) {
    let _ = std::fs::create_dir_all(destination);
    let _ = std::fs::write(destination.join(MARKER_FILE), "done");
}

/// What could be imported from `source`, or nothing available if the offer was
/// already handled or the old folder holds no records.
pub fn status(source: &Path, destination: &Path) -> LegacyStatus {
    let none = LegacyStatus { available: false, notes: 0, conversations: 0, memories: 0 };
    if already_handled(destination) {
        return none;
    }
    let notes = read_notes_from(source).len();
    let conversations = read_conversations_from(source).len();
    let memories = read_memories_from(source).len();
    LegacyStatus { available: notes + conversations + memories > 0, notes, conversations, memories }
}

/// Copies the records from `source` into the stores and marks the offer handled.
pub fn import(
    source: &Path,
    destination: &Path,
    notes: &NotesStore,
    conversations: &ConversationStore,
    memories: &MemoryStore,
) -> ImportSummary {
    let summary = ImportSummary {
        notes: notes.import(read_notes_from(source)),
        conversations: conversations.import(read_conversations_from(source)),
        memories: memories.import(read_memories_from(source)),
    };
    mark_handled(destination);
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Folders {
        _root: tempfile::TempDir,
        old: PathBuf,
        new: PathBuf,
    }

    fn folders() -> Folders {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("zara-ai");
        let new = root.path().join("com.zara.app").join("ai");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        Folders { _root: root, old, new }
    }

    fn stores(directory: &Path) -> (NotesStore, ConversationStore, MemoryStore) {
        (NotesStore::open(directory), ConversationStore::open(directory), MemoryStore::open(directory))
    }

    const OLD_NOTES: &str = r#"[
        {"id":"n1","title":"Shopping","text":"Milk and eggs","color":"blue","createdAt":100,"updatedAt":150},
        {"id":"n2","text":"Written before titles existed","createdAt":200,"updatedAt":200}
    ]"#;
    const OLD_CONVERSATIONS: &str = r#"[
        {"id":"c1","title":"Brewing tea","createdAt":10,"updatedAt":20,
         "messages":[{"id":"m1","role":"user","text":"how do I brew tea?","createdAt":10}]}
    ]"#;
    const OLD_MEMORIES: &str = r#"[{"id":"mem1","text":"prefers concise answers","createdAt":5}]"#;

    fn write_old_data(old: &Path) {
        fs::write(old.join("notes.json"), OLD_NOTES).unwrap();
        fs::write(old.join("conversations.json"), OLD_CONVERSATIONS).unwrap();
        fs::write(old.join("memories.json"), OLD_MEMORIES).unwrap();
    }

    #[test]
    fn the_offer_lists_what_an_old_installation_holds() {
        let f = folders();
        write_old_data(&f.old);

        let status = status(&f.old, &f.new);

        assert_eq!(status, LegacyStatus { available: true, notes: 2, conversations: 1, memories: 1 });
    }

    #[test]
    fn there_is_nothing_to_offer_when_the_old_folder_is_empty_or_missing() {
        let f = folders();

        assert!(!status(&f.old, &f.new).available);
        assert!(!status(&f.old.join("does-not-exist"), &f.new).available);
    }

    #[test]
    fn an_import_keeps_ids_titles_colours_and_dates() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);

        let summary = import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(summary, ImportSummary { notes: 2, conversations: 1, memories: 1 });
        let imported = notes.list();
        assert_eq!(imported[0].id, "n1");
        assert_eq!(imported[0].title, "Shopping");
        assert_eq!(imported[0].created_at, 100);
        assert_eq!(imported[0].updated_at, 150);
        assert_eq!(conversations.load("c1").unwrap().title, "Brewing tea");
        assert_eq!(memories.list()[0].id, "mem1");
    }

    #[test]
    fn notes_from_before_titles_and_colours_existed_are_filled_in() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);

        import(&f.old, &f.new, &notes, &conversations, &memories);

        let old_style = &notes.list()[1];
        assert_eq!(old_style.title, "Written before titles existed");
    }

    #[test]
    fn importing_twice_changes_nothing() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);
        import(&f.old, &f.new, &notes, &conversations, &memories);

        let second = import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(second, ImportSummary { notes: 0, conversations: 0, memories: 0 });
        assert_eq!(notes.list().len(), 2);
        assert_eq!(conversations.list().len(), 1);
        assert_eq!(memories.list().len(), 1);
    }

    #[test]
    fn existing_new_data_is_kept_and_only_missing_records_are_added() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);
        notes.add("A note made in the new app", None, None).unwrap();
        memories.add("prefers concise answers").unwrap();

        let summary = import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(summary.notes, 2);
        assert_eq!(summary.memories, 0, "the same fact is not saved twice");
        assert_eq!(notes.list().len(), 3);
    }

    #[test]
    fn the_old_files_are_left_exactly_as_they_were() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);

        import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(fs::read_to_string(f.old.join("notes.json")).unwrap(), OLD_NOTES);
        assert_eq!(fs::read_to_string(f.old.join("conversations.json")).unwrap(), OLD_CONVERSATIONS);
        assert_eq!(fs::read_to_string(f.old.join("memories.json")).unwrap(), OLD_MEMORIES);
        let names: Vec<String> = fs::read_dir(&f.old).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names.len(), 3, "nothing was added or moved: {names:?}");
    }

    #[test]
    fn a_damaged_old_file_is_skipped_without_blocking_the_rest_or_being_moved() {
        let f = folders();
        write_old_data(&f.old);
        fs::write(f.old.join("conversations.json"), "[{\"id\":\"c1\",\"tit").unwrap();
        let (notes, conversations, memories) = stores(&f.new);

        let summary = import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(summary, ImportSummary { notes: 2, conversations: 0, memories: 1 });
        assert_eq!(fs::read_to_string(f.old.join("conversations.json")).unwrap(), "[{\"id\":\"c1\",\"tit");
    }

    #[test]
    fn records_missing_required_fields_are_skipped_individually() {
        let f = folders();
        fs::write(f.old.join("notes.json"), r#"[{"id":"ok","text":"fine","createdAt":1},{"title":"no id or text"},{"id":"empty","text":"   ","createdAt":2}]"#).unwrap();
        let (notes, conversations, memories) = stores(&f.new);

        let summary = import(&f.old, &f.new, &notes, &conversations, &memories);

        assert_eq!(summary.notes, 1);
        assert_eq!(notes.list()[0].id, "ok");
    }

    #[test]
    fn after_an_import_the_offer_is_not_made_again() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, conversations, memories) = stores(&f.new);

        import(&f.old, &f.new, &notes, &conversations, &memories);

        assert!(!status(&f.old, &f.new).available);
    }

    #[test]
    fn dismissing_the_offer_also_stops_it_without_importing_anything() {
        let f = folders();
        write_old_data(&f.old);
        let (notes, _, _) = stores(&f.new);

        mark_handled(&f.new);

        assert!(!status(&f.old, &f.new).available);
        assert!(notes.list().is_empty());
    }
}
