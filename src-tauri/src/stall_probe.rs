//! Finds out when the UI thread is too busy to answer, for chasing stutter.
//!
//! The UI thread runs the notch window's message loop, and every command
//! written as a plain `fn` runs on it. While it is busy with one thing it
//! cannot start another, so the notch's window updates and the answers to the
//! webview's requests wait. This probe asks the UI thread to run a trivial job
//! ten times a second and times how long that takes. A reply that takes longer
//! than `STALL_THRESHOLD` means the thread was busy for about that long, and
//! is written to the diagnostics log as `ui_stall wait_ms=<n>`.
//!
//! It only runs when the environment variable `ZARA_STALL_PROBE=1` is set, so
//! it works on a release build on the machine that stutters and costs nothing
//! otherwise.

use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const PROBE_INTERVAL: Duration = Duration::from_millis(100);

/// A reply slower than this counts as the UI thread being busy. A frame at
/// 60 Hz is about 16 ms, so 50 ms is three dropped frames.
const STALL_THRESHOLD: Duration = Duration::from_millis(50);

/// How long to wait for one reply before giving up on it, so a UI thread that
/// is hung outright is reported rather than waited on forever.
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

fn is_stall(wait: Duration) -> bool {
    wait >= STALL_THRESHOLD
}

/// Asks `schedule` to run a job on the UI thread and returns how long it took
/// to run, or `REPLY_TIMEOUT` if it never did. `schedule` is what hands the
/// job to the UI thread; passing it in keeps this testable without a window.
fn time_ui_thread_reply(schedule: impl FnOnce(Box<dyn FnOnce() + Send>)) -> Duration {
    let (done, replied) = mpsc::channel();
    let asked_at = Instant::now();
    schedule(Box::new(move || {
        let _ = done.send(());
    }));
    match replied.recv_timeout(REPLY_TIMEOUT) {
        Ok(()) => asked_at.elapsed(),
        Err(_) => REPLY_TIMEOUT,
    }
}

/// Starts the probe if `ZARA_STALL_PROBE=1`; does nothing otherwise.
pub fn start_if_requested(app: AppHandle) {
    if std::env::var("ZARA_STALL_PROBE").as_deref() != Ok("1") {
        return;
    }
    crate::diagnostics::record("stall_probe", "started");
    std::thread::Builder::new()
        .name("zara-stall-probe".into())
        .spawn(move || loop {
            std::thread::sleep(PROBE_INTERVAL);
            let wait = time_ui_thread_reply(|job| {
                let _ = app.run_on_main_thread(job);
            });
            if is_stall(wait) {
                crate::diagnostics::record("ui_stall", &format!("wait_ms={}", wait.as_millis()));
            }
        })
        .expect("Failed to start the stall probe");
}

/// Lets the webview add a line to the diagnostics log, for its own probes
/// (see src/diagnostics/framePacingProbe.ts). Cheap: a file append on a
/// blocking-pool thread.
#[tauri::command]
pub async fn record_diagnostic(event: String, detail: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        crate::diagnostics::record(&event, &detail);
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_that_takes_the_threshold_counts_as_a_stall() {
        assert!(is_stall(Duration::from_millis(50)));
    }

    #[test]
    fn a_reply_within_a_few_frames_is_not_a_stall() {
        assert!(!is_stall(Duration::from_millis(49)));
    }

    #[test]
    fn times_how_long_a_busy_ui_thread_takes_to_reply() {
        // A stand-in for a UI thread that is busy for 80 ms before it gets to the job.
        let busy_then_run = |job: Box<dyn FnOnce() + Send>| {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(80));
                job();
            });
        };

        let wait = time_ui_thread_reply(busy_then_run);

        assert!(wait >= Duration::from_millis(80), "waited only {wait:?}");
        assert!(is_stall(wait));
    }

    #[test]
    fn an_idle_ui_thread_replies_without_a_stall() {
        let run_at_once = |job: Box<dyn FnOnce() + Send>| job();

        let wait = time_ui_thread_reply(run_at_once);

        assert!(!is_stall(wait), "waited {wait:?}");
    }
}
