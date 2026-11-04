//! Stealth: hide Zara's windows from screen capture and screen sharing.
//!
//! This uses the Windows "exclude from capture" display affinity
//! (`WDA_EXCLUDEFROMCAPTURE`) on every Zara window. `docs/spikes/stealth.md`
//! records the measurements behind the decision: GDI, DXGI Desktop Duplication
//! and Windows Graphics Capture all return what is *behind* an excluded window,
//! and the flag works on layered (transparent) windows like the notch.
//!
//! What it does not do, and the README says so: it does not hide the process
//! from Task Manager, does not stop software that reads the flag, does not affect
//! a camera pointed at the screen, and does not cover native popups such as the
//! tray menu (those are separate windows).
//!
//! Design rules:
//! - `WDA_EXCLUDEFROMCAPTURE` needs Windows 10 build 19041 or newer. On older
//!   builds the closest flag paints the window black, which is worse than being
//!   visible, so stealth reports "unsupported" and never applies anything.
//! - Tao applies the flag but ignores the result, so every application is checked
//!   by reading the flag back. The status is "active" only if every window
//!   confirms it.
//! - The flag is per window and can be lost (a webview is recreated, the desktop
//!   compositor restarts). A watcher re-applies it, and windows created later are
//!   protected before they are first shown.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    WINDOW_DISPLAY_AFFINITY,
};

/// Settings key holding the user's choice (`"true"` / `"false"`).
pub const SETTING_KEY: &str = "zara-stealth-enabled";

/// The first Windows 10 build that understands `WDA_EXCLUDEFROMCAPTURE` (2004).
const MIN_SUPPORTED_BUILD: u32 = 19041;

/// Pause between re-assertion checks.
const WATCH_INTERVAL: Duration = Duration::from_secs(3);

static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

pub fn supports_exclude_from_capture(windows_build: u32) -> bool {
    windows_build >= MIN_SUPPORTED_BUILD
}

/// The Windows build number (for example 26300), read from the registry because
/// the usual version API reports a capped value to apps without a manifest entry.
fn windows_build_number() -> Option<u32> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    let mut buffer = [0u16; 16];
    let mut byte_length = std::mem::size_of_val(&buffer) as u32;
    unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut byte_length),
        )
        .ok()
        .ok()?;
    }
    let characters = (byte_length as usize / 2).saturating_sub(1);
    String::from_utf16_lossy(&buffer[..characters]).trim().parse().ok()
}

fn this_windows_supports_stealth() -> bool {
    windows_build_number().is_some_and(supports_exclude_from_capture)
}

/// How one window stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStatus {
    pub label: String,
    /// True when the window's flag matches what was asked for.
    pub as_requested: bool,
}

/// What the user sees in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StealthStatus {
    /// What the user asked for.
    pub requested: bool,
    /// Whether this version of Windows can do it.
    pub supported: bool,
    /// True only when it is requested, supported and every window confirms it.
    pub active: bool,
    /// Why it is not active although requested, in plain words.
    pub problem: Option<String>,
    pub windows: Vec<WindowStatus>,
}

/// Combines the per-window results into the one answer shown to the user.
/// "Active" is only claimed when every single window confirms the flag.
pub fn summarize(requested: bool, supported: bool, windows: Vec<WindowStatus>) -> StealthStatus {
    if !requested {
        return StealthStatus { requested, supported, active: false, problem: None, windows };
    }
    if !supported {
        return StealthStatus {
            requested,
            supported,
            active: false,
            problem: Some(
                "This version of Windows cannot hide windows from screen capture. Windows 10 version 2004 or newer is needed."
                    .into(),
            ),
            windows,
        };
    }
    let failed: Vec<&str> =
        windows.iter().filter(|w| !w.as_requested).map(|w| w.label.as_str()).collect();
    if failed.is_empty() {
        StealthStatus { requested, supported, active: true, problem: None, windows }
    } else {
        let problem = format!("Windows did not accept the setting for: {}.", failed.join(", "));
        StealthStatus { requested, supported, active: false, problem: Some(problem), windows }
    }
}

fn desired_affinity(enabled: bool) -> WINDOW_DISPLAY_AFFINITY {
    if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    }
}

/// Sets the flag on one window and confirms it by reading it back.
fn set_and_verify(hwnd: HWND, enabled: bool) -> bool {
    let wanted = desired_affinity(enabled);
    unsafe {
        let _ = SetWindowDisplayAffinity(hwnd, wanted);
        let mut actual = 0u32;
        GetWindowDisplayAffinity(hwnd, &mut actual).is_ok() && actual == wanted.0
    }
}

