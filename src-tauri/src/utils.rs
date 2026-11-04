use base64::{engine::general_purpose, Engine as _};
use windows::core::Interface;
use windows::Win32::Foundation::{HGLOBAL, HWND};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppPBGRA,
    IWICImagingFactory, WICBitmapEncoderNoCache,
};
use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream};
use windows::Win32::System::Com::{
    CoCreateInstance, IPersistFile, CLSCTX_ALL, CLSCTX_INPROC_SERVER,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::Win32::UI::WindowsAndMessaging::HICON;

pub fn resolve_shortcut(path: &str) -> Option<(String, String)> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;

        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        persist_file
            .Load(
                windows::core::PCWSTR(wide_path.as_ptr()),
                windows::Win32::System::Com::STGM(0),
            )
            .ok()?;

        let _ = shell_link.Resolve(HWND(std::ptr::null_mut()), 1 | 16 | 32);

        let mut buffer = [0u16; 260];
        let mut data = windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW::default();
        shell_link.GetPath(&mut buffer, &mut data, 0).ok()?;

        let mut arg_buffer = [0u16; 1024];
        let _ = shell_link.GetArguments(&mut arg_buffer);

        let target = String::from_utf16_lossy(&buffer)
            .trim_matches(char::from(0))
            .to_string();
        let args = String::from_utf16_lossy(&arg_buffer)
            .trim_matches(char::from(0))
            .to_string();

        if target.trim().is_empty() {
            None
        } else {
            Some((target, args))
        }
    }
}

/// Extracts the icon a shortcut declares for itself (`IShellLinkW::GetIconLocation`).
///
/// This is how Firefox web apps and user-customized shortcuts store their icon.
/// Returns only real image files (`.ico`, `.png`, ...). Icon references into
/// executables/DLLs are ignored so the regular target-based extraction is used
/// instead (it yields a better icon than the file's first resource).
pub fn get_shortcut_icon_location(path: &str) -> Option<String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        persist_file
            .Load(
                windows::core::PCWSTR(wide_path.as_ptr()),
                windows::Win32::System::Com::STGM(0),
            )
            .ok()?;

        let mut buffer = [0u16; 512];
        let mut index = 0i32;
        shell_link.GetIconLocation(&mut buffer, &mut index).ok()?;

        let raw = String::from_utf16_lossy(&buffer)
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        if raw.is_empty() {
            return None;
        }

        let location = expand_env_vars(&raw);
        let ext = std::path::Path::new(&location)
            .extension()?
            .to_str()?
            .to_lowercase();
        if !matches!(
            ext.as_str(),
            "ico" | "png" | "jpg" | "jpeg" | "bmp" | "webp" | "gif"
        ) {
            return None;
        }
        if !std::path::Path::new(&location).exists() {
            return None;
        }
        Some(location)
    }
}

/// Expands `%VAR%` references using the current process environment.
fn expand_env_vars(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if !name.is_empty() && !name.contains(' ') {
                match std::env::var(name) {
                    Ok(value) => result.push_str(&value),
                    Err(_) => {
                        result.push('%');
                        result.push_str(name);
                        result.push('%');
                    }
                }
            } else {
                result.push('%');
                result.push_str(name);
                result.push('%');
            }
            rest = &after[end + 1..];
        } else {
            result.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    result.push_str(rest);
    result
}

/// Reads an image file (PNG/ICO/etc.) and returns it as a base64 PNG data URI.
pub fn image_file_to_base64(path: &str) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 8 * 1024 * 1024 {
        return None;
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        use base64::Engine;
        return Some(format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(&bytes)
        ));
    }

    let img = image::load_from_memory(&bytes).ok()?;
    let mut png: Vec<u8> = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    use base64::Engine;
    Some(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(&png)
    ))
}

