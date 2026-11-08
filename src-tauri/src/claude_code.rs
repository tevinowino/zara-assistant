//! Claude Code activity for the notch: which of your Claude Code sessions are working, which
//! need you, and which have finished.
//!
//! How it works. Claude Code can run a command when things happen in a session (a "hook").
//! When the user connects Claude Code in Settings, Zara adds hooks to Claude Code's own
//! `settings.json` that run a small PowerShell script, `claude_code_hook.ps1`. For each event
//! the script appends one line, holding only the few fields the notch shows, to a spool file
//! in Zara's data folder. Zara reads new lines from that file, keeps the state of each session,
//! and tells the notch when something changes or needs attention.
//!
//! Why a file and not a local server: a listening port can be written to by any program on
//! the PC, or by a web page, so anyone could forge "Claude finished". A file in Zara's own
//! data folder cannot be reached that way. It also works when Zara is not running (the hooks
//! do nothing then) and never slows Claude Code (the hooks run in the background).
//!
//! Privacy:
//! - Nothing happens until the Claude Code widget is on and Claude Code is connected.
//! - The script keeps the event name, session id, project folder, a session title and, for a
//!   prompt that needs permission or a finished turn, the first few hundred characters of
//!   Claude's message. It never keeps the user's prompt, tool inputs or tool results.
//! - The state of the sessions is held in memory only. Turning the widget off deletes the spool
//!   file and forgets every session.
//! - Nothing leaves the PC.
//!
//! Connecting edits a file Zara does not own, so it asks first (Settings shows exactly what
//! will be added), keeps a copy of the original, adds only its own entries and leaves every
//! other setting and hook as it was. Disconnecting removes only Zara's entries.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

/// The file the hook script appends to, in Zara's data folder.
pub const SPOOL_FILE_NAME: &str = "claude-code-events.jsonl";
/// The hook script, as installed in Zara's data folder. Its name is also how Zara recognizes
/// its own entries in Claude Code's settings.
pub const HOOK_SCRIPT_FILE_NAME: &str = "claude-code-hook.ps1";
const HOOK_SCRIPT: &str = include_str!("claude_code_hook.ps1");
/// The Claude Code events Zara asks to hear about.
pub const HOOK_EVENTS: [&str; 5] =
    ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "SessionEnd"];

/// How often the spool file is checked for new lines.
const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Longest excerpt of Claude's message kept, in characters.
const MAX_EXCERPT_CHARS: usize = 200;
/// A session that was working but has been silent this long is shown as idle: Claude Code may
/// have been closed without saying so. In milliseconds.
const STALE_AFTER_MS: i64 = 15 * 60 * 1000;
/// A session silent this long is forgotten. In milliseconds.
const FORGET_AFTER_MS: i64 = 6 * 60 * 60 * 1000;
/// Most sessions shown; the least recently active are dropped.
const MAX_SESSIONS: usize = 12;
/// Most bytes read from the spool in one go.
const MAX_READ_BYTES: u64 = 256 * 1024;

// ---- reading one event -----------------------------------------------------------------------

/// What happened in a session, as far as the notch cares.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HookEvent {
    SessionStarted,
    PromptSubmitted,
    /// Claude is waiting on the user (a permission to give, a question to answer).
    NeedsInput { message: Option<String> },
    /// Claude has been waiting for the user for a while; the turn had already finished.
    WaitingIdle,
    /// Claude finished its turn.
    Finished { message: Option<String> },
    SessionEnded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedEvent {
    pub session_id: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub event: HookEvent,
}

#[derive(Deserialize)]
struct RawEvent {
    session_id: Option<String>,
    hook_event_name: Option<String>,
    cwd: Option<String>,
    notification_type: Option<String>,
    message: Option<String>,
    last_assistant_message: Option<String>,
    session_title: Option<String>,
}

fn excerpt(text: Option<String>) -> Option<String> {
    let text = text?;
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    if text.chars().count() <= MAX_EXCERPT_CHARS {
        return Some(text);
    }
    let kept: String = text.chars().take(MAX_EXCERPT_CHARS - 1).collect();
    Some(format!("{}…", kept.trim_end()))
}

/// Reads one line of the spool file. A line that is not an event Zara uses (damaged, from a
/// newer script, an event it does not follow) is `None`. Fields it does not know are ignored.
pub fn parse_hook_event(line: &str) -> Option<ParsedEvent> {
    let line = line.trim_start_matches('\u{feff}').trim();
    if line.is_empty() {
        return None;
    }
    let raw: RawEvent = serde_json::from_str(line).ok()?;
    let session_id = raw.session_id.filter(|id| !id.trim().is_empty())?;
    let event = match raw.hook_event_name.as_deref()? {
        "SessionStart" => HookEvent::SessionStarted,
        "UserPromptSubmit" => HookEvent::PromptSubmitted,
        "Notification" => match raw.notification_type.as_deref() {
            Some("permission_prompt") | Some("elicitation_dialog") => {
                HookEvent::NeedsInput { message: excerpt(raw.message) }
            }
            Some("idle_prompt") => HookEvent::WaitingIdle,
            _ => return None,
        },
        "Stop" => HookEvent::Finished { message: excerpt(raw.last_assistant_message) },
        "SessionEnd" => HookEvent::SessionEnded,
        _ => return None,
    };
    Some(ParsedEvent {
        session_id,
        cwd: raw.cwd.filter(|cwd| !cwd.trim().is_empty()),
        title: excerpt(raw.session_title),
        event,
    })
}

// ---- the sessions ----------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    /// Claude is working on a prompt.
    Working,
    /// Claude is waiting on the user.
    NeedsInput,
    /// Claude finished its last turn.
    Done,
    /// Nothing has been asked yet, or the session went quiet.
    Idle,
}

