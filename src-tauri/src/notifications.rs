//! Windows notifications, mirrored to the notch.
//!
//! When another app raises a toast, the notch can show it as a pill. Windows lets an app read
//! the toasts in the Action Center through `UserNotificationListener`, once the user allows it
//! (Settings, Privacy & security, Notifications). Measured on this setup with an unpackaged
//! build like Zara's: access is granted, but the listener's change event fails to subscribe
//! (error 0x80070490), so the toasts are polled instead. A new toast shows up within about a
//! second.
//!
//! Privacy is the point of the design:
//! - Nothing is read until the user turns the feature on in Settings, and turning it off
//!   stops the reading at once.
//! - What is read is held in memory only, and only long enough to be sent to the notch window.
//!   Nothing is written to disk, logged or sent anywhere else.
//! - The toasts already in the Action Center when the feature is turned on are not replayed;
//!   only toasts that arrive afterwards are sent.
//! - Zara's own notifications are skipped.
//! - Which apps may show a pill, and whether the text is shown, are the user's choices in
//!   Settings; the notch applies them before drawing anything.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// How often the Action Center is read. Costs little: it is a short in-process call.
const POLL_INTERVAL: Duration = Duration::from_millis(750);
/// Longest body kept, in characters; the rest is cut off.
const MAX_BODY_CHARS: usize = 240;
/// Longest title kept, in characters.
const MAX_TITLE_CHARS: usize = 120;
/// Most notifications sent for one reading; a burst beyond this is not worth a queue of pills.
const MAX_ARRIVALS_PER_POLL: usize = 5;

/// A notification that arrived, as the notch receives it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrivedNotification {
    /// Windows' number for this notification; unique while it is in the Action Center.
    pub id: u32,
    /// The sending app's identity (its AppUserModelId), stable across notifications.
    pub app_id: String,
    /// The sending app's name, as Windows shows it.
    pub app_name: String,
    pub title: String,
    pub body: String,
    /// The app's logo as a data URL, if Windows would give it.
    pub app_icon: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub created_at_ms: i64,
}

/// Splits a toast's text lines into a title (the first line) and a body (the rest, one per
/// line), each cut to its limit. Blank lines are dropped.
pub fn title_and_body(lines: &[String]) -> (String, String) {
    let mut lines = lines.iter().map(|line| line.trim()).filter(|line| !line.is_empty());
    let title = lines.next().unwrap_or_default();
    let body = lines.collect::<Vec<_>>().join("\n");
    (cut(title, MAX_TITLE_CHARS), cut(&body, MAX_BODY_CHARS))
}

fn cut(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

/// Whether the notification came from Zara itself, which is never mirrored back to the notch.
pub fn is_from_zara(app_id: &str, app_name: &str) -> bool {
    app_name.eq_ignore_ascii_case("zara") || app_id.to_ascii_lowercase().contains("zara")
}

/// Tells new notifications from the ones already seen.
///
/// The first reading is the baseline: everything in it was there before the feature was turned
/// on, so none of it is new. After that, a notification is new the first time its id appears;
/// ids that have left the Action Center are forgotten.
#[derive(Default)]
pub struct ArrivalTracker {
    seen: Option<HashSet<u32>>,
}

impl ArrivalTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// The notifications in `snapshot` that have not been seen before, oldest first, without
    /// Zara's own and at most `MAX_ARRIVALS_PER_POLL` of them.
    pub fn arrivals(&mut self, snapshot: Vec<ArrivedNotification>) -> Vec<ArrivedNotification> {
        let current: HashSet<u32> = snapshot.iter().map(|item| item.id).collect();
        let Some(seen) = self.seen.replace(current) else {
            return Vec::new();
        };
        let mut fresh: Vec<ArrivedNotification> = snapshot
            .into_iter()
            .filter(|item| !seen.contains(&item.id))
            .filter(|item| !is_from_zara(&item.app_id, &item.app_name))
            .collect();
        fresh.sort_by_key(|item| (item.created_at_ms, item.id));
        fresh.truncate(MAX_ARRIVALS_PER_POLL);
        fresh
    }
}

/// Whether Windows lets Zara read notifications.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    Allowed,
    /// The user (or a policy) said no; only the user can change it, in Windows Settings.
    Denied,
    /// Windows did not give an answer, or the notification listener is not available.
    Unavailable,
}

