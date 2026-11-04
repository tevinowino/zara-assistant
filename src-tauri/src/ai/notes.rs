//! The user's notes: a small scratchpad the assistant can also read and edit.
//!
//! Notes are numbered oldest-first everywhere (the UI list and the numbering
//! shown to the model), so "note 2" always means the same note in both places.

use super::store::{one_line_title, system_clock, truncate_chars, Clock, JsonArrayFile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// A generous ceiling, a safety net against unbounded growth.
const MAX_NOTES: usize = 300;
const TITLE_MAX_CHARS: usize = 60;
/// Longest note body accepted. Longer input is cut, not rejected, so pasted
/// text is never lost entirely.
pub const NOTE_MAX_CHARS: usize = 20_000;

/// A small fixed palette rather than a free-form colour, so arbitrary strings
/// from the user or the model never reach rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteColor {
    Yellow,
    Pink,
    Blue,
    Purple,
    Green,
}

const PALETTE: [NoteColor; 5] =
    [NoteColor::Yellow, NoteColor::Pink, NoteColor::Blue, NoteColor::Purple, NoteColor::Green];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub text: String,
    pub color: NoteColor,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A note as older versions wrote it: title and colour may be missing.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNote {
    id: String,
    #[serde(default)]
    title: Option<String>,
    text: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
}

fn parse_color(raw: &str) -> Option<NoteColor> {
    PALETTE.iter().copied().find(|color| {
        serde_json::to_value(color).ok().and_then(|v| v.as_str().map(|s| s == raw)).unwrap_or(false)
    })
}

fn derive_title(text: &str) -> String {
    one_line_title(text, TITLE_MAX_CHARS, "Untitled")
}

/// Notes written before titles and colours existed get both backfilled, the
/// colour round-robin by position, so every note the app sees has them.
fn with_backfill(stored: Vec<StoredNote>) -> Vec<Note> {
    stored
        .into_iter()
        .enumerate()
        .map(|(index, stored)| Note {
            title: stored.title.unwrap_or_else(|| derive_title(&stored.text)),
            color: stored.color.as_deref().and_then(parse_color).unwrap_or(PALETTE[index % PALETTE.len()]),
            id: stored.id,
            text: stored.text,
            created_at: stored.created_at,
            updated_at: stored.updated_at,
        })
        .collect()
}

/// Reads the notes in someone else's `notes.json` without touching the file.
pub fn read_notes_from(directory: &Path) -> Vec<Note> {
    with_backfill(JsonArrayFile::new(directory, "notes.json").read_only::<StoredNote>())
}

pub struct NotesStore {
    file: JsonArrayFile,
    notes: Mutex<Vec<Note>>,
    clock: Clock,
}

impl NotesStore {
    pub fn open(directory: &Path) -> Self {
        Self::open_with_clock(directory, system_clock())
    }

    pub fn open_with_clock(directory: &Path, clock: Clock) -> Self {
        let file = JsonArrayFile::new(directory, "notes.json");
        let notes = with_backfill(file.read::<StoredNote>());
        Self { file, notes: Mutex::new(notes), clock }
    }