/// One session, as the notch shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub session_id: String,
    /// The folder's name, e.g. "zara" for `C:\Users\me\Desktop\zara`.
    pub project: String,
    pub title: Option<String>,
    pub state: SessionState,
    /// What Claude last said, cut short, when it is waiting or finished.
    pub excerpt: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub updated_at_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AlertKind {
    NeedsInput,
    Done,
}

/// Something worth interrupting the user for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub kind: AlertKind,
    pub session_id: String,
    pub project: String,
    pub excerpt: Option<String>,
}

struct Session {
    project: String,
    title: Option<String>,
    state: SessionState,
    excerpt: Option<String>,
    updated_at_ms: i64,
}

/// The folder name of a path written with either kind of slash.
fn project_name(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("Claude Code")
        .to_string()
}

/// What each Claude Code session is doing.
#[derive(Default)]
pub struct SessionBoard {
    sessions: HashMap<String, Session>,
}

impl SessionBoard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies one event. Returns an alert if it is something the user should be told about:
    /// Claude started waiting on them (once, not again while it keeps waiting), or finished.
    pub fn apply(&mut self, parsed: ParsedEvent, now_ms: i64) -> Option<Alert> {
        let ParsedEvent { session_id, cwd, title, event } = parsed;
        if event == HookEvent::SessionEnded {
            self.sessions.remove(&session_id);
            return None;
        }

        let session = self.sessions.entry(session_id.clone()).or_insert_with(|| Session {
            project: "Claude Code".to_string(),
            title: None,
            state: SessionState::Idle,
            excerpt: None,
            updated_at_ms: now_ms,
        });
        if let Some(cwd) = cwd {
            session.project = project_name(&cwd);
        }
        if title.is_some() {
            session.title = title;
        }
        session.updated_at_ms = now_ms;

        let alert = match event {
            HookEvent::SessionStarted => {
                session.state = SessionState::Idle;
                session.excerpt = None;
                None
            }
            HookEvent::PromptSubmitted => {
                session.state = SessionState::Working;
                session.excerpt = None;
                None
            }
            HookEvent::NeedsInput { message } => {
                let already_waiting = session.state == SessionState::NeedsInput;
                session.state = SessionState::NeedsInput;
                session.excerpt = message.clone();
                (!already_waiting).then_some((AlertKind::NeedsInput, message))
            }
            HookEvent::WaitingIdle => None,
            HookEvent::Finished { message } => {
                session.state = SessionState::Done;
                session.excerpt = message.clone();
                Some((AlertKind::Done, message))
            }
            HookEvent::SessionEnded => None,
        };
        let project = session.project.clone();
        self.forget_old_and_excess(now_ms);
        alert.map(|(kind, excerpt)| Alert { kind, session_id, project, excerpt })
    }

    fn forget_old_and_excess(&mut self, now_ms: i64) {
        self.sessions.retain(|_, session| now_ms - session.updated_at_ms <= FORGET_AFTER_MS);
        while self.sessions.len() > MAX_SESSIONS {
            let oldest = self
                .sessions
                .iter()
                .min_by_key(|(_, session)| session.updated_at_ms)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => self.sessions.remove(&id),
                None => break,
            };
        }
    }

    /// The sessions, most recently active first. A session that was working but has gone quiet
    /// for a long time is shown as idle.
    pub fn sessions(&self, now_ms: i64) -> Vec<SessionView> {
        let mut views: Vec<SessionView> = self
            .sessions
            .iter()
            .map(|(id, session)| {
                let quiet = now_ms - session.updated_at_ms > STALE_AFTER_MS;
                let state = if quiet && session.state == SessionState::Working {
                    SessionState::Idle
                } else {
                    session.state
                };
                SessionView {
                    session_id: id.clone(),
                    project: session.project.clone(),
                    title: session.title.clone(),
                    state,
                    excerpt: session.excerpt.clone(),
                    updated_at_ms: session.updated_at_ms,
                }
            })
            .collect();
        views.sort_by(|a, b| {
            b.updated_at_ms.cmp(&a.updated_at_ms).then_with(|| a.session_id.cmp(&b.session_id))
        });
        views
    }

    pub fn clear(&mut self) {
        self.sessions.clear();
    }
}

// ---- reading the spool file ------------------------------------------------------------------

/// Reads lines as they are appended to the spool file.
pub struct SpoolReader {
    path: PathBuf,
    offset: u64,
    /// The start of a line whose end has not been written yet.
    partial: Vec<u8>,
}

impl SpoolReader {
    /// Starts at the current end of the file: what is already in it happened before Zara was
    /// listening.
    pub fn at_end_of(path: &Path) -> Self {
        let offset = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        Self { path: path.to_path_buf(), offset, partial: Vec::new() }
    }

    /// The complete lines written since the last call. A file that has become shorter was
    /// emptied or replaced, so it is read from its start; a line still being written is kept
    /// until its end arrives.
    pub fn read_new_lines(&mut self) -> Vec<String> {
        let Ok(mut file) = std::fs::File::open(&self.path) else {
            return Vec::new();
        };
        let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        if length < self.offset {
            self.offset = 0;
            self.partial.clear();
        }
        if length == self.offset || file.seek(SeekFrom::Start(self.offset)).is_err() {
            return Vec::new();
        }
        let mut bytes = Vec::new();
        if file.take(MAX_READ_BYTES).read_to_end(&mut bytes).is_err() {
            return Vec::new();
        }
        self.offset += bytes.len() as u64;

        self.partial.extend_from_slice(&bytes);
        let mut lines = Vec::new();
        while let Some(end) = self.partial.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=end).collect();
            lines.push(String::from_utf8_lossy(&line[..line.len() - 1]).trim_end_matches('\r').to_string());
        }
        lines
    }
}

// ---- Claude Code's settings.json ---------------------------------------------------------------

