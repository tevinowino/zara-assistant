//! Durable storage shared by the notes, conversations and memories stores.
//!
//! Each store keeps one JSON array in one file, read once at start-up and
//! rewritten after every change (the data is small text). The file format is
//! the same as Electron Zara's, so importing old data is a plain copy.
//!
//! Guarantees:
//! - A write never leaves a half-written file: the new content goes to a
//!   temporary file that is flushed to disk and then renamed over the old one.
//! - A file that is not a JSON array (truncated, hand-edited, wrong type) is
//!   moved aside to `<name>.corrupt-<unix ms>` instead of being silently
//!   overwritten, and the store starts empty. The user's data is never lost to
//!   a parse error.
//! - A single bad record does not discard its neighbours.

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Milliseconds since the Unix epoch. Injectable so tests control time.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    })
}

/// One JSON array stored in one file.
pub struct JsonArrayFile {
    path: PathBuf,
}

impl JsonArrayFile {
    pub fn new(directory: &Path, file_name: &str) -> Self {
        Self { path: directory.join(file_name) }
    }

    /// Reads the records. A missing file is an empty store; an unreadable one
    /// is quarantined (see the module docs).
    pub fn read<T: DeserializeOwned>(&self) -> Vec<T> {
        self.read_inner(true)
    }

    /// Reads the records from a file that belongs to someone else (another
    /// version of the app). It is never moved or changed, whatever it holds.
    pub fn read_only<T: DeserializeOwned>(&self) -> Vec<T> {
        self.read_inner(false)
    }

    fn read_inner<T: DeserializeOwned>(&self, quarantine_if_unreadable: bool) -> Vec<T> {
        let unreadable = |this: &Self| {
            if quarantine_if_unreadable {
                this.quarantine()
            } else {
                Vec::new()
            }
        };
        let raw = match fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(_) => return unreadable(self),
        };
        let text = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(serde_json::Value::Array(items)) => items
                .into_iter()
                .filter_map(|item| serde_json::from_value::<T>(item).ok())
                .collect(),
            _ => unreadable(self),
        }
    }

    fn quarantine<T>(&self) -> Vec<T> {
        let stamp = (system_clock())();
        let name = self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let aside = self.path.with_file_name(format!("{name}.corrupt-{stamp}"));
        let _ = fs::rename(&self.path, &aside);
        crate::diagnostics::record("ai_store_quarantined", &format!("file={name}"));
        Vec::new()
    }

    /// Replaces the file's content atomically.
    pub fn write<T: Serialize>(&self, items: &[T]) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(items).map_err(std::io::Error::other)?;
        {
            let mut file = fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        fs::rename(&temporary, &self.path)
    }

    /// Like `write`, but a failure is recorded (without any content) and the
    /// in-memory state stays authoritative; the next change retries.
    pub fn write_or_record<T: Serialize>(&self, items: &[T]) {
        if let Err(error) = self.write(items) {
            let name = self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            crate::diagnostics::record("ai_store_write_failed", &format!("file={name} error={error}"));
        }
    }
}

/// Collapses whitespace runs and shortens `text` to `max_chars` characters for
/// use as a one-line title. Returns `fallback` when nothing is left.
pub fn one_line_title(text: &str, max_chars: usize, fallback: &str) -> String {
    let single_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.is_empty() {
        return fallback.to_string();
    }
    if single_line.chars().count() > max_chars {
        let shortened: String = single_line.chars().take(max_chars).collect();
        return format!("{}\u{2026}", shortened.trim_end());
    }
    single_line
}

/// Cuts `text` to at most `max_chars` characters on a character boundary.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Item {
        id: u32,
        name: String,
    }

    #[test]
    fn a_missing_file_reads_as_an_empty_store() {
        let directory = tempfile::tempdir().unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read();

        assert!(items.is_empty());
    }

    #[test]
    fn written_records_read_back_identically() {
        let directory = tempfile::tempdir().unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");
        let items = vec![Item { id: 1, name: "tea".into() }, Item { id: 2, name: "caf\u{e9}".into() }];

        file.write(&items).unwrap();

        assert_eq!(file.read::<Item>(), items);
    }

    #[test]
    fn a_write_replaces_the_old_content_and_leaves_no_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");
        file.write(&[Item { id: 1, name: "old".into() }]).unwrap();

        file.write(&[Item { id: 2, name: "new".into() }]).unwrap();

        assert_eq!(file.read::<Item>(), vec![Item { id: 2, name: "new".into() }]);
        let leftovers: Vec<_> = fs::read_dir(directory.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, vec!["items.json".to_string()]);
    }

    #[test]
    fn a_truncated_file_is_moved_aside_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("items.json"), "[{\"id\":1,\"na").unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read();

        assert!(items.is_empty());
        let names: Vec<String> = fs::read_dir(directory.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 1);
        assert!(names[0].starts_with("items.json.corrupt-"), "got {names:?}");
        let preserved = fs::read_to_string(directory.path().join(&names[0])).unwrap();
        assert_eq!(preserved, "[{\"id\":1,\"na");
    }

    #[test]
    fn a_file_read_only_is_never_moved_even_when_it_is_corrupt() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("items.json"), "[{\"id\":1,\"na").unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read_only();

        assert!(items.is_empty());
        assert_eq!(fs::read_to_string(directory.path().join("items.json")).unwrap(), "[{\"id\":1,\"na");
    }

    #[test]
    fn a_file_holding_an_object_instead_of_an_array_is_quarantined() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("items.json"), "{\"id\":1}").unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read();

        assert!(items.is_empty());
        assert!(!directory.path().join("items.json").exists());
    }

    #[test]
    fn one_bad_record_does_not_discard_the_good_ones() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("items.json"),
            "[{\"id\":1,\"name\":\"a\"},{\"id\":\"oops\"},{\"id\":3,\"name\":\"c\"}]",
        )
        .unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read();

        assert_eq!(items, vec![Item { id: 1, name: "a".into() }, Item { id: 3, name: "c".into() }]);
    }

    #[test]
    fn a_byte_order_mark_does_not_make_a_file_unreadable() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("items.json"), "\u{feff}[{\"id\":1,\"name\":\"a\"}]").unwrap();
        let file = JsonArrayFile::new(directory.path(), "items.json");

        let items: Vec<Item> = file.read();

        assert_eq!(items, vec![Item { id: 1, name: "a".into() }]);
    }

    #[test]
    fn a_write_into_a_missing_folder_creates_it() {
        let directory = tempfile::tempdir().unwrap();
        let nested = directory.path().join("ai").join("data");
        let file = JsonArrayFile::new(&nested, "items.json");

        file.write(&[Item { id: 1, name: "a".into() }]).unwrap();

        assert_eq!(file.read::<Item>().len(), 1);
    }

    #[test]
    fn titles_collapse_whitespace_and_shorten_on_character_boundaries() {
        assert_eq!(one_line_title("  hello \n\t world  ", 60, "Untitled"), "hello world");
        assert_eq!(one_line_title("   ", 60, "Untitled"), "Untitled");
        assert_eq!(one_line_title("abcdef", 3, "Untitled"), "abc\u{2026}");
        assert_eq!(one_line_title("caf\u{e9} caf\u{e9}", 4, "Untitled"), "caf\u{e9}\u{2026}");
    }

    #[test]
    fn truncation_never_splits_a_character() {
        assert_eq!(truncate_chars("h\u{e9}llo", 2), "h\u{e9}");
        assert_eq!(truncate_chars("\u{1f389}\u{1f389}\u{1f389}", 2), "\u{1f389}\u{1f389}");
    }
}