    /// Adds notes written elsewhere (an earlier version), keeping their ids and
    /// dates. Notes whose id is already here are skipped, so importing twice
    /// changes nothing. Returns how many were added.
    pub fn import(&self, incoming: Vec<Note>) -> usize {
        let mut notes = self.lock();
        let mut added = 0;
        for mut note in incoming {
            if note.id.is_empty() || notes.iter().any(|existing| existing.id == note.id) {
                continue;
            }
            note.text = truncate_chars(note.text.trim(), NOTE_MAX_CHARS);
            if note.text.is_empty() {
                continue;
            }
            notes.push(note);
            added += 1;
        }
        if notes.len() > MAX_NOTES {
            notes.sort_by_key(|n| n.created_at);
            let excess = notes.len() - MAX_NOTES;
            notes.drain(..excess);
        }
        if added > 0 {
            self.file.write_or_record(&notes);
        }
        added
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Note>> {
        self.notes.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Oldest first; the order used to number notes for the model.
    pub fn list(&self) -> Vec<Note> {
        let mut notes = self.lock().clone();
        notes.sort_by_key(|note| note.created_at);
        notes
    }

    /// Adds a note. A blank `title` is derived from the text; a missing `color`
    /// rotates through the palette (notes created by the model never choose).
    /// Returns `None` for blank text.
    pub fn add(&self, text: &str, title: Option<&str>, color: Option<NoteColor>) -> Option<Note> {
        let text = truncate_chars(text.trim(), NOTE_MAX_CHARS);
        if text.is_empty() {
            return None;
        }
        let mut notes = self.lock();
        let now = (self.clock)();
        let note = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: title
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(|t| truncate_chars(t, TITLE_MAX_CHARS))
                .unwrap_or_else(|| derive_title(&text)),
            color: color.unwrap_or(PALETTE[notes.len() % PALETTE.len()]),
            text,
            created_at: now,
            updated_at: now,
        };
        notes.push(note.clone());
        if notes.len() > MAX_NOTES {
            notes.sort_by_key(|n| n.created_at);
            let excess = notes.len() - MAX_NOTES;
            notes.drain(..excess);
        }
        self.file.write_or_record(&notes);
        Some(note)
    }

    /// Replaces a note's text. `title` and `color` follow "`None` leaves it
    /// unchanged"; an explicit blank title is re-derived from the new text.
    /// Returns false (and changes nothing) for blank text or an unknown id: the
    /// model resolves a position to an id once per turn, and if the note has
    /// since changed, doing nothing is safer than editing whatever now sits at
    /// that position.
    pub fn update(&self, id: &str, text: &str, title: Option<&str>, color: Option<NoteColor>) -> bool {
        let text = truncate_chars(text.trim(), NOTE_MAX_CHARS);
        if text.is_empty() {
            return false;
        }
        let mut notes = self.lock();
        let Some(note) = notes.iter_mut().find(|n| n.id == id) else {
            return false;
        };
        if let Some(title) = title {
            let title = title.trim();
            note.title =
                if title.is_empty() { derive_title(&text) } else { truncate_chars(title, TITLE_MAX_CHARS) };
        }
        if let Some(color) = color {
            note.color = color;
        }
        note.text = text;
        note.updated_at = (self.clock)().max(note.created_at);
        self.file.write_or_record(&notes);
        true
    }

    /// Returns whether a note was removed.
    pub fn delete(&self, id: &str) -> bool {
        let mut notes = self.lock();
        let before = notes.len();
        notes.retain(|n| n.id != id);
        let removed = notes.len() != before;
        if removed {
            self.file.write_or_record(&notes);
        }
        removed
    }
}

/// The numbered list shown to the model, or an empty string for no notes. Takes
/// the snapshot as a parameter so the numbering shown to the model and the
/// numbering used to resolve its answer are the same list.
pub fn build_context_block(notes: &[Note]) -> String {
    if notes.is_empty() {
        return String::new();
    }
    let lines = notes
        .iter()
        .enumerate()
        .map(|(index, note)| format!("{}. \"{}\" \u{2014} {}", index + 1, note.title, note.text))
        .collect::<Vec<_>>()
        .join("\n");
    format!("The user's saved notes:\n{lines}")
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
    fn a_new_note_gets_a_title_from_its_first_line_and_the_first_palette_colour() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());

        let note = store.add("  Buy milk\nand eggs  ", None, None).unwrap();