fn window_matches(hwnd: HWND, enabled: bool) -> bool {
    let mut actual = 0u32;
    unsafe { GetWindowDisplayAffinity(hwnd, &mut actual).is_ok() && actual == desired_affinity(enabled).0 }
}

fn requested(app: &AppHandle) -> bool {
    crate::utils::get_setting_str(app, SETTING_KEY).as_deref() == Some("true")
}

/// Applies the user's choice to every Zara window and reports the result.
/// With `supported == false` nothing is touched.
pub fn apply_to_all(app: &AppHandle, enabled: bool) -> StealthStatus {
    let supported = this_windows_supports_stealth();
    let mut windows = Vec::new();
    for (label, window) in app.webview_windows() {
        let as_requested = match window.hwnd() {
            Ok(hwnd) if supported || !enabled => set_and_verify(hwnd, enabled),
            _ => false,
        };
        windows.push(WindowStatus { label, as_requested });
    }
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    summarize(enabled, supported, windows)
}

/// Reports the current state without changing anything.
pub fn status(app: &AppHandle) -> StealthStatus {
    let enabled = requested(app);
    let supported = this_windows_supports_stealth();
    let mut windows: Vec<WindowStatus> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| WindowStatus {
            label,
            as_requested: window.hwnd().is_ok_and(|hwnd| window_matches(hwnd, enabled)),
        })
        .collect();
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    summarize(enabled, supported, windows)
}

/// Protects a window that was just created, before it is shown, so it never
/// appears in a capture even for one frame.
pub fn protect_new_window<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let enabled =
        crate::utils::get_setting_str(app, SETTING_KEY).as_deref() == Some("true");
    if enabled && this_windows_supports_stealth() {
        if let Ok(hwnd) = window.hwnd() {
            let _ = set_and_verify(hwnd, true);
        }
    }
}

/// Re-applies the flag to any window that lost it. Cheap when nothing changed.
pub fn reassert(app: &AppHandle) {
    if !requested(app) || !this_windows_supports_stealth() {
        return;
    }
    for (_, window) in app.webview_windows() {
        if let Ok(hwnd) = window.hwnd() {
            if !window_matches(hwnd, true) {
                let _ = set_and_verify(hwnd, true);
            }
        }
    }
}

/// Starts stealth if it was left on, and a watcher that keeps it on.
pub fn init(app: &AppHandle) {
    if requested(app) {
        let status = apply_to_all(app, true);
        crate::diagnostics::record("stealth_start", &format!("active={}", status.active));
    }
    if WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("zara-stealth-watch".into())
        .spawn(move || {
            while !crate::state::SHUTTING_DOWN.load(Ordering::Relaxed) {
                std::thread::sleep(WATCH_INTERVAL);
                reassert(&app);
            }
        })
        .ok();
}

/// Persists the user's choice and applies it everywhere. Returns the result so
/// the UI can show exactly what happened.
#[tauri::command]
pub fn stealth_set(app: AppHandle, enabled: bool) -> Result<StealthStatus, String> {
    crate::commands::save_setting(
        app.clone(),
        SETTING_KEY.to_string(),
        serde_json::Value::String(enabled.to_string()),
    )?;
    let result = apply_to_all(&app, enabled);
    crate::diagnostics::record("stealth_set", &format!("enabled={enabled} active={}", result.active));
    Ok(result)
}

#[tauri::command]
pub fn stealth_status(app: AppHandle) -> StealthStatus {
    status(&app)
}

