//! A short history of text the user copied, for the Clipboard widget in the notch.
//!
//! Privacy is the point of the design:
//! - It only watches the clipboard while the widget is turned on, and turning it off wipes
//!   the history.
//! - It is kept in memory only. Nothing is written to disk, and it is gone when Zara quits.
//! - Text only, capped in length and count.
//! - A copy that the source marked as private is skipped: password managers set
//!   `ExcludeClipboardContentFromMonitorProcessing` (or `CanIncludeInClipboardHistory` = 0)
//!   on what they copy, and Windows' own clipboard history honours the same signals.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Most entries kept; the oldest is dropped first.
const MAX_ENTRIES: usize = 30;
/// Longest text kept for one entry, in characters; the rest is cut off.
const MAX_CHARS: usize = 10_000;
/// How often the clipboard's change counter is checked, which costs nothing while it is idle.
const POLL_INTERVAL: Duration = Duration::from_millis(400);

/// One thing that was copied.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: u64,
    pub text: String,
    /// Milliseconds since the Unix epoch.
    pub copied_at: i64,
}

/// The remembered copies, newest first.
#[derive(Default)]
pub struct ClipboardHistory {
    entries: VecDeque<ClipboardEntry>,
    next_id: u64,
}

impl ClipboardHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remembers `text` as the newest copy. Blank text is ignored, long text is cut to
    /// `MAX_CHARS`, copying what is already the newest changes nothing, and copying something
    /// remembered earlier moves it to the front instead of listing it twice. Returns whether
    /// the history changed.
    pub fn record(&mut self, text: &str, now_ms: i64) -> bool {
        if text.trim().is_empty() {
            return false;
        }
        let text: String = text.chars().take(MAX_CHARS).collect();
        if self.entries.front().is_some_and(|newest| newest.text == text) {
            return false;
        }
        self.entries.retain(|entry| entry.text != text);
        self.next_id += 1;
        self.entries.push_front(ClipboardEntry {
            id: self.next_id,
            text,
            copied_at: now_ms,
        });
        self.entries.truncate(MAX_ENTRIES);
        true
    }

    pub fn entries(&self) -> Vec<ClipboardEntry> {
        self.entries.iter().cloned().collect()
    }

    /// Forgets one entry. Returns whether it was there.
    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.id != id);
        self.entries.len() != before
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Whether a copy may be remembered, given what its source said about it:
/// `excluded_from_monitoring` is the presence of the "ExcludeClipboardContentFromMonitorProcessing"
/// format, and `can_include_in_history` the value of the "CanIncludeInClipboardHistory" format
/// when the source set one.
pub fn is_recordable(excluded_from_monitoring: bool, can_include_in_history: Option<u32>) -> bool {
    !excluded_from_monitoring && can_include_in_history != Some(0)
}

fn history() -> &'static Mutex<ClipboardHistory> {
    static HISTORY: OnceLock<Mutex<ClipboardHistory>> = OnceLock::new();
    HISTORY.get_or_init(|| Mutex::new(ClipboardHistory::new()))
}

/// The running clipboard watcher, if the widget is on.
fn monitor() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    static MONITOR: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    MONITOR.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(windows)]
mod win {
    use super::is_recordable;
    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
        OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    /// A number that changes whenever anything is copied; reading it does not open the clipboard.
    pub fn change_counter() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// Opens the clipboard, which another program may be using for a moment.
    fn open_with_retries() -> bool {
        for _ in 0..6 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        false
    }

    /// Reads the memory a clipboard handle points at, as UTF-16 text up to its terminator.
    unsafe fn text_from(handle: HANDLE) -> Option<String> {
        let memory = HGLOBAL(handle.0);
        let pointer = GlobalLock(memory) as *const u16;
        if pointer.is_null() {
            return None;
        }
        let capacity = GlobalSize(memory) / 2;
        let mut length = 0;
        while length < capacity && *pointer.add(length) != 0 {
            length += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
        let _ = GlobalUnlock(memory);
        Some(text)
    }

    /// The text on the clipboard, if there is some and its source allows it to be remembered.
    pub fn recordable_text() -> Option<String> {
        if !open_with_retries() {
            return None;
        }
        let result = unsafe {
            let excluded =
                IsClipboardFormatAvailable(RegisterClipboardFormatW(w!(
                    "ExcludeClipboardContentFromMonitorProcessing"
                )))
                .is_ok();
            let can_include_format = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
            let can_include = if IsClipboardFormatAvailable(can_include_format).is_ok() {
                GetClipboardData(can_include_format).ok().and_then(|handle| {
                    let memory = HGLOBAL(handle.0);
                    let pointer = GlobalLock(memory) as *const u32;
                    if pointer.is_null() {
                        return None;
                    }
                    let value = *pointer;
                    let _ = GlobalUnlock(memory);
                    Some(value)
                })
            } else {
                None
            };
            if !is_recordable(excluded, can_include)
                || IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_err()
            {
                None
            } else {
                GetClipboardData(CF_UNICODETEXT.0 as u32)
                    .ok()
                    .and_then(|handle| text_from(handle))
            }
        };
        unsafe {
            let _ = CloseClipboard();
        }
        result
    }
}

/// Starts or stops watching the clipboard. Turning it off also wipes the history.
#[tauri::command]
pub async fn clipboard_history_enable(app: AppHandle, enabled: bool) {
    let mut running = monitor().lock().unwrap_or_else(|e| e.into_inner());
    if enabled {
        if running.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        *running = Some(stop.clone());
        std::thread::spawn(move || watch(app, stop));
    } else {
        if let Some(stop) = running.take() {
            stop.store(true, Ordering::Relaxed);
        }
        history().lock().unwrap_or_else(|e| e.into_inner()).clear();
        let _ = app.emit("clipboard-history-changed", ());
    }
}

#[cfg(windows)]
fn watch(app: AppHandle, stop: Arc<AtomicBool>) {
    // What was already on the clipboard when the widget was turned on is not remembered.
    let mut last_seen = win::change_counter();
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL_INTERVAL);
        let counter = win::change_counter();
        if counter == last_seen {
            continue;
        }
        last_seen = counter;
        if let Some(text) = win::recordable_text() {
            let changed = history()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .record(&text, now_ms());
            if changed {
                let _ = app.emit("clipboard-history-changed", ());
            }
        }
    }
}