impl Access {
    fn as_str(self) -> &'static str {
        match self {
            Access::Allowed => "allowed",
            Access::Denied => "denied",
            Access::Unavailable => "unavailable",
        }
    }
}

/// Bumped whenever the feature is turned on or off, so a reader started earlier knows it has
/// been replaced and stops.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Whether a reader is running. Both the notch and Settings ask for the feature to be turned
/// on (Settings, to learn whether Windows allowed it), and the second ask must not start a
/// second reader.
static READER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
mod win {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use std::collections::HashMap;
    use windows::Foundation::Size;
    use windows::Storage::Streams::DataReader;
    use windows::UI::Notifications::Management::{
        UserNotificationListener, UserNotificationListenerAccessStatus,
    };
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    /// Seconds between 1601-01-01 (Windows' epoch) and 1970-01-01, in 100 ns ticks.
    const WINDOWS_EPOCH_TO_UNIX_TICKS: i64 = 116_444_736_000_000_000;
    const LOGO_SIZE: f32 = 44.0;

    pub fn init_com() {
        // A second initialization on the same thread is harmless.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    /// Reads the Action Center, remembering each app's logo so it is only fetched once.
    pub struct ToastReader {
        listener: UserNotificationListener,
        logos: HashMap<String, Option<String>>,
    }

    impl ToastReader {
        /// Asks Windows for permission (a no-op if it was already answered) and opens the reader.
        pub fn open() -> Result<ToastReader, Access> {
            let listener = UserNotificationListener::Current().map_err(|_| Access::Unavailable)?;
            let status = listener
                .GetAccessStatus()
                .map_err(|_| Access::Unavailable)?;
            let status = if status == UserNotificationListenerAccessStatus::Unspecified {
                listener
                    .RequestAccessAsync()
                    .and_then(|operation| operation.get())
                    .map_err(|_| Access::Unavailable)?
            } else {
                status
            };
            match status {
                UserNotificationListenerAccessStatus::Allowed => Ok(ToastReader {
                    listener,
                    logos: HashMap::new(),
                }),
                UserNotificationListenerAccessStatus::Denied => Err(Access::Denied),
                _ => Err(Access::Unavailable),
            }
        }

        /// Every toast in the Action Center now.
        pub fn snapshot(&mut self) -> windows::core::Result<Vec<ArrivedNotification>> {
            let list = self
                .listener
                .GetNotificationsAsync(NotificationKinds::Toast)?
                .get()?;
            let mut items = Vec::new();
            for index in 0..list.Size()? {
                let Ok(item) = list.GetAt(index) else { continue };
                if let Some(arrived) = self.read(&item) {
                    items.push(arrived);
                }
            }
            Ok(items)
        }

        fn read(
            &mut self,
            item: &windows::UI::Notifications::UserNotification,
        ) -> Option<ArrivedNotification> {
            let app_info = item.AppInfo().ok()?;
            let app_id = app_info.AppUserModelId().ok()?.to_string();
            let app_name = app_info
                .DisplayInfo()
                .ok()?
                .DisplayName()
                .ok()?
                .to_string();
            let mut lines = Vec::new();
            let visual = item.Notification().ok()?.Visual().ok()?;
            if let Ok(binding) = visual.GetBinding(&KnownNotificationBindings::ToastGeneric().ok()?) {
                if let Ok(elements) = binding.GetTextElements() {
                    for index in 0..elements.Size().unwrap_or(0) {
                        if let Ok(text) = elements.GetAt(index).and_then(|element| element.Text()) {
                            lines.push(text.to_string());
                        }
                    }
                }
            }
            let (title, body) = title_and_body(&lines);
            let created_ticks = item.CreationTime().map(|t| t.UniversalTime).unwrap_or(0);
            let app_icon = self
                .logos
                .entry(app_id.clone())
                .or_insert_with(|| logo_of(&app_info))
                .clone();
            Some(ArrivedNotification {
                id: item.Id().ok()?,
                app_id,
                app_name,
                title,
                body,
                app_icon,
                created_at_ms: (created_ticks - WINDOWS_EPOCH_TO_UNIX_TICKS) / 10_000,
            })
        }
    }

    /// The app's logo as a data URL, if Windows gives it.
    fn logo_of(app_info: &windows::ApplicationModel::AppInfo) -> Option<String> {
        let logo = app_info
            .DisplayInfo()
            .ok()?
            .GetLogo(Size {
                Width: LOGO_SIZE,
                Height: LOGO_SIZE,
            })
            .ok()?;
        let stream = logo.OpenReadAsync().ok()?.get().ok()?;
        let content_type = stream
            .ContentType()
            .ok()?
            .to_string()
            .split(',')
            .next()
            .unwrap_or("image/png")
            .trim()
            .to_string();
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let length = stream.Size().ok()? as u32;
        if length == 0 || length > 256 * 1024 {
            return None;
        }
        reader.LoadAsync(length).ok()?.get().ok()?;
        let mut bytes = vec![0u8; length as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!(
            "data:{};base64,{}",
            content_type,
            general_purpose::STANDARD.encode(bytes)
        ))
    }
}

/// Reads the Action Center until the feature is turned off, sending each new toast to the notch
/// as a `windows-notification` event.
#[cfg(windows)]
fn read_until_replaced(app: AppHandle, mut reader: win::ToastReader, generation: u64) {
    win::init_com();
    let mut tracker = ArrivalTracker::new();
    while GENERATION.load(Ordering::SeqCst) == generation {
        if let Ok(snapshot) = reader.snapshot() {
            for arrived in tracker.arrivals(snapshot) {
                let _ = app.emit("windows-notification", arrived);
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Turns notification mirroring on or off and says whether Windows allows it.
///
/// Turning it on asks Windows for permission if that was never answered, which can show a
/// prompt, so the answer ("allowed", "denied" or "unavailable") comes back to Settings to show;
/// turning it off answers "off".
/// Nothing is read unless the answer is "allowed".
#[tauri::command]
pub async fn notifications_enable(app: AppHandle, enabled: bool) -> String {
    if !enabled {
        READER_ACTIVE.store(false, Ordering::SeqCst);
        GENERATION.fetch_add(1, Ordering::SeqCst);
        return "off".to_string();
    }
    if READER_ACTIVE.swap(true, Ordering::SeqCst) {
        return Access::Allowed.as_str().to_string();
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    #[cfg(windows)]
    {
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            win::init_com();
            match win::ToastReader::open() {
                Ok(reader) => {
                    std::thread::spawn(move || read_until_replaced(app, reader, generation));
                    Access::Allowed
                }
                Err(access) => access,
            }
        })
        .await
        .unwrap_or(Access::Unavailable);
        if outcome != Access::Allowed {
            READER_ACTIVE.store(false, Ordering::SeqCst);
        }
        outcome.as_str().to_string()
    }
    #[cfg(not(windows))]
    {
        let _ = (app, generation);
        READER_ACTIVE.store(false, Ordering::SeqCst);
        Access::Unavailable.as_str().to_string()
    }
}

/// Opens Windows' own page for which apps may read notifications.
#[tauri::command]
pub async fn open_notification_privacy_settings() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteA;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let _ = ShellExecuteA(
            Some(HWND(std::ptr::null_mut())),
            windows::core::PCSTR(c"open".as_ptr() as *const u8),
            windows::core::PCSTR(c"ms-settings:privacy-notifications".as_ptr() as *const u8),
            windows::core::PCSTR::null(),
            windows::core::PCSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(id: u32, app_name: &str, created_at_ms: i64) -> ArrivedNotification {
        ArrivedNotification {
            id,
            app_id: format!("{app_name}.app"),
            app_name: app_name.to_string(),
            title: "A title".to_string(),
            body: "A body".to_string(),
            app_icon: None,
            created_at_ms,
        }
    }

    fn ids(items: &[ArrivedNotification]) -> Vec<u32> {
        items.iter().map(|item| item.id).collect()
    }

    fn lines(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|text| text.to_string()).collect()
    }

    #[test]
    fn takes_the_first_line_as_the_title_and_the_rest_as_the_body() {
        let (title, body) = title_and_body(&lines(&["Maria", "Are you free at 3?", "Bring the notes"]));

        assert_eq!(title, "Maria");
        assert_eq!(body, "Are you free at 3?\nBring the notes");
    }

    #[test]
    fn has_an_empty_body_when_there_is_only_a_title() {
        let (title, body) = title_and_body(&lines(&["Battery low"]));

        assert_eq!(title, "Battery low");
        assert_eq!(body, "");
    }

    #[test]
    fn has_nothing_when_there_is_no_text() {
        assert_eq!(title_and_body(&[]), (String::new(), String::new()));
    }

    #[test]
    fn drops_blank_lines_and_trims_the_rest() {
        let (title, body) = title_and_body(&lines(&["  ", " Maria ", "", "  hello  "]));

        assert_eq!(title, "Maria");
        assert_eq!(body, "hello");
    }

    #[test]
    fn cuts_a_long_body_and_marks_the_cut() {
        let long = "x".repeat(500);

        let (_, body) = title_and_body(&lines(&["Title", &long]));

        assert_eq!(body.chars().count(), 240);
        assert!(body.ends_with('…'));
    }

    #[test]
    fn cuts_a_long_title() {
        let long = "y".repeat(300);

        let (title, _) = title_and_body(&lines(&[&long]));

        assert_eq!(title.chars().count(), 120);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn cuts_on_character_boundaries_not_bytes() {
        let accented = "é".repeat(400);

        let (_, body) = title_and_body(&lines(&["Title", &accented]));

        assert_eq!(body.chars().count(), 240);
    }

    #[test]
    fn recognizes_zaras_own_notifications_by_name_or_identity() {
        assert!(is_from_zara("com.zara.app", "Something"));
        assert!(is_from_zara("Other.App", "Zara"));
        assert!(is_from_zara("Other.App", "ZARA"));
    }

    #[test]
    fn does_not_mistake_other_apps_for_zara() {
        assert!(!is_from_zara("Microsoft.WindowsStore", "Microsoft Store"));
    }

    #[test]
    fn treats_everything_in_the_first_reading_as_already_there() {
        let mut tracker = ArrivalTracker::new();

        let arrivals = tracker.arrivals(vec![notification(1, "Mail", 10), notification(2, "Chat", 20)]);

        assert!(arrivals.is_empty());
    }

    #[test]
    fn reports_a_notification_the_first_time_it_appears() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![notification(1, "Mail", 10)]);

        let arrivals = tracker.arrivals(vec![notification(1, "Mail", 10), notification(2, "Chat", 20)]);

        assert_eq!(ids(&arrivals), vec![2]);
    }

    #[test]
    fn does_not_report_the_same_notification_twice() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![]);
        tracker.arrivals(vec![notification(7, "Chat", 20)]);

        let arrivals = tracker.arrivals(vec![notification(7, "Chat", 20)]);

        assert!(arrivals.is_empty());
    }