/// Resolves a bare executable name (e.g. `notepad.exe`, `msedge`, `wt.exe`) to a
/// full path, using the same mechanisms Windows uses: the registry `App Paths`
/// registration, then the standard executable search path, then a few well-known
/// install locations for apps that register in neither.
///
/// This matters for default pins: on Windows 11 `notepad.exe` resolves through
/// App Paths to the Store Notepad package, whose icon comes from the package
/// manifest rather than the stale stub in System32.
pub fn resolve_executable_path(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains('/') {
        return None;
    }

    let file = if trimmed.to_lowercase().ends_with(".exe") {
        trimmed.to_string()
    } else {
        format!("{}.exe", trimmed)
    };

    if let Some(path) = app_paths_lookup(&file) {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    if let Some(path) = search_system_path(&file) {
        return Some(path);
    }
    known_install_location(&file)
}

/// The version in a Squirrel version folder's name: `app-1.0.9264` is
/// `[1, 0, 9264]`. Compared as numbers, so `app-1.0.10000` is newer.
fn squirrel_folder_version(name: &str) -> Option<Vec<u64>> {
    let version = name
        .get(..4)?
        .eq_ignore_ascii_case("app-")
        .then(|| &name[4..])?;
    version
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

/// The newest of a Squirrel app's version folders, by name.
fn newest_squirrel_folder<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    names
        .into_iter()
        .filter_map(|name| squirrel_folder_version(name).map(|v| (v, name)))
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, name)| name)
}

/// Where an app installed by Squirrel (Discord, Slack, GitHub Desktop, Teams
/// classic, Postman, Figma) lives now. Squirrel keeps each version in its own
/// `app-<version>` folder next to `Update.exe` and deletes the old one after an
/// update, so a path saved earlier, such as a shelf item, can point at a folder
/// that's gone. Returns the same executable in the newest version folder (or in
/// `current`, which some apps use), or None when the path still exists or isn't
/// in a version folder.
pub fn moved_squirrel_exe(path: &str) -> Option<String> {
    let path = std::path::Path::new(path.trim().trim_matches('"'));
    if path.exists() {
        return None;
    }
    let folder = path.parent()?;
    let folder_name = folder.file_name()?.to_str()?;
    if squirrel_folder_version(folder_name).is_none()
        && !folder_name.eq_ignore_ascii_case("current")
    {
        return None;
    }
    let root = folder.parent()?;
    let exe = path.file_name()?;
    let names: Vec<String> = std::fs::read_dir(root)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().join(exe).is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    let newest = newest_squirrel_folder(names.iter().map(String::as_str)).or_else(|| {
        names
            .iter()
            .find(|n| n.eq_ignore_ascii_case("current"))
            .map(String::as_str)
    })?;
    Some(root.join(newest).join(exe).to_string_lossy().into_owned())
}

/// Reads `HKCU`/`HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths\<file>`.
fn app_paths_lookup(file: &str) -> Option<String> {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        KEY_READ,
    };

    unsafe {
        let subkey: Vec<u16> = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}",
            file
        )
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

        for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            let mut key = HKEY::default();
            if RegOpenKeyExW(
                root,
                windows::core::PCWSTR(subkey.as_ptr()),
                None,
                KEY_READ,
                &mut key,
            )
            .0 != 0
            {
                continue;
            }

            let mut buffer = [0u16; 1024];
            let mut size = (buffer.len() * 2) as u32;
            let status = RegQueryValueExW(
                key,
                windows::core::PCWSTR::null(),
                None,
                None,
                Some(buffer.as_mut_ptr() as *mut u8),
                Some(&mut size),
            );
            let _ = RegCloseKey(key);
            if status.0 != 0 {
                continue;
            }

            let value = String::from_utf16_lossy(&buffer[..(size as usize / 2).min(buffer.len())]);
            let value = value
                .trim_matches(char::from(0))
                .trim()
                .trim_matches('"')
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
        None
    }
}

