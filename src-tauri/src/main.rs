#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod autostart_repair;
mod battery;
mod bluetooth;
mod buds;
mod claude_code;
mod claude_usage;
mod clipboard_history;
mod commands;
mod diagnostics;
mod installed_apps;
mod jack;
mod lyrics;
mod notch_monitor;
mod notifications;
mod services;
mod settings_window;
mod shortcuts;
mod shelf;
mod shelf_preview;
mod state;
mod stall_probe;
mod stealth;
mod types;
mod usb;
mod utils;
mod wifi;
mod window_region;

use std::sync::atomic::Ordering;
use tauri::Manager;
use windows::core::BOOL;
use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT};

use crate::commands::*;
use crate::services::*;
use crate::state::*;

unsafe extern "system" fn ctrl_handler(ctrl_type: u32) -> BOOL {
    if ctrl_type == CTRL_C_EVENT || ctrl_type == CTRL_BREAK_EVENT || ctrl_type == CTRL_CLOSE_EVENT {
        set_native_osd_suppressed(false);
    }
    BOOL(0)
}

fn main() {
    unsafe {
        let _ = SetConsoleCtrlHandler(Some(ctrl_handler), true);
    }

    // Single-instance enforcement
    unsafe {
        use windows::Win32::Foundation::{CloseHandle, GetLastError};
        use windows::Win32::System::Threading::{
            CreateEventW, CreateMutexW, OpenEventW, SetEvent, SYNCHRONIZATION_ACCESS_RIGHTS,
        };

        let mutex_name: Vec<u16> = "ZaraSingleInstance"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let event_name: Vec<u16> = "ZaraOpenSettings"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let h_mutex = CreateMutexW(None, true, windows::core::PCWSTR(mutex_name.as_ptr())).ok();
        let err = GetLastError();

        if err.0 == 183 {
            // Another instance is already running — signal it to open settings
            if let Ok(h_event) = OpenEventW(
                SYNCHRONIZATION_ACCESS_RIGHTS(0x00100002),
                false,
                windows::core::PCWSTR(event_name.as_ptr()),
            ) {
                let _ = SetEvent(h_event);
                let _ = CloseHandle(h_event);
            }
            if let Some(h) = h_mutex {
                let _ = CloseHandle(h);
            }
            return;
        }

        if let Ok(h_event) = CreateEventW(
            None,
            false,
            false,
            windows::core::PCWSTR(event_name.as_ptr()),
        ) {
            let _ = SINGLE_INSTANCE_EVENT_HANDLE.set(h_event.0 as isize);
        }
        if let Some(h) = h_mutex {
            let _ = SINGLE_INSTANCE_MUTEX_HANDLE.set(h.0 as isize);
        }
    }

    diagnostics::initialize();
    setup_brightness_worker();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            hide_native_osd,
            open_settings_window,
            close_settings_window,
            open_wifi_settings,
            open_sound_settings,
            open_notification_center,
            open_system_tray,
            set_ignore_cursor_events,
            set_window_height,
            resize_settings_window,
            hide_overlay,
            set_splash_fullscreen,
            sync_overlay_position,
            media_play_pause,
            media_next,
            media_previous,
            media_seek,
            open_media_source_app,
            change_notch_mode,
            sync_appbar,
            open_app,
            update_notch_rect,
            window_region::set_window_region,
            set_notch_hovered,
            set_notch_visible,
            setup_shelf_drop,
            shelf_thumbnail,
            shelf_drag_icon,
            shelf_prune,
            shelf_open,
            get_app_icon,
            quit_zara,
            restart_zara,
            get_volume,
            get_volume_state,
            get_brightness,
            set_volume,
            get_audio_sessions,
            set_app_volume,
            set_app_mute,
            set_volume_mixer_rect,
            clear_volume_mixer_rect,
            save_setting,
            load_settings,
            settings_file_readable,
            get_wifi_status,
            set_wifi_state,
            get_bluetooth_state,
            set_bluetooth_state,
            open_bluetooth_settings,
            open_airplane_mode_settings,
            set_brightness,
            get_battery_saver_state,
            open_battery_saver_settings,
            battery::get_battery_details,
            get_system_accent_color,
            get_system_metrics,
            export_settings_to_file,
            import_settings_from_file,
            reset_settings,
            wifi::wifi_list_networks,
            wifi::wifi_scan,
            wifi::wifi_connect,
            wifi::wifi_disconnect,
            wifi::wifi_forget,
            wifi::wifi_open_settings,
            bluetooth::bluetooth_list_devices,
            bluetooth::bluetooth_set_connected,
            bluetooth::bluetooth_discovery,
            bluetooth::bluetooth_pair,
            bluetooth::bluetooth_pairing_respond,
            bluetooth::bluetooth_unpair,
            bluetooth::bluetooth_refresh_buds,
            usb::usb_list_devices,
            jack::jack_list_devices,
            ai::ai_get_settings,
            ai::ai_cancel_chat,
            ai::ai_get_model_controls,
            ai::ai_set_model_tuning,
            ai::ai_list_models,
            ai::ai_has_api_key,
            ai::ai_set_api_key,
            ai::ai_clear_api_key,
            ai::ai_test_connection,
            ai::focus::ai_take_focus,
            ai::focus::ai_release_focus,
            shortcuts::shortcut_list,
            shortcuts::shortcut_active,
            shortcuts::shortcut_set,
            shortcuts::shortcut_reset,
            stealth::stealth_set,
            stealth::stealth_status,
            stealth::stealth_verify,
            ai::legacy_import_status,
            ai::legacy_import_run,
            ai::legacy_import_dismiss,
            ai::ai_chat,
            ai::conv_list,
            ai::conv_load,
            ai::conv_save,
            ai::conv_delete,
            ai::conv_rename,
            ai::conv_generate_title,
            ai::memory_list,
            ai::memory_add,
            ai::memory_delete,
            ai::note_list,
            ai::note_add,
            ai::note_update,
            ai::note_delete,
            stall_probe::record_diagnostic,
            clipboard_history::clipboard_history_enable,
            claude_code::claude_code_enable,
            claude_code::claude_code_sessions,
            claude_code::claude_code_connection,
            claude_code::claude_code_hooks_preview,
            claude_code::claude_code_connect,
            claude_code::claude_code_disconnect,
            claude_usage::claude_usage_enable,
            claude_usage::claude_usage_summary,
            lyrics::lyrics_for_track,
            notifications::notifications_enable,
            notifications::open_notification_privacy_settings,
            clipboard_history::clipboard_history_list,
            clipboard_history::clipboard_history_remove,
            clipboard_history::clipboard_history_clear,
            installed_apps::apps_list_installed
        ])
        .setup(|app| {
            // Populate the settings cache before anything else: a webview can
            // invoke save_setting as soon as it loads, which happens before the
            // rest of this hook runs.
            crate::utils::init_settings_cache(app.handle());
            autostart_repair::point_at_this_copy(app.handle());
            app.manage(ai::AiState::open(app.handle())?);
            let window = app.get_webview_window("main").unwrap();
            // tao rebuilds the extended style from its own flags whenever one
            // changes (show, hide, ...). With its ignore-cursor flag on, every
            // rebuild keeps the notch window layered, which its window region
            // needs to stay transparent; set_click_through then drives the
            // click-through bit directly. The worst a rebuild does is make the
            // window click-through until the next cursor update.
            let _ = window.set_ignore_cursor_events(true);

            // Sync window rects initially and on event
            let win_clone = window.clone();
            let update_main_rect = move || {
                if let (Ok(p), Ok(s)) = (win_clone.outer_position(), win_clone.outer_size()) {
                    if let Ok(mut lock) = MAIN_WINDOW_RECT.lock() {
                        *lock = Some((p, s));
                    }
                }
            };


            let u_main = update_main_rect.clone();
            let handle_for_events = app.handle().clone();
            window.on_window_event(move |e| match e {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    u_main();
                    sync_overlays(&handle_for_events);
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // Re-evaluate against the configured notch mode instead of
                    // registering unconditionally: on wake / display re-init a
                    // scale change in smart/peek mode must not reserve the top
                    // strip (issue #109).
                    let h = handle_for_events.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        reconcile_main_appbar(&h);
                        sync_overlays(&h);
                    });
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    shutdown_cleanly(&handle_for_events);
                }
                _ => {}
            });

            sync_overlays(app.handle());

            // Initialize the overlay window — on Windows, set_position doesn't
            // take effect on a window that has never been shown. Show it once
            // to register it with the compositor, then hide immediately.
            if let Some(ov_win) = app.get_webview_window("overlay") {
                // Layered from the start, like the notch (see
                // set_click_through): the overlay has a window region too.
                let _ = ov_win.set_ignore_cursor_events(true);
                let _ = ov_win.show();
                let _ = ov_win.hide();
                let overlay_handle = app.handle().clone();
                ov_win.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        shutdown_cleanly(&overlay_handle);
                    }
                });
            }

            shortcuts::init(app.handle())?;
            stealth::init(app.handle());
            watch_webview_processes(app.handle());
            setup_mouse_hook(app.handle().clone());
            stall_probe::start_if_requested(app.handle().clone());
            setup_display_change_monitor(app.handle().clone());
            let tx = setup_system_worker(app.handle().clone());
            let _ = COMMAND_SENDER.set(tx.clone());
            setup_audio_visualization(app.handle().clone());
            setup_settings_watcher(app.handle().clone());
            diagnostics::record("services_ready", "hooks and settings watcher initialized");
            wifi::setup_wifi_notifications(app.handle().clone());
            bluetooth::setup_bluetooth_notifications(app.handle().clone());
            usb::setup_usb_notifications(app.handle().clone());
            jack::setup_jack_notifications(app.handle().clone());

            // Listen for second-instance signal to open settings
            if let Some(&h_event) = SINGLE_INSTANCE_EVENT_HANDLE.get() {
                if h_event != 0 {
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
                        use windows::Win32::System::Threading::{WaitForSingleObject, INFINITE};
                        let h_event = HANDLE(h_event as *mut _);
                        loop {
                            let result = unsafe { WaitForSingleObject(h_event, INFINITE) };
                            if result == WAIT_OBJECT_0 {
                                crate::commands::open_settings_window(app_handle.clone());
                            }
                        }
                    });
                }
            }

            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let quit_item = MenuItem::with_id(app, "quit", "Quit Zara", true, None::<&str>)?;
                let restart_item =
                    MenuItem::with_id(app, "restart", "Restart Zara", true, None::<&str>)?;
                let settings_item =
                    MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&settings_item, &restart_item, &quit_item])?;
                let ah = app.handle().clone();
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Zara")
                    .menu(&menu)
                    .on_menu_event(move |_, event| match event.id().as_ref() {
                        "quit" => {
                            diagnostics::record("shutdown", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            set_native_osd_suppressed(false);

                            ah.exit(0);
                        }
                        "restart" => {
                            diagnostics::record("restart", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            if let Some(w) = ah.get_webview_window("settings") {
                                let _ = w.destroy();
                            }
                            set_native_osd_suppressed(false);
                            close_single_instance_handles();

                            ah.restart();
                        }
                        "settings" => {
                            crate::commands::open_settings_window(ah.clone());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            crate::commands::open_settings_window(tray.app_handle().clone());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            diagnostics::record("exit", "releasing AppBar and native OSD");
            crate::commands::release_appbars(app_handle);
            set_native_osd_suppressed(false);
        }
    });
}
