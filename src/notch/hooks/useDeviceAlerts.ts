import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import type { BudsBattery } from "../../devices/connectedDevices";
import type { DeviceArtKey } from "../../devices/art";
import { deviceArtFor } from "../../devices/deviceArtFor";
import { deviceLookFor } from "../../devices/deviceLooks";
import { isWiredAudio, usbArtFor, usbDisplayName } from "../../devices/usbArtFor";
import { DEVICE_ALERT_MS, DEVICE_ALERT_QUEUE } from "../deviceAlertPresentation";
import type { BluetoothConnection, DeviceAlert, UsbConnection, ZaraMode } from "../types";

export interface UseDeviceAlertsOptions {
	/** The window this notch runs in; alerts are only listened for in "main". */
	windowLabel: string;
	/** The notch's mode setting; "peek" reveals the notch for the length of an alert. */
	notchMode: string;
	/** Reveals the notch for the given number of milliseconds. */
	triggerEventPeek: (duration?: number) => void;
	/** Mirrors whether the notch is open; alerts never interrupt an open notch. */
	isOpenRef: MutableRefObject<boolean>;
	/** Mirrors the view the notch is showing; alerts never interrupt the shelf. */
	zaraModeRef: MutableRefObject<ZaraMode>;
	/** Switches the notch to its device alert view. */
	setZaraMode: (mode: ZaraMode) => void;
}

/**
 * The short alert the notch shows when a Bluetooth, USB or headphone-jack device
 * connects or disconnects. Alerts for other devices queue behind the one on screen,
 * and an open notch or the shelf is never interrupted.
 */
