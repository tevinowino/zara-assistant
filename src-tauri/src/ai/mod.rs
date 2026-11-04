//! Zara's assistant.
//!
//! This module is the whole AI backend behind a small command surface; the
//! frontend never sees the model provider, files or Win32.
//!
//! ```text
//!   commands (this file)
//!      |
//!   chat  ---- the two-pass turn: protocol tags, model, screen, side effects
//!      |-- protocol      text tags and the system prompt (pure)
//!      |-- llm           LlmClient + the OpenRouter client (retry, errors)
//!      |-- capture       the screen, shrunk for the model
//!      |-- notes / memories / conversations   JSON-file stores (store.rs)
//!      '-- secrets       the API key, in Windows Credential Manager
//! ```
//!
//! Data lives in `%APPDATA%\com.zara.app\ai\`. Events sent to the frontend:
//! `ai-chat-status`, `ai-chat-reasoning`, `ai-notes-changed`, `ai-memories-changed`.

pub mod anthropic;
pub mod capture;
pub mod chat;
pub mod client;
pub mod conversations;
pub mod focus;
pub mod gemini;
pub mod llm;
pub mod memories;
pub mod migrate;
pub mod notes;
pub mod protocol;
pub mod providers;
pub mod secrets;
pub mod store;
pub mod tuning;
pub mod turns;

use capture::DesktopScreenCapturer;
use chat::{ChatOutcome, ChatSession, ChatStatus};
use conversations::{ConversationStore, ConversationSummary, StoredChatMessage, StoredConversation};
use client::{build_client, build_client_with_keys, ConfiguredClient, WithFallback};
use llm::{AiError, Turn};
use providers::{AiConfig, ProviderId};
use memories::{MemoryEntry, MemoryStore};
use notes::{Note, NoteColor, NotesStore};
use secrets::{CredentialManagerStore, SecretStore};
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Reads one saved setting by key (`zara-ai-provider` and so on).
type SettingsReader = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Everything the assistant owns, registered once as Tauri state.
pub struct AiState {
    /// The folder the stores live in; also holds the import marker.
    directory: std::path::PathBuf,
    notes: NotesStore,
    conversations: ConversationStore,
    memories: MemoryStore,
    secrets: Arc<dyn SecretStore>,
    settings: SettingsReader,
    /// Which question is being answered, so an older one cannot report into the newest.
    turns: turns::Turns,
}

impl AiState {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai");
        let handle = app.clone();
        let settings: SettingsReader = Arc::new(move |key| crate::utils::get_setting_str(&handle, key));
        Ok(Self::with_stores(&directory, Arc::new(CredentialManagerStore::new()), settings))
    }

    fn with_stores(directory: &Path, secrets: Arc<dyn SecretStore>, settings: SettingsReader) -> Self {
        Self {
            directory: directory.to_path_buf(),
            notes: NotesStore::open(directory),
            conversations: ConversationStore::open(directory),
            memories: MemoryStore::open(directory),
            secrets,
            settings,
            turns: turns::Turns::new(),
        }
    }

    /// What the user has chosen: the service, model, fallback and address.
    fn config(&self) -> AiConfig {
        AiConfig::from_settings(&*self.settings)
    }

    /// The stored key for a service, if there is one.
    fn key_for(&self, provider: ProviderId) -> Result<Option<String>, AiError> {
        self.secrets.get(providers::spec(provider).secret_account)
    }

    /// The service a command is about: the one it names, else the chosen one.
    fn provider_or_chosen(&self, provider: Option<ProviderId>) -> ProviderId {
        provider.unwrap_or_else(|| self.config().provider)
    }

    /// A model client for the chosen service, or `KeyMissing` so the UI can show
    /// the onboarding card.
    fn client(&self) -> Result<WithFallback<ConfiguredClient>, AiError> {
        let config = self.config();
        let key = self.key_for(config.provider)?;
        // A fallback on another service uses that service's key, if it has one.
        build_client_with_keys(&config, &|provider| {
            if provider == config.provider { key.clone() } else { self.key_for(provider).ok().flatten() }
        })
    }

    /// Whether the assistant may search the web: the user allows it (on unless
    /// turned off in Settings) and the chosen service can.
    fn web_search_enabled(&self) -> bool {
        let allowed = (self.settings)("zara-ai-web-search").is_none_or(|value| value != "false");
        allowed && providers::spec(self.config().provider).supports_web_search
    }
}

#[derive(Serialize)]
pub struct Success {
    success: bool,
}