/// Why Zara could not connect or disconnect.
#[derive(Debug, PartialEq, Eq)]
pub enum SettingsError {
    /// The settings file is not valid JSON, so Zara leaves it alone.
    NotJson(String),
    /// Something Zara needs to add to is there but is not what Claude Code expects
    /// (`hooks` is not an object, or an event's list is not a list).
    UnexpectedShape(String),
    Io(String),
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::NotJson(detail) => write!(
                f,
                "Claude Code's settings file is not valid JSON ({detail}), so Zara left it alone. Fix or remove it, then try again."
            ),
            SettingsError::UnexpectedShape(detail) => write!(
                f,
                "Claude Code's settings file has {detail}, which Zara does not know how to add to, so it left the file alone."
            ),
            SettingsError::Io(detail) => write!(f, "Zara could not read or write Claude Code's settings: {detail}"),
        }
    }
}

/// The command a Claude Code hook runs: PowerShell running Zara's script. Forward slashes work
/// in the path whether Claude Code runs the command from bash or from PowerShell.
pub fn hook_command(script_path: &Path) -> String {
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script_path.to_string_lossy().replace('\\', "/")
    )
}

fn is_zara_hook(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.contains(HOOK_SCRIPT_FILE_NAME))
}

fn group_has_zara_hook(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| hooks.iter().any(is_zara_hook))
}

/// The entry Zara adds for each event: runs the script in the background.
fn zara_group(command: &str) -> Value {
    json!({ "hooks": [{ "type": "command", "command": command, "async": true }] })
}

/// What connecting adds, for Settings to show before the user agrees.
pub fn hooks_preview(command: &str) -> String {
    let hooks: Map<String, Value> =
        HOOK_EVENTS.iter().map(|event| (event.to_string(), json!([zara_group(command)]))).collect();
    serde_json::to_string_pretty(&json!({ "hooks": hooks })).unwrap_or_default()
}

/// Adds Zara's hooks to the parsed settings, changing nothing else. Safe to repeat: an entry
/// already there is brought up to date (its command may name a moved script) and nothing is
/// added twice. Returns whether anything changed.
pub fn add_zara_hooks(settings: &mut Value, command: &str) -> Result<bool, SettingsError> {
    let root = settings
        .as_object_mut()
        .ok_or_else(|| SettingsError::UnexpectedShape("something other than an object at the top".into()))?;
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| SettingsError::UnexpectedShape("a \"hooks\" entry that is not an object".into()))?;

    let mut changed = false;
    for event in HOOK_EVENTS {
        let groups = hooks.entry(event).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or_else(|| {
            SettingsError::UnexpectedShape(format!("a \"{event}\" hooks entry that is not a list"))
        })?;
        let mut found = false;
        for group in groups.iter_mut() {
            let Some(group_hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            for hook in group_hooks.iter_mut().filter(|hook| is_zara_hook(hook)) {
                found = true;
                if hook.get("command").and_then(Value::as_str) != Some(command) {
                    hook["command"] = json!(command);
                    changed = true;
                }
                if hook.get("async") != Some(&json!(true)) {
                    hook["async"] = json!(true);
                    changed = true;
                }
            }
        }
        if !found {
            groups.push(zara_group(command));
            changed = true;
        }
    }
    Ok(changed)
}

/// Removes Zara's hooks, leaving everything else (other hooks in the same group included).
/// Empty groups, lists and a `hooks` entry that Zara emptied are removed too. Returns whether
/// anything changed.
pub fn remove_zara_hooks(settings: &mut Value) -> bool {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    for event in HOOK_EVENTS {
        let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) else {
            continue;
        };
        let before = groups.len();
        for group in groups.iter_mut() {
            if let Some(group_hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                let count = group_hooks.len();
                group_hooks.retain(|hook| !is_zara_hook(hook));
                changed |= group_hooks.len() != count;
            }
        }
        groups.retain(|group| {
            let emptied = group.get("hooks").and_then(Value::as_array).is_some_and(Vec::is_empty);
            !emptied
        });
        changed |= groups.len() != before;
        if groups.is_empty() {
            hooks.remove(event);
        }
    }
    if hooks.is_empty() && changed {
        if let Some(root) = settings.as_object_mut() {
            root.remove("hooks");
        }
    }
    changed
}

/// Whether every event Zara needs has Zara's hook.
pub fn is_connected(settings: &Value) -> bool {
    HOOK_EVENTS.iter().all(|event| {
        settings
            .get("hooks")
            .and_then(|hooks| hooks.get(event))
            .and_then(Value::as_array)
            .is_some_and(|groups| groups.iter().any(group_has_zara_hook))
    })
}

/// Where Claude Code keeps its user settings: `%USERPROFILE%\.claude\settings.json`, or inside
/// `CLAUDE_CONFIG_DIR` if that is set.
pub fn claude_settings_path() -> Option<PathBuf> {
    let directory = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(directory) if !directory.is_empty() => PathBuf::from(directory),
        _ => PathBuf::from(std::env::var_os("USERPROFILE")?).join(".claude"),
    };
    Some(directory.join("settings.json"))
}

fn read_settings(path: &Path) -> Result<(Value, bool), SettingsError> {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let text = text.trim_start_matches('\u{feff}');
            if text.trim().is_empty() {
                return Ok((json!({}), false));
            }
            let value = serde_json::from_str(text).map_err(|e| SettingsError::NotJson(e.to_string()))?;
            Ok((value, true))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((json!({}), false)),
        Err(error) => Err(SettingsError::Io(error.to_string())),
    }
}

fn write_settings(path: &Path, settings: &Value) -> Result<(), SettingsError> {
    let mut text = serde_json::to_string_pretty(settings).map_err(|e| SettingsError::Io(e.to_string()))?;
    text.push('\n');
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| SettingsError::Io(e.to_string()))?;
    }
    crate::utils::atomic_write_file(path, text.as_bytes()).map_err(SettingsError::Io)
}

/// Where the copy of the user's settings from before Zara first changed them is kept.
fn backup_path(settings_path: &Path) -> PathBuf {
    let mut name = settings_path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".zara-backup");
    settings_path.with_file_name(name)
}

