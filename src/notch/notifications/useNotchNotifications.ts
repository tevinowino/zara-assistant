import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ZaraMode } from "../types";
import {
	decideNotification,
	NOTIFICATION_SETTING_KEYS,
	withAppSeen,
	type IncomingNotification,
	type PillNotification,
	type SeenApp
} from "./notificationPolicy";
import {
	enqueueNotification,
	takeNextNotification,
	type QueuedNotification
} from "./notificationQueue";
import { useNotificationPreferences } from "./useNotificationPreferences";

/** How often a waiting pill checks whether the notch is free to show it, in milliseconds. */
const RETRY_INTERVAL_MS = 500;

export interface UseNotchNotificationsOptions {
	/** The window this notch runs in; notifications are only listened for in "main". */
	windowLabel: string;
	/** The notch's mode setting; "peek" reveals the notch for as long as a pill shows. */
	notchMode: string;
	/** Reveals the notch for the given number of milliseconds. */
	triggerEventPeek: (duration?: number) => void;
	/** Mirrors whether the notch is open; a pill never interrupts an open notch. */
	isOpenRef: MutableRefObject<boolean>;
	/** Mirrors the view the notch is showing; a pill never interrupts the shelf or a device alert. */
	zaraModeRef: MutableRefObject<ZaraMode>;
	/** Switches the notch to its notification view. */
	setZaraMode: (mode: ZaraMode) => void;
	/**
	 * Stealth is switched on but is not holding, so the notch could be on a shared screen.
	 * The pill then shows only the app's name.
	 */
	protectionLapsed: boolean;
}

/**
 * The short pill the notch shows when an app the user has allowed raises a Windows
 * notification. It turns the backend's reader on while the feature is on, applies the user's
 * choices (see `decideNotification`), and shows one pill at a time: others queue behind it,
 * and nothing interrupts an open notch, the shelf or a device alert. A waiting pill is shown
 * as soon as the notch is free, or dropped if it has waited too long to be news.
 */
export function useNotchNotifications({
	windowLabel,
	notchMode,
	triggerEventPeek,
	isOpenRef,
	zaraModeRef,
	setZaraMode,
	protectionLapsed
}: UseNotchNotificationsOptions) {
	const { preferences, save } = useNotificationPreferences();
	const preferencesRef = useRef(preferences);
	preferencesRef.current = preferences;
	const protectionLapsedRef = useRef(protectionLapsed);
	protectionLapsedRef.current = protectionLapsed;
	const notchModeRef = useRef(notchMode);
	notchModeRef.current = notchMode;
	const triggerEventPeekRef = useRef(triggerEventPeek);
	triggerEventPeekRef.current = triggerEventPeek;

	const [notification, setNotification] = useState<PillNotification | null>(null);
	// Read at once by code that has just changed it, before the next render.
	const notificationRef = useRef<PillNotification | null>(null);
	// True from a pill appearing until its exit animation has finished, so the clock row
	// only comes back once the pill has faded out.
	const [notificationOnScreen, setNotificationOnScreen] = useState(false);
	const queueRef = useRef<QueuedNotification[]>([]);
	const [anyWaiting, setAnyWaiting] = useState(false);
	const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearDismissTimer = () => {
		if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
		dismissTimerRef.current = null;
	};
	useEffect(() => clearDismissTimer, []);

	// The backend reads the Action Center only while the feature is on.
	useEffect(() => {
		if (windowLabel !== "main") return;
		invoke("notifications_enable", { enabled: preferences.enabled }).catch(() => {});
	}, [windowLabel, preferences.enabled]);

	const finishPill = useCallback(() => {
		clearDismissTimer();
		notificationRef.current = null;
		setNotification(null);
	}, []);

	const tryPresentRef = useRef<() => void>(() => {});
	tryPresentRef.current = () => {
		if (notificationRef.current) return;
		const mode = zaraModeRef.current;
		if (isOpenRef.current || mode === "shelf" || mode === "device") return;
		const { next, rest } = takeNextNotification(queueRef.current, Date.now());
		queueRef.current = rest;
		setAnyWaiting(rest.length > 0);
		if (!next) return;
		const durationMs = preferencesRef.current.durationMs;
		notificationRef.current = next;
		setNotification(next);
		setNotificationOnScreen(true);
		setZaraMode("notification");
		if (notchModeRef.current === "peek") triggerEventPeekRef.current(durationMs);
		clearDismissTimer();
		dismissTimerRef.current = setTimeout(() => {
			finishPill();
			tryPresentRef.current();
		}, durationMs);
	};

	// A pill that arrived while the notch was busy is shown as soon as it is free.
	useEffect(() => {
		if (!anyWaiting) return;
		const interval = setInterval(() => tryPresentRef.current(), RETRY_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [anyWaiting]);

	// Which apps have sent a notification is remembered (by name, never the text) so Settings
	// can list them for the user to allow.
	const rememberSeenApp = useCallback(
		(app: SeenApp) => {
			const seenApps = withAppSeen(preferencesRef.current.seenApps, app);
			preferencesRef.current = { ...preferencesRef.current, seenApps };
			void save(NOTIFICATION_SETTING_KEYS.seenApps, JSON.stringify(seenApps)).catch(() => {});
		},
		[save]
	);

	useEffect(() => {
		if (windowLabel !== "main") return;
		const unlisten = listen<IncomingNotification>("windows-notification", ({ payload }) => {
			const decision = decideNotification(payload, preferencesRef.current, {
				forceHideText: protectionLapsedRef.current
			});
			if (decision.newlySeenApp) rememberSeenApp(decision.newlySeenApp);
			if (!decision.pill) return;
			queueRef.current = enqueueNotification(queueRef.current, decision.pill, Date.now());
			setAnyWaiting(true);
			tryPresentRef.current();
		});
		return () => {
			void unlisten.then((stop) => stop());
		};
	}, [windowLabel, rememberSeenApp]);

	/** The user clicked the pill: it goes away, and the next one (if any) takes its place. */
	const dismiss = useCallback(() => {
		finishPill();
		tryPresentRef.current();
	}, [finishPill]);

	/** The pill's exit animation has finished. */
	const onPillExited = useCallback(() => {
		setNotificationOnScreen(notificationRef.current !== null);
	}, []);

	return { notification, notificationOnScreen, dismiss, onPillExited };
}