#[derive(Serialize)]
pub struct GeneratedTitle {
    title: Option<String>,
}

fn notify_notes_changed(app: &AppHandle) {
    let _ = app.emit("ai-notes-changed", ());
}

fn notify_memories_changed(app: &AppHandle) {
    let _ = app.emit("ai-memories-changed", ());
}

/// Runs `work` against the assistant's state on a blocking-pool thread.
///
/// A plain `fn` command runs on the UI thread, which also runs the notch's
/// animations. The assistant's commands read the Windows Credential Manager
/// (one round trip per service), and rewrite and flush whole data files while
/// holding the store's lock, so every command that does either goes through
/// here: the UI thread then never waits on the disk, the credential store, or
/// another command's lock. A panic in `work` panics here too, as it would have
/// on the UI thread.
async fn on_blocking_thread<R, T, F>(app: tauri::AppHandle<R>, work: F) -> T
where
    R: tauri::Runtime,
    T: Send + 'static,
    F: FnOnce(&AiState) -> T + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(move || work(&app.state::<AiState>())).await {
        Ok(value) => value,
        Err(error) => panic!("assistant work did not finish: {error}"),
    }
}

// ---- service, model and key ---------------------------------------------

/// One service as the settings screen shows it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    id: ProviderId,
    label: &'static str,
    key_required: bool,
    base_url_editable: bool,
    default_base_url: &'static str,
    key_help_url: &'static str,
    supports_web_search: bool,
    default_model: &'static str,
    suggested_models: Vec<&'static str>,
    /// Whether a key is saved for it (not the key itself, which never leaves the backend).
    has_key: bool,
    /// What is saved for this service: its model (the default when none), its fallback
    /// model, and the address of a custom or local server.
    model: String,
    fallback_model: Option<String>,
    /// The service the fallback model is on, when it is not this one.
    fallback_provider: Option<ProviderId>,
    base_url: Option<String>,
    /// The saved request settings of each of its models, by model name (see `tuning`).
    tuning: serde_json::Map<String, serde_json::Value>,
}

/// The chosen service, and every service they can choose from with what is saved for each.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    provider: ProviderId,
    providers: Vec<ProviderInfo>,
}

#[tauri::command]
pub async fn ai_get_settings(app: AppHandle) -> Result<AiSettingsView, AiError> {
    on_blocking_thread(app, read_ai_settings).await
}

fn read_ai_settings(state: &AiState) -> Result<AiSettingsView, AiError> {
    let config = state.config();
    let providers = providers::all()
        .iter()
        .map(|spec| {
            let saved = AiConfig::for_provider(&*state.settings, spec.id);
            Ok(ProviderInfo {
                id: spec.id,
                label: spec.label,
                key_required: spec.key_required,
                base_url_editable: spec.base_url_editable,
                default_base_url: spec.base_url,
                key_help_url: spec.key_help_url,
                supports_web_search: spec.supports_web_search,
                default_model: spec.default_model(),
                suggested_models: spec.suggested_models.to_vec(),
                has_key: state.key_for(spec.id)?.is_some(),
                model: saved.model,
                fallback_model: saved.fallback_model,
                fallback_provider: saved.fallback_provider,
                base_url: saved.base_url,
                tuning: saved.tuning,
            })
        })
        .collect::<Result<Vec<_>, AiError>>()?;
    Ok(AiSettingsView { provider: config.provider, providers })
}

/// The settings a model accepts (how hard it thinks, how random it is, and so on),
/// each with the values it takes for that model.
#[tauri::command]
pub fn ai_get_model_controls(provider: ProviderId, model: String) -> Vec<tuning::ControlInfo> {
    tuning::describe(provider, &model)
}

/// Saves the settings chosen for one model of a service, replacing what was saved
/// for it. Anything the model does not accept is dropped; no values clears them.
#[tauri::command]
pub async fn ai_set_model_tuning(
    app: AppHandle,
    provider: ProviderId,
    model: String,
    values: serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let saving = app.clone();
    on_blocking_thread(app, move |state| {
        let key = tuning::setting_key(provider);
        let text =
            tuning::with_model_values((state.settings)(&key).as_deref(), provider, model.trim(), &values);
        crate::commands::save_setting(saving, key, serde_json::Value::String(text))
    })
    .await
}