/// Re-applies and re-reads the flag on every window, for the "Verify now" button.
#[tauri::command]
pub fn stealth_verify(app: AppHandle) -> StealthStatus {
    let enabled = requested(&app);
    apply_to_all(&app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(label: &str, as_requested: bool) -> WindowStatus {
        WindowStatus { label: label.into(), as_requested }
    }

    #[test]
    fn windows_before_build_19041_are_not_supported() {
        assert!(!supports_exclude_from_capture(18363));
        assert!(!supports_exclude_from_capture(19040));
    }

    #[test]
    fn windows_from_build_19041_are_supported() {
        assert!(supports_exclude_from_capture(19041));
        assert!(supports_exclude_from_capture(22631));
        assert!(supports_exclude_from_capture(26300));
    }

    #[test]
    fn this_machine_reports_a_plausible_build_number() {
        let build = windows_build_number().expect("the build number is in the registry");

        assert!(build >= 10_000, "got {build}");
    }

    #[test]
    fn it_is_active_only_when_requested_supported_and_every_window_confirms() {
        let status = summarize(true, true, vec![window("main", true), window("settings", true)]);

        assert!(status.active);
        assert_eq!(status.problem, None);
    }

    #[test]
    fn one_window_that_did_not_accept_the_flag_means_it_is_not_active() {
        let status = summarize(true, true, vec![window("main", true), window("overlay", false)]);

        assert!(!status.active);
        assert_eq!(status.problem.as_deref(), Some("Windows did not accept the setting for: overlay."));
    }

    #[test]
    fn several_failures_are_all_named() {
        let status = summarize(true, true, vec![window("main", false), window("overlay", false)]);

        assert_eq!(
            status.problem.as_deref(),
            Some("Windows did not accept the setting for: main, overlay.")
        );
    }

    #[test]
    fn an_unsupported_windows_version_is_explained_and_never_active() {
        let status = summarize(true, false, vec![window("main", true)]);

        assert!(!status.active);
        assert!(status.problem.unwrap().contains("Windows 10 version 2004"));
    }

    #[test]
    fn when_not_requested_there_is_nothing_to_report() {
        let status = summarize(false, true, vec![window("main", true)]);

        assert!(!status.active);
        assert_eq!(status.problem, None);
        assert!(!status.requested);
    }

    #[test]
    fn the_status_serializes_with_camel_case_fields_the_frontend_reads() {
        let value = serde_json::to_value(summarize(true, true, vec![window("main", true)])).unwrap();

        assert_eq!(value["active"], true);
        assert_eq!(value["windows"][0]["asRequested"], true);
    }

    /// Creates a real window and checks, with a real screen capture, that the
    /// flag hides it and that turning it off shows it again. It flashes a
    /// rectangle on screen, so it is not part of the normal run:
    /// `cargo test the_flag_hides_a_real_window -- --ignored`.
    #[test]
    #[ignore = "flashes a window on screen"]
    fn the_flag_hides_a_real_window_from_a_real_screen_capture() {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::{COLORREF, LPARAM, LRESULT, WPARAM};
        use windows::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject,
            GetDC, GetPixel, ReleaseDC, SelectObject, CAPTUREBLT, SRCCOPY,
        };
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW, RegisterClassW,
            ShowWindow, TranslateMessage, MSG, PM_REMOVE, SW_SHOWNOACTIVATE, WNDCLASSW, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
        };

        unsafe extern "system" fn proc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
            DefWindowProcW(h, m, w, l)
        }
        fn pump(milliseconds: u64) {
            let end = std::time::Instant::now() + Duration::from_millis(milliseconds);
            unsafe {
                while std::time::Instant::now() < end {
                    let mut message = MSG::default();
                    while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        fn screen_pixel(x: i32, y: i32) -> u32 {
            unsafe {
                let screen = GetDC(None);
                let memory = CreateCompatibleDC(Some(screen));
                let bitmap = CreateCompatibleBitmap(screen, 1920, 1080);
                let old = SelectObject(memory, bitmap.into());
                let _ = BitBlt(memory, 0, 0, 1920, 1080, Some(screen), 0, 0, SRCCOPY | CAPTUREBLT);
                let pixel = GetPixel(memory, x, y).0;
                SelectObject(memory, old);
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(memory);
                ReleaseDC(None, screen);
                pixel
            }
        }

        const MAGENTA: u32 = 0x00FF_00FF; // COLORREF is 0x00BBGGRR; magenta is symmetric
        unsafe {
            let instance = GetModuleHandleW(None).unwrap();
            let class = w!("ZaraStealthTest");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(proc),
                hInstance: instance.into(),
                lpszClassName: class,
                hbrBackground: CreateSolidBrush(COLORREF(MAGENTA)),
                ..Default::default()
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class,
                PCWSTR::null(),
                WS_POPUP | WS_VISIBLE,
                200,
                200,
                300,
                200,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .unwrap();
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            pump(500);

            assert_eq!(screen_pixel(350, 300), MAGENTA, "a normal window is visible to capture");

            assert!(set_and_verify(hwnd, true), "the flag must read back as applied");
            pump(500);
            assert_ne!(screen_pixel(350, 300), MAGENTA, "an excluded window must not appear in capture");

            assert!(set_and_verify(hwnd, false));
            pump(500);
            assert_eq!(screen_pixel(350, 300), MAGENTA, "turning stealth off shows the window again");

            let _ = DestroyWindow(hwnd);
        }
    }
}