/// Adds Zara's hooks to Claude Code's settings at `settings_path`. The file is read as JSON
/// first; if it cannot be, it is not touched. The first time, a copy of the file as it was is
/// kept beside it. Returns whether the file changed.
pub fn connect_at(settings_path: &Path, command: &str) -> Result<bool, SettingsError> {
    let (mut settings, existed) = read_settings(settings_path)?;
    let changed = add_zara_hooks(&mut settings, command)?;
    if !changed {
        return Ok(false);
    }
    let backup = backup_path(settings_path);
    if existed && !backup.exists() {
        std::fs::copy(settings_path, &backup).map_err(|e| SettingsError::Io(e.to_string()))?;
    }
    write_settings(settings_path, &settings)?;
    Ok(true)
}

/// Removes Zara's hooks from Claude Code's settings at `settings_path`. A missing file has
/// nothing to remove. Returns whether the file changed.
pub fn disconnect_at(settings_path: &Path) -> Result<bool, SettingsError> {
    let (mut settings, existed) = read_settings(settings_path)?;
    if !existed || !remove_zara_hooks(&mut settings) {
        return Ok(false);
    }
    write_settings(settings_path, &settings)?;
    Ok(true)
}

/// Whether the settings at `settings_path` have Zara's hooks. A missing or unreadable file is
/// not connected.
pub fn is_connected_at(settings_path: &Path) -> bool {
    read_settings(settings_path).is_ok_and(|(settings, _)| is_connected(&settings))
}

// ---- running it --------------------------------------------------------------------------------

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn board() -> &'static Mutex<SessionBoard> {
    static BOARD: OnceLock<Mutex<SessionBoard>> = OnceLock::new();
    BOARD.get_or_init(|| Mutex::new(SessionBoard::new()))
}