/// Whether the service has what it needs to be used: a saved key, or nothing to
/// save because it is a local server.
#[tauri::command]
pub async fn ai_has_api_key(app: AppHandle, provider: Option<ProviderId>) -> Result<bool, AiError> {
    on_blocking_thread(app, move |state| {
        let provider = state.provider_or_chosen(provider);
        if !providers::spec(provider).key_required {
            return Ok(true);
        }
        Ok(state.key_for(provider)?.is_some())
    })
    .await
}

#[tauri::command]
pub async fn ai_set_api_key(
    app: AppHandle,
    provider: Option<ProviderId>,
    key: String,
) -> Result<(), AiError> {
    on_blocking_thread(app, move |state| {
        let key = key.trim();
        if key.is_empty() {
            return Err(AiError::KeyMissing);
        }
        let provider = state.provider_or_chosen(provider);
        state.secrets.set(providers::spec(provider).secret_account, key)
    })
    .await
}

#[tauri::command]
pub async fn ai_clear_api_key(app: AppHandle, provider: Option<ProviderId>) -> Result<(), AiError> {
    on_blocking_thread(app, move |state| {
        let provider = state.provider_or_chosen(provider);
        state.secrets.delete(providers::spec(provider).secret_account)
    })
    .await
}

/// Checks that a service works with a tiny request: the one named, else the one in
/// use. Settings checks a service it is showing, which need not be the one in use.
#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AiState>,
    provider: Option<ProviderId>,
) -> Result<(), AiError> {
    let provider = state.provider_or_chosen(provider);
    let config = AiConfig::for_provider(&*state.settings, provider);
    let key = state.key_for(provider)?;
    llm::test_connection(&build_client(&config, key)?).await
}

/// The models the service says it offers, best effort: a service that does not list
/// them is an error the UI can ignore, falling back to the suggestions.
#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AiState>,
    provider: Option<ProviderId>,
) -> Result<Vec<String>, AiError> {
    let mut config = state.config();
    config.provider = state.provider_or_chosen(provider);
    let key = state.key_for(config.provider)?;
    client::list_models(&config, key).await
}

// ---- chat ----------------------------------------------------------------

/// Stops the question being answered, if any. Its `ai_chat` returns `Cancelled`.
#[tauri::command]
pub fn ai_cancel_chat(state: State<'_, AiState>) {
    state.turns.stop();
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AiState>,
    message: String,
    history: Vec<Turn>,
) -> Result<ChatOutcome, AiError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AiError::Other("Type a message first.".into()));
    }
    let client = state.client()?;

    // Only one question is answered at a time: starting this one stops any other still
    // running, and an earlier question cannot report into this one's panel.
    let my_turn = state.turns.begin();
    let session = ChatSession {
        llm: &client,
        capture: &DesktopScreenCapturer,
        notes: &state.notes,
        memories: &state.memories,
        web_search: state.web_search_enabled(),
    };
    let status_app = app.clone();
    let text_app = app.clone();
    let reasoning_app = app.clone();
    let (status_turn, text_turn, reasoning_turn) = (my_turn.clone(), my_turn.clone(), my_turn.clone());
    let on_status = move |status: ChatStatus| {
        if status_turn.is_current() {
            let _ = status_app.emit("ai-chat-status", status.as_str());
        }
    };
    // The answer so far, so the panel can show it as it is written.
    let on_text = move |text: &str| {
        if text_turn.is_current() {
            let _ = text_app.emit("ai-chat-delta", text);
        }
    };
    // The model's own reasoning so far, for the panel's Thinking section.
    let on_reasoning = move |reasoning: &str| {
        if reasoning_turn.is_current() {
            let _ = reasoning_app.emit("ai-chat-reasoning", reasoning);
        }
    };
    let turn = session.run_with_reasoning(message, &history, &on_status, &on_text, &on_reasoning);
    let outcome = tokio::select! {
        outcome = turn => outcome?,
        // Dropping the turn here ends its request, so nothing more is paid for.
        () = my_turn.replaced() => return Err(AiError::Cancelled),
    };
    if !outcome.note_changes.is_empty() {
        notify_notes_changed(&app);
    }
    if !outcome.saved_memories.is_empty() {
        notify_memories_changed(&app);
    }
    Ok(outcome)
}

// ---- bringing data over from the Electron version ------------------------

#[tauri::command]
pub async fn legacy_import_status(app: AppHandle) -> migrate::LegacyStatus {
    on_blocking_thread(app, |state| match migrate::legacy_directory() {
        Some(source) => migrate::status(&source, &state.directory),
        None => migrate::LegacyStatus { available: false, notes: 0, conversations: 0, memories: 0 },
    })
    .await
}

