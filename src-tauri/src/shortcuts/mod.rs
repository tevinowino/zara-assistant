//! Keyboard shortcuts: user-chosen, with a safe fallback.
//!
//! `policy` holds the rules (pure and tested). This file connects them to
//! Windows: it stores the user's choices, asks Windows to deliver the global
//! combinations, and tells the frontend what is in effect and why.
//!
//! Choices are stored as overrides only (`shortcuts.json`), so a default that
//! changes in a later release reaches anyone who never customised it. The
//! preferred combination is kept even when it cannot be used right now; it is
//! tried again at start-up, when Settings opens, and after the display or power
//! state changes, so a shortcut that was blocked by another app starts working
//! once that app lets go of it.
//!
//! Threading: Windows only lets the thread that owns the hotkey window register
//! hotkeys, and the manager is not thread-safe. So the manager lives in a
//! main-thread-only slot and every operation is run on the main thread.

pub mod policy;

use crate::ai::store::JsonArrayFile;
use global_hotkey::hotkey::{Code, HotKey, Modifiers as HotkeyModifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use policy::{claimed_from, message, resolve, spec_for, Accelerator, ActionSpec, Key, Named, Registrar, Scope, ACTIONS};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::thread::ThreadId;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Which action owns each registered hotkey, for the event handler.
static HOTKEY_ACTIONS: Mutex<Vec<(u32, &'static str)>> = Mutex::new(Vec::new());
static MAIN_THREAD: OnceLock<ThreadId> = OnceLock::new();

thread_local! {
    /// Only ever filled on the main thread (see `init`).
    static HOTKEYS: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredOverride {
    action: String,
    accelerator: String,
}

/// One action as the Settings list shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRow {
    pub action: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    pub default: &'static str,
    /// What the user asked for, if they changed it.
    pub preferred: Option<String>,
    /// What is in effect right now; `None` when nothing could be used.
    pub active: Option<String>,
    /// Why the first choice was not used, in plain words.
    pub message: Option<String>,
}

pub struct ShortcutManager {
    file: JsonArrayFile,
    overrides: Mutex<Vec<StoredOverride>>,
    rows: Mutex<Vec<ShortcutRow>>,
    registered: Mutex<Vec<HotKey>>,
}

fn hotkey_for(accelerator: &Accelerator) -> Option<HotKey> {
    let mut modifiers = HotkeyModifiers::empty();
    let m = accelerator.modifiers;
    if m.ctrl {
        modifiers |= HotkeyModifiers::CONTROL;
    }
    if m.alt {
        modifiers |= HotkeyModifiers::ALT;
    }
    if m.shift {
        modifiers |= HotkeyModifiers::SHIFT;
    }
    if m.win {
        modifiers |= HotkeyModifiers::SUPER;
    }
    let code_name = match accelerator.key {
        Key::Letter(c) => format!("Key{c}"),
        Key::Digit(d) => format!("Digit{d}"),
        Key::Function(n) => format!("F{n}"),
        Key::Named(named) => match named {
            Named::Up => "ArrowUp".to_string(),
            Named::Down => "ArrowDown".to_string(),
            Named::Left => "ArrowLeft".to_string(),
            Named::Right => "ArrowRight".to_string(),
            other => format!("{other:?}"),
        },
    };
    let code: Code = code_name.parse().ok()?;
    Some(HotKey::new(if modifiers.is_empty() { None } else { Some(modifiers) }, code))
}

/// Registers combinations with Windows on behalf of one action.
struct WindowsRegistrar<'a> {
    hotkeys: &'a GlobalHotKeyManager,
    action: &'static str,
    registered: &'a mut Vec<HotKey>,
}

impl Registrar for WindowsRegistrar<'_> {
    fn register(&mut self, accelerator: &Accelerator) -> Result<(), ()> {
        let hotkey = hotkey_for(accelerator).ok_or(())?;
        self.hotkeys.register(hotkey).map_err(|_| ())?;
        self.registered.push(hotkey);
        if let Ok(mut owners) = HOTKEY_ACTIONS.lock() {
            owners.push((hotkey.id(), self.action));
        }
        Ok(())
    }
}

/// Runs `work` on the main thread and waits for its result.
fn on_main_thread<T: Send + 'static>(app: &AppHandle, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    if MAIN_THREAD.get() == Some(&std::thread::current().id()) {
        return Some(work());
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(work());
    })
    .ok()?;
    receiver.recv_timeout(Duration::from_secs(5)).ok()
}

impl ShortcutManager {
    pub fn open(directory: &Path) -> Self {
        let file = JsonArrayFile::new(directory, "shortcuts.json");
        let overrides = file.read::<StoredOverride>();
        Self {
            file,
            overrides: Mutex::new(overrides),
            rows: Mutex::new(Vec::new()),
            registered: Mutex::new(Vec::new()),
        }
    }

