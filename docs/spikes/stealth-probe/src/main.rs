//! Phase 1 spike: does SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) hide a
//! topmost window from real screen-capture APIs on this machine?
//!
//! The probe paints a solid magenta window, then for each affinity mode reads
//! the screen pixel behind the window's centre through two capture paths:
//!   1. GDI BitBlt of the whole screen (CAPTUREBLT, includes layered windows)
//!   2. DXGI Desktop Duplication (the path OBS display capture and most screen
//!      sharing tools use)
//! A capture that returns magenta leaked the window; anything else did not.
//! Assumes the primary monitor is at the virtual-screen origin.

use windows::core::{factory, w, Interface, PCWSTR};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

const MAGENTA: (u8, u8, u8) = (255, 0, 255);
const WIN_X: i32 = 120;
const WIN_Y: i32 = 120;
const WIN_W: i32 = 300;
const WIN_H: i32 = 200;
const PROBE_X: i32 = WIN_X + WIN_W / 2;
const PROBE_Y: i32 = WIN_Y + WIN_H / 2;

unsafe extern "system" fn wnd_proc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    DefWindowProcW(h, m, w, l)
}

fn pump(ms: u64) {
    let end = std::time::Instant::now() + std::time::Duration::from_millis(ms);
    unsafe {
        while std::time::Instant::now() < end {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}

fn create_probe_window(layered: bool) -> HWND {
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap();
        let class = w!("StealthProbe");
        let colorref = (MAGENTA.0 as u32) | ((MAGENTA.1 as u32) << 8) | ((MAGENTA.2 as u32) << 16);
        let brush = CreateSolidBrush(COLORREF(colorref));
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: class,
            hbrBackground: brush,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let mut ex = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        if layered {
            ex |= WS_EX_LAYERED;
        }
        let hwnd = CreateWindowExW(
            ex,
            class,
            PCWSTR::null(),
            WS_POPUP | WS_VISIBLE,
            WIN_X,
            WIN_Y,
            WIN_W,
            WIN_H,
            None,
            None,
            Some(hinst.into()),
            None,
        )
        .unwrap();
        if layered {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        hwnd
    }
}

fn gdi_pixel() -> (u8, u8, u8) {
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let (sw, sh) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        let bmp = CreateCompatibleBitmap(screen, sw, sh);
        let old = SelectObject(mem, bmp.into());
        let _ = BitBlt(mem, 0, 0, sw, sh, Some(screen), 0, 0, SRCCOPY | CAPTUREBLT);
        let px = GetPixel(mem, PROBE_X, PROBE_Y).0;
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        ((px & 0xff) as u8, ((px >> 8) & 0xff) as u8, ((px >> 16) & 0xff) as u8)
    }
}

fn dxgi_pixel() -> Result<(u8, u8, u8), String> {
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| e.to_string())?;
        // Walk every adapter/output and use the one whose desktop rectangle
        // contains the probe point (output 0 is not always the primary monitor).
        let mut found: Option<(IDXGIAdapter1, IDXGIOutput)> = None;
        let mut ai = 0;
        while let Ok(adapter) = factory.EnumAdapters1(ai) {
            let mut oi = 0;
            while let Ok(output) = adapter.EnumOutputs(oi) {
                let d = output.GetDesc().map_err(|e| e.to_string())?;
                let r = d.DesktopCoordinates;
                if PROBE_X >= r.left && PROBE_X < r.right && PROBE_Y >= r.top && PROBE_Y < r.bottom {
                    found = Some((adapter.clone(), output));
                    break;
                }
                oi += 1;
            }
            if found.is_some() {
                break;
            }
            ai += 1;
        }
        let (adapter, output) = found.ok_or("no output contains the probe point")?;
        let rect = output.GetDesc().map_err(|e| e.to_string())?.DesktopCoordinates;

        let mut device: Option<ID3D11Device> = None;
        let mut ctx: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_FLAG(0),
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        let device = device.ok_or("no device")?;
        let ctx = ctx.ok_or("no context")?;
        let output1: IDXGIOutput1 = output.cast().map_err(|e| e.to_string())?;
        let dup = output1
            .DuplicateOutput(&device)
            .map_err(|e| format!("DuplicateOutput: {e}"))?;

        let local_x = (PROBE_X - rect.left) as usize;
        let local_y = (PROBE_Y - rect.top) as usize;
        // Keep acquiring until a frame that actually carries desktop pixels
        // arrives (LastPresentTime != 0); earlier frames can be cursor-only.
        for _ in 0..40 {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut res: Option<IDXGIResource> = None;
            if dup.AcquireNextFrame(100, &mut info, &mut res).is_err() {
                // Nothing changed on screen; nudge the desktop so a frame is produced.
                let _ = SetCursorPos(10, 10);
                continue;
            }
            if info.LastPresentTime == 0 {
                let _ = dup.ReleaseFrame();
                continue;
            }
            let tex: ID3D11Texture2D = res.ok_or("no resource")?.cast().map_err(|e| e.to_string())?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            tex.GetDesc(&mut desc);
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            desc.MiscFlags = 0;
            let mut staging: Option<ID3D11Texture2D> = None;
            device
                .CreateTexture2D(&desc, None, Some(&mut staging))
                .map_err(|e| e.to_string())?;
            let staging = staging.ok_or("no staging")?;
            ctx.CopyResource(&staging, &tex);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(|e| e.to_string())?;
            let row = mapped.RowPitch as usize;
            let p = std::slice::from_raw_parts(mapped.pData as *const u8, row * desc.Height as usize);
            let off = local_y * row + local_x * 4;
            let (b, g, r) = (p[off], p[off + 1], p[off + 2]); // BGRA
            ctx.Unmap(&staging, 0);
            let _ = dup.ReleaseFrame();
            return Ok((r, g, b));
        }
        Err("no frame with desktop pixels acquired".into())
    }
}