#[tauri::command]
pub async fn legacy_import_run(app: AppHandle) -> Result<migrate::ImportSummary, String> {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let source = migrate::legacy_directory().ok_or("No earlier Zara data was found.")?;
        let summary =
            migrate::import(&source, &state.directory, &state.notes, &state.conversations, &state.memories);
        notify_notes_changed(&notifying);
        notify_memories_changed(&notifying);
        Ok(summary)
    })
    .await
}

/// "No thanks": stops the offer without importing anything.
#[tauri::command]
pub async fn legacy_import_dismiss(app: AppHandle) {
    on_blocking_thread(app, |state| migrate::mark_handled(&state.directory)).await
}

// ---- conversations -------------------------------------------------------

#[tauri::command]
pub async fn conv_list(app: AppHandle) -> Vec<ConversationSummary> {
    on_blocking_thread(app, |state| state.conversations.list()).await
}

#[tauri::command]
pub async fn conv_load(app: AppHandle, id: String) -> Option<StoredConversation> {
    on_blocking_thread(app, move |state| state.conversations.load(&id)).await
}

#[tauri::command]
pub async fn conv_save(
    app: AppHandle,
    id: String,
    messages: Vec<StoredChatMessage>,
) -> StoredConversation {
    on_blocking_thread(app, move |state| state.conversations.upsert(&id, messages)).await
}

#[tauri::command]
pub async fn conv_delete(app: AppHandle, id: String) -> Success {
    on_blocking_thread(app, move |state| Success { success: state.conversations.delete(&id) }).await
}

#[tauri::command]
pub async fn conv_rename(app: AppHandle, id: String, title: String) -> Success {
    on_blocking_thread(app, move |state| Success { success: state.conversations.rename(&id, &title) })
        .await
}

#[tauri::command]
pub async fn conv_generate_title(
    state: State<'_, AiState>,
    first_user_message: String,
    first_assistant_reply: String,
) -> Result<GeneratedTitle, AiError> {
    let title = llm::generate_title(&state.client()?, &first_user_message, &first_assistant_reply).await?;
    Ok(GeneratedTitle { title })
}

// ---- memories ------------------------------------------------------------

#[tauri::command]
pub async fn memory_list(app: AppHandle) -> Vec<MemoryEntry> {
    on_blocking_thread(app, |state| state.memories.list()).await
}

#[tauri::command]
pub async fn memory_add(app: AppHandle, text: String) -> Option<MemoryEntry> {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let added = state.memories.add(&text);
        if added.is_some() {
            notify_memories_changed(&notifying);
        }
        added
    })
    .await
}

#[tauri::command]
pub async fn memory_delete(app: AppHandle, id: String) -> Success {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let removed = state.memories.delete(&id);
        if removed {
            notify_memories_changed(&notifying);
        }
        Success { success: removed }
    })
    .await
}

// ---- notes ---------------------------------------------------------------

#[tauri::command]
pub async fn note_list(app: AppHandle) -> Vec<Note> {
    on_blocking_thread(app, |state| state.notes.list()).await
}

#[tauri::command]
pub async fn note_add(
    app: AppHandle,
    text: String,
    title: Option<String>,
    color: Option<NoteColor>,
) -> Option<Note> {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let added = state.notes.add(&text, title.as_deref(), color);
        if added.is_some() {
            notify_notes_changed(&notifying);
        }
        added
    })
    .await
}

#[tauri::command]
pub async fn note_update(
    app: AppHandle,
    id: String,
    text: String,
    title: Option<String>,
    color: Option<NoteColor>,
) -> Success {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let updated = state.notes.update(&id, &text, title.as_deref(), color);
        if updated {
            notify_notes_changed(&notifying);
        }
        Success { success: updated }
    })
    .await
}