export function useDeviceAlerts({
	windowLabel,
	notchMode,
	triggerEventPeek,
	isOpenRef,
	zaraModeRef,
	setZaraMode
}: UseDeviceAlertsOptions) {
	const [deviceAlert, setDeviceAlert] = useState<DeviceAlert | null>(null);
	// Each connected earbud's own levels, as last reported, for Connected devices.
	const [budsById, setBudsById] = useState<Record<string, BudsBattery>>({});

	// True from an alert appearing until its exit animation has finished, so
	// the clock row only comes back once the alert has faded out.
	const [deviceAlertOnScreen, setDeviceAlertOnScreen] = useState(false);
	const deviceAlertRef = useRef<DeviceAlert | null>(null);
	deviceAlertRef.current = deviceAlert;
	const deviceAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (deviceAlertTimerRef.current) clearTimeout(deviceAlertTimerRef.current);
		},
		[]
	);

	// Alerts for other devices wait their turn (two drives plugged in
	// together show one after the other); a newer alert for the device on
	// screen replaces it. The queue is short: a burst of devices shouldn't
	// hold the notch for long.
	const deviceAlertQueueRef = useRef<Omit<DeviceAlert, "runId">[]>([]);
	const presentDeviceAlertRef = useRef<(alert: Omit<DeviceAlert, "runId">) => void>(() => {});
	presentDeviceAlertRef.current = (alert) => {
		const duration = alert.connected ? DEVICE_ALERT_MS.connected : DEVICE_ALERT_MS.disconnected;
		setDeviceAlert({ ...alert, runId: Date.now() });
		setDeviceAlertOnScreen(true);
		setZaraMode("device");
		if (notchMode === "peek") triggerEventPeek(duration);
		if (deviceAlertTimerRef.current) clearTimeout(deviceAlertTimerRef.current);
		deviceAlertTimerRef.current = setTimeout(() => {
			const next = deviceAlertQueueRef.current.shift();
			if (next && !isOpenRef.current) presentDeviceAlertRef.current(next);
			else {
				deviceAlertQueueRef.current = [];
				setDeviceAlert(null);
			}
		}, duration);
	};
	const showDeviceAlert = useCallback((alert: Omit<DeviceAlert, "runId">) => {
		const mode = zaraModeRef.current;
		if (isOpenRef.current || mode === "shelf") return;
		const current = deviceAlertRef.current;
		if (current && current.id !== alert.id) {
			const queue = deviceAlertQueueRef.current.filter((queued) => queued.id !== alert.id);
			deviceAlertQueueRef.current = [...queue, alert].slice(-DEVICE_ALERT_QUEUE);
			return;
		}
		presentDeviceAlertRef.current(alert);
	}, []);

	useEffect(() => {
		if (windowLabel !== "main") return;
		const unlistenConnection = listen<BluetoothConnection>(
			"bluetooth-connection",
			({ payload }) => {
				showDeviceAlert({
					id: payload.id,
					art: deviceLookFor(payload.name) ?? deviceArtFor(payload),
					name: payload.name,
					connected: payload.connected,
					battery: payload.battery
				});
				// A disconnected device's bud levels are out of date by its next connect.
				if (!payload.connected) {
					setBudsById((all) => {
						if (!(payload.id in all)) return all;
						const { [payload.id]: _gone, ...rest } = all;
						return rest;
					});
				}
			}
		);
		// Windows often reports a battery level a moment after the device
		// connects; fill it into the alert if that device is still showing.
		const unlistenBattery = listen<{ id: string; battery: number }>(
			"bluetooth-battery",
			({ payload }) => {
				setDeviceAlert((alert) =>
					alert && alert.id === payload.id && alert.connected
						? { ...alert, battery: payload.battery }
						: alert
				);
			}
		);
		// Earbuds that report each bud's and the case's level send them a
		// moment after connecting.
		const unlistenBuds = listen<BudsBattery & { id: string }>("bluetooth-buds", ({ payload }) => {
			const { id, ...buds } = payload;
			setDeviceAlert((alert) =>
				alert && alert.id === id && alert.connected ? { ...alert, buds } : alert
			);
			setBudsById((all) => ({ ...all, [id]: buds }));
		});
		// USB devices, and what's plugged into the 3.5 mm jack. A wired audio
		// device's drawing can be picked in Connected devices.
		const showWired = ({ payload }: { payload: UsbConnection }) => {
			const name = usbDisplayName(payload);
			showDeviceAlert({
				id: payload.id,
				art: (isWiredAudio(payload.class) ? deviceLookFor(name) : null) ?? usbArtFor(payload),
				name,
				connected: payload.connected,
				battery: null,
				usb: true
			});
		};
		const unlistenUsb = listen<UsbConnection>("usb-connection", showWired);
		const unlistenJack = listen<UsbConnection>("wired-audio-connection", showWired);
		return () => {
			unlistenConnection.then((f) => f());
			unlistenBattery.then((f) => f());
			unlistenUsb.then((f) => f());
			unlistenJack.then((f) => f());
			unlistenBuds.then((f) => f());
		};
	}, [windowLabel, showDeviceAlert]);

	// In a dev build, any drawing can be shown from the console, e.g.
	// __zaraDeviceAlert("stem-buds", "AirPods Pro", true, 82), and a late
	// battery report sent with __zaraDeviceBattery("dev", 64).
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		const w = window as unknown as Record<string, unknown>;
		w.__zaraDeviceAlert = (
			art: DeviceArtKey,
			name: string,
			connected = true,
			battery: number | null = null
		) => showDeviceAlert({ id: "dev", art, name, connected, battery });
		// __zaraUsb("disk", "SanDisk Cruzer Blade USB Device", true, "a")
		// stands in for the backend's usb-connection event.
		w.__zaraUsb = (kind: string, name: string, connected = true, id = "usb-dev") =>
			showDeviceAlert({
				id,
				art: usbArtFor({ class: kind, name }),
				name: usbDisplayName({ class: kind, name }),
				connected,
				battery: null,
				usb: true
			});
		// __zaraDeviceBuds("dev", [90, false], [80, true], [40, false]) stands
		// in for bluetooth-buds; pass null for a part with no reading.
		const part = (p: [number, boolean] | null) => (p ? { level: p[0], charging: p[1] } : null);
		w.__zaraDeviceBuds = (
			id: string,
			left: [number, boolean] | null,
			right: [number, boolean] | null,
			caseLevel: [number, boolean] | null
		) =>
			setDeviceAlert((alert) =>
				alert && alert.id === id && alert.connected
					? { ...alert, buds: { left: part(left), right: part(right), case: part(caseLevel) } }
					: alert
			);
		w.__zaraDeviceBattery = (id: string, battery: number) =>
			setDeviceAlert((alert) =>
				alert && alert.id === id && alert.connected ? { ...alert, battery } : alert
			);
	}, [showDeviceAlert]);

	// The clock row normally returns when the alert's exit animation ends.
	// If the alert never rendered (the notch was still starting up), there's
	// no exit to wait for, so bring it back shortly after the alert ends.
	useEffect(() => {
		if (deviceAlert) return;
		const timer = setTimeout(() => setDeviceAlertOnScreen(false), 400);
		return () => clearTimeout(timer);
	}, [deviceAlert]);

	return {
		deviceAlert,
		setDeviceAlert,
		budsById,
		deviceAlertOnScreen,
		setDeviceAlertOnScreen,
		deviceAlertRef,
		deviceAlertQueueRef
	};
}