#[cfg(not(windows))]
fn watch(_app: AppHandle, _stop: Arc<AtomicBool>) {}

#[tauri::command]
pub async fn clipboard_history_list() -> Vec<ClipboardEntry> {
    history().lock().unwrap_or_else(|e| e.into_inner()).entries()
}

#[tauri::command]
pub async fn clipboard_history_remove(app: AppHandle, id: u64) {
    let removed = history().lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    if removed {
        let _ = app.emit("clipboard-history-changed", ());
    }
}

#[tauri::command]
pub async fn clipboard_history_clear(app: AppHandle) {
    history().lock().unwrap_or_else(|e| e.into_inner()).clear();
    let _ = app.emit("clipboard-history-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(history: &ClipboardHistory) -> Vec<String> {
        history.entries().into_iter().map(|entry| entry.text).collect()
    }

    #[test]
    fn remembers_what_was_copied_newest_first() {
        let mut history = ClipboardHistory::new();

        history.record("first", 1);
        history.record("second", 2);

        assert_eq!(texts(&history), vec!["second", "first"]);
    }

    #[test]
    fn records_when_each_copy_happened() {
        let mut history = ClipboardHistory::new();

        history.record("a", 1_000);

        assert_eq!(history.entries()[0].copied_at, 1_000);
    }

    #[test]
    fn ignores_blank_text() {
        let mut history = ClipboardHistory::new();

        assert!(!history.record("", 1));
        assert!(!history.record("   \n\t", 2));
        assert!(history.entries().is_empty());
    }

    #[test]
    fn does_not_list_the_newest_copy_twice() {
        let mut history = ClipboardHistory::new();
        history.record("same", 1);

        let changed = history.record("same", 2);

        assert!(!changed);
        assert_eq!(texts(&history), vec!["same"]);
        assert_eq!(history.entries()[0].copied_at, 1);
    }

    #[test]
    fn moves_an_older_copy_to_the_front_when_it_is_copied_again() {
        let mut history = ClipboardHistory::new();
        history.record("a", 1);
        history.record("b", 2);
        history.record("c", 3);

        let changed = history.record("a", 4);

        assert!(changed);
        assert_eq!(texts(&history), vec!["a", "c", "b"]);
        assert_eq!(history.entries()[0].copied_at, 4);
    }

    #[test]
    fn keeps_only_the_newest_thirty() {
        let mut history = ClipboardHistory::new();

        for number in 0..40 {
            history.record(&format!("copy {number}"), number);
        }

        let kept = texts(&history);
        assert_eq!(kept.len(), 30);
        assert_eq!(kept[0], "copy 39");
        assert_eq!(kept[29], "copy 10");
    }

    #[test]
    fn cuts_very_long_text() {
        let mut history = ClipboardHistory::new();

        history.record(&"x".repeat(25_000), 1);

        assert_eq!(history.entries()[0].text.chars().count(), 10_000);
    }

    #[test]
    fn cuts_long_text_on_a_character_boundary() {
        let mut history = ClipboardHistory::new();

        history.record(&"é".repeat(12_000), 1);

        assert_eq!(history.entries()[0].text.chars().count(), 10_000);
    }

    #[test]
    fn gives_each_entry_its_own_id() {
        let mut history = ClipboardHistory::new();
        history.record("a", 1);
        history.record("b", 2);

        let ids: Vec<u64> = history.entries().iter().map(|entry| entry.id).collect();

        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn forgets_one_entry() {
        let mut history = ClipboardHistory::new();
        history.record("a", 1);
        history.record("b", 2);
        let id_of_a = history.entries()[1].id;

        assert!(history.remove(id_of_a));

        assert_eq!(texts(&history), vec!["b"]);
    }

    #[test]
    fn reports_when_there_was_nothing_to_forget() {
        let mut history = ClipboardHistory::new();
        history.record("a", 1);

        assert!(!history.remove(999));
        assert_eq!(texts(&history), vec!["a"]);
    }

    #[test]
    fn forgets_everything() {
        let mut history = ClipboardHistory::new();
        history.record("a", 1);
        history.record("b", 2);

        history.clear();

        assert!(history.entries().is_empty());
    }

    #[test]
    fn remembers_an_ordinary_copy() {
        assert!(is_recordable(false, None));
    }

    #[test]
    fn skips_a_copy_the_source_excluded_from_monitoring() {
        assert!(!is_recordable(true, None));
    }

    #[test]
    fn skips_a_copy_the_source_said_may_not_be_in_history() {
        assert!(!is_recordable(false, Some(0)));
    }

    #[test]
    fn remembers_a_copy_the_source_said_may_be_in_history() {
        assert!(is_recordable(false, Some(1)));
    }
}