#[tauri::command]
pub async fn note_delete(app: AppHandle, id: String) -> Success {
    let notifying = app.clone();
    on_blocking_thread(app, move |state| {
        let removed = state.notes.delete(&id);
        if removed {
            notify_notes_changed(&notifying);
        }
        Success { success: removed }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrets::InMemorySecretStore;
    use std::collections::HashMap;

    #[test]
    fn blocking_work_runs_off_the_thread_that_asked_for_it() {
        let app = tauri::test::mock_app();
        let directory = tempfile::tempdir().unwrap();
        let reader: SettingsReader = Arc::new(|_| None);
        app.manage(AiState::with_stores(
            directory.path(),
            Arc::new(InMemorySecretStore::empty()),
            reader,
        ));
        let asking_thread = std::thread::current().id();

        let working_thread = tauri::async_runtime::block_on(on_blocking_thread(
            app.handle().clone(),
            |_state| std::thread::current().id(),
        ));

        assert_ne!(working_thread, asking_thread);
    }

    #[test]
    fn blocking_work_sees_the_assistants_state() {
        let app = tauri::test::mock_app();
        let directory = tempfile::tempdir().unwrap();
        let reader: SettingsReader = Arc::new(|_| None);
        app.manage(AiState::with_stores(
            directory.path(),
            Arc::new(InMemorySecretStore::empty()),
            reader,
        ));

        let saved = tauri::async_runtime::block_on(on_blocking_thread(
            app.handle().clone(),
            |state| {
                state.conversations.upsert("chat-1", Vec::new());
                state.conversations.load("chat-1").is_some()
            },
        ));

        assert!(saved);
    }

    fn state_with(secrets: Arc<dyn SecretStore>, settings: &[(&str, &str)]) -> (tempfile::TempDir, AiState) {
        let directory = tempfile::tempdir().unwrap();
        let saved: HashMap<String, String> =
            settings.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect();
        let reader: SettingsReader = Arc::new(move |key| saved.get(key).cloned());
        let state = AiState::with_stores(directory.path(), secrets, reader);
        (directory, state)
    }

    #[test]
    fn without_a_stored_key_the_client_reports_it_as_missing() {
        let (_directory, state) = state_with(Arc::new(InMemorySecretStore::empty()), &[]);

        assert_eq!(state.client().err(), Some(AiError::KeyMissing));
    }

    #[test]
    fn with_a_stored_key_a_client_is_built() {
        let secrets = Arc::new(InMemorySecretStore::empty());
        secrets.set("openrouter-api-key", "sk-or-test-key").unwrap();
        let (_directory, state) = state_with(secrets, &[]);

        assert!(state.client().is_ok());
    }

    #[test]
    fn the_key_used_is_the_one_stored_for_the_chosen_service() {
        let secrets = Arc::new(InMemorySecretStore::empty());
        secrets.set("openrouter-api-key", "sk-or-test-key").unwrap();
        // Only OpenRouter has a key, but OpenAI is chosen: no key to send.
        let (_directory, state) = state_with(secrets, &[("zara-ai-provider", "openai")]);

        assert_eq!(state.client().err(), Some(AiError::KeyMissing));
    }

    #[test]
    fn a_service_with_its_own_key_works_once_chosen() {
        let secrets = Arc::new(InMemorySecretStore::empty());
        secrets.set("anthropic-api-key", "sk-ant-test").unwrap();
        let (_directory, state) = state_with(secrets, &[("zara-ai-provider", "anthropic")]);

        assert!(state.client().is_ok());
    }

    #[test]
    fn a_local_server_needs_no_stored_key() {
        let (_directory, state) =
            state_with(Arc::new(InMemorySecretStore::empty()), &[("zara-ai-provider", "ollama")]);

        assert!(state.client().is_ok());
    }

    #[test]
    fn web_search_needs_both_the_users_permission_and_a_service_that_can_do_it() {
        let secrets = || -> Arc<dyn SecretStore> { Arc::new(InMemorySecretStore::empty()) };
        let (_a, openrouter) = state_with(secrets(), &[]);
        let (_b, switched_off) = state_with(secrets(), &[("zara-ai-web-search", "false")]);
        let (_c, openai) = state_with(secrets(), &[("zara-ai-provider", "openai")]);

        assert!(openrouter.web_search_enabled());
        assert!(!switched_off.web_search_enabled());
        assert!(!openai.web_search_enabled());
    }

    #[test]
    fn a_command_with_no_service_named_is_about_the_chosen_one() {
        let (_directory, state) =
            state_with(Arc::new(InMemorySecretStore::empty()), &[("zara-ai-provider", "groq")]);

        assert_eq!(state.provider_or_chosen(None), ProviderId::Groq);
        assert_eq!(state.provider_or_chosen(Some(ProviderId::Mistral)), ProviderId::Mistral);
    }

    #[test]
    fn the_stores_live_in_the_directory_they_were_given() {
        let (directory, state) = state_with(Arc::new(InMemorySecretStore::empty()), &[]);

        state.notes.add("a note", None, None).unwrap();
        state.memories.add("a fact").unwrap();
        state.conversations.upsert("c", vec![]);

        for file in ["notes.json", "memories.json", "conversations.json"] {
            assert!(directory.path().join(file).exists(), "{file} should exist");
        }
    }
}
