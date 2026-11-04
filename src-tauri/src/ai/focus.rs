//! Keyboard focus for the notch while the assistant is open.
//!
//! The notch window is deliberately non-activating, so clicking it never steals
//! focus from the app the user is working in. Typing a question needs the
//! opposite: the window must take focus when the assistant opens, and hand it
//! back to the app the user came from when it closes. Without the hand-back, the
//! user's own app would be left with no keyboard focus.
//!
//! Windows only lets a foreground-owning thread give the foreground away, so
//! taking focus attaches a thread's input to the current foreground thread for
//! the moment of the switch. That switch sends messages to the app being left
//! and waits for it, so it runs on a blocking-pool thread: if that app is busy,
//! only that thread waits, and the notch's UI thread keeps animating.

use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
};

/// The window that had focus before the assistant took it, 0 when none.
static PREVIOUS_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

/// Which window should get focus back: the one that had it, unless it no longer
/// exists or is Zara's own window (which would be a no-op loop).
pub fn focus_restore_target(previous: isize, own: isize, previous_still_exists: bool) -> Option<isize> {
    if previous == 0 || previous == own || !previous_still_exists {
        None
    } else {
        Some(previous)
    }
}

/// Makes `target` the foreground window even though another thread owns the
/// foreground, by attaching input queues for the duration of the call.
///
/// # Safety
/// Calls raw Win32 window and input APIs with a window handle owned by this app.
unsafe fn force_foreground(target: HWND) {
    let foreground = GetForegroundWindow();
    let this_thread = GetCurrentThreadId();
    let foreground_thread = if foreground.0.is_null() { 0 } else { GetWindowThreadProcessId(foreground, None) };
    let attached = foreground_thread != 0
        && foreground_thread != this_thread
        && AttachThreadInput(this_thread, foreground_thread, true).as_bool();
    let _ = BringWindowToTop(target);
    let _ = SetForegroundWindow(target);
    if attached {
        let _ = AttachThreadInput(this_thread, foreground_thread, false);
    }
}

/// Runs `force_foreground` for the window with handle value `target` on a
/// blocking-pool thread. The handle travels as an integer because a raw window
/// handle cannot be sent between threads.
async fn force_foreground_off_ui_thread(target: isize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        force_foreground(HWND(target as *mut _));
    })
    .await
    .map_err(|e| e.to_string())
}

/// Lets the notch take keyboard focus and moves focus to it, remembering which
/// window to return to.
#[tauri::command]
pub async fn ai_take_focus(window: WebviewWindow) -> Result<(), String> {
    // Kept as an integer: a raw window handle cannot be held across an await.
    let own_window = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let previous = unsafe { GetForegroundWindow() }.0 as isize;
    if previous != own_window {
        PREVIOUS_FOREGROUND.store(previous, Ordering::Relaxed);
    }
    // Asking tao (rather than editing the window style directly) keeps the
    // setting from being undone the next time tao rebuilds the window's style.
    window.set_focusable(true).map_err(|e| e.to_string())?;
    force_foreground_off_ui_thread(own_window).await?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Makes the notch non-activating again and gives focus back to the window the
/// user was in.
#[tauri::command]
pub async fn ai_release_focus(window: WebviewWindow) -> Result<(), String> {
    let own_window = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    window.set_focusable(false).map_err(|e| e.to_string())?;
    let previous = PREVIOUS_FOREGROUND.swap(0, Ordering::Relaxed);
    let exists = previous != 0 && unsafe { IsWindow(Some(HWND(previous as *mut _))).as_bool() };
    match focus_restore_target(previous, own_window, exists) {
        Some(target) => force_foreground_off_ui_thread(target).await,
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_returns_to_the_window_the_user_came_from() {
        assert_eq!(focus_restore_target(1234, 99, true), Some(1234));
    }

    #[test]
    fn focus_is_not_returned_when_nothing_had_it() {
        assert_eq!(focus_restore_target(0, 99, true), None);
    }

    #[test]
    fn focus_is_not_returned_to_a_window_that_has_since_closed() {
        assert_eq!(focus_restore_target(1234, 99, false), None);
    }

    #[test]
    fn focus_is_not_handed_back_to_zara_itself() {
        assert_eq!(focus_restore_target(99, 99, true), None);
    }
}