    fn preferred_for(&self, spec: &ActionSpec) -> Option<Accelerator> {
        let overrides = self.overrides.lock().ok()?;
        overrides.iter().find(|o| o.action == spec.id).and_then(|o| o.accelerator.parse().ok())
    }

    /// Releases everything this app registered and decides again, action by
    /// action, what is in effect. Must run on the main thread.
    fn reconcile_on_main_thread(&self) -> Vec<ShortcutRow> {
        let mut registered = self.registered.lock().unwrap_or_else(|p| p.into_inner());
        let rows = HOTKEYS.with(|slot| {
            let slot = slot.borrow();
            let Some(hotkeys) = slot.as_ref() else {
                return self.rows();
            };
            for hotkey in registered.drain(..) {
                let _ = hotkeys.unregister(hotkey);
            }
            if let Ok(mut owners) = HOTKEY_ACTIONS.lock() {
                owners.clear();
            }

            let mut active: HashMap<&'static str, Accelerator> = HashMap::new();
            let mut rows = Vec::new();
            for spec in ACTIONS {
                let preferred = self.preferred_for(&spec);
                let mut registrar = WindowsRegistrar { hotkeys, action: spec.id, registered: &mut registered };
                let resolution = resolve(&spec, preferred, &claimed_from(&active), &mut registrar);
                if let Some(accelerator) = resolution.active {
                    active.insert(spec.id, accelerator);
                }
                rows.push(ShortcutRow {
                    action: spec.id,
                    label: spec.label,
                    scope: spec.scope,
                    default: spec.default,
                    preferred: preferred.map(|a| a.to_string()),
                    active: resolution.active.map(|a| a.to_string()),
                    message: resolution.unavailable.as_ref().map(|u| message(u, resolution.active.as_ref(), spec.label)),
                });
            }
            rows
        });
        *self.rows.lock().unwrap_or_else(|p| p.into_inner()) = rows.clone();
        rows
    }

    fn rows(&self) -> Vec<ShortcutRow> {
        self.rows.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn set_override(&self, action: &str, accelerator: Option<&Accelerator>) {
        let mut overrides = self.overrides.lock().unwrap_or_else(|p| p.into_inner());
        overrides.retain(|o| o.action != action);
        if let Some(accelerator) = accelerator {
            overrides.push(StoredOverride { action: action.to_string(), accelerator: accelerator.to_string() });
        }
        self.file.write_or_record(&overrides);
    }
}

/// Decides again what every action uses, on the main thread, and returns the result.
fn reconcile(app: &AppHandle) -> Vec<ShortcutRow> {
    let handle = app.clone();
    on_main_thread(app, move || handle.state::<ShortcutManager>().reconcile_on_main_thread()).unwrap_or_default()
}

/// Called by the hotkey window for every hotkey event.
fn on_hotkey(app: &AppHandle, event: GlobalHotKeyEvent) {
    if event.state != HotKeyState::Pressed {
        return;
    }
    let action = HOTKEY_ACTIONS
        .lock()
        .ok()
        .and_then(|owners| owners.iter().find(|(id, _)| *id == event.id).map(|(_, action)| *action));
    match action {
        Some("ai.settings") => crate::commands::open_settings_window(app.clone()),
        Some(other) => {
            let _ = app.emit("ai-shortcut", other);
        }
        None => {}
    }
}

/// Starts the shortcuts at launch. Must be called on the main thread (the setup
/// hook is).
pub fn init(app: &AppHandle) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai");
    let _ = MAIN_THREAD.set(std::thread::current().id());
    let hotkeys = GlobalHotKeyManager::new().map_err(|e| e.to_string())?;
    HOTKEYS.with(|slot| *slot.borrow_mut() = Some(hotkeys));
    let handler_app = app.clone();
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| on_hotkey(&handler_app, event)));

    app.manage(ShortcutManager::open(&directory));
    let rows = reconcile(app);
    let notices: Vec<&str> = rows.iter().filter_map(|row| row.message.as_deref()).collect();
    if !notices.is_empty() {
        crate::diagnostics::record("shortcut_fallback", &format!("count={}", notices.len()));
        let _ = app.emit("ai-shortcut-notice", notices);
    }
    Ok(())
}

/// Tries again for any shortcut whose first choice was unavailable, after the
/// display or power state changed.
pub fn retry_if_blocked(app: &AppHandle) {
    let Some(manager) = app.try_state::<ShortcutManager>() else { return };
    if manager.rows().iter().any(|row| row.message.is_some()) {
        reconcile(app);
    }
}

/// The shortcuts as Settings shows them. Also tries again for any that were
/// blocked, so opening Settings picks up a combination another app has released.
#[tauri::command]
pub fn shortcut_list(app: AppHandle) -> Vec<ShortcutRow> {
    reconcile(&app)
}

