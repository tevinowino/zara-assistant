import type { BudsBattery } from "../devices/connectedDevices";
import type { DeviceArtKey } from "../devices/art";
import type { UsbIdentity } from "../devices/usbArtFor";

/**
 * The notch has two kinds of content:
 * - Panels are tools the user chooses. A click opens the last-used panel by
 *   default, or a selected fixed panel when panel memory is turned off.
 * - Live activities (music, a set timer, a filled shelf) show a compact form in
 *   the pill or a bubble beside it, and opening one shows its own view, which
 *   stands alone (no panel arrows) and is never remembered as the last panel.
 *   Dragging files onto the notch also opens the shelf. Wheel/swipe switches
 *   between tool panels, including when a live activity occupies the pill.
 */
export type NotchPanel = "ai" | "calendar" | "command-center" | "devices";
export const NOTCH_PANELS: readonly NotchPanel[] = ["ai", "calendar", "command-center", "devices"];
export const asNotchPanel = (value: unknown): NotchPanel | null =>
	NOTCH_PANELS.includes(value as NotchPanel) ? (value as NotchPanel) : null;

export interface MediaInfo {
	title: string;
	artist: string;
	is_playing: boolean;
	has_media: boolean;
	artwork?: string[];
	position_ms?: number;
	duration_ms?: number;
	seek_enabled?: boolean;
	position_updated_at?: number;
}

export interface WifiStatus {
	enabled: boolean;
	connected: boolean;
	ssid: string | null;
}

// A shelf file's preview from the backend: a picture when one can be made,
// else the opening text of a document or text file, and whether it's a folder
// (for the placeholder icon).
export interface ShelfPreview {
	thumb: string | null;
	text: string | null;
	folder: boolean;
}

export interface ShelfItem {
	id: string;
	type: "file" | "text";
	name: string;
	path?: string;
	text?: string;
	timestamp: number;
}

export type ZaraMode =
	| "music"
	| "calendar"
	| "command-center"
	| "status"
	| "shelf"
	| "wifi"
	| "bluetooth"
	| "devices"
	| "ai"
	| "device";

// A device that just connected or disconnected, shown briefly in the pill.
export interface DeviceAlert {
	// The device's id, so a later battery report can find its alert.
	id: string;
	art: DeviceArtKey;
	name: string;
	connected: boolean;
	battery: number | null;
	// Each bud's and the case's battery, for earbuds that report them.
	buds?: BudsBattery | null;
	// A USB device, which has no list to open when the alert is clicked.
	usb?: boolean;
	// Changes on every alert, so the drawing replays its animation.
	runId: number;
}

// As sent by the backend's `bluetooth-connection` event.
export interface BluetoothConnection {
	id: string;
	name: string;
	kind: string;
	form: string | null;
	connected: boolean;
	battery: number | null;
}

/** A USB device plugged in or removed, from the backend's `usb-connection`. */
export interface UsbConnection extends UsbIdentity {
	/** The device's container id. */
	id: string;
	connected: boolean;
}
