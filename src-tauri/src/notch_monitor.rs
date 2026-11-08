//! Which screens exist, which one the cursor is on, and which one the notch is on.
//!
//! In Smart and Peek modes the notch follows the cursor: when the cursor rests at the top
//! edge of another screen, the notch moves there. This module is the geometry behind that,
//! kept free of windows and Tauri so the rules can be tested. Screens are read straight from
//! Windows (not through Tauri's monitor calls, which wait on the UI thread) because the
//! cursor path runs up to 30 times a second.
//!
//! All coordinates are physical pixels on the virtual desktop, so a screen to the left of or
//! above the primary one has negative coordinates.

use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::core::BOOL;

/// One screen's place on the virtual desktop and its display scale (1.0 at 100%).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
    pub primary: bool,
}

impl MonitorRect {
    pub fn contains(&self, point: (i32, i32)) -> bool {
        point.0 >= self.x
            && point.0 < self.x + self.width
            && point.1 >= self.y
            && point.1 < self.y + self.height
    }

    /// Whether `point` is on this screen within `band_logical_px` (at this screen's own scale)
    /// of its top edge.
    pub fn top_band_contains(&self, point: (i32, i32), band_logical_px: f64) -> bool {
        self.contains(point) && point.1 < self.y + (band_logical_px * self.scale).ceil() as i32
    }
}

/// The screen `point` is on, if any.
pub fn monitor_at(monitors: &[MonitorRect], point: (i32, i32)) -> Option<MonitorRect> {
    monitors.iter().copied().find(|monitor| monitor.contains(point))
}

/// The primary screen.
pub fn primary_monitor(monitors: &[MonitorRect]) -> Option<MonitorRect> {
    monitors.iter().copied().find(|monitor| monitor.primary)
}

/// The screen the notch window is on. The window spans the width of its screen and starts at
/// the top of it, so its top-left corner identifies the screen. A window that is on no screen
/// (its screen was unplugged) is on none.
pub fn monitor_of_window(monitors: &[MonitorRect], window_origin: (i32, i32)) -> Option<MonitorRect> {
    monitor_at(monitors, window_origin)
}

/// The screen whose top-edge band (`band_logical_px` deep) the cursor is in, when that counts as
/// asking for the notch: any screen when the notch follows the cursor, otherwise only
/// `notch_screen`, the one it is already on.
pub fn edge_screen(
    monitors: &[MonitorRect],
    cursor: (i32, i32),
    band_logical_px: f64,
    follow: bool,
    notch_screen: Option<MonitorRect>,
) -> Option<MonitorRect> {
    let screen = monitor_at(monitors, cursor)?;
    if !screen.top_band_contains(cursor, band_logical_px) {
        return None;
    }
    (follow || Some(screen) == notch_screen).then_some(screen)
}

/// Where the notch should sit when it is on `monitor`: the screen's top-left corner, and the
/// window size in physical pixels (the screen's full width, `window_height_logical_px` tall at
/// the screen's own scale and the user's own zoom).
pub fn notch_window_rect(
    monitor: MonitorRect,
    window_height_logical_px: f64,
    user_zoom: f64,
) -> (i32, i32, u32, u32) {
    let height = (window_height_logical_px * user_zoom * monitor.scale).round() as u32;
    (monitor.x, monitor.y, monitor.width as u32, height)
}