/// What is in effect now, keyed by action id, without changing anything. The
/// panel reads this to know its own (panel-only) shortcuts.
#[tauri::command]
pub fn shortcut_active(manager: State<'_, ShortcutManager>) -> HashMap<&'static str, String> {
    manager.rows().into_iter().filter_map(|row| row.active.map(|active| (row.action, active))).collect()
}

fn row_for(rows: Vec<ShortcutRow>, action: &str) -> Result<ShortcutRow, String> {
    rows.into_iter().find(|row| row.action == action).ok_or_else(|| "The shortcut could not be applied.".to_string())
}

/// Saves the user's choice for one action and reports what ended up in effect.
#[tauri::command]
pub fn shortcut_set(
    app: AppHandle,
    manager: State<'_, ShortcutManager>,
    action: String,
    accelerator: String,
) -> Result<ShortcutRow, String> {
    let spec = spec_for(&action).ok_or_else(|| format!("Unknown shortcut \"{action}\"."))?;
    let parsed: Accelerator = accelerator.parse().map_err(|e: policy::ParseError| e.0)?;
    manager.set_override(spec.id, Some(&parsed));
    row_for(reconcile(&app), spec.id)
}

/// Goes back to the default for one action.
#[tauri::command]
pub fn shortcut_reset(
    app: AppHandle,
    manager: State<'_, ShortcutManager>,
    action: String,
) -> Result<ShortcutRow, String> {
    let spec = spec_for(&action).ok_or_else(|| format!("Unknown shortcut \"{action}\"."))?;
    manager.set_override(spec.id, None);
    row_for(reconcile(&app), spec.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(text: &str) -> Accelerator {
        text.parse().unwrap()
    }

    #[test]
    fn every_key_the_policy_accepts_maps_to_a_hotkey_code() {
        for text in [
            "Ctrl+A", "Ctrl+Z", "Ctrl+0", "Ctrl+9", "F1", "F24", "Ctrl+Space", "Ctrl+Enter", "Ctrl+Tab", "Ctrl+Escape",
            "Ctrl+Backspace", "Ctrl+Delete", "Ctrl+Insert", "Ctrl+Home", "Ctrl+End", "Ctrl+PageUp", "Ctrl+PageDown",
            "Ctrl+Up", "Ctrl+Down", "Ctrl+Left", "Ctrl+Right", "Ctrl+Comma", "Ctrl+Period", "Ctrl+Slash",
            "Ctrl+Backslash", "Ctrl+Semicolon", "Ctrl+Quote", "Ctrl+Minus", "Ctrl+Equal", "Ctrl+BracketLeft",
            "Ctrl+BracketRight", "Ctrl+Backquote",
        ] {
            assert!(hotkey_for(&acc(text)).is_some(), "{text} has no hotkey code");
        }
    }

    #[test]
    fn modifiers_map_to_the_matching_hotkey_modifiers() {
        let hotkey = hotkey_for(&acc("Ctrl+Alt+Shift+Win+K")).unwrap();

        assert_eq!(hotkey.mods, HotkeyModifiers::CONTROL | HotkeyModifiers::ALT | HotkeyModifiers::SHIFT | HotkeyModifiers::SUPER);
        assert_eq!(hotkey.key, Code::KeyK);
    }

    #[test]
    fn a_bare_function_key_has_no_modifiers() {
        let hotkey = hotkey_for(&acc("F9")).unwrap();

        assert!(hotkey.mods.is_empty());
        assert_eq!(hotkey.key, Code::F9);
    }

    #[test]
    fn overrides_are_stored_only_for_actions_the_user_changed_and_survive_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        {
            let manager = ShortcutManager::open(directory.path());
            manager.set_override("ai.toggle", Some(&acc("ctrl+alt+q")));
        }

        let reopened = ShortcutManager::open(directory.path());

        assert_eq!(reopened.preferred_for(spec_for("ai.toggle").unwrap()), Some(acc("Ctrl+Alt+Q")));
        assert_eq!(reopened.preferred_for(spec_for("ai.settings").unwrap()), None);
        let raw = std::fs::read_to_string(directory.path().join("shortcuts.json")).unwrap();
        assert!(raw.contains("Ctrl+Alt+Q"), "stored in canonical form: {raw}");
        assert!(!raw.contains("ai.settings"));
    }

    #[test]
    fn resetting_an_action_removes_its_override() {
        let directory = tempfile::tempdir().unwrap();
        let manager = ShortcutManager::open(directory.path());
        manager.set_override("ai.toggle", Some(&acc("Ctrl+Alt+Q")));

        manager.set_override("ai.toggle", None);

        assert_eq!(manager.preferred_for(spec_for("ai.toggle").unwrap()), None);
    }

    #[test]
    fn a_stored_override_that_no_longer_parses_is_ignored_rather_than_breaking_startup() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("shortcuts.json"),
            r#"[{"action":"ai.toggle","accelerator":"Ctrl+Banana"}]"#,
        )
        .unwrap();

        let manager = ShortcutManager::open(directory.path());

        assert_eq!(manager.preferred_for(spec_for("ai.toggle").unwrap()), None);
    }
}