/// Standard executable search (PATH, System32, Windows, ...).
fn search_system_path(file: &str) -> Option<String> {
    use windows::Win32::Storage::FileSystem::SearchPathW;

    unsafe {
        let wide: Vec<u16> = file.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buffer = vec![0u16; 32768];
        let len = SearchPathW(
            None,
            windows::core::PCWSTR(wide.as_ptr()),
            windows::core::PCWSTR::null(),
            Some(&mut buffer),
            None,
        );
        if len == 0 || len as usize >= buffer.len() {
            return None;
        }

        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        if std::path::Path::new(&path).exists() {
            Some(path)
        } else {
            None
        }
    }
}

/// Last resort for apps that are neither registered in App Paths nor on PATH.
fn known_install_location(file: &str) -> Option<String> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let home = std::env::var("USERPROFILE").unwrap_or_default();

    let candidates: Vec<String> = match file.to_lowercase().as_str() {
        "code.exe" | "code-insiders.exe" => vec![
            format!(
                "{}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
                home
            ),
            format!("{}\\Programs\\Microsoft VS Code\\Code.exe", local),
            "C:\\Program Files\\Microsoft VS Code\\Code.exe".into(),
            "C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe".into(),
        ],
        "msedge.exe" => vec![
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".into(),
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe".into(),
            format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", local),
        ],
        "notepad.exe" => vec![
            "C:\\Windows\\System32\\notepad.exe".into(),
            "C:\\Windows\\notepad.exe".into(),
        ],
        "explorer.exe" => vec!["C:\\Windows\\explorer.exe".into()],
        _ => Vec::new(),
    };

    candidates
        .into_iter()
        .find(|c| std::path::Path::new(c).exists())
}

/// Reads the `System.AppUserModel.ID` shell property of a window.
///
/// This is the same identity the taskbar uses to group windows: for Store/UWP
/// apps it is the package AppUserModelID, for installed browser web apps it is
/// the browser's web app id. Unlike the process command line it is always
/// available on the window itself.
pub fn get_window_app_user_model_id(hwnd: HWND) -> Option<String> {
    get_window_string_property(hwnd, 5)
}

fn get_window_string_property(hwnd: HWND, pid: u32) -> Option<String> {
    unsafe {
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::System::Com::StructuredStorage::{
            PropVariantClear, PropVariantToStringAlloc,
        };
        use windows::Win32::UI::Shell::PropertiesSystem::{
            IPropertyStore, SHGetPropertyStoreForWindow,
        };

        const PKEY_APP_USER_MODEL: PROPERTYKEY = PROPERTYKEY {
            fmtid: windows::core::GUID {
                data1: 0x9F4C2855,
                data2: 0x9F79,
                data3: 0x4B39,
                data4: [0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3],
            },
            pid: 0,
        };
        let key = PROPERTYKEY {
            pid,
            ..PKEY_APP_USER_MODEL
        };

        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        let mut prop = store.GetValue(&key).ok()?;
        let result = PropVariantToStringAlloc(&prop).ok().map(|pwstr| {
            let value = String::from_utf16_lossy(pwstr.as_wide()).trim().to_string();
            windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.0 as _));
            value
        });
        let _ = PropVariantClear(&mut prop);
        result.filter(|s| !s.is_empty())
    }
}

pub unsafe fn icon_to_base64(hicon: HICON) -> Option<String> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let bitmap = factory.CreateBitmapFromHICON(hicon).ok()?;
    wic_bitmap_to_base64(&factory, &bitmap)
}

/// Encodes an `HBITMAP` (as returned by `IShellItemImageFactory::GetImage`) to a base64 PNG.
pub unsafe fn hbitmap_to_base64(hbitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<String> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let bitmap = factory
        .CreateBitmapFromHBITMAP(
            hbitmap,
            windows::Win32::Graphics::Gdi::HPALETTE::default(),
            windows::Win32::Graphics::Imaging::WICBitmapUsePremultipliedAlpha,
        )
        .ok()?;
    wic_bitmap_to_base64(&factory, &bitmap)
}

