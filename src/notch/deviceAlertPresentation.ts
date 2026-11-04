import type { DeviceArtKey } from "../devices/art";

// What a device alert says: wired and USB devices are plugged in, cards
// inserted, everything else connected.
export const PLUGGED_ART = new Set<DeviceArtKey>([
	"headphones-wired",
	"earbuds-usbc",
	"earbuds-jack",
	"flash-drive",
	"ssd",
	"hub",
	"webcam",
	"microphone"
]);
export function deviceAlertStatus(art: DeviceArtKey, connected: boolean, wired = false): string {
	if (art === "sd-card") return connected ? "Inserted" : "Removed";
	// A wired device is plugged in whatever it was picked to look like.
	if (wired || PLUGGED_ART.has(art)) return connected ? "Plugged in" : "Unplugged";
	return connected ? "Connected" : "Disconnected";
}

// How long a device alert stays in the pill.
export const DEVICE_ALERT_MS = { connected: 4200, disconnected: 2600 };
// How many alerts for other devices can wait behind the one showing.
export const DEVICE_ALERT_QUEUE = 3;
