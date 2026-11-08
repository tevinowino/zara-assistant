//! Keeps "start with Windows" pointing at the copy of Zara that is installed.
//!
//! The autostart plugin writes the path of whichever Zara turned the setting
//! on into the `Run` registry key, under the name `Zara`, and its `is_enabled`
//! only asks whether that name exists, not where it points. A development
//! build that toggled the setting, or an install that moved, therefore leaves
//! an entry that Settings shows as on while Windows launches something else
//! (or nothing) at sign-in, and nothing ever corrects it. On each start of a
//! release build, this checks the entry and rewrites it when it points
//! elsewhere. A missing entry is left alone: the user turned the setting off.
//!
//! Development builds never repair, so running `tauri dev` cannot take the
//! entry away from the installed app.

use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/// Whether the registry command line `entry` launches the program at `exe`.
/// The command line is the program's path, quoted or not, optionally followed
/// by arguments. Case and slash direction do not matter on Windows.
fn entry_launches(entry: &str, exe: &Path) -> bool {
    let normalise = |text: &str| text.trim().replace('/', "\\").to_lowercase();
    let entry = normalise(entry);
    let exe = normalise(&exe.to_string_lossy());
    if let Some(quoted) = entry.strip_prefix('"') {
        return quoted.split('"').next() == Some(exe.as_str());
    }
    match entry.strip_prefix(exe.as_str()) {
        Some(after_path) => after_path.is_empty() || after_path.starts_with(' '),
        None => false,
    }
}

/// The command line stored under `name` in the current user's `Run` key.
fn read_run_entry(name: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_SZ, REG_VALUE_TYPE,
    };
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), None, KEY_READ, &mut key)
            .is_err()
        {
            return None;
        }
        let value_name = HSTRING::from(name);
        let mut value_type = REG_VALUE_TYPE::default();
        let mut size_in_bytes = 0u32;
        let sized = RegQueryValueExW(key, &value_name, None, Some(&mut value_type), None, Some(&mut size_in_bytes));
        let mut text = vec![0u16; size_in_bytes as usize / 2 + 1];
        let read = sized.is_ok()
            && value_type == REG_SZ
            && RegQueryValueExW(
                key,
                &value_name,
                None,
                Some(&mut value_type),
                Some(text.as_mut_ptr().cast()),
                Some(&mut size_in_bytes),
            )
            .is_ok();
        let _ = RegCloseKey(key);
        if !read {
            return None;
        }
        let length = text.iter().position(|&unit| unit == 0).unwrap_or(text.len());
        Some(String::from_utf16_lossy(&text[..length]))
    }
}

/// Points an existing autostart entry at the running program, if it points
/// elsewhere. Does nothing in a development build, when there is no entry, or
/// when the entry is already right.
pub fn point_at_this_copy(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let name = &app.package_info().name;
    let Some(entry) = read_run_entry(name) else {
        return;
    };
    if entry_launches(&entry, &exe) {
        return;
    }
    let repaired = app.autolaunch().enable().is_ok();
    crate::diagnostics::record(
        "autostart_repair",
        &format!("was={entry} now={} repaired={repaired}", exe.display()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn installed() -> PathBuf {
        PathBuf::from(r"C:\Users\tevoh\AppData\Local\Zara\zara.exe")
    }

    #[test]
    fn an_entry_for_the_installed_program_is_right() {
        assert!(entry_launches(r"C:\Users\tevoh\AppData\Local\Zara\zara.exe ", &installed()));
    }

    #[test]
    fn a_quoted_entry_for_the_installed_program_is_right() {
        assert!(entry_launches(
            r#""C:\Users\tevoh\AppData\Local\Zara\zara.exe" --background"#,
            &installed()
        ));
    }

    #[test]
    fn case_and_slash_direction_do_not_matter() {
        assert!(entry_launches(
            "c:/users/TEVOH/appdata/local/zara/ZARA.EXE",
            &installed()
        ));
    }

    #[test]
    fn an_entry_for_a_development_build_is_wrong() {
        assert!(!entry_launches(
            r"C:\Users\tevoh\Desktop\zara\src-tauri\target\debug\zara.exe ",
            &installed()
        ));
    }

    #[test]
    fn a_program_whose_path_only_starts_the_same_way_is_wrong() {
        assert!(!entry_launches(
            r"C:\Users\tevoh\AppData\Local\Zara\zara.exe.old",
            &installed()
        ));
    }

    #[test]
    fn a_path_with_spaces_is_matched_whole() {
        let exe = PathBuf::from(r"C:\Users\Jo Smith\AppData\Local\Zara\zara.exe");
        assert!(entry_launches(r"C:\Users\Jo Smith\AppData\Local\Zara\zara.exe ", &exe));
        assert!(!entry_launches(r"C:\Users\Jo\AppData\Local\Zara\zara.exe", &exe));
    }

    #[test]
    fn reads_nothing_for_a_name_that_is_not_in_the_run_key() {
        assert_eq!(read_run_entry("Zara-test-entry-that-does-not-exist"), None);
    }

    #[test]
    fn reads_an_entry_that_is_in_the_run_key() {
        // Every Windows account that has signed in has something in its Run key
        // in the test environment only by accident, so write one of our own.
        use windows::core::HSTRING;
        use windows::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let name = HSTRING::from("ZaraAutostartRepairTest");
        let data: Vec<u16> = r"C:\somewhere\zara.exe -x".encode_utf16().chain([0]).collect();
        unsafe {
            let mut key = HKEY::default();
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(RUN_KEY),
                None,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            )
            .ok()
            .unwrap();
            RegSetValueExW(
                key,
                &name,
                None,
                REG_SZ,
                Some(std::slice::from_raw_parts(data.as_ptr().cast(), data.len() * 2)),
            )
            .ok()
            .unwrap();
            let read = read_run_entry("ZaraAutostartRepairTest");
            let _ = RegDeleteValueW(key, &name);
            let _ = RegCloseKey(key);
            assert_eq!(read.as_deref(), Some(r"C:\somewhere\zara.exe -x"));
        }
    }
}