unsafe fn wic_bitmap_to_base64(
    factory: &IWICImagingFactory,
    bitmap: &windows::Win32::Graphics::Imaging::IWICBitmapSource,
) -> Option<String> {
    let stream = CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true).ok()?;
    let encoder = factory
        .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
        .ok()?;
    encoder.Initialize(&stream, WICBitmapEncoderNoCache).ok()?;

    let mut frame = None;
    encoder
        .CreateNewFrame(&mut frame, std::ptr::null_mut())
        .ok()?;
    let frame = frame?;
    frame.Initialize(None).ok()?;

    let (mut width, mut height) = (0u32, 0u32);
    bitmap.GetSize(&mut width, &mut height).ok()?;
    frame.SetSize(width, height).ok()?;

    let mut format = GUID_WICPixelFormat32bppPBGRA;
    frame.SetPixelFormat(&mut format).ok()?;

    frame.WriteSource(bitmap, std::ptr::null()).ok()?;
    frame.Commit().ok()?;
    encoder.Commit().ok()?;

    let hglobal = GetHGlobalFromStream(&stream).ok()?;
    let ptr = windows::Win32::System::Memory::GlobalLock(hglobal);
    let size = windows::Win32::System::Memory::GlobalSize(hglobal);

    let data = std::slice::from_raw_parts(ptr as *const u8, size);
    let base64_str = general_purpose::STANDARD.encode(data);

    let _ = windows::Win32::System::Memory::GlobalUnlock(hglobal);

    Some(format!("data:image/png;base64,{}", base64_str))
}

pub fn get_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Parse the editable settings file without discarding a UTF-8 BOM. A parse
/// failure must reach the caller rather than turning into an empty map: the
/// next save would otherwise overwrite all of the user's preferences.
pub fn read_settings_file(
    path: &std::path::Path,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(content.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("Invalid settings file: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
        Err(e) => Err(format!("Could not read settings file: {e}")),
    }
}

/// Write a complete file in the same directory and replace the old file only
/// after the new contents are ready. A crash or write failure leaves the old file.
pub fn atomic_write_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let temp = path.with_file_name(format!(
        "{}.tmp-{}-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("zara"),
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    if let Err(e) = std::fs::write(&temp, content) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Could not write {}: {e}", temp.display()));
    }
    // Antivirus, indexers and editors can briefly open the destination without
    // FILE_SHARE_DELETE. Keep the original intact and retry only these Windows
    // sharing/access errors; a permanent failure is still returned to Settings.
    let mut replaced = std::fs::rename(&temp, path);
    for delay_ms in [25, 50, 100, 200] {
        if !replaced
            .as_ref()
            .is_err_and(|e| matches!(e.raw_os_error(), Some(5 | 32 | 33)))
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        replaced = std::fs::rename(&temp, path);
    }
    if let Err(e) = replaced {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Could not replace {}: {e}", path.display()));
    }
    Ok(())
}

pub fn write_settings_file(
    path: &std::path::Path,
    settings: &std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let content = serde_json::to_vec(settings).map_err(|e| e.to_string())?;
    atomic_write_file(path, &content)
}

/// The four webviews may save at once. Keep each read/modify/write transaction
/// together so one window cannot replace another window's new setting.
pub fn save_setting_file(
    path: &std::path::Path,
    key: String,
    value: serde_json::Value,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let _guard = crate::state::SETTINGS_FILE_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    let mut settings = read_settings_file(path)?;
    settings.insert(key, value);
    write_settings_file(path, &settings)?;
    replace_settings_cache(settings.clone());
    Ok(settings)
}

/// Load settings.json into the in-memory cache. Call once at startup.
pub fn init_settings_cache(app: &tauri::AppHandle) {
    use crate::state::SETTINGS_CACHE;
    use tauri::Manager;
    let cache =
        SETTINGS_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("settings.json"))
    {
        if let Ok(settings) = read_settings_file(&path) {
            if let Ok(mut cache) = cache.lock() {
                *cache = settings;
            }
        }
    }
}