fn wgc_pixel() -> Result<(u8, u8, u8), String> {
    unsafe {
        let hmon = MonitorFromPoint(POINT { x: PROBE_X, y: PROBE_Y }, MONITOR_DEFAULTTOPRIMARY);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(hmon, &mut mi).as_bool() {
            return Err("GetMonitorInfoW failed".into());
        }
        let interop: IGraphicsCaptureItemInterop =
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(|e| e.to_string())?;
        let item: GraphicsCaptureItem = interop.CreateForMonitor(hmon).map_err(|e| format!("CreateForMonitor: {e}"))?;

        let mut device: Option<ID3D11Device> = None;
        let mut ctx: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        let device = device.ok_or("no device")?;
        let ctx = ctx.ok_or("no context")?;
        let dxgi: IDXGIDevice = device.cast().map_err(|e| e.to_string())?;
        let winrt_device = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).map_err(|e| e.to_string())?;
        let winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
            winrt_device.cast().map_err(|e| e.to_string())?;

        let size = item.Size().map_err(|e| e.to_string())?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(|e| e.to_string())?;
        let session = pool.CreateCaptureSession(&item).map_err(|e| e.to_string())?;
        session.StartCapture().map_err(|e| e.to_string())?;

        let mut result = Err("no WGC frame within 3 s".to_string());
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(frame) = pool.TryGetNextFrame() {
                let surface = frame.Surface().map_err(|e| e.to_string())?;
                let access: IDirect3DDxgiInterfaceAccess = surface.cast().map_err(|e| e.to_string())?;
                let tex: ID3D11Texture2D = access.GetInterface().map_err(|e| e.to_string())?;
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                tex.GetDesc(&mut desc);
                desc.Usage = D3D11_USAGE_STAGING;
                desc.BindFlags = 0;
                desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                desc.MiscFlags = 0;
                let mut staging: Option<ID3D11Texture2D> = None;
                device.CreateTexture2D(&desc, None, Some(&mut staging)).map_err(|e| e.to_string())?;
                let staging = staging.ok_or("no staging")?;
                ctx.CopyResource(&staging, &tex);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(|e| e.to_string())?;
                let row = mapped.RowPitch as usize;
                let p = std::slice::from_raw_parts(mapped.pData as *const u8, row * desc.Height as usize);
                let lx = (PROBE_X - mi.rcMonitor.left) as usize;
                let ly = (PROBE_Y - mi.rcMonitor.top) as usize;
                let off = ly * row + lx * 4;
                result = Ok((p[off + 2], p[off + 1], p[off]));
                ctx.Unmap(&staging, 0);
                break;
            }
        }
        let _ = session.Close();
        let _ = pool.Close();
        result
    }
}

fn verdict(px: (u8, u8, u8)) -> &'static str {
    let near = |a: u8, b: u8| (a as i32 - b as i32).abs() <= 8;
    if near(px.0, MAGENTA.0) && near(px.1, MAGENTA.1) && near(px.2, MAGENTA.2) {
        "LEAKED"
    } else if px.0 < 8 && px.1 < 8 && px.2 < 8 {
        "BLACK"
    } else {
        "HIDDEN"
    }
}

fn main() {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    println!(
        "{:<22} {:<8} {:<8} {:<8} {:<8} detail",
        "variant", "affinity", "GDI", "DXGI", "WGC"
    );
    for (label, layered) in [("plain topmost popup", false), ("layered (like notch)", true)] {
        let hwnd = create_probe_window(layered);
        pump(400);
        for (name, flag) in [
            ("NONE", WDA_NONE),
            ("EXCLUDE", WDA_EXCLUDEFROMCAPTURE),
            ("MONITOR", WDA_MONITOR),
        ] {
            let applied = unsafe { SetWindowDisplayAffinity(hwnd, flag).is_ok() };
            pump(600);
            let mut read = 0u32;
            unsafe {
                let _ = GetWindowDisplayAffinity(hwnd, &mut read);
            }
            let gdi = gdi_pixel();
            let dxgi = dxgi_pixel();
            let wgc = wgc_pixel();
            let wgc_verdict = match &wgc {
                Ok(p) => verdict(*p).to_string(),
                Err(e) => format!("n/a:{e}"),
            };
            let dxgi_verdict = match &dxgi {
                Ok(p) => verdict(*p).to_string(),
                Err(_) => "n/a".to_string(),
            };
            println!(
                "{:<22} {:<8} {:<8} {:<8} {:<8} set_ok={applied} read_back=0x{read:x} gdi={gdi:?} dxgi={dxgi:?} wgc={wgc:?}",
                label,
                name,
                verdict(gdi),
                dxgi_verdict,
                wgc_verdict,
            );
        }
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
        pump(200);
    }
}