        assert_eq!(note.title, "Buy milk and eggs");
        assert_eq!(note.text, "Buy milk\nand eggs");
        assert_eq!(note.color, NoteColor::Yellow);
    }

    #[test]
    fn colours_rotate_through_the_palette_for_notes_that_choose_none() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());

        let colours: Vec<NoteColor> =
            (0..6).map(|i| store.add(&format!("note {i}"), None, None).unwrap().color).collect();

        assert_eq!(
            colours,
            vec![
                NoteColor::Yellow,
                NoteColor::Pink,
                NoteColor::Blue,
                NoteColor::Purple,
                NoteColor::Green,
                NoteColor::Yellow
            ]
        );
    }

    #[test]
    fn blank_text_adds_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());

        assert!(store.add("   \n ", None, None).is_none());
        assert!(store.list().is_empty());
    }

    #[test]
    fn a_blank_explicit_title_falls_back_to_the_derived_one() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());

        let note = store.add("Call the dentist", Some("   "), Some(NoteColor::Blue)).unwrap();

        assert_eq!(note.title, "Call the dentist");
        assert_eq!(note.color, NoteColor::Blue);
    }

    #[test]
    fn notes_are_listed_oldest_first() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        store.add("first", None, None).unwrap();
        store.add("second", None, None).unwrap();
        store.add("third", None, None).unwrap();

        let texts: Vec<String> = store.list().into_iter().map(|n| n.text).collect();

        assert_eq!(texts, vec!["first", "second", "third"]);
    }

    #[test]
    fn updating_text_only_leaves_title_and_colour_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        let note = store.add("draft", Some("My title"), Some(NoteColor::Pink)).unwrap();

        let changed = store.update(&note.id, "final text", None, None);

        let updated = store.list().remove(0);
        assert!(changed);
        assert_eq!(updated.text, "final text");
        assert_eq!(updated.title, "My title");
        assert_eq!(updated.color, NoteColor::Pink);
        assert!(updated.updated_at > updated.created_at);
    }

    #[test]
    fn updating_with_a_blank_title_rederives_it_from_the_new_text() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        let note = store.add("draft", Some("Old title"), None).unwrap();

        store.update(&note.id, "Brand new text", Some(""), None);

        assert_eq!(store.list()[0].title, "Brand new text");
    }

    #[test]
    fn updating_or_deleting_an_unknown_note_changes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        store.add("keep me", None, None).unwrap();

        assert!(!store.update("no-such-id", "x", None, None));
        assert!(!store.delete("no-such-id"));
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn updating_to_blank_text_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        let note = store.add("keep me", None, None).unwrap();

        assert!(!store.update(&note.id, "  ", None, None));
        assert_eq!(store.list()[0].text, "keep me");
    }

    #[test]
    fn notes_survive_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        {
            let store = NotesStore::open_with_clock(directory.path(), counting_clock());
            store.add("remember this", None, Some(NoteColor::Green)).unwrap();
        }

        let reopened = NotesStore::open_with_clock(directory.path(), counting_clock());

        let notes = reopened.list();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text, "remember this");
        assert_eq!(notes[0].color, NoteColor::Green);
    }

    #[test]
    fn notes_from_before_titles_and_colours_existed_are_backfilled() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("notes.json"),
            r#"[{"id":"a","text":"Old note one","createdAt":1,"updatedAt":1},
                {"id":"b","text":"Old note two","color":"not-a-colour","createdAt":2,"updatedAt":2}]"#,
        )
        .unwrap();

        let notes = NotesStore::open_with_clock(directory.path(), counting_clock()).list();

        assert_eq!(notes[0].title, "Old note one");
        assert_eq!(notes[0].color, NoteColor::Yellow);
        assert_eq!(notes[1].title, "Old note two");
        assert_eq!(notes[1].color, NoteColor::Pink);
    }

    #[test]
    fn the_oldest_notes_are_dropped_beyond_the_ceiling() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        for i in 0..(MAX_NOTES + 3) {
            store.add(&format!("note {i}"), None, None).unwrap();
        }

        let notes = store.list();

        assert_eq!(notes.len(), MAX_NOTES);
        assert_eq!(notes[0].text, "note 3");
    }

    #[test]
    fn very_long_text_is_cut_not_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());

        let note = store.add(&"x".repeat(NOTE_MAX_CHARS + 500), None, None).unwrap();

        assert_eq!(note.text.chars().count(), NOTE_MAX_CHARS);
    }

    #[test]
    fn the_context_block_numbers_notes_from_one() {
        let directory = tempfile::tempdir().unwrap();
        let store = NotesStore::open_with_clock(directory.path(), counting_clock());
        store.add("Milk and eggs", Some("Shopping"), None).unwrap();
        store.add("Dentist at 3", None, None).unwrap();

        let block = build_context_block(&store.list());

        assert_eq!(
            block,
            "The user's saved notes:\n1. \"Shopping\" \u{2014} Milk and eggs\n2. \"Dentist at 3\" \u{2014} Dentist at 3"
        );
        assert_eq!(build_context_block(&[]), "");
    }
}
