//! The apps installed on this PC, for choosing the favourites shown in the command center.
//!
//! They are read from the Start Menu's shortcuts: the current user's and the shared ones.
//! A shortcut is what `open_app` already launches, with its arguments and icon, so a chosen
//! app needs nothing more than the path of its shortcut.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// How deep into the Start Menu's folders (Microsoft Office, Visual Studio, ...) to look.
const MAX_DEPTH: usize = 4;

/// One installed app.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct InstalledApp {
    /// The name shown in the Start Menu.
    pub name: String,
    /// The path of its shortcut, which `open_app` launches.
    pub path: String,
}

/// Words that mark a Start Menu shortcut as something other than the app itself.
const NOT_AN_APP: &[&str] = &[
    "uninstall",
    "readme",
    "release notes",
    "license",
    "documentation",
    "user guide",
    "help",
];

/// The name to show for a shortcut called `file_stem`, or None for one that is not an app
/// (an uninstaller, a readme, a link to the documentation).
pub fn display_name(file_stem: &str) -> Option<String> {
    let name = file_stem.trim();
    if name.is_empty() {
        return None;
    }
    let lowered = name.to_lowercase();
    if NOT_AN_APP.iter().any(|word| lowered.contains(word)) {
        return None;
    }
    Some(name.to_string())
}

/// One entry per name (the first found wins, so the user's own shortcut beats a shared one),
/// sorted A to Z without regard to case.
pub fn merge_apps(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    let mut seen = std::collections::HashSet::new();
    let mut merged: Vec<InstalledApp> = apps
        .into_iter()
        .filter(|app| seen.insert(app.name.to_lowercase()))
        .collect();
    merged.sort_by_key(|app| app.name.to_lowercase());
    merged
}

fn collect(directory: &Path, depth: usize, found: &mut Vec<InstalledApp>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            if depth < MAX_DEPTH {
                collect(&path, depth + 1, found);
            }
            continue;
        }
        let is_shortcut = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"));
        if !is_shortcut {
            continue;
        }
        let Some(name) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(display_name)
        else {
            continue;
        };
        found.push(InstalledApp {
            name,
            path: path.to_string_lossy().into_owned(),
        });
    }
}

/// The apps found under `roots`, in order of the roots.
pub fn apps_under(roots: &[PathBuf]) -> Vec<InstalledApp> {
    let mut found = Vec::new();
    for root in roots {
        collect(root, 0, &mut found);
    }
    merge_apps(found)
}

fn start_menu_roots() -> Vec<PathBuf> {
    ["APPDATA", "ProgramData"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| {
            PathBuf::from(base)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
        })
        .collect()
}

/// Lists the installed apps, for the picker in Settings.
#[tauri::command]
pub async fn apps_list_installed() -> Vec<InstalledApp> {
    tauri::async_runtime::spawn_blocking(|| apps_under(&start_menu_roots()))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, path: &str) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            path: path.to_string(),
        }
    }

    #[test]
    fn shows_an_apps_own_name() {
        assert_eq!(display_name("Spotify"), Some("Spotify".to_string()));
    }

    #[test]
    fn trims_the_name() {
        assert_eq!(display_name("  Notepad  "), Some("Notepad".to_string()));
    }

    #[test]
    fn hides_an_empty_name() {
        assert_eq!(display_name("   "), None);
        assert_eq!(display_name(""), None);
    }

    #[test]
    fn hides_uninstallers_whatever_the_case() {
        assert_eq!(display_name("Uninstall Spotify"), None);
        assert_eq!(display_name("UNINSTALL"), None);
    }

    #[test]
    fn hides_documentation_links() {
        assert_eq!(display_name("Read Me"), Some("Read Me".to_string()));
        assert_eq!(display_name("README"), None);
        assert_eq!(display_name("Release Notes"), None);
        assert_eq!(display_name("Online Documentation"), None);
        assert_eq!(display_name("Python 3.12 Help"), None);
    }

    #[test]
    fn keeps_an_app_whose_name_only_resembles_a_hidden_word() {
        assert_eq!(display_name("Calendar"), Some("Calendar".to_string()));
        assert_eq!(display_name("Chrome"), Some("Chrome".to_string()));
    }

    #[test]
    fn lists_apps_a_to_z_without_regard_to_case() {
        let merged = merge_apps(vec![
            app("zoom", "z.lnk"),
            app("Calculator", "c.lnk"),
            app("alpha", "a.lnk"),
        ]);

        let names: Vec<_> = merged.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Calculator", "zoom"]);
    }

    #[test]
    fn lists_an_app_once_and_prefers_the_first_found() {
        let merged = merge_apps(vec![
            app("Discord", "user\\Discord.lnk"),
            app("discord", "shared\\Discord.lnk"),
        ]);

        assert_eq!(merged, vec![app("Discord", "user\\Discord.lnk")]);
    }

    #[test]
    fn finds_shortcuts_in_folders_and_ignores_other_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("Notepad.lnk"), b"").unwrap();
        std::fs::write(root.path().join("notes.txt"), b"").unwrap();
        std::fs::create_dir(root.path().join("Office")).unwrap();
        std::fs::write(root.path().join("Office").join("Word.LNK"), b"").unwrap();

        let apps = apps_under(&[root.path().to_path_buf()]);

        let names: Vec<_> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["Notepad", "Word"]);
    }

    #[test]
    fn leaves_out_uninstallers_found_on_disk() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("Spotify.lnk"), b"").unwrap();
        std::fs::write(root.path().join("Uninstall Spotify.lnk"), b"").unwrap();

        let apps = apps_under(&[root.path().to_path_buf()]);

        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "Spotify");
    }

    #[test]
    fn records_the_shortcut_path_to_launch() {
        let root = tempfile::tempdir().unwrap();
        let shortcut = root.path().join("Notepad.lnk");
        std::fs::write(&shortcut, b"").unwrap();

        let apps = apps_under(&[root.path().to_path_buf()]);

        assert_eq!(apps[0].path, shortcut.to_string_lossy());
    }

    #[test]
    fn does_not_look_deeper_than_the_limit() {
        let root = tempfile::tempdir().unwrap();
        let mut deep = root.path().to_path_buf();
        for level in 0..=(MAX_DEPTH + 1) {
            deep = deep.join(format!("level{level}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("TooDeep.lnk"), b"").unwrap();
        std::fs::write(root.path().join("Shallow.lnk"), b"").unwrap();

        let apps = apps_under(&[root.path().to_path_buf()]);

        let names: Vec<_> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["Shallow"]);
    }

    #[test]
    fn prefers_the_first_root_when_an_app_is_in_both() {
        let user = tempfile::tempdir().unwrap();
        let shared = tempfile::tempdir().unwrap();
        std::fs::write(user.path().join("Slack.lnk"), b"").unwrap();
        std::fs::write(shared.path().join("Slack.lnk"), b"").unwrap();

        let apps = apps_under(&[user.path().to_path_buf(), shared.path().to_path_buf()]);

        assert_eq!(apps.len(), 1);
        assert!(apps[0].path.starts_with(&*user.path().to_string_lossy()));
    }

    #[test]
    fn copes_with_a_folder_that_does_not_exist() {
        let apps = apps_under(&[PathBuf::from("C:\\this\\folder\\does\\not\\exist")]);

        assert!(apps.is_empty());
    }
}