    #[test]
    fn reports_several_new_ones_oldest_first() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![]);

        let arrivals = tracker.arrivals(vec![
            notification(5, "Chat", 300),
            notification(3, "Mail", 100),
            notification(4, "Chat", 200),
        ]);

        assert_eq!(ids(&arrivals), vec![3, 4, 5]);
    }

    #[test]
    fn skips_zaras_own_notifications() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![]);

        let arrivals = tracker.arrivals(vec![notification(1, "Zara", 10), notification(2, "Chat", 20)]);

        assert_eq!(ids(&arrivals), vec![2]);
    }

    #[test]
    fn sends_at_most_five_from_one_reading() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![]);
        let burst: Vec<_> = (1..=9).map(|id| notification(id, "Chat", id as i64)).collect();

        let arrivals = tracker.arrivals(burst);

        assert_eq!(ids(&arrivals), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn forgets_a_notification_once_it_has_left_the_action_center() {
        let mut tracker = ArrivalTracker::new();
        tracker.arrivals(vec![]);
        tracker.arrivals(vec![notification(1, "Chat", 10)]);
        tracker.arrivals(vec![]);

        let arrivals = tracker.arrivals(vec![notification(1, "Chat", 10)]);

        assert_eq!(ids(&arrivals), vec![1]);
    }

    #[test]
    fn serializes_for_the_notch_with_camel_case_names() {
        let json = serde_json::to_value(notification(1, "Chat", 10)).unwrap();

        assert_eq!(json["appName"], "Chat");
        assert_eq!(json["createdAtMs"], 10);
        assert!(json["appIcon"].is_null());
    }
}