/// Bumped each time the widget is turned on or off, so a reader started earlier stops.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static READER_ACTIVE: AtomicBool = AtomicBool::new(false);

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn read_until_replaced(app: AppHandle, spool: PathBuf, generation: u64) {
    let mut reader = SpoolReader::at_end_of(&spool);
    while GENERATION.load(Ordering::SeqCst) == generation {
        let mut changed = false;
        for line in reader.read_new_lines() {
            let Some(parsed) = parse_hook_event(&line) else { continue };
            changed = true;
            let alert =
                board().lock().unwrap_or_else(|e| e.into_inner()).apply(parsed, now_ms());
            if let Some(alert) = alert {
                let _ = app.emit("claude-code-alert", alert);
            }
        }
        if changed {
            let _ = app.emit("claude-code-changed", ());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Turns the Claude Code widget's reading on or off. On: creates an empty spool file (the hook
/// script does nothing without it) and starts reading it. Off: stops, deletes the file and
/// forgets every session.
#[tauri::command]
pub async fn claude_code_enable(app: AppHandle, enabled: bool) -> Result<(), String> {
    let directory = data_dir(&app)?;
    let spool = directory.join(SPOOL_FILE_NAME);
    if !enabled {
        READER_ACTIVE.store(false, Ordering::SeqCst);
        GENERATION.fetch_add(1, Ordering::SeqCst);
        let _ = std::fs::remove_file(&spool);
        board().lock().unwrap_or_else(|e| e.into_inner()).clear();
        let _ = app.emit("claude-code-changed", ());
        return Ok(());
    }
    if READER_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let created = std::fs::create_dir_all(&directory).and_then(|_| std::fs::write(&spool, b""));
    if let Err(error) = created {
        READER_ACTIVE.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || read_until_replaced(app, spool, generation));
    Ok(())
}

/// The sessions Zara knows about, most recently active first.
#[tauri::command]
pub async fn claude_code_sessions() -> Vec<SessionView> {
    board().lock().unwrap_or_else(|e| e.into_inner()).sessions(now_ms())
}

/// Whether Claude Code is connected, for Settings.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub connected: bool,
    /// The path of Claude Code's settings file, for Settings to name.
    pub settings_path: Option<String>,
}

fn connection() -> Connection {
    let path = claude_settings_path();
    Connection {
        connected: path.as_deref().is_some_and(is_connected_at),
        settings_path: path.map(|path| path.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub async fn claude_code_connection() -> Connection {
    tauri::async_runtime::spawn_blocking(connection).await.unwrap_or(Connection {
        connected: false,
        settings_path: None,
    })
}

/// The JSON that connecting adds to Claude Code's settings, for the user to read first.
#[tauri::command]
pub async fn claude_code_hooks_preview(app: AppHandle) -> Result<String, String> {
    let script = data_dir(&app)?.join(HOOK_SCRIPT_FILE_NAME);
    Ok(hooks_preview(&hook_command(&script)))
}

/// Installs the hook script and adds Zara's hooks to Claude Code's settings.
#[tauri::command]
pub async fn claude_code_connect(app: AppHandle) -> Result<Connection, String> {
    let directory = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let script = directory.join(HOOK_SCRIPT_FILE_NAME);
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        std::fs::write(&script, HOOK_SCRIPT).map_err(|e| e.to_string())?;
        let settings = claude_settings_path()
            .ok_or_else(|| "Zara could not find where Claude Code keeps its settings.".to_string())?;
        connect_at(&settings, &hook_command(&script)).map_err(|e| e.to_string())?;
        Ok(connection())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Removes Zara's hooks from Claude Code's settings, and the hook script.
#[tauri::command]
pub async fn claude_code_disconnect(app: AppHandle) -> Result<Connection, String> {
    let directory = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(settings) = claude_settings_path() {
            disconnect_at(&settings).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(directory.join(HOOK_SCRIPT_FILE_NAME));
        Ok(connection())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(json: &str) -> ParsedEvent {
        parse_hook_event(json).expect("a line the parser should accept")
    }

    fn line(name: &str, extra: &str) -> String {
        format!(
            r#"{{"session_id":"s1","hook_event_name":"{name}","cwd":"C:\\Users\\me\\Desktop\\zara"{extra}}}"#
        )
    }

    fn parsed(session: &str, cwd: Option<&str>, event: HookEvent) -> ParsedEvent {
        ParsedEvent {
            session_id: session.to_string(),
            cwd: cwd.map(str::to_string),
            title: None,
            event,
        }
    }

    // ---- parse_hook_event

    #[test]
    fn reads_a_session_start() {
        let parsed = event(&line("SessionStart", ""));

        assert_eq!(parsed.session_id, "s1");
        assert_eq!(parsed.cwd.as_deref(), Some(r"C:\Users\me\Desktop\zara"));
        assert_eq!(parsed.event, HookEvent::SessionStarted);
    }

    #[test]
    fn reads_a_prompt_without_keeping_what_it_said() {
        let parsed = event(&line("UserPromptSubmit", r#","prompt":"my secret prompt""#));

        assert_eq!(parsed.event, HookEvent::PromptSubmitted);
        assert!(!format!("{parsed:?}").contains("secret"));
    }

    #[test]
    fn reads_a_permission_prompt_as_needing_the_user() {
        let parsed = event(&line(
            "Notification",
            r#","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash""#,
        ));

        assert_eq!(
            parsed.event,
            HookEvent::NeedsInput { message: Some("Claude needs your permission to use Bash".into()) }
        );
    }

    #[test]
    fn reads_a_question_dialog_as_needing_the_user() {
        let parsed = event(&line("Notification", r#","notification_type":"elicitation_dialog""#));

        assert_eq!(parsed.event, HookEvent::NeedsInput { message: None });
    }

    #[test]
    fn reads_an_idle_prompt_as_waiting() {
        let parsed = event(&line("Notification", r#","notification_type":"idle_prompt""#));

        assert_eq!(parsed.event, HookEvent::WaitingIdle);
    }

    #[test]
    fn ignores_a_notification_of_another_kind() {
        assert_eq!(parse_hook_event(&line("Notification", r#","notification_type":"auth_success""#)), None);
        assert_eq!(parse_hook_event(&line("Notification", "")), None);
    }

    #[test]
    fn reads_a_stop_with_what_claude_said() {
        let parsed = event(&line("Stop", r#","last_assistant_message":"All done.""#));

        assert_eq!(parsed.event, HookEvent::Finished { message: Some("All done.".into()) });
    }

    #[test]
    fn reads_a_stop_with_nothing_said() {
        let parsed = event(&line("Stop", r#","last_assistant_message":null"#));

        assert_eq!(parsed.event, HookEvent::Finished { message: None });
    }

    #[test]
    fn reads_a_session_end() {
        assert_eq!(event(&line("SessionEnd", "")).event, HookEvent::SessionEnded);
    }

    #[test]
    fn ignores_an_event_zara_does_not_follow() {
        assert_eq!(parse_hook_event(&line("PreToolUse", "")), None);
    }

    #[test]
    fn ignores_a_line_that_is_not_json() {
        assert_eq!(parse_hook_event("not json"), None);
        assert_eq!(parse_hook_event(""), None);
        assert_eq!(parse_hook_event("   "), None);
    }

    #[test]
    fn ignores_an_event_without_a_session() {
        assert_eq!(parse_hook_event(r#"{"hook_event_name":"Stop"}"#), None);
        assert_eq!(parse_hook_event(r#"{"session_id":"  ","hook_event_name":"Stop"}"#), None);
    }

    #[test]
    fn ignores_fields_it_does_not_know() {
        let parsed = event(&line("Stop", r#","a_future_field":{"x":1}"#));

        assert_eq!(parsed.event, HookEvent::Finished { message: None });
    }

    #[test]
    fn reads_a_line_that_starts_with_a_byte_order_mark() {
        let with_mark = format!("\u{feff}{}", line("SessionStart", ""));

        assert_eq!(event(&with_mark).event, HookEvent::SessionStarted);
    }

    #[test]
    fn keeps_a_session_title() {
        let parsed = event(&line("SessionStart", r#","session_title":"Fix the notch""#));

        assert_eq!(parsed.title.as_deref(), Some("Fix the notch"));
    }

    #[test]
    fn cuts_a_long_message_and_squeezes_its_spaces() {
        let long = format!("{}   tail", "word ".repeat(100));
        let json = format!(r#"{{"session_id":"s1","hook_event_name":"Stop","last_assistant_message":"{long}"}}"#);

        let HookEvent::Finished { message: Some(message) } = event(&json).event else {
            panic!("expected a finished event with a message");
        };

        assert_eq!(message.chars().count(), MAX_EXCERPT_CHARS);
        assert!(message.ends_with('…'));
        assert!(!message.contains("  "));
    }

    // ---- SessionBoard

    #[test]
    fn a_new_prompt_means_claude_is_working() {
        let mut board = SessionBoard::new();

        board.apply(parsed("s1", Some(r"C:\work\zara"), HookEvent::PromptSubmitted), 1_000);

        let sessions = board.sessions(1_000);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].state, SessionState::Working);
        assert_eq!(sessions[0].project, "zara");
    }

    #[test]
    fn names_the_project_after_its_folder_whatever_the_slashes() {
        assert_eq!(project_name(r"C:\Users\me\Desktop\zara"), "zara");
        assert_eq!(project_name("/home/me/zara/"), "zara");
        assert_eq!(project_name("C:\\"), "C:");
        assert_eq!(project_name(""), "Claude Code");
    }

    #[test]
    fn alerts_when_claude_starts_waiting_for_the_user() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", Some(r"C:\work\zara"), HookEvent::PromptSubmitted), 1_000);

        let alert = board.apply(
            parsed("s1", None, HookEvent::NeedsInput { message: Some("Allow Bash?".into()) }),
            2_000,
        );

        assert_eq!(
            alert,
            Some(Alert {
                kind: AlertKind::NeedsInput,
                session_id: "s1".into(),
                project: "zara".into(),
                excerpt: Some("Allow Bash?".into()),
            })
        );
        assert_eq!(board.sessions(2_000)[0].state, SessionState::NeedsInput);
    }

    #[test]
    fn does_not_alert_again_while_claude_keeps_waiting() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::NeedsInput { message: None }), 1_000);

        let again = board.apply(parsed("s1", None, HookEvent::NeedsInput { message: None }), 2_000);

        assert_eq!(again, None);
    }

    #[test]
    fn alerts_again_for_a_new_wait_after_working_resumed() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::NeedsInput { message: None }), 1_000);
        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 2_000);

        let again = board.apply(parsed("s1", None, HookEvent::NeedsInput { message: None }), 3_000);

        assert_eq!(again.map(|alert| alert.kind), Some(AlertKind::NeedsInput));
    }

    #[test]
    fn alerts_when_claude_finishes_and_keeps_what_it_said() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", Some(r"C:\work\zara"), HookEvent::PromptSubmitted), 1_000);

        let alert = board.apply(
            parsed("s1", None, HookEvent::Finished { message: Some("Fixed it.".into()) }),
            9_000,
        );

        assert_eq!(alert.map(|alert| alert.kind), Some(AlertKind::Done));
        let session = &board.sessions(9_000)[0];
        assert_eq!(session.state, SessionState::Done);
        assert_eq!(session.excerpt.as_deref(), Some("Fixed it."));
    }

    #[test]
    fn a_new_prompt_clears_what_claude_said_before() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::Finished { message: Some("Done.".into()) }), 1_000);

        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 2_000);

        assert_eq!(board.sessions(2_000)[0].excerpt, None);
    }

    #[test]
    fn an_idle_prompt_does_not_change_a_finished_session_or_alert() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::Finished { message: None }), 1_000);

        let alert = board.apply(parsed("s1", None, HookEvent::WaitingIdle), 61_000);

        assert_eq!(alert, None);
        assert_eq!(board.sessions(61_000)[0].state, SessionState::Done);
    }

    #[test]
    fn forgets_a_session_that_ends() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 1_000);

        board.apply(parsed("s1", None, HookEvent::SessionEnded), 2_000);

        assert!(board.sessions(2_000).is_empty());
    }

    #[test]
    fn tells_sessions_apart_and_lists_the_most_recent_first() {
        let mut board = SessionBoard::new();
        board.apply(parsed("old", Some("/a/first"), HookEvent::PromptSubmitted), 1_000);
        board.apply(parsed("new", Some("/a/second"), HookEvent::PromptSubmitted), 5_000);

        let projects: Vec<String> = board.sessions(5_000).into_iter().map(|s| s.project).collect();

        assert_eq!(projects, vec!["second", "first"]);
    }

    #[test]
    fn shows_a_session_that_went_quiet_while_working_as_idle() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 0);

        assert_eq!(board.sessions(STALE_AFTER_MS).first().map(|s| s.state), Some(SessionState::Working));
        assert_eq!(
            board.sessions(STALE_AFTER_MS + 1).first().map(|s| s.state),
            Some(SessionState::Idle)
        );
    }

    #[test]
    fn does_not_call_a_finished_session_idle_just_for_being_quiet() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::Finished { message: None }), 0);

        assert_eq!(board.sessions(STALE_AFTER_MS * 2)[0].state, SessionState::Done);
    }

    #[test]
    fn forgets_a_session_that_has_been_silent_for_hours() {
        let mut board = SessionBoard::new();
        board.apply(parsed("old", None, HookEvent::PromptSubmitted), 0);

        board.apply(parsed("new", None, HookEvent::PromptSubmitted), FORGET_AFTER_MS + 1);

        let ids: Vec<String> = board.sessions(FORGET_AFTER_MS + 1).into_iter().map(|s| s.session_id).collect();
        assert_eq!(ids, vec!["new"]);
    }

    #[test]
    fn keeps_at_most_twelve_sessions() {
        let mut board = SessionBoard::new();

        for index in 0..20 {
            board.apply(parsed(&format!("s{index}"), None, HookEvent::PromptSubmitted), index as i64);
        }

        let sessions = board.sessions(20);
        assert_eq!(sessions.len(), MAX_SESSIONS);
        assert_eq!(sessions[0].session_id, "s19");
    }

    #[test]
    fn learns_the_project_and_title_from_later_events() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 1_000);

        board.apply(
            ParsedEvent {
                session_id: "s1".into(),
                cwd: Some(r"C:\work\zara".into()),
                title: Some("Fix the notch".into()),
                event: HookEvent::WaitingIdle,
            },
            2_000,
        );

        let session = &board.sessions(2_000)[0];
        assert_eq!(session.project, "zara");
        assert_eq!(session.title.as_deref(), Some("Fix the notch"));
    }

    #[test]
    fn forgets_everything_when_cleared() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", None, HookEvent::PromptSubmitted), 1_000);

        board.clear();

        assert!(board.sessions(1_000).is_empty());
    }

    #[test]
    fn serializes_a_session_for_the_notch() {
        let mut board = SessionBoard::new();
        board.apply(parsed("s1", Some("/a/zara"), HookEvent::Finished { message: Some("ok".into()) }), 5);

        let json = serde_json::to_value(&board.sessions(5)[0]).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "sessionId": "s1", "project": "zara", "title": null,
                "state": "done", "excerpt": "ok", "updatedAtMs": 5
            })
        );
    }

    // ---- SpoolReader

    #[test]
    fn reads_only_what_is_appended_after_it_started() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spool.jsonl");
        std::fs::write(&path, "old line\n").unwrap();
        let mut reader = SpoolReader::at_end_of(&path);

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, b"new line\n").unwrap();

        assert_eq!(reader.read_new_lines(), vec!["new line"]);
    }

    #[test]
    fn reads_nothing_when_nothing_was_added() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spool.jsonl");
        std::fs::write(&path, "").unwrap();
        let mut reader = SpoolReader::at_end_of(&path);

        assert!(reader.read_new_lines().is_empty());
    }

    #[test]
    fn waits_for_the_end_of_a_line_that_is_still_being_written() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spool.jsonl");
        std::fs::write(&path, "").unwrap();
        let mut reader = SpoolReader::at_end_of(&path);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();

        std::io::Write::write_all(&mut file, b"first\nsecond, not fini").unwrap();
        assert_eq!(reader.read_new_lines(), vec!["first"]);
        std::io::Write::write_all(&mut file, b"shed\n").unwrap();

        assert_eq!(reader.read_new_lines(), vec!["second, not finished"]);
    }

    #[test]
    fn starts_again_from_the_top_when_the_file_is_emptied() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spool.jsonl");
        std::fs::write(&path, "a long first line that is read\n").unwrap();
        let mut reader = SpoolReader::at_end_of(&path);

        std::fs::write(&path, "short\n").unwrap();

        assert_eq!(reader.read_new_lines(), vec!["short"]);
    }

    #[test]
    fn reads_nothing_while_the_file_does_not_exist() {
        let directory = tempfile::tempdir().unwrap();
        let mut reader = SpoolReader::at_end_of(&directory.path().join("missing.jsonl"));

        assert!(reader.read_new_lines().is_empty());
    }

    #[test]
    fn reads_windows_line_endings_and_non_ascii_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spool.jsonl");
        std::fs::write(&path, "").unwrap();
        let mut reader = SpoolReader::at_end_of(&path);

        std::fs::write(&path, "café\r\nnaïve\r\n").unwrap();

        assert_eq!(reader.read_new_lines(), vec!["café", "naïve"]);
    }

    // ---- settings.json

    const COMMAND: &str = "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/data/claude-code-hook.ps1\"";

    #[test]
    fn builds_the_hook_command_with_forward_slashes() {
        let command = hook_command(Path::new(r"C:\Users\me\AppData\Roaming\com.zara.app\claude-code-hook.ps1"));

        assert_eq!(
            command,
            "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/me/AppData/Roaming/com.zara.app/claude-code-hook.ps1\""
        );
    }

    #[test]
    fn adds_a_background_hook_for_every_event_to_empty_settings() {
        let mut settings = json!({});

        let changed = add_zara_hooks(&mut settings, COMMAND).unwrap();

        assert!(changed);
        for event_name in HOOK_EVENTS {
            let hook = &settings["hooks"][event_name][0]["hooks"][0];
            assert_eq!(hook["type"], "command");
            assert_eq!(hook["command"], COMMAND);
            assert_eq!(hook["async"], true);
        }
        assert!(is_connected(&settings));
    }

    #[test]
    fn leaves_everything_else_in_the_settings_alone() {
        let mut settings = json!({
            "model": "opus",
            "permissions": { "allow": ["Bash(ls)"] },
            "hooks": { "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "echo hi" }] }] }
        });

        add_zara_hooks(&mut settings, COMMAND).unwrap();

        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["permissions"]["allow"][0], "Bash(ls)");
        assert_eq!(settings["hooks"]["PostToolUse"][0]["hooks"][0]["command"], "echo hi");
    }

    #[test]
    fn keeps_the_users_own_hooks_on_the_same_event_and_adds_beside_them() {
        let mut settings = json!({
            "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "play-sound.sh" }] }] }
        });

        add_zara_hooks(&mut settings, COMMAND).unwrap();

        let groups = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0]["hooks"][0]["command"], "play-sound.sh");
        assert_eq!(groups[1]["hooks"][0]["command"], COMMAND);
    }

    #[test]
    fn adds_nothing_twice() {
        let mut settings = json!({});
        add_zara_hooks(&mut settings, COMMAND).unwrap();
        let once = settings.clone();

        let changed = add_zara_hooks(&mut settings, COMMAND).unwrap();

        assert!(!changed);
        assert_eq!(settings, once);
    }

    #[test]
    fn brings_an_existing_entry_up_to_date_when_the_script_has_moved() {
        let mut settings = json!({});
        add_zara_hooks(&mut settings, "powershell -File \"C:/old/claude-code-hook.ps1\"").unwrap();

        let changed = add_zara_hooks(&mut settings, COMMAND).unwrap();

        assert!(changed);
        assert_eq!(settings["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(settings["hooks"]["Stop"][0]["hooks"][0]["command"], COMMAND);
    }

    #[test]
    fn refuses_settings_whose_hooks_are_not_an_object() {
        let mut settings = json!({ "hooks": ["nope"] });

        let result = add_zara_hooks(&mut settings, COMMAND);

        assert!(matches!(result, Err(SettingsError::UnexpectedShape(_))));
        assert_eq!(settings, json!({ "hooks": ["nope"] }));
    }

    #[test]
    fn refuses_an_event_whose_hooks_are_not_a_list() {
        let mut settings = json!({ "hooks": { "Stop": "nope" } });

        assert!(matches!(add_zara_hooks(&mut settings, COMMAND), Err(SettingsError::UnexpectedShape(_))));
    }

    #[test]
    fn refuses_settings_that_are_not_an_object() {
        let mut settings = json!([1, 2]);

        assert!(matches!(add_zara_hooks(&mut settings, COMMAND), Err(SettingsError::UnexpectedShape(_))));
    }

    #[test]
    fn removes_only_zaras_hooks() {
        let mut settings = json!({
            "model": "opus",
            "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "play-sound.sh" }] }] }
        });
        add_zara_hooks(&mut settings, COMMAND).unwrap();

        let changed = remove_zara_hooks(&mut settings);

        assert!(changed);
        assert_eq!(
            settings,
            json!({
                "model": "opus",
                "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "play-sound.sh" }] }] }
            })
        );
    }

    #[test]
    fn removes_a_zara_hook_that_shares_a_group_with_the_users() {
        let mut settings = json!({
            "hooks": { "Stop": [{ "hooks": [
                { "type": "command", "command": "mine.sh" },
                { "type": "command", "command": COMMAND, "async": true }
            ] }] }
        });

        remove_zara_hooks(&mut settings);

        assert_eq!(settings["hooks"]["Stop"][0]["hooks"], json!([{ "type": "command", "command": "mine.sh" }]));
    }

    #[test]
    fn removes_the_hooks_entry_when_zara_was_the_only_thing_in_it() {
        let mut settings = json!({ "model": "opus" });
        add_zara_hooks(&mut settings, COMMAND).unwrap();

        remove_zara_hooks(&mut settings);

        assert_eq!(settings, json!({ "model": "opus" }));
    }

    #[test]
    fn removing_changes_nothing_when_zara_was_never_connected() {
        let mut settings = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mine.sh" }] }] } });
        let before = settings.clone();

        let changed = remove_zara_hooks(&mut settings);

        assert!(!changed);
        assert_eq!(settings, before);
    }

    #[test]
    fn is_not_connected_when_an_event_is_missing() {
        let mut settings = json!({});
        add_zara_hooks(&mut settings, COMMAND).unwrap();
        settings["hooks"].as_object_mut().unwrap().remove("Stop");

        assert!(!is_connected(&settings));
    }

    #[test]
    fn previews_exactly_the_hooks_that_connecting_adds() {
        let mut settings = json!({});
        add_zara_hooks(&mut settings, COMMAND).unwrap();

        let preview: Value = serde_json::from_str(&hooks_preview(COMMAND)).unwrap();

        assert_eq!(preview, settings);
    }

    // ---- connecting to a file

    fn settings_file(contents: Option<&str>) -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        if let Some(contents) = contents {
            std::fs::write(&path, contents).unwrap();
        }
        (directory, path)
    }

    #[test]
    fn creates_the_settings_file_when_there_is_none() {
        let (_directory, path) = settings_file(None);

        let changed = connect_at(&path, COMMAND).unwrap();

        assert!(changed);
        assert!(is_connected_at(&path));
    }

    #[test]
    fn keeps_a_copy_of_the_settings_as_they_were() {
        let original = "{\n  \"model\": \"opus\"\n}\n";
        let (_directory, path) = settings_file(Some(original));

        connect_at(&path, COMMAND).unwrap();

        assert_eq!(std::fs::read_to_string(backup_path(&path)).unwrap(), original);
    }

    #[test]
    fn keeps_the_first_copy_when_connecting_again_after_a_change() {
        let original = "{ \"model\": \"opus\" }";
        let (_directory, path) = settings_file(Some(original));
        connect_at(&path, COMMAND).unwrap();
        disconnect_at(&path).unwrap();

        connect_at(&path, "powershell -File \"C:/moved/claude-code-hook.ps1\"").unwrap();

        assert_eq!(std::fs::read_to_string(backup_path(&path)).unwrap(), original);
    }

    #[test]
    fn writes_nothing_when_already_connected() {
        let (_directory, path) = settings_file(None);
        connect_at(&path, COMMAND).unwrap();
        let before = std::fs::read(&path).unwrap();

        let changed = connect_at(&path, COMMAND).unwrap();

        assert!(!changed);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn leaves_a_file_that_is_not_json_untouched() {
        let (_directory, path) = settings_file(Some("{ this is not json"));

        let result = connect_at(&path, COMMAND);

        assert!(matches!(result, Err(SettingsError::NotJson(_))));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ this is not json");
        assert!(!backup_path(&path).exists());
    }

    #[test]
    fn keeps_the_order_of_the_settings_keys() {
        let (_directory, path) =
            settings_file(Some("{\"zebra\":1,\"apple\":2,\"permissions\":{\"allow\":[]},\"model\":\"opus\"}"));

        connect_at(&path, COMMAND).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        let positions: Vec<usize> =
            ["\"zebra\"", "\"apple\"", "\"permissions\"", "\"model\"", "\"hooks\""]
                .iter()
                .map(|key| text.find(key).unwrap())
                .collect();
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]), "keys moved: {text}");
    }

    #[test]
    fn reads_a_settings_file_that_starts_with_a_byte_order_mark() {
        let (_directory, path) = settings_file(Some("\u{feff}{\"model\":\"opus\"}"));

        connect_at(&path, COMMAND).unwrap();

        assert!(is_connected_at(&path));
    }

    #[test]
    fn disconnects_by_removing_only_zaras_entries_from_the_file() {
        let (_directory, path) = settings_file(Some("{\"model\":\"opus\"}"));
        connect_at(&path, COMMAND).unwrap();

        let changed = disconnect_at(&path).unwrap();

        assert!(changed);
        assert!(!is_connected_at(&path));
        let settings: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(settings, json!({ "model": "opus" }));
    }

    #[test]
    fn disconnecting_a_missing_file_changes_nothing() {
        let (_directory, path) = settings_file(None);

        assert_eq!(disconnect_at(&path), Ok(false));
        assert!(!path.exists());
    }

    #[test]
    fn is_not_connected_without_a_settings_file() {
        let (_directory, path) = settings_file(None);

        assert!(!is_connected_at(&path));
    }

    #[test]
    fn names_the_backup_beside_the_settings_file() {
        assert_eq!(
            backup_path(Path::new(r"C:\Users\me\.claude\settings.json")),
            PathBuf::from(r"C:\Users\me\.claude\settings.json.zara-backup")
        );
    }

    #[test]
    fn the_installed_script_reads_the_spool_zara_creates() {
        assert!(HOOK_SCRIPT.contains("claude-code-events.jsonl"));
        assert!(HOOK_SCRIPT_FILE_NAME.ends_with(".ps1"));
    }
}