/// Replace the entire settings cache (used by save_setting and the file watcher).
///
/// Uses `get_or_init` rather than `get().unwrap()`: a webview can invoke
/// `save_setting` before the setup hook has initialized the cache, and a panic
/// on the main thread inside a WebView2 callback cannot unwind, which aborts
/// the process.
pub fn replace_settings_cache(new_settings: std::collections::HashMap<String, serde_json::Value>) {
    let cache = crate::state::SETTINGS_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        *cache = new_settings;
    }
}

/// Height of the notch window in logical pixels at scale 1. The window is a tall
/// transparent strip across the top of the screen, clipped to what the notch
/// draws, so it must be at least as tall as the largest notch panel (the
/// assistant's, `AI_PANEL_HEIGHT.max` in src/ai/panelSize.ts). `tauri.conf.json`
/// repeats this number for the window's first size; a frontend test keeps the
/// two equal.
pub const NOTCH_WINDOW_HEIGHT: f64 = 640.0;

pub fn get_zara_scale(_app: &tauri::AppHandle) -> f64 {
    get_setting_str(_app, "zara-scale")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0)
}

/// Read any string value from the settings cache. Returns None if the key is absent.
pub fn get_setting_str<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, key: &str) -> Option<String> {
    let cache = crate::state::SETTINGS_CACHE.get()?;
    let guard = cache.lock().ok()?;
    guard.get(key)?.as_str().map(|s| s.to_string())
}

/// Makes a window click-through or not by its WS_EX_TRANSPARENT bit alone,
/// keeping WS_EX_LAYERED set in both states.
///
/// tao's `set_ignore_cursor_events` sets both bits when ignoring and clears
/// both otherwise. A window with a region (window_region.rs) that isn't
/// layered loses its transparency: its clear pixels inside the region paint
/// opaque. Writes only when the style differs, so it can be called on every
/// cursor update, which also restores the bits if tao rewrites the extended
/// style (it does on its own flag changes, such as show and hide). Returns
/// whether it changed anything.
pub fn set_click_through(hwnd: HWND, ignore: bool) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
    };
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let wanted = click_through_style(current, ignore);
        if wanted == current {
            return false;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted as isize);
        true
    }
}

/// The extended style with WS_EX_LAYERED set and WS_EX_TRANSPARENT set only
/// when ignoring input, every other bit kept.
fn click_through_style(style: u32, ignore: bool) -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::{WS_EX_LAYERED, WS_EX_TRANSPARENT};
    let layered = style | WS_EX_LAYERED.0;
    if ignore {
        layered | WS_EX_TRANSPARENT.0
    } else {
        layered & !WS_EX_TRANSPARENT.0
    }
}

