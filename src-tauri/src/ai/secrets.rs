//! Where API keys live: the Windows Credential Manager, one entry per service
//! (target name `Zara / <account>`, with the account named by the service's entry
//! in `providers.rs`). A key is never written to settings.json, never logged,
//! and never sent to the webview (the frontend can only ask whether a key
//! exists, set one, or clear it).
//!
//! Each service has its own account, so a key can only be read back for, and so
//! only ever sent to, the service it belongs to. An earlier build's
//! `gemini-api-key` entry is ignored on purpose, for the same reason.

use super::llm::AiError;

const SERVICE: &str = "Zara";

/// Storage for API keys, addressed by account name.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, AiError>;
    fn set(&self, account: &str, value: &str) -> Result<(), AiError>;
    /// Removing a secret that is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), AiError>;
}

pub struct CredentialManagerStore {
    service: String,
}

impl CredentialManagerStore {
    pub fn new() -> Self {
        Self { service: SERVICE.to_string() }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, AiError> {
        keyring::Entry::new(&self.service, account).map_err(storage_error)
    }
}

/// The credential store's own error text can name internal details, so only a
/// fixed message reaches the user.
fn storage_error(_: keyring::Error) -> AiError {
    AiError::Other("Windows Credential Manager is unavailable, so the API key could not be stored.".into())
}

impl SecretStore for CredentialManagerStore {
    fn get(&self, account: &str) -> Result<Option<String>, AiError> {
        match self.entry(account)?.get_password() {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(storage_error(error)),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), AiError> {
        self.entry(account)?.set_password(value).map_err(storage_error)
    }

    fn delete(&self, account: &str) -> Result<(), AiError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(storage_error(error)),
        }
    }
}

#[cfg(test)]
pub struct InMemorySecretStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl InMemorySecretStore {
    pub fn empty() -> Self {
        Self(std::sync::Mutex::new(std::collections::HashMap::new()))
    }
}

#[cfg(test)]
impl SecretStore for InMemorySecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, AiError> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> Result<(), AiError> {
        self.0.lock().unwrap().insert(account.to_string(), value.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), AiError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_secret_reads_back_and_can_be_removed() {
        let store = InMemorySecretStore::empty();
        assert_eq!(store.get("openrouter-api-key").unwrap(), None);

        store.set("openrouter-api-key", "secret-value").unwrap();
        assert_eq!(store.get("openrouter-api-key").unwrap(), Some("secret-value".to_string()));

        store.delete("openrouter-api-key").unwrap();
        assert_eq!(store.get("openrouter-api-key").unwrap(), None);
        store.delete("openrouter-api-key").unwrap();
    }

    #[test]
    fn each_account_keeps_its_own_key() {
        let store = InMemorySecretStore::empty();
        store.set("openai-api-key", "sk-openai").unwrap();
        store.set("anthropic-api-key", "sk-anthropic").unwrap();

        assert_eq!(store.get("openai-api-key").unwrap(), Some("sk-openai".to_string()));
        assert_eq!(store.get("anthropic-api-key").unwrap(), Some("sk-anthropic".to_string()));
        assert_eq!(store.get("google-api-key").unwrap(), None);
    }

    /// Exercises the real Windows Credential Manager with a throwaway service name
    /// that is removed afterwards, so the user's real keys are never touched.
    #[test]
    fn the_credential_manager_round_trips_a_secret() {
        let store = CredentialManagerStore { service: format!("Zara-test-{}", uuid::Uuid::new_v4()) };

        assert_eq!(store.get("test-api-key").unwrap(), None);
        store.set("test-api-key", "k-\u{e9}-123").unwrap();
        assert_eq!(store.get("test-api-key").unwrap(), Some("k-\u{e9}-123".to_string()));
        store.set("test-api-key", "replaced").unwrap();
        assert_eq!(store.get("test-api-key").unwrap(), Some("replaced".to_string()));
        store.delete("test-api-key").unwrap();
        assert_eq!(store.get("test-api-key").unwrap(), None);
        store.delete("test-api-key").unwrap();
    }
}
