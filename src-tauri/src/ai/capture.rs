//! Screenshots for the assistant.
//!
//! Captures the monitor the mouse is on, shrinks it to a size the model can
//! read without sending megabytes, and returns it as an inline JPEG.
//!
//! Known limits, reported to the user rather than hidden: protected video
//! (DRM) appears black, the secure desktop (UAC prompts) cannot be captured, and
//! a locked session has nothing to capture. Each fails with an error that the
//! chat turns into a text-only answer.

use super::chat::ScreenCapturer;
use super::llm::{AiError, InlineData};
use base64::Engine as _;
use image::{imageops::FilterType, ExtendedColorType, RgbaImage};

/// The long edge a screenshot is shrunk to. Larger images cost more and the
/// model does not read small text any better.
const MAX_LONG_EDGE: u32 = 1568;
/// Largest JPEG sent inline. Base64 adds a third on top, and providers behind
/// OpenRouter cap request sizes, so this stays far below any of their limits.
const MAX_JPEG_BYTES: usize = 3 * 1024 * 1024;
const QUALITY_STEPS: [u8; 4] = [80, 65, 50, 35];

/// The size an image shrinks to so its long edge is at most `max_long_edge`,
/// keeping its aspect ratio. Never enlarges, and never returns a zero side.
pub fn fit_within(width: u32, height: u32, max_long_edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= max_long_edge || long == 0 {
        return (width.max(1), height.max(1));
    }
    let scale = f64::from(max_long_edge) / f64::from(long);
    (((f64::from(width) * scale).round() as u32).max(1), ((f64::from(height) * scale).round() as u32).max(1))
}

fn encode_jpeg(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Shrinks and compresses a screenshot until it fits the size budget.
pub fn compress_for_model(image: RgbaImage) -> Result<InlineData, AiError> {
    let (width, height) = fit_within(image.width(), image.height(), MAX_LONG_EDGE);
    let mut current = if (width, height) == (image.width(), image.height()) {
        image
    } else {
        image::imageops::resize(&image, width, height, FilterType::Triangle)
    };

    // Quality first, then size: a noisy 4K desktop can need both.
    for _ in 0..4 {
        for quality in QUALITY_STEPS {
            let bytes = encode_jpeg(&current, quality).map_err(AiError::Capture)?;
            if bytes.len() <= MAX_JPEG_BYTES {
                return Ok(InlineData {
                    mime_type: "image/jpeg".to_string(),
                    base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                });
            }
        }
        let (smaller_width, smaller_height) = (current.width() * 3 / 4, current.height() * 3 / 4);
        if smaller_width == 0 || smaller_height == 0 {
            break;
        }
        current = image::imageops::resize(&current, smaller_width, smaller_height, FilterType::Triangle);
    }
    Err(AiError::Capture("the screenshot is too large to send".into()))
}

/// Copies the pixels of the monitor under the mouse pointer using GDI.
/// GDI sees what is composed on screen, including layered windows, and needs no
/// extra permission on Windows.
fn capture_monitor_under_cursor() -> Result<RgbaImage, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).map_err(|e| e.to_string())?;
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("the monitor could not be identified".into());
        }
        let area = info.rcMonitor;
        let (width, height) = (area.right - area.left, area.bottom - area.top);
        if width <= 0 || height <= 0 {
            return Err("the monitor has no visible area".into());
        }

        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("the screen is not available (is the session locked?)".into());
        }
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());

        let mut result = Err("the screen could not be copied".to_string());
        if BitBlt(memory, 0, 0, width, height, Some(screen), area.left, area.top, SRCCOPY | CAPTUREBLT).is_ok() {
            let mut header = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    // Negative height asks for rows top to bottom.
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; width as usize * height as usize * 4];
            let rows = GetDIBits(memory, bitmap, 0, height as u32, Some(pixels.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
            if rows != 0 {
                for pixel in pixels.as_chunks_mut::<4>().0 {
                    pixel.swap(0, 2); // BGRA -> RGBA
                    pixel[3] = 255;
                }
                result = RgbaImage::from_raw(width as u32, height as u32, pixels)
                    .ok_or_else(|| "the screen copy had an unexpected size".to_string());
            }
        }

        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        result
    }
}

/// The real screen, for the assistant.
pub struct DesktopScreenCapturer;

impl ScreenCapturer for DesktopScreenCapturer {
    async fn capture(&self) -> Result<InlineData, AiError> {
        tauri::async_runtime::spawn_blocking(|| {
            let image = capture_monitor_under_cursor().map_err(AiError::Capture)?;
            compress_for_model(image)
        })
        .await
        .map_err(|_| AiError::Capture("the capture was interrupted".into()))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_large_image_shrinks_to_the_long_edge_keeping_its_shape() {
        assert_eq!(fit_within(3840, 2160, 1568), (1568, 882));
        assert_eq!(fit_within(1080, 1920, 1568), (882, 1568));
    }

    #[test]
    fn an_image_already_small_enough_is_left_alone() {
        assert_eq!(fit_within(800, 600, 1568), (800, 600));
        assert_eq!(fit_within(1568, 1000, 1568), (1568, 1000));
    }

    #[test]
    fn a_very_thin_image_never_shrinks_to_a_zero_side() {
        assert_eq!(fit_within(20_000, 1, 1568), (1568, 1));
        assert_eq!(fit_within(0, 0, 1568), (1, 1));
    }

    fn noisy_image(width: u32, height: u32) -> RgbaImage {
        let mut seed = 0x2545_F491_4F6C_DD1D_u64;
        RgbaImage::from_fn(width, height, |_, _| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            image::Rgba([(seed & 0xff) as u8, ((seed >> 8) & 0xff) as u8, ((seed >> 16) & 0xff) as u8, 255])
        })
    }

    #[test]
    fn a_4k_screenshot_becomes_a_small_decodable_jpeg() {
        let inline = compress_for_model(noisy_image(3840, 2160)).unwrap();

        let bytes = base64::engine::general_purpose::STANDARD.decode(&inline.base64).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(inline.mime_type, "image/jpeg");
        assert!(bytes.len() <= MAX_JPEG_BYTES);
        assert_eq!((decoded.width(), decoded.height()), (1568, 882));
    }

    /// Needs a real, unlocked desktop, so it is not part of the normal run:
    /// `cargo test the_real_screen -- --ignored`.
    #[test]
    #[ignore = "captures the real screen"]
    fn the_real_screen_can_be_captured_and_compressed() {
        let screen = capture_monitor_under_cursor().expect("the screen should be capturable");
        let distinct_colours: std::collections::HashSet<[u8; 4]> =
            screen.pixels().step_by(997).map(|p| p.0).collect();

        let inline = compress_for_model(screen).unwrap();

        assert!(distinct_colours.len() > 1, "the capture should not be a single flat colour");
        assert!(inline.base64.len() > 1000);
    }

    #[test]
    fn a_small_screenshot_keeps_its_size() {
        let inline = compress_for_model(noisy_image(300, 200)).unwrap();

        let bytes = base64::engine::general_purpose::STANDARD.decode(&inline.base64).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (300, 200));
    }
}