/// Re-assert HWND_TOPMOST without activating the window.
///
/// Tauri's `set_always_on_top(true)` calls `SetWindowPos(HWND_TOPMOST)` without
/// `SWP_NOACTIVATE`, which causes Windows to send `WM_ACTIVATE` to the WebView2 window.
/// This activation message makes the WebView compositor briefly blank/hide the window,
/// and can also strip the `WS_EX_NOACTIVATE` extended style.
///
/// This helper uses the raw Win32 call with the correct flags and re-stamps
/// `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` to prevent both problems.
pub fn re_assert_topmost(hwnd: HWND) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSENDCHANGING, SWP_NOSIZE, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW,
        };
        // Set topmost without activating or notifying the window
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING,
        );
        // Re-stamp NOACTIVATE + TOOLWINDOW — HWND_TOPMOST can cause these to be reset
        // by the shell on some Windows builds
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as usize;
        let new_ex = ex | WS_EX_NOACTIVATE.0 as usize | WS_EX_TOOLWINDOW.0 as usize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex as isize);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        click_through_style, expand_env_vars, moved_squirrel_exe,
        newest_squirrel_folder, };

    #[test]
    fn picks_the_newest_squirrel_version_by_number() {
        assert_eq!(
            newest_squirrel_folder(["app-1.0.9264", "app-1.0.10000", "app-1.0.999", "packages"]),
            Some("app-1.0.10000")
        );
        assert_eq!(
            newest_squirrel_folder(["App-3.2", "app-3.10"]),
            Some("app-3.10")
        );
        assert_eq!(
            newest_squirrel_folder(["app-beta", "current", "packages"]),
            None
        );
    }

    #[test]
    fn finds_a_squirrel_app_after_an_update() {
        let root = std::env::temp_dir().join(format!("zara-squirrel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for version in ["app-1.0.9264", "app-1.0.10000"] {
            std::fs::create_dir_all(root.join(version)).unwrap();
            std::fs::write(root.join(version).join("Discord.exe"), b"").unwrap();
        }
        // A newer folder without the exe (an update still unpacking) is skipped.
        std::fs::create_dir_all(root.join("app-1.0.20000")).unwrap();
        let stale = root.join("app-1.0.9262").join("Discord.exe");
        let moved = moved_squirrel_exe(&stale.to_string_lossy());
        assert_eq!(
            moved.as_deref(),
            Some(
                root.join("app-1.0.10000")
                    .join("Discord.exe")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        // A path that still exists, or that isn't in a version folder, stays put.
        let current = root.join("app-1.0.9264").join("Discord.exe");
        assert_eq!(moved_squirrel_exe(&current.to_string_lossy()), None);
        assert_eq!(
            moved_squirrel_exe(&root.join("Discord.exe").to_string_lossy()),
            None
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn click_through_keeps_the_window_layered() {
        const LAYERED: u32 = 0x0008_0000;
        const TRANSPARENT: u32 = 0x0000_0020;
        const NOACTIVATE: u32 = 0x0800_0000;
        // tao's interactive style: neither bit. Taking clicks adds layered.
        assert_eq!(click_through_style(NOACTIVATE, false), NOACTIVATE | LAYERED);
        // Click-through adds both; other bits are kept.
        assert_eq!(
            click_through_style(NOACTIVATE, true),
            NOACTIVATE | LAYERED | TRANSPARENT
        );
        // Back to taking clicks drops only the transparent bit.
        assert_eq!(
            click_through_style(NOACTIVATE | LAYERED | TRANSPARENT, false),
            NOACTIVATE | LAYERED
        );
    }
    
    static TEST_SETTINGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_settings_path() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "zara-settings-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).expect("create test directory");
        dir.join("settings.json")
    }

    #[test]
    fn settings_bom_is_read_and_a_damaged_file_is_never_overwritten() {
        let _guard = TEST_SETTINGS_LOCK.lock().unwrap();
        let path = test_settings_path();
        std::fs::write(&path, "\u{feff}{\"zara-existing\":\"true\"}").unwrap();
        let settings = super::read_settings_file(&path).unwrap();
        assert_eq!(settings["zara-existing"], "true");

        super::save_setting_file(&path, "zara-new".into(), "false".into()).unwrap();
        let settings = super::read_settings_file(&path).unwrap();
        assert_eq!(settings.len(), 2);

        std::fs::write(&path, "{invalid").unwrap();
        assert!(super::save_setting_file(&path, "zara-another".into(), "true".into()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{invalid");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn simultaneous_setting_saves_keep_every_key() {
        let _guard = TEST_SETTINGS_LOCK.lock().unwrap();
        let path = test_settings_path();
        let workers: Vec<_> = (0..12)
            .map(|index| {
                let path = path.clone();
                std::thread::spawn(move || {
                    super::save_setting_file(
                        &path,
                        format!("zara-key-{index}"),
                        serde_json::json!(index.to_string()),
                    )
                    .unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(super::read_settings_file(&path).unwrap().len(), 12);
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn atomic_settings_save_retries_a_temporary_windows_file_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        let _guard = TEST_SETTINGS_LOCK.lock().unwrap();
        let path = test_settings_path();
        std::fs::write(&path, "{\"zara-existing\":\"true\"}").unwrap();
        // Allow reads and writes, but withhold FILE_SHARE_DELETE as an editor
        // or scanner can do. Replacing this file fails until the handle closes.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            drop(held);
        });
        super::save_setting_file(&path, "zara-new".into(), "false".into()).unwrap();
        release.join().unwrap();
        let settings = super::read_settings_file(&path).unwrap();
        assert_eq!(settings["zara-existing"], "true");
        assert_eq!(settings["zara-new"], "false");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_failed_setting_write_keeps_the_file_and_cache_then_allows_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let _guard = TEST_SETTINGS_LOCK.lock().unwrap();
        let path = test_settings_path();
        super::save_setting_file(&path, "zara-theme-mode".into(), "dark".into()).unwrap();
        let original = std::fs::read(&path).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        let result = super::save_setting_file(&path, "zara-theme-mode".into(), "light".into());
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert_eq!(
            crate::state::SETTINGS_CACHE.get().unwrap().lock().unwrap()["zara-theme-mode"],
            "dark"
        );
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
        drop(held);
        super::save_setting_file(&path, "zara-theme-mode".into(), "light".into()).unwrap();
        assert_eq!(
            super::read_settings_file(&path).unwrap()["zara-theme-mode"],
            "light"
        );
        assert_eq!(
            crate::state::SETTINGS_CACHE.get().unwrap().lock().unwrap()["zara-theme-mode"],
            "light"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn env_expansion() {
        let out = expand_env_vars("%SystemRoot%\\System32");
        assert!(out.to_lowercase().ends_with("\\system32"), "got {out}");
        assert!(!out.contains('%'), "got {out}");

        // Unknown variables stay verbatim
        assert_eq!(
            expand_env_vars("%ZARA_NOT_A_REAL_VAR%\\x"),
            "%ZARA_NOT_A_REAL_VAR%\\x"
        );

        // Unclosed percent is left alone
        assert_eq!(expand_env_vars("50% done"), "50% done");

        // Plain paths are untouched
        assert_eq!(expand_env_vars("C:\\plain\\path"), "C:\\plain\\path");
    }

    #[test]
    fn bare_executable_resolution() {
        use super::resolve_executable_path;

        for name in ["notepad", "notepad.exe", "msedge"] {
            let path =
                resolve_executable_path(name).unwrap_or_else(|| panic!("{name} did not resolve"));
            assert!(
                std::path::Path::new(&path).exists(),
                "{name} -> {path} does not exist"
            );
            assert!(path.to_lowercase().ends_with(".exe"), "{name} -> {path}");
        }

        // Already-qualified paths and nonsense are not resolved
        assert_eq!(resolve_executable_path("C:\\Windows\\notepad.exe"), None);
        assert_eq!(
            resolve_executable_path("zara-definitely-not-installed"),
            None
        );
        assert_eq!(resolve_executable_path(""), None);
    }

    #[test]
    fn replace_settings_cache_before_init_does_not_panic() {
        let _guard = TEST_SETTINGS_LOCK.lock().unwrap();
        use super::replace_settings_cache;
        use crate::state::SETTINGS_CACHE;

        // Mirrors a webview invoking save_setting before the setup hook has
        // initialized the cache.
        let mut settings = std::collections::HashMap::new();
        settings.insert("zara-test".to_string(), serde_json::json!("true"));
        replace_settings_cache(settings);

        let cache = SETTINGS_CACHE.get().expect("cache initialized");
        let guard = cache.lock().expect("cache lock");
        assert_eq!(
            guard.get("zara-test").and_then(|value| value.as_str()),
            Some("true")
        );
    }

}