/// Every screen Windows reports. Empty only if the query itself fails.
pub fn list_monitors() -> Vec<MonitorRect> {
    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _device: HDC,
        _clip: *mut RECT,
        found: LPARAM,
    ) -> BOOL {
        let found = &mut *(found.0 as *mut Vec<MonitorRect>);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
            // A screen whose scale cannot be read is taken to be at 100%.
            let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
            const MONITORINFOF_PRIMARY: u32 = 1;
            found.push(MonitorRect {
                x: info.rcMonitor.left,
                y: info.rcMonitor.top,
                width: info.rcMonitor.right - info.rcMonitor.left,
                height: info.rcMonitor.bottom - info.rcMonitor.top,
                scale: dpi_x as f64 / 96.0,
                primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
            });
        }
        true.into()
    }

    let mut found: Vec<MonitorRect> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut found as *mut _ as isize));
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(x: i32, y: i32, width: i32, height: i32, scale: f64, primary: bool) -> MonitorRect {
        MonitorRect { x, y, width, height, scale, primary }
    }

    fn side_by_side() -> Vec<MonitorRect> {
        vec![
            screen(0, 0, 1920, 1080, 1.0, true),
            screen(1920, 0, 2560, 1440, 1.5, false),
        ]
    }

    #[test]
    fn finds_the_screen_a_point_is_on() {
        let monitors = side_by_side();
        assert_eq!(monitor_at(&monitors, (100, 50)), Some(monitors[0]));
        assert_eq!(monitor_at(&monitors, (2000, 50)), Some(monitors[1]));
    }

    #[test]
    fn a_point_on_the_shared_edge_belongs_to_the_screen_on_its_right() {
        let monitors = side_by_side();
        assert_eq!(monitor_at(&monitors, (1919, 10)), Some(monitors[0]));
        assert_eq!(monitor_at(&monitors, (1920, 10)), Some(monitors[1]));
    }

    #[test]
    fn a_point_off_every_screen_is_on_none() {
        assert_eq!(monitor_at(&side_by_side(), (5000, 5000)), None);
        assert_eq!(monitor_at(&side_by_side(), (-1, 10)), None);
    }

    #[test]
    fn a_screen_left_of_the_primary_has_negative_coordinates() {
        let monitors = vec![
            screen(-1920, 0, 1920, 1080, 1.0, false),
            screen(0, 0, 1920, 1080, 1.0, true),
        ];
        assert_eq!(monitor_at(&monitors, (-500, 40)), Some(monitors[0]));
        assert_eq!(primary_monitor(&monitors), Some(monitors[1]));
    }

    #[test]
    fn the_top_band_is_measured_at_each_screens_own_scale() {
        let monitors = side_by_side();
        // 8 logical pixels: 8 on the 100% screen, 12 on the 150% screen.
        assert!(monitors[0].top_band_contains((100, 7), 8.0));
        assert!(!monitors[0].top_band_contains((100, 8), 8.0));
        assert!(monitors[1].top_band_contains((2000, 11), 8.0));
        assert!(!monitors[1].top_band_contains((2000, 12), 8.0));
    }

    #[test]
    fn the_top_band_is_only_on_the_screens_own_top_edge() {
        let stacked = [
            screen(0, 0, 1920, 1080, 1.0, true),
            screen(0, 1080, 1920, 1080, 1.0, false),
        ];
        // The top of the lower screen is the top band of that screen, not of the upper one.
        assert!(!stacked[0].top_band_contains((100, 1081), 8.0));
        assert!(stacked[1].top_band_contains((100, 1081), 8.0));
    }

    #[test]
    fn a_following_notch_answers_to_the_top_edge_of_any_screen() {
        let monitors = side_by_side();
        let notch_on_primary = Some(monitors[0]);
        assert_eq!(
            edge_screen(&monitors, (2000, 3), 8.0, true, notch_on_primary),
            Some(monitors[1])
        );
        assert_eq!(
            edge_screen(&monitors, (100, 3), 8.0, true, notch_on_primary),
            Some(monitors[0])
        );
    }

    #[test]
    fn a_notch_that_does_not_follow_answers_only_to_its_own_screen() {
        let monitors = side_by_side();
        let notch_on_primary = Some(monitors[0]);
        assert_eq!(
            edge_screen(&monitors, (2000, 3), 8.0, false, notch_on_primary),
            None
        );
        assert_eq!(
            edge_screen(&monitors, (100, 3), 8.0, false, notch_on_primary),
            Some(monitors[0])
        );
    }

    #[test]
    fn the_middle_of_a_screen_is_never_the_top_edge() {
        let monitors = side_by_side();
        assert_eq!(edge_screen(&monitors, (2000, 700), 8.0, true, Some(monitors[0])), None);
    }

    #[test]
    fn a_cursor_off_every_screen_is_at_no_edge() {
        let monitors = side_by_side();
        assert_eq!(edge_screen(&monitors, (9000, 2), 8.0, true, Some(monitors[0])), None);
    }

    #[test]
    fn without_a_known_notch_screen_only_a_following_notch_answers() {
        let monitors = side_by_side();
        assert_eq!(edge_screen(&monitors, (100, 3), 8.0, false, None), None);
        assert_eq!(edge_screen(&monitors, (100, 3), 8.0, true, None), Some(monitors[0]));
    }

    #[test]
    fn the_notch_window_is_on_the_screen_its_corner_is_on() {
        let monitors = side_by_side();
        assert_eq!(monitor_of_window(&monitors, (1920, 0)), Some(monitors[1]));
        assert_eq!(monitor_of_window(&monitors, (0, 0)), Some(monitors[0]));
    }

    #[test]
    fn a_window_whose_screen_was_unplugged_is_on_no_screen() {
        let only_primary = vec![screen(0, 0, 1920, 1080, 1.0, true)];
        assert_eq!(monitor_of_window(&only_primary, (1920, 0)), None);
    }

    #[test]
    fn the_notch_window_spans_its_screen_and_scales_with_it() {
        let monitors = side_by_side();
        assert_eq!(notch_window_rect(monitors[0], 640.0, 1.0), (0, 0, 1920, 640));
        assert_eq!(notch_window_rect(monitors[1], 640.0, 1.0), (1920, 0, 2560, 960));
        assert_eq!(notch_window_rect(monitors[1], 640.0, 1.25), (1920, 0, 2560, 1200));
    }

    #[test]
    fn windows_reports_exactly_one_primary_screen() {
        let monitors = list_monitors();
        assert!(!monitors.is_empty(), "a session always has a screen");
        assert_eq!(monitors.iter().filter(|monitor| monitor.primary).count(), 1);
        assert!(monitors.iter().all(|monitor| monitor.scale >= 1.0 && monitor.width > 0));
    }
}
