import { motion, AnimatePresence } from "framer-motion";
import {
	useEffect,
	useLayoutEffect,
	useState,
	useCallback,
	useMemo,
	useRef,
	lazy,
	Suspense
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import { batteryTooltip } from "./batteryTooltip";
import { createRegionSender, measureElements, notchPillBox, type RegionRect } from "./windowRegion";
import "./App.css";
import "./glisse.css";
import { initTheme } from "./theme";
import { MusicNoteIcon } from "./icons";
import { useWeather } from "./hooks/useWeather";

import { EdgeSurface } from "./components/EdgeSurface";
import { WifiPanel } from "./components/WifiPanel";
import { BluetoothPanel } from "./components/BluetoothPanel";
import { DeviceArtDefs } from "./devices/DeviceArt";

import { ConnectedDevicesPanel } from "./components/ConnectedDevicesPanel";
import { AiSessionHost, createAiSessionStore, useAiSessionSelector } from "./ai/aiSessionStore";
import { ASK_BAR_ROW_HEIGHT } from "./ai/AskBar";
import { loadAiPanel, preloadAiPanelWhenIdle } from "./ai/loadAiPanel";
import { frameProbeRequested, startFramePacingProbe } from "./diagnostics/framePacingProbe";
import { wantsKeyboardFocus } from "./notch/keyboardFocus";
import { useDeferredKeyboardFocus } from "./notch/hooks/useDeferredKeyboardFocus";
import { useDelayedAction } from "./notch/hooks/useDelayedAction";
import { AI_PANEL_HEIGHT, AI_PANEL_WIDTH, fitAiPanelHeight } from "./ai/panelSize";

// The assistant panel pulls in markdown, math, charts and diagrams, so it stays out
// of the entry bundle. It is fetched in the background shortly after start-up and
// when the pointer reaches the notch, so opening it does not wait on loading code.
const AiPanel = lazy(() => loadAiPanel().then((module) => ({ default: module.ConnectedAiPanel })));
import { useConnectedDevices } from "./hooks/useConnectedDevices";

import { Cpu, MemoryStick, HardDrive, ArrowUpDown, BellRing, ChevronLeft, ChevronRight } from "./icons/glyphs";

import { BatteryIcon } from "./notch/icons/StatusIcons";

import { Visualizer } from "./notch/components/Visualizer";
import { type NotchPanel, asNotchPanel, type ZaraMode } from "./notch/types";
import { isPanelEnabled } from "./notch/panels/notchPanels";

import { useTimer } from "./notch/timer/useTimer";
import { useStealth } from "./stealth/useStealth";
import { ClockFace } from "./notch/clock/ClockFace";
import { clockParts, sameClockParts, type ClockParts } from "./notch/clock/clockParts";
import { StealthBadge, StealthRim } from "./notch/components/StealthMark";
import { useSystemStats } from "./notch/hooks/useSystemStats";
import { useBattery } from "./notch/hooks/useBattery";
import { useMediaPlayback } from "./notch/hooks/useMediaPlayback";
import { useQuickSettings } from "./notch/hooks/useQuickSettings";
import { useDeviceAlerts } from "./notch/hooks/useDeviceAlerts";
import { useNotchSettings } from "./notch/hooks/useNotchSettings";
import { useShelf } from "./notch/hooks/useShelf";
import { ShelfPanel } from "./notch/views/ShelfPanel";
import {
	CALENDAR_TIMER_PANEL_HEIGHT_PX,
	CALENDAR_TIMER_PANEL_WIDTH_PX,
	CalendarTimerPanel
} from "./notch/views/CalendarTimerPanel";
import { DeviceAlertBubble } from "./notch/views/DeviceAlertBubble";
import {
	COMMAND_CENTER_PANEL_WIDTH_PX,
	commandCenterPanelHeight,
	ControlsPanel
} from "./notch/views/ControlsPanel";
import { NOTES_PANEL_HEIGHT_PX, NOTES_PANEL_WIDTH_PX, NotesPanel } from "./notch/views/NotesPanel";
import {
	WEATHER_PANEL_HEIGHT_PX,
	WEATHER_PANEL_WIDTH_PX,
	WeatherPanel
} from "./notch/views/WeatherPanel";
import {
	CLIPBOARD_PANEL_HEIGHT_PX,
	CLIPBOARD_PANEL_WIDTH_PX,
	ClipboardPanel
} from "./notch/views/ClipboardPanel";
import { useClipboardMonitor } from "./notch/clipboard/useClipboardHistory";
import { MusicPlayerView } from "./notch/views/MusicPlayerView";
import { MusicBubble } from "./notch/views/MusicBubble";
import { ShelfBubble } from "./notch/views/ShelfBubble";
import { useStartupUpdateOffer } from "./updates/useStartupUpdateOffer";

// The Connected devices panel grows with its list between these heights;
// the maximum is the size the panel had before it grew to fit.
const DEVICES_MIN_HEIGHT = 150;
const DEVICES_MAX_HEIGHT = 300;

/** How long an open notch waits after the pointer leaves it before it closes. */
const NOTCH_CLOSE_DELAY_MS = 1200;

function App() {
	useEffect(() => {
		return initTheme();
	}, []);

	const [clock, setClock] = useState<ClockParts>({ time: "", dayPeriod: null });
	const [isHovered, setIsHovered] = useState(false);
	// Expanded into a panel by a click. Hover alone only peeks.
	const [isOpen, setIsOpen] = useState(false);
	const isOpenRef = useRef(false);
	isOpenRef.current = isOpen;
	const [isReady, setIsReady] = useState(false);
	const [windowLabel, setWindowLabel] = useState<string>("");
	useEffect(() => {
		setWindowLabel(getCurrentWebviewWindow().label);
	}, []);

	const {
		scale,
		timeFormat24h,
		notchMode,
		setNotchMode,
		statusWidgets,
		systemSettingsReady,
		waitForStartupSplash,
		settingsWeatherEnabled,
		settingsCalendarEnabled,
		panelPreferences,
		quickApps,
		settingsDevicesPanelEnabled,
		settingsTimerSoundEnabled,
		settingsMusicModeEnabled,
		rememberPanelEnabled,
		rememberPanelEnabledRef,
		defaultPanel,
		lastPanel,
		setLastPanel,
		settingsMusicCompactNotch,
		shelfPersist,
		settingsVisualizerEnabled,
		settingsAlbumArtEnabled,
		settingsAmbienceEnabled,
		settingsCompactGlowEnabled,
		settingsCornersEnabled,
		mediaLayout,
		setMediaLayout,
		lowBatteryThreshold
	} = useNotchSettings({ windowLabel });

	// The status widget whose tooltip is open, the side of the pill it hangs
	// from, and the distance from the widget to just past that edge.
	const [statusTooltip, setStatusTooltip] = useState<{
		id: string;
		side: "below" | "left" | "right";
		offset: number;
	} | null>(null);
	const statusTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Width the hovered status strip needs so neither side runs into the clock.
	const [statusFitWidth, setStatusFitWidth] = useState(0);

	const [eventPeek, setEventPeek] = useState(false);
	const eventPeekTimeoutRef = useRef<any>(null);
	const triggerEventPeek = useCallback((duration = 3000) => {
		setEventPeek(true);
		if (eventPeekTimeoutRef.current) clearTimeout(eventPeekTimeoutRef.current);
		eventPeekTimeoutRef.current = setTimeout(() => setEventPeek(false), duration);
	}, []);

	const {
		batteryLevel,
		isCharging,
		batteryDetails,
		showPowerPulse,
		showLowBatteryPulse,
		refreshBatteryDetails
	} = useBattery({ isReady, notchMode, triggerEventPeek, lowBatteryThreshold });

	// Weather state (managed by useWeather hook)

	// System metrics for status widgets

	// The height the Connected devices panel's content needs; the open notch
	// follows it up to DEVICES_MAX_HEIGHT, past which the list scrolls.
	const [devicesContentHeight, setDevicesContentHeight] = useState(DEVICES_MAX_HEIGHT);
	const devicesPanelHeight = Math.min(
		DEVICES_MAX_HEIGHT,
		Math.max(DEVICES_MIN_HEIGHT, devicesContentHeight)
	);

	const [isVisible, setIsVisible] = useState(true);
	const [isImpacted, setIsImpacted] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startupAnimating, setStartupAnimating] = useState(false);

	const [isNotchHovered, setIsNotchHovered] = useState(false);

	const [isEdgeHovered, setIsEdgeHovered] = useState(false);
	const [isOverlapped, setIsOverlapped] = useState(false);
	const [interactionState, setInteractionState] = useState<"active" | "grace" | "none">("none");
	const zaraRef = useRef<HTMLDivElement>(null);
	// Measured to fit the hovered status strip; see statusFitWidth.
	const leftWidgetsRef = useRef<HTMLDivElement>(null);
	const rightWidgetsRef = useRef<HTMLDivElement>(null);
	const timeCenterRef = useRef<HTMLDivElement>(null);
	const musicBubbleRef = useRef<HTMLButtonElement>(null);
	const shelfBubbleRef = useRef<HTMLButtonElement>(null);
	const reportNotchRect = useRef<() => void>(() => {});
	// The pill's target box in window CSS px, and the sender that applies the
	// notch window's region (holding earlier regions while it shrinks).
	const pillTargetRef = useRef<RegionRect | null>(null);
	const sendNotchRegion = useMemo(
		() =>
			createRegionSender((rects) => {
				invoke("set_window_region", { rects }).catch(() => {});
			}),
		[]
	);

	// Recomputes the notch window's region from the pill's target box and the
	// floating parts drawn around it, and sends it if it changed. Reads only
	// refs and the DOM, so it is safe to call from any callback.
	const updateNotchRegion = () => {
		const wanted: RegionRect[] = [];
		if (pillTargetRef.current) wanted.push(pillTargetRef.current);
		// Each floating part, padded to cover what it paints outside its box: a
		// tooltip card's shadow reaches 20px out plus a 6px drop, a bubble's
		// glow less, and the screen corners nothing.
		wanted.push(
			...measureElements([
				[".activity-bubble", 16],
				[".status-tooltip", 28],
				[".screen-corner", 0]
			])
		);
		sendNotchRegion(wanted);
	};
	const initialSystemSyncDone = useRef(false);
	const splashDone = useRef(false);
	const systemSyncQueue = useRef<Promise<void>>(Promise.resolve());
	const appliedNotchMode = useRef<string | null>(null);

	// Zara mode state: 'music', 'calendar', 'command-center', 'announcement', 'shelf', or 'status'
	const [zaraMode, setZaraMode] = useState<ZaraMode>("status");
	const zaraModeRef = useRef<ZaraMode>("status");

	// A device connecting or disconnecting takes the pill for a few seconds,
	// like the Dynamic Island: its drawing, name and battery. It never takes
	// over a notch the user has open, an announcement or the shelf. In peek
	// and smart modes it shows the notch for as long as it lasts.
	const deviceAlerts = useDeviceAlerts({
		windowLabel,
		notchMode,
		triggerEventPeek,
		isOpenRef,
		zaraModeRef,
		setZaraMode
	});
	const { deviceAlert, budsById, deviceAlertOnScreen } = deviceAlerts;

	const isAnyInteraction = isHovered || isNotchHovered || isEdgeHovered;
	const isHidden =
		!startupAnimating &&
		!deviceAlertOnScreen &&
		((notchMode === "smart" && isOverlapped && interactionState === "none") ||
			(notchMode === "peek" && interactionState === "none" && !eventPeek));

	useEffect(() => {
		if (isAnyInteraction) {
			setInteractionState("active");
		} else if (interactionState !== "none") {
			setInteractionState("grace");
			const timer = setTimeout(() => setInteractionState("none"), 800);
			return () => clearTimeout(timer);
		}
	}, [isAnyInteraction]);

	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_hovered", { hovered: isNotchHovered }).catch(() => {});
		}
	}, [isNotchHovered, windowLabel]);

	// Tell the backend whether the notch is actually on screen so a hidden
	// notch (smart/peek mode) stays click-through instead of swallowing clicks
	// in its footprint.
	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_visible", { visible: isVisible && !isHidden }).catch(() => {});
		}
	}, [isVisible, isHidden, windowLabel]);

	useEffect(() => {
		const updateRect = () => {
			if (zaraRef.current && windowLabel === "main") {
				// Activity bubbles sit beside the pill and must stay clickable too.
				const rects = [zaraRef.current, musicBubbleRef.current, shelfBubbleRef.current]
					.filter((el): el is NonNullable<typeof el> => el !== null)
					.map((el) => el.getBoundingClientRect());
				const left = Math.min(...rects.map((r) => r.left));
				const top = Math.min(...rects.map((r) => r.top));
				const right = Math.max(...rects.map((r) => r.right));
				const bottom = Math.max(...rects.map((r) => r.bottom));
				invoke("update_notch_rect", {
					rect: {
						x: Math.round(left),
						y: Math.round(top),
						width: Math.round(right - left),
						height: Math.round(bottom - top)
					}
				}).catch(() => {});
				// Bubbles finishing their entrance land here too.
				updateNotchRegion();
			}
		};
		reportNotchRect.current = updateRect;

		updateRect();
		window.addEventListener("resize", updateRect);
		const observer = new ResizeObserver(updateRect);
		if (zaraRef.current) observer.observe(zaraRef.current);

		return () => {
			window.removeEventListener("resize", updateRect);
			observer.disconnect();
		};
	}, [isExpanded, isHidden, windowLabel, scale]);

	useEffect(() => {
		if (!windowLabel) return;

		// Only animate the main top-bar
		if (windowLabel !== "main") {
			setIsReady(true);
			setIsImpacted(true);
			setIsExpanded(true);
			return;
		}

		const proceedWithStartup = () => {
			const checkVisibility = async () => {
				try {
					const win = getCurrentWebviewWindow();
					const visible = await win.isVisible();
					if (visible) {
						setStartupAnimating(true);
						setIsReady(true);
						// The window is shown here; WebView2 may only create its
						// render child now, so refresh the drop targets.
						invoke("setup_shelf_drop").catch(() => {});
						setTimeout(() => {
							setIsImpacted(true);
							setIsExpanded(true);
						}, 240);
						setTimeout(() => setStartupAnimating(false), 1500);
						return true;
					}
				} catch (e) {}
				return false;
			};

			const interval = setInterval(async () => {
				if (await checkVisibility()) clearInterval(interval);
			}, 100);

			checkVisibility();
			return interval;
		};

		// Mirror Overlay.tsx's splash decision so we only wait when a splash will actually fire.
		// Overlay always emits splash-done, but on a normal relaunch it emits it near-instantly
		// (after one async getVersion() call) — before this listener would be registered.
		// By making the same decision here we avoid a race and avoid any unnecessary delay.
		const firstRun = localStorage.getItem("zara-first-run") === null;
		const storedVersion = localStorage.getItem("zara-app-version");

		const waitForSplash = () => {
			// Splash is definitely coming — register listener now (2800ms animation gives us plenty of time)
			let started = false;
			let interval: any;
			const unlistenSplash = listen("splash-done", () => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			});
			const safetyTimer = setTimeout(() => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			}, 6000);
			return () => {
				clearTimeout(safetyTimer);
				if (interval) clearInterval(interval);
				unlistenSplash.then((fn) => fn());
			};
		};

		if (firstRun || storedVersion === null) {
			// Splash is definitely showing — wait for it
			return waitForSplash();
		}

		// Has a version key — need async check to know if version changed
		let interval: any;
		getVersion()
			.then((currentVersion) => {
				if (storedVersion !== currentVersion) {
					// Version changed — splash is coming, wait for it
					// (splash takes 2800ms so there's plenty of time to register the listener)
					waitForSplash();
				} else {
					// Same version — no splash, start immediately
					interval = proceedWithStartup();
				}
			})
			.catch(() => {
				interval = proceedWithStartup();
			});
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [windowLabel]);

	// The assistant conversation lives here, not in the panel, so it survives the
	// notch collapsing and reopening.
	// With "remember where I left off" on, the assistant also picks up the last
	// conversation at launch, not only the last panel.
	// Held outside App's own state so a streaming answer re-renders the panel, not the notch.
	const [aiSessionStore] = useState(createAiSessionStore);
	const aiBusy = useAiSessionSelector(
		aiSessionStore,
		(session) => session.phase === "sending",
		false
	);
	useEffect(() => {
		if (windowLabel === "main") return preloadAiPanelWhenIdle();
	}, [windowLabel]);
	// Off unless switched on in DevTools; see diagnostics/framePacingProbe.ts.
	useEffect(() => {
		if (windowLabel !== "main" || !frameProbeRequested()) return;
		return startFramePacingProbe((event, detail) => {
			invoke("record_diagnostic", { event, detail }).catch(() => {});
		});
	}, [windowLabel]);
	useStartupUpdateOffer();
	const [aiPanelHeight, setAiPanelHeight] = useState<number>(AI_PANEL_HEIGHT.welcome);
	const connectedDevices = useConnectedDevices(
		windowLabel === "main" && settingsDevicesPanelEnabled
	);
	const [compactVolumeExpanded, setCompactVolumeExpanded] = useState(false);

	// Weather hook
	const {
		temperature,
		weatherCondition,
		weatherIcon: WeatherIcon,
		cityName,
		tempUnit
	} = useWeather(settingsWeatherEnabled);

	useEffect(() => {
		// Disable context menu globally
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext);

		const unlistenVisibility = listen<boolean>("visibility-change", (event) => {
			setIsVisible(event.payload);
		});

		const unlistenNotchOverlap = listen<boolean>("notch-overlap", (event) => {
			setIsOverlapped(event.payload);
		});

		const unlistenNotchEdgeHover = listen<boolean>("notch-edge-hover", (event) => {
			setIsEdgeHovered(event.payload);
		});

		// The backend emits this when the window flips to click-through while
		// the webview still thinks the pointer is inside the notch (it cannot
		// receive the mouseleave once the window is click-through).
		const unlistenNotchPointerLeft = listen("notch-pointer-left", () => {
			releaseNotchHover();
		});

		return () => {
			unlistenVisibility.then((f) => f());
			unlistenNotchOverlap.then((f) => f());
			unlistenNotchEdgeHover.then((f) => f());
			unlistenNotchPointerLeft.then((f) => f());
			document.removeEventListener("contextmenu", preventContext);
		};
	}, [windowLabel]);

	// One owner applies the latest window settings. Superseded splash timers and
	// retries are cancelled; an in-flight command finishes before the new state
	// is applied, so an old startup retry cannot overwrite a user change.
	useEffect(() => {
		if (windowLabel !== "main" || !systemSettingsReady) return;

		let cancelled = false;
		let started = false;
		let attempts = 0;
		let startTimer: number | undefined;
		let splashTimer: number | undefined;
		let retryTimer: number | undefined;
		let settleTimer: number | undefined;
		let unlistenSplash: (() => void) | undefined;

		const reconcile = () => {
			systemSyncQueue.current = systemSyncQueue.current
				.catch(() => {})
				.then(async () => {
					if (cancelled) return;
					try {
						if (cancelled) return;
						if (appliedNotchMode.current !== notchMode) {
							await invoke("change_notch_mode", { mode: notchMode });
							appliedNotchMode.current = notchMode;
						}
						if (cancelled) return;
						await invoke("sync_appbar");
						if (cancelled) return;
						const wasInitialSync = !initialSystemSyncDone.current;
						initialSystemSyncDone.current = true;
						if (wasInitialSync) {
							settleTimer = window.setTimeout(() => {
								if (!cancelled) {
									systemSyncQueue.current = systemSyncQueue.current
										.catch(() => {})
										.then(() => invoke<void>("sync_appbar"))
										.catch((error) => console.error("AppBar settle failed", error));
								}
							}, 1000);
						}
					} catch (error) {
						console.error("Window reconciliation failed", error);
						if (!cancelled && attempts++ < 1) {
							retryTimer = window.setTimeout(reconcile, 1000);
						}
					}
				});
		};

		const start = () => {
			if (cancelled || started) return;
			started = true;
			splashDone.current = true;
			if (splashTimer !== undefined) window.clearTimeout(splashTimer);
			unlistenSplash?.();
			startTimer = window.setTimeout(reconcile, initialSystemSyncDone.current ? 0 : 400);
		};

		if (waitForStartupSplash && !splashDone.current && !initialSystemSyncDone.current) {
			void listen("splash-done", start)
				.then((unlisten) => {
					if (cancelled || started) unlisten();
					else unlistenSplash = unlisten;
				})
				.catch(() => start());
			splashTimer = window.setTimeout(start, 6000);
		} else {
			start();
		}

		return () => {
			cancelled = true;
			for (const timer of [startTimer, splashTimer, retryTimer, settleTimer]) {
				if (timer !== undefined) window.clearTimeout(timer);
			}
			unlistenSplash?.();
		};
	}, [windowLabel, systemSettingsReady, waitForStartupSplash, notchMode]);

	// What the collapsed notch shows (see collapsedMode). Refs let the drop
	// listener and the backend pointer-left event, both mounted once, act on
	// the current state.
	const restingModeRef = useRef<ZaraMode>("status");
	const rememberPanelRef = useRef<(panel: NotchPanel) => void>(() => {});
	const openingPanelRef = useRef<() => NotchPanel>(() => "command-center");
	const notchPinnedRef = useRef(false);
	const releaseDeferredRef = useRef(false);

	// An open notch waits this long after the pointer leaves before it closes,
	// so a slip off the edge while reading or scrolling does not lose the panel.
	// Coming back cancels it. The notch that is only showing its hover state
	// (not open) still lets go at once.
	const closeAfterPointerLeaves = useDelayedAction(NOTCH_CLOSE_DELAY_MS);

	// Closes an open notch, remembering its panel, and returns to the resting mode.
	const collapseNotch = () => {
		// A view being typed into (a Wi-Fi password) keeps the notch open; the
		// release happens once it lets go, if the pointer is still away.
		if (notchPinnedRef.current) {
			releaseDeferredRef.current = true;
			return;
		}
		setIsHovered(false);
		setIsNotchHovered(false);
		if (isOpenRef.current) {
			const panel = asNotchPanel(zaraModeRef.current);
			if (panel && rememberPanelEnabledRef.current) rememberPanelRef.current(panel);
			setIsOpen(false);
		}
		setZaraMode((prev) =>
			prev === "music" ||
			prev === "command-center" ||
			prev === "calendar" ||
			prev === "status" ||
			prev === "shelf" ||
			prev === "wifi" ||
			prev === "bluetooth" ||
			prev === "devices" ||
			prev === "notes" ||
			prev === "clipboard" ||
			prev === "weather" ||
			prev === "ai"
				? restingModeRef.current
				: prev
		);
	};

	// Shared hover-release, called on DOM hover end and when the backend
	// reports the pointer left the (now click-through) notch window.
	const releaseNotchHover = () => {
		if (isOpenRef.current) closeAfterPointerLeaves.schedule(collapseNotch);
		else collapseNotch();
	};

	const shelf = useShelf({
		shelfPersist,
		zaraMode,
		isOpen,
		isOpenRef,
		zaraModeRef,
		restingModeRef,
		setIsOpen,
		setZaraMode,
		openingPanelRef,
		releaseNotchHover
	});
	const { shelfItems, shelfOverflowing, clearShelfCollapse, isDragHovering } = shelf;

	// Window height is now kept constant to prevent rendering layout lag and sharp corners

	const lastScrollTime = useRef(0);
	const handleWheel = (e: React.WheelEvent) => {
		const target = e.target as HTMLElement;
		if (
			target.closest(".calendar-timer-content") ||
			target.closest(".ask-bar") ||
			target.closest(".zai-panel") ||
			target.closest(".shelf-content") ||
			target.closest(".notes-panel") ||
			target.closest(".clipboard-panel") ||
			target.closest(".qp-list")
		) {
			return;
		}

		const now = Date.now();
		if (now - lastScrollTime.current < 250) return;

		// Use absolute values to detect horizontal swipe gestures on trackpad
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 5) return; // Ignore tiny movements

		if (cycleZaraMode(delta > 0 ? 1 : -1)) lastScrollTime.current = now;
	};

	// The widgets the user chose, in the order the notch cycles through them. The
	// preference always holds at least one, so the open notch is never empty.
	const enabledPanels = panelPreferences.enabled;

	function panelAvailable(panel: NotchPanel) {
		return isPanelEnabled(panelPreferences, panel);
	}

	// The clipboard is only watched while its widget is on, and only by the notch itself.
	useClipboardMonitor(windowLabel === "main" && isPanelEnabled(panelPreferences, "clipboard"));

	// Wheel and swipe navigate panels, even from a collapsed live activity.
	// Music and shelf remain entry points through their activity affordances.
	const cycleZaraMode = (direction: 1 | -1) => {
		const panels = enabledPanels;
		const currentIndex = panels.indexOf(zaraMode as NotchPanel);
		const nextMode =
			currentIndex === -1
				? openingPanel()
				: panels[(currentIndex + direction + panels.length) % panels.length];
		setIsOpen(true);
		setZaraMode(nextMode);
		return true;
	};

	// Arrows and wheel both stay within panels once one is open.
	const cyclePanel = (direction: 1 | -1) => {
		const panels = enabledPanels;
		const index = panels.indexOf(zaraMode as NotchPanel);
		if (index === -1 || panels.length < 2) return;
		setZaraMode(panels[(index + direction + panels.length) % panels.length]);
	};

	const timer = useTimer({
		timeFormat24h,
		soundEnabled: settingsTimerSoundEnabled,
		notchMode,
		triggerEventPeek
	});
	const { timerSeconds, isTimerFinished, formatTimerTime, resetTimer } = timer;
	const stealth = useStealth();
	const stealthOn = stealth.status?.requested === true;
	const stealthHolding = stealth.status?.active === true;

	const media = useMediaPlayback({
		musicModeEnabled: settingsMusicModeEnabled,
		notchMode,
		triggerEventPeek
	});
	const {
		isPlaying,
		mediaInfo,
		albumArtUrl,
		albumArtKey,
		setVolume,
		setIsMuted,
		displayVolume,
		musicActivityVisible,
		skipPrevious,
		handleVolumeChange
	} = media;

	// Like the Dynamic Island, the collapsed notch shows one live activity at a
	// time. Music fades a few seconds after playback stops. A set timer
	// (running, paused or just finished) takes the pill, and music then moves to
	// its own bubble beside it.
	const timerActive = timerSeconds > 0 || isTimerFinished;
	const musicActivity =
		settingsMusicModeEnabled &&
		settingsMusicCompactNotch &&
		mediaInfo.has_media &&
		musicActivityVisible;
	const collapsedMode = musicActivity && !timerActive ? "music" : "status";
	const showMusicBubble = musicActivity && timerActive && !isOpen && isVisible && !isHidden;
	const showShelfBubble = shelfItems.length > 0 && !isOpen && isVisible && !isHidden;
	restingModeRef.current = collapsedMode;
	zaraModeRef.current = zaraMode;

	// A click opens the last-used panel when memory is enabled, otherwise the
	// selected default. If that panel is turned off, the first one that's on.
	const openingPanel = (): NotchPanel => {
		const preferred = rememberPanelEnabled ? (lastPanel ?? defaultPanel) : defaultPanel;
		if (panelAvailable(preferred)) return preferred;
		return enabledPanels[0] ?? "command-center";
	};

	// Expands the notch into a panel, or into an activity's own view.
	const openNotch = (view: NotchPanel | "music" | "shelf") => {
		setIsOpen(true);
		setZaraMode(view);
	};

	const rememberPanel = (panel: NotchPanel) => {
		if (panel === lastPanel) return;
		setLastPanel(panel);
		localStorage.setItem("zara-notch-last-panel", panel);
		invoke("save_setting", { key: "zara-notch-last-panel", value: panel }).catch(console.error);
	};
	rememberPanelRef.current = rememberPanel;
	openingPanelRef.current = openingPanel;

	// Called by views that take typed input; see releaseNotchHover.
	const setNotchPinned = useCallback((pinned: boolean) => {
		notchPinnedRef.current = pinned;
		if (!pinned && releaseDeferredRef.current) {
			releaseDeferredRef.current = false;
			releaseNotchHover();
		}
		// releaseNotchHover only touches refs and state setters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Closing the assistant collapses the notch back to its resting view.
	const closeAiPanel = useCallback(() => {
		if (rememberPanelEnabledRef.current) rememberPanelRef.current("ai");
		setNotchPinned(false);
		setIsOpen(false);
		setZaraMode(restingModeRef.current);
		// setNotchPinned only touches refs and state setters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// A question typed into the Ask Zara bar opens the assistant and sends it. The
	// session lives here, so sending does not wait for the panel to finish loading.
	const askZara = (question: string) => {
		openNotch("ai");
		void aiSessionStore.require().send(question);
	};

	// What buttons in the assistant's answers may ask the notch to do. Built once
	// and reading the latest state through refs, so the panel is not re-rendered
	// for it on every notch update.
	const notchActionsRef = useRef({
		startTimer: (_seconds: number) => {},
		openPanel: (_panel: NotchPanel) => {}
	});
	notchActionsRef.current = {
		startTimer: (seconds) => timer.startTimer(seconds),
		openPanel: (panel) => {
			if (panelAvailable(panel)) openNotch(panel);
		}
	};
	const notchActions = useMemo(
		() => ({
			startTimer: (seconds: number) => notchActionsRef.current.startTimer(seconds),
			openPanel: (panel: NotchPanel) => notchActionsRef.current.openPanel(panel)
		}),
		[]
	);

	// The global "show or hide Zara" shortcut opens the assistant, or closes it if it
	// is already open. The listener is mounted once and reads the latest state
	// through a ref.
	const toggleAssistantRef = useRef<() => void>(() => {});
	toggleAssistantRef.current = () => {
		if (zaraModeRef.current === "ai" && isOpenRef.current) {
			closeAiPanel();
		} else if (panelAvailable("ai")) {
			openNotch("ai");
		}
	};
	useEffect(() => {
		if (windowLabel !== "main") return;
		let unlisten: (() => void) | undefined;
		let disposed = false;
		listen<string>("ai-shortcut", (event) => {
			if (event.payload === "ai.toggle") toggleAssistantRef.current();
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [windowLabel]);

	// "Open" on a saved conversation in Settings (a different window) loads it here.
	const openConversationRef = useRef<(id: string) => void>(() => {});
	openConversationRef.current = (conversationId: string) => {
		void aiSessionStore
			.require()
			.load(conversationId)
			.then(() => {
				if (panelAvailable("ai")) openNotch("ai");
			});
	};
	useEffect(() => {
		if (windowLabel !== "main") return;
		let unlisten: (() => void) | undefined;
		let disposed = false;
		listen<string>("ai-open-conversation", (event) => {
			openConversationRef.current(event.payload);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [windowLabel]);

	// While the user is typing to Zara (the assistant panel, or the Ask Zara bar in
	// the calendar panel) the notch stays open and takes keyboard focus; when they
	// stop, focus goes back to the app they were in. The notch window normally
	// never takes focus, so this is explicit.
	const [fieldFocused, setFieldFocused] = useState(false);
	const keyboardFocusWanted = wantsKeyboardFocus({ mode: zaraMode, isOpen, fieldFocused });
	useDeferredKeyboardFocus(keyboardFocusWanted, windowLabel === "main");
	useEffect(() => {
		if (windowLabel !== "main") return;
		const active = keyboardFocusWanted;
		setNotchPinned(active);
		if (!active) return;
		// Clicking into another app lets the notch collapse as soon as the pointer
		// leaves it, like the other panels; coming back to it pins it open again.
		const onBlur = () => setNotchPinned(false);
		const onFocus = () => setNotchPinned(true);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
		};
	}, [keyboardFocusWanted, windowLabel, setNotchPinned]);

	// Leave a panel that has just been turned off in Settings.
	useEffect(() => {
		const panel = asNotchPanel(zaraMode);
		if (panel && !panelAvailable(panel)) {
			setZaraMode(isOpen ? openingPanel() : collapsedMode);
		}
	}, [panelPreferences, zaraMode, isOpen]);

	// Leave the music view when music is turned off or the player ends its media
	// session: an open notch falls back to the remembered panel.
	useEffect(() => {
		if (zaraMode === "music" && !(settingsMusicModeEnabled && mediaInfo.has_media)) {
			setZaraMode(isOpen ? openingPanel() : collapsedMode);
		}
	}, [settingsMusicModeEnabled, mediaInfo.has_media, zaraMode, isOpen]);

	// Back to the resting view once the alert is over.
	useEffect(() => {
		if (zaraMode === "device" && !deviceAlert) {
			setZaraMode(isOpenRef.current ? openingPanel() : collapsedMode);
		}
		// openingPanel only reads settings state already in this render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [zaraMode, deviceAlert, collapsedMode]);

	// The collapsed notch always shows its current live activity: music while a
	// session exists, the timer (with music in its bubble) once one is set, and
	// the clock otherwise. An open notch is left alone.
	useEffect(() => {
		if (isOpen) return;
		if ((zaraMode === "status" || zaraMode === "music") && zaraMode !== collapsedMode) {
			setZaraMode(collapsedMode);
		}
	}, [collapsedMode, zaraMode, isOpen]);

	// Update time
	useEffect(() => {
		const updateTime = () => {
			const next = clockParts(new Date(), !timeFormat24h);
			// Same reading, same object: the notch is not redrawn every second for nothing.
			setClock((shown) => (sameClockParts(shown, next) ? shown : next));
		};

		updateTime();
		const interval = setInterval(updateTime, 1000);

		return () => {
			clearInterval(interval);
		};
	}, [timeFormat24h]);

	const quick = useQuickSettings({ zaraMode, setVolume, setIsMuted });
	const { wifiEnabled, bluetoothEnabled, batterySaverEnabled, toggleWifi, toggleBluetooth } = quick;

	const { cpuUsage, ramUsage, diskSpace, netUpSpeed, netDownSpeed } = useSystemStats(
		isVisible && !isHidden
	);

	// The notch never takes focus, and native `title` tooltips only show for an
	// active window, so the status widgets draw their own. A tooltip opens
	// after a tooltip-like delay, by which time the battery details fetched on
	// enter are in. Under the status strip it hangs below the pill; once the
	// notch is open the pill is the tall panel, so it sits beside the pill on
	// the widget's side instead, level with the widget.
	const showStatusTooltip = useCallback(
		(id: string, widget: HTMLElement) => {
			if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
			statusTooltipTimerRef.current = setTimeout(() => {
				const pill = zaraRef.current?.getBoundingClientRect();
				const own = widget.getBoundingClientRect();
				// Client rects are zoomed by the notch scale; offsets are not.
				if (!pill) {
					setStatusTooltip({ id, side: "below", offset: 8 });
				} else if (!isOpen) {
					const gap = (pill.bottom - own.bottom) / scale;
					setStatusTooltip({ id, side: "below", offset: Math.max(0, gap) + 8 });
				} else if (own.left + own.width / 2 >= pill.left + pill.width / 2) {
					const gap = (pill.right - own.right) / scale;
					setStatusTooltip({ id, side: "right", offset: Math.max(0, gap) + 10 });
				} else {
					const gap = (own.left - pill.left) / scale;
					setStatusTooltip({ id, side: "left", offset: Math.max(0, gap) + 10 });
				}
			}, 400);
		},
		[scale, isOpen]
	);

	const hideStatusTooltip = useCallback(() => {
		if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
		statusTooltipTimerRef.current = null;
		setStatusTooltip(null);
	}, []);

	// Widgets unmount when the notch collapses, without a mouse leave, and an
	// open card is placed for the notch's shape when it opened.
	useEffect(() => {
		hideStatusTooltip();
	}, [isHovered, isOpen, hideStatusTooltip]);

	// Both sides of the status strip get equal width around the centered
	// clock, so the notch must fit the clock plus twice the wider side. Widget
	// widths vary (network speed especially), so they are measured rather than
	// counted. The width only grows during a hover, so a live label getting
	// shorter doesn't make the notch jitter. Layout widths are unaffected by
	// the notch scale.
	useLayoutEffect(() => {
		if (!isHovered || zaraMode !== "status") {
			if (statusFitWidth !== 0) setStatusFitWidth(0);
			return;
		}
		// offsetWidth, not scrollWidth: an open tooltip card overflows its
		// widget and must not widen the notch.
		const side = Math.max(
			leftWidgetsRef.current?.offsetWidth ?? 0,
			rightWidgetsRef.current?.offsetWidth ?? 0
		);
		const clock = timeCenterRef.current?.offsetWidth ?? 0;
		// The pill's 12px padding on each side, and a 10px gap to the clock.
		const needed = Math.ceil(clock + 2 * (side + 10) + 24);
		if (side > 0 && needed > statusFitWidth) setStatusFitWidth(needed);
	});

	// Open the system tray (Win+B)
	const openSystemTray = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await invoke("open_system_tray");
		} catch (e) {
			console.error("Failed to open system tray:", e);
		}
	}, []);

	const openSettingsWindow = useCallback(async () => {
		try {
			await invoke("open_settings_window");
		} catch (e) {
			console.error("Failed to open settings window:", e);
		}
	}, []);

	// Right-click opens the tile's own view, the same as its › button.
	const handleWifiRightClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setZaraMode("wifi");
	}, []);

	const toggleNotchModeSetting = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const nextMode = notchMode === "fixed" ? "smart" : notchMode === "smart" ? "peek" : "fixed";
			setNotchMode(nextMode);
			localStorage.setItem("zara-notch-mode", nextMode);
			invoke("save_setting", { key: "zara-notch-mode", value: nextMode }).catch(console.error);
			try {
				await invoke("change_notch_mode", { mode: nextMode });
			} catch (err) {
				console.error("Failed to change notch mode:", err);
			}
		},
		[notchMode]
	);

	const handleBluetoothRightClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setZaraMode("bluetooth");
	}, []);

	const toggleCalendarMode = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isTimerFinished) {
			resetTimer();
			return;
		}
		// The time is part of the notch: a click opens it like anywhere else.
		// Once open, it is a shortcut to the calendar.
		if (!isOpen) {
			openNotch(openingPanel());
		} else if (settingsCalendarEnabled) {
			setZaraMode("calendar");
		}
	};

	// Where a status tooltip card sits and how it slides in, by placement.
	const statusTooltipMotion = (side: "below" | "left" | "right", offset: number) => {
		if (side === "below") {
			return {
				style: { top: `calc(100% + ${offset}px)`, left: "50%" },
				hidden: { opacity: 0, x: "-50%", y: -4 },
				shown: { opacity: 1, x: "-50%", y: 0 }
			};
		}
		// Top-aligned with the widget rather than centered on it: the widgets
		// sit near the top of the screen, which would cut a centered card off.
		const nudge = side === "right" ? -4 : 4;
		return {
			style: { top: -8, [side === "right" ? "left" : "right"]: `calc(100% + ${offset}px)` },
			hidden: { opacity: 0, x: nudge, y: 0 },
			shown: { opacity: 1, x: 0, y: 0 }
		};
	};

	// A status widget with its tooltip card, which hangs outside the pill.
	const statusWidget = (
		id: string,
		tooltip: string,
		content: React.ReactNode,
		onEnter?: () => void
	) => (
		<div
			className="passive-feature"
			key={id}
			onMouseEnter={(e) => {
				onEnter?.();
				showStatusTooltip(id, e.currentTarget);
			}}
			onMouseLeave={hideStatusTooltip}
		>
			{content}
			<AnimatePresence>
				{statusTooltip?.id === id &&
					(() => {
						const placed = statusTooltipMotion(statusTooltip.side, statusTooltip.offset);
						return (
							<motion.div
								className="status-tooltip"
								style={placed.style}
								initial={placed.hidden}
								animate={placed.shown}
								exit={placed.hidden}
								transition={{ duration: 0.15 }}
							>
								{tooltip}
							</motion.div>
						);
					})()}
			</AnimatePresence>
		</div>
	);

	// Render a status widget by ID
	const renderStatusWidget = (id: string) => {
		switch (id) {
			case "weather":
				if (!settingsWeatherEnabled || temperature === null) return null;
				return statusWidget(
					"weather",
					cityName ? `${weatherCondition} — ${cityName}` : weatherCondition,
					<>
						<WeatherIcon size={12} strokeWidth={2.2} />
						<span className="label">
							{temperature}°{tempUnit === "fahrenheit" ? "F" : "C"}
						</span>
					</>
				);
			case "battery":
				return statusWidget(
					"battery",
					batteryTooltip(
						batteryDetails,
						{ level: batteryLevel, charging: isCharging },
						batterySaverEnabled
					),
					<>
						<BatteryIcon
							charging={isCharging}
							level={batteryLevel}
							threshold={lowBatteryThreshold}
						/>
						<span className="label">{batteryLevel}%</span>
					</>,
					refreshBatteryDetails
				);
			case "cpu":
				return statusWidget(
					"cpu",
					"CPU Usage",
					<>
						<Cpu size={12} strokeWidth={2} />
						<span className="label">{cpuUsage}%</span>
					</>
				);
			case "ram":
				return statusWidget(
					"ram",
					"RAM Usage",
					<>
						<MemoryStick size={12} strokeWidth={2} />
						<span className="label">{Math.round(ramUsage)}%</span>
					</>
				);
			case "disk":
				return statusWidget(
					"disk",
					"Free Disk Space",
					<>
						<HardDrive size={12} strokeWidth={2} />
						<span className="label">{diskSpace}GB</span>
					</>
				);
			case "net":
				return statusWidget(
					"net",
					"Network Speed",
					<>
						<ArrowUpDown size={12} strokeWidth={2} />
						<span className="label">
							↑{formatBytes(netUpSpeed)} ↓{formatBytes(netDownSpeed)}
						</span>
					</>
				);
			default:
				return null;
		}
	};

	const formatBytes = (bytes: number) => {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
	};

	// Music mode shows any time we have media info (playing or paused) and music mode setting is enabled
	const isMusicMode = mediaInfo.has_media && zaraMode === "music" && settingsMusicModeEnabled;
	// A media session remains reachable on hover after its activity fades, or
	// whenever the compact music display is disabled.
	const showMusicOnStatusHover =
		!isOpen &&
		isHovered &&
		zaraMode === "status" &&
		settingsMusicModeEnabled &&
		mediaInfo.has_media &&
		(!musicActivityVisible || !settingsMusicCompactNotch);
	const showCompactMusicIcons = isMusicMode || showMusicOnStatusHover;

	// The 24-hour clock is ~16px narrower than the 12-hour one.
	const clock24hTrim = timeFormat24h ? 16 : 0;

	// Calculate width dynamically based on enabled features
	const getDynamicWidth = () => {
		if (zaraMode === "device" && deviceAlert) return 330;
		if (zaraMode === "ai") return AI_PANEL_WIDTH;
		if (isCalendarMode) return CALENDAR_TIMER_PANEL_WIDTH_PX;
		if (zaraMode === "shelf") return 380;
		if (zaraMode === "notes") return NOTES_PANEL_WIDTH_PX;
		if (zaraMode === "weather") return WEATHER_PANEL_WIDTH_PX;
		if (zaraMode === "clipboard") return CLIPBOARD_PANEL_WIDTH_PX;
		if (zaraMode === "command-center" && isOpen) return COMMAND_CENTER_PANEL_WIDTH_PX;
		if (zaraMode === "wifi" || zaraMode === "bluetooth" || zaraMode === "devices") return 350;
		if (showMusicOnStatusHover) {
			return 170 + (settingsVisualizerEnabled ? 30 : 0);
		}
		if (zaraMode === "status" && isHovered) {
			const totalWidgets = statusWidgets.left.length + statusWidgets.right.length;
			return Math.max(Math.min(200 + totalWidgets * 50, 380) - clock24hTrim, statusFitWidth);
		}
		if (isMusicMode && isOpen) return mediaLayout === "compact" ? 300 : 340;
		if ((showPowerPulse || showLowBatteryPulse) && !isHovered) return 200;

		let w = 140 - clock24hTrim;
		if (isMusicMode) {
			if (settingsVisualizerEnabled && isPlaying) w += 30;
			if (settingsAlbumArtEnabled) w += 30;
		}

		return w;
	};

	const getDynamicHeight = () => {
		if (!isExpanded || !isVisible || isHidden) {
			return isImpacted ? 28.9 : 44.2;
		}
		// Device alert: the drawing, with room for its motion.
		if (zaraMode === "device" && deviceAlert) return 76;
		// The calendar and timer views are the same size, so the notch never changes
		// height as the user switches views or browses months.
		if (zaraMode === "calendar") {
			const askBarRow = panelAvailable("ai") ? ASK_BAR_ROW_HEIGHT : 0;
			return CALENDAR_TIMER_PANEL_HEIGHT_PX + askBarRow;
		}
		// Shelf expands on mode alone (no hover needed: there is no cursor
		// hover during an OS drag) and is sized to exactly one row of tiles,
		// plus room for the scrollbar once the tiles overflow it.
		if (zaraMode === "shelf") {
			if (shelfItems.length === 0) return 130;
			return shelfOverflowing ? 190 : 176;
		}
		if (zaraMode === "command-center")
			return isOpen ? commandCenterPanelHeight(quickApps.length) : 36;
		if (zaraMode === "notes") return NOTES_PANEL_HEIGHT_PX;
		if (zaraMode === "weather") return WEATHER_PANEL_HEIGHT_PX;
		if (zaraMode === "clipboard") return CLIPBOARD_PANEL_HEIGHT_PX;
		if (zaraMode === "devices") {
			return devicesPanelHeight;
		}
		// Never taller than the notch window, which may be shorter on a small screen.
		if (zaraMode === "ai") return fitAiPanelHeight(aiPanelHeight, window.innerHeight / scale);
		if (zaraMode === "wifi" || zaraMode === "bluetooth") return 300;
		if (zaraMode === "status") return 36;
		if (isMusicMode && isOpen) {
			const hasProgressBar = (mediaInfo.duration_ms ?? 0) > 0;
			let h = mediaLayout === "compact" ? (hasProgressBar ? 132 : 116) : 120;
			if (mediaLayout === "compact") {
				if (compactVolumeExpanded) h += 36;
			}
			return h;
		}
		return 36;
	};

	const isCalendarMode = zaraMode === "calendar";
	// Arrows switch between the two tool panels; wheel/swipe can also open one
	// directly from the collapsed pill or a live activity.
	const showPanelArrows = isOpen && asNotchPanel(zaraMode) !== null && enabledPanels.length > 1;

	// Close compact media player expansions when notch is unhovered or mode changes
	useEffect(() => {
		if (mediaLayout === "compact") {
			setCompactVolumeExpanded(false);
		}
	}, [isHovered, mediaLayout, zaraMode]);

	// The pill's target geometry: the animation springs toward it, and the
	// window region below is cut from it, so the region is already at the
	// final size while the pill animates.
	const pillTargetY = !isReady ? 250 : isVisible ? (isHidden ? -100 : 0) : -150;
	const pillTargetWidth = !isReady
		? 34
		: isExpanded && isVisible && !isHidden
			? getDynamicWidth()
			: isImpacted
				? 39.1
				: 30.6;
	const pillTargetHeight = !isReady ? 34 : getDynamicHeight();
	// Shadow and the edge flares beside the pill.
	pillTargetRef.current = notchPillBox(
		window.innerWidth,
		scale,
		pillTargetY,
		pillTargetWidth,
		pillTargetHeight,
		24
	);

	// Clip the notch window to what it draws (see window_region.rs): outside
	// these rectangles the window takes no clicks, whatever its click-through
	// state. Sent after every render, but only when the region changes.
	useEffect(() => {
		if (windowLabel === "main") updateNotchRegion();
	});

	return (
		<div className="screen" style={{ overflow: "hidden" }}>
			<AiSessionHost store={aiSessionStore} resumeLast={rememberPanelEnabled} />
			{/* Screen Corners (Top) */}
			<AnimatePresence>
				{isVisible && settingsCornersEnabled && (
					<>
						<motion.div
							className="screen-corner top-left"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, filter: "blur(0px)" }}
							exit={{ opacity: 0, filter: "blur(10px)" }}
						/>
						<motion.div
							className="screen-corner top-right"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, filter: "blur(0px)" }}
							exit={{ opacity: 0, filter: "blur(10px)" }}
						/>
					</>
				)}
			</AnimatePresence>

			<div
				style={{
					zoom: scale,
					width: "100%",
					display: "flex",
					justifyContent: "center",
					position: "relative"
				}}
			>
				<DeviceArtDefs />
				<motion.div
					ref={zaraRef}
					className={`zara ${isHovered ? "expanded" : ""} ${isImpacted ? "is-impacted" : ""} ${isDragHovering ? "drag-hover" : ""} ${zaraMode === "ai" && isOpen ? "fade-bottom" : ""} ${stealthOn ? "stealth-on" : ""}`}
					onMouseEnter={() => {
						setIsNotchHovered(true);
						void loadAiPanel().catch(() => {});
					}}
					onMouseMove={closeAfterPointerLeaves.cancel}
					onMouseLeave={() => setIsNotchHovered(false)}
					onWheel={handleWheel}
					initial={{
						y: 250,
						width: 30.6,
						height: 44.2,
						borderTopLeftRadius: 18,
						borderTopRightRadius: 18,
						borderBottomLeftRadius: 18,
						borderBottomRightRadius: 18,
						scaleX: 1,
						scaleY: 1,
						opacity: 0
					}}
					animate={{
						y: pillTargetY,
						width: pillTargetWidth,
						height: pillTargetHeight,
						opacity: isVisible ? 1 : 0,
						scaleX: 1,
						scaleY: 1,
						borderTopLeftRadius: isImpacted ? 0 : 18,
						borderTopRightRadius: isImpacted ? 0 : 18,
						borderBottomLeftRadius: isCalendarMode ? 28 : 18,
						borderBottomRightRadius: isCalendarMode ? 28 : 18,
						filter: isVisible ? "blur(0px)" : "blur(8px)",
						pointerEvents: isVisible ? "auto" : "none"
					}}
					onClick={(e) => {
						e.stopPropagation();
						if (!isOpen) openNotch(openingPanel());
					}}
					onHoverStart={() => {
						releaseDeferredRef.current = false;
						closeAfterPointerLeaves.cancel();
						setIsHovered(true);
						// Hovering the shelf cancels its post-drop auto-close.
						if (zaraMode === "shelf") clearShelfCollapse();
					}}
					onHoverEnd={releaseNotchHover}
					style={{ originY: 0 }}
					transition={{
						width: { type: "spring", stiffness: 400, damping: 31 },
						height: { type: "spring", stiffness: 450, damping: 29 },
						y: { type: "spring", stiffness: 550, damping: 45, mass: 0.8, restDelta: 0.001 },
						opacity: { duration: 0.2 },
						borderTopLeftRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderTopRightRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderBottomLeftRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderBottomRightRadius: { type: "spring", stiffness: 1000, damping: 40 },
						default: { type: "spring", stiffness: 500, damping: 30, mass: 1 }
					}}
				>
					<EdgeSurface edge="top" flares={isImpacted} />
					{stealthOn && <StealthRim active={stealthHolding} />}
					<AnimatePresence>
						{isMusicMode && settingsAmbienceEnabled && albumArtUrl && isOpen && !isCalendarMode && (
							<motion.div
								className="notch-ambient-glow"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.15 }}
							>
								<AnimatePresence mode="wait">
									<motion.img
										key={albumArtUrl}
										src={albumArtUrl}
										alt=""
										draggable={false}
										initial={{ opacity: 0, scale: 1.1 }}
										animate={{ opacity: 1, scale: 1.8 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.3 }}
									/>
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
					<AnimatePresence mode="wait">
						{isExpanded && (
							<motion.div
								key="zara-content"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.1 }}
								style={{
									width: "100%",
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									position: "relative",
									borderRadius: "inherit"
								}}
							>
								{/* Faster Waiting Transition Area */}
								<AnimatePresence mode="wait">
									{isOpen && isMusicMode && !isCalendarMode ? (
										<MusicPlayerView
											media={media}
											mediaLayout={mediaLayout}
											setMediaLayout={setMediaLayout}
											compactVolumeExpanded={compactVolumeExpanded}
											setCompactVolumeExpanded={setCompactVolumeExpanded}
										/>
									) : (
										<motion.div
											key="standard-view-group"
											initial={{ opacity: 0, y: -5 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 5, transition: { duration: 0.1 } }}
											transition={{ duration: 0.2 }}
											style={{ width: "100%" }}
										>
											<div
												className="main-row"
												// A device alert covers the whole pill.
												style={
													zaraMode === "device" || deviceAlertOnScreen
														? { visibility: "hidden" }
														: undefined
												}
											>
												<AnimatePresence mode="wait">
													{(showPowerPulse || showLowBatteryPulse) && !isHovered ? (
														<motion.div
															key="pulse-view"
															initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
															animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
															exit={{ opacity: 0, scale: 1.05, filter: "blur(4px)" }}
															className="power-pulse-content"
														>
															<BatteryIcon
																charging={isCharging}
																level={batteryLevel}
																threshold={lowBatteryThreshold}
															/>
															<span
																className="label"
																style={{ color: showLowBatteryPulse ? "#FF453A" : "inherit" }}
															>
																{showLowBatteryPulse
																	? "Low Battery"
																	: isCharging
																		? "Charging"
																		: "On Battery"}{" "}
																• {batteryLevel}%
															</span>
														</motion.div>
													) : (
														<motion.div
															key="standard-view"
															className="main-row-inner"
															initial={{ opacity: 0 }}
															animate={{ opacity: 1 }}
															exit={{ opacity: 0 }}
														>
															{/* Left: music on hover while a paused session remains, otherwise status widgets */}
															<div className="side-content left">
																{showCompactMusicIcons && settingsVisualizerEnabled ? (
																	<AnimatePresence>
																		{settingsVisualizerEnabled && (
																			<motion.div
																				key="visualizer"
																				initial={{ scale: 0.8, opacity: 0 }}
																				animate={{ scale: 1, opacity: 1 }}
																				exit={{ scale: 0.8, opacity: 0 }}
																			>
																				<Visualizer isPlaying={isPlaying} />
																			</motion.div>
																		)}
																	</AnimatePresence>
																) : !showCompactMusicIcons &&
																  isHovered &&
																  statusWidgets.left.length > 0 ? (
																	<motion.div
																		key="left-widgets"
																		ref={leftWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.left.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>

															{/* Center - Time (always visible) */}
															<div className="time-center" ref={timeCenterRef}>
																{stealthOn && (
																	<StealthBadge
																		active={stealthHolding}
																		problem={stealth.status?.problem ?? null}
																	/>
																)}
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-prev"
																			type="button"
																			className="panel-arrow prev"
																			aria-label="Previous panel"
																			initial={{ opacity: 0, x: 4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: 4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(-1);
																			}}
																		>
																			<ChevronLeft size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
																<div className="time-flip-container" onClick={toggleCalendarMode}>
																	<AnimatePresence initial={false}>
																		{timerSeconds > 0 || isTimerFinished ? (
																			<motion.span
																				key="timer"
																				className={`time compact-timer ${isTimerFinished ? "timer-finished" : ""}`}
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={{ type: "spring", stiffness: 600, damping: 30 }}
																			>
																				{isTimerFinished && (
																					<BellRing
																						size={13}
																						strokeWidth={2.5}
																						className="timer-bell"
																					/>
																				)}
																				{formatTimerTime(timerSeconds)}
																			</motion.span>
																		) : (
																			<motion.span
																				key="clock"
																				className="time"
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={{ type: "spring", stiffness: 600, damping: 30 }}
																			>
																				<ClockFace {...clock} />
																			</motion.span>
																		)}
																	</AnimatePresence>
																</div>
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-next"
																			type="button"
																			className="panel-arrow next"
																			aria-label="Next panel"
																			initial={{ opacity: 0, x: -4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: -4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(1);
																			}}
																		>
																			<ChevronRight size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
															</div>

															{/* Right: album art on a retained music session, otherwise status widgets */}
															<div className="side-content right">
																{showCompactMusicIcons &&
																(settingsAlbumArtEnabled || showMusicOnStatusHover) ? (
																	<AnimatePresence mode="wait">
																		<motion.div
																			key="album-art"
																			className="album-art-glow-wrapper"
																			initial={{ opacity: 0, scale: 0.8 }}
																			animate={{ opacity: 1, scale: 1 }}
																			exit={{ opacity: 0, y: -20, scale: 0.8, filter: "blur(8px)" }}
																			transition={{ duration: 0.12 }}
																		>
																			{settingsAlbumArtEnabled &&
																				albumArtUrl &&
																				settingsCompactGlowEnabled && (
																					<img
																						src={albumArtUrl}
																						alt=""
																						className="album-art-glow-bg"
																						draggable={false}
																					/>
																				)}
																			<button
																				className={`album-art album-art-activity${!isPlaying ? " paused" : ""}`}
																				aria-label="Open music"
																				onClick={(e) => {
																					e.stopPropagation();
																					openNotch("music");
																				}}
																				onContextMenu={(e) => {
																					e.preventDefault();
																					e.stopPropagation();
																					skipPrevious();
																				}}
																			>
																				<div className="album-art-inner">
																					<AnimatePresence mode="wait" initial={false}>
																						{settingsAlbumArtEnabled && albumArtUrl ? (
																							<motion.img
																								key={`compact-art-${albumArtKey}`}
																								src={albumArtUrl}
																								alt="Art"
																								draggable={false}
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																								style={{
																									width: "100%",
																									height: "100%",
																									objectFit: "cover"
																								}}
																							/>
																						) : (
																							<motion.div
																								key="compact-placeholder"
																								className="album-art-placeholder"
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																							>
																								<MusicNoteIcon className="music-placeholder-svg-small" />
																							</motion.div>
																						)}
																					</AnimatePresence>
																				</div>
																			</button>
																		</motion.div>
																	</AnimatePresence>
																) : !showCompactMusicIcons &&
																  isHovered &&
																  statusWidgets.right.length > 0 ? (
																	<motion.div
																		key="right-widgets"
																		ref={rightWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.right.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>
														</motion.div>
													)}
												</AnimatePresence>
											</div>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Wi-Fi networks, opened from the controls panel's Wi-Fi tile */}
								<AnimatePresence>
									{zaraMode === "wifi" && (
										<motion.div
											key="wifi-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<WifiPanel
												enabled={wifiEnabled}
												onToggle={toggleWifi}
												onBack={() => setZaraMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Bluetooth devices, opened from the controls panel's Bluetooth tile */}
								<AnimatePresence>
									{zaraMode === "bluetooth" && (
										<motion.div
											key="bluetooth-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<BluetoothPanel
												enabled={bluetoothEnabled}
												onToggle={toggleBluetooth}
												onBack={() => setZaraMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Connected devices: everything connected, with its battery, by priority */}
								<AnimatePresence>
									{zaraMode === "devices" && (
										<motion.div
											key="devices-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<ConnectedDevicesPanel
												data={connectedDevices}
												height={devicesPanelHeight}
												buds={budsById}
												lowThreshold={lowBatteryThreshold}
												onContentHeight={setDevicesContentHeight}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* The Zara assistant */}
								<AnimatePresence>
									{zaraMode === "ai" && (
										<motion.div
											key="ai-view"
											className="ai-view"
											onClick={(e) => e.stopPropagation()}
											// The notch never takes focus on its own, so a click back into the panel after
											// using another app has to ask for it again.
											onMouseDown={() => {
												if (!document.hasFocus()) invoke("ai_take_focus").catch(() => {});
											}}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<Suspense fallback={null}>
												<AiPanel
													store={aiSessionStore}
													onClose={closeAiPanel}
													onDesiredHeight={setAiPanelHeight}
													notchActions={notchActions}
													stealth={stealth}
												/>
											</Suspense>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Notes Panel */}
								<NotesPanel zaraMode={zaraMode} onFieldFocusChange={setFieldFocused} />

								{/* Clipboard Panel */}
								<ClipboardPanel zaraMode={zaraMode} />

								{/* Weather Panel */}
								<WeatherPanel zaraMode={zaraMode} timeFormat24h={timeFormat24h} />

								{/* Command Center Panel */}
								<ControlsPanel
									quick={quick}
									quickApps={quickApps}
									openQuickApp={(quickApp) => {
										invoke("open_app", { appName: quickApp.target }).catch(console.error);
									}}
									displayVolume={displayVolume}
									handleVolumeChange={handleVolumeChange}
									notchMode={notchMode}
									toggleNotchModeSetting={toggleNotchModeSetting}
									openSystemTray={openSystemTray}
									openSettingsWindow={openSettingsWindow}
									handleWifiRightClick={handleWifiRightClick}
									handleBluetoothRightClick={handleBluetoothRightClick}
									zaraMode={zaraMode}
									setZaraMode={setZaraMode}
								/>

								{/* Device alert: a device connected or disconnected. A
								    click opens the Bluetooth view. */}
								<DeviceAlertBubble
									deviceAlerts={deviceAlerts}
									zaraMode={zaraMode}
									setIsOpen={setIsOpen}
									setZaraMode={setZaraMode}
								/>

								{/* Calendar & Timer Split View */}
								<CalendarTimerPanel
									timer={timer}
									settingsCalendarEnabled={settingsCalendarEnabled}
									isCalendarMode={isCalendarMode}
									ask={
										panelAvailable("ai")
											? {
													busy: aiBusy,
													onSubmit: askZara,
													onFocusChange: setFieldFocused
												}
											: undefined
									}
								/>

								{/* Shelf Panel */}
								<ShelfPanel shelf={shelf} zaraMode={zaraMode} />
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
				{/* The shelf's items, as a bubble on the left of the collapsed pill */}
				<ShelfBubble
					showShelfBubble={showShelfBubble}
					shelfItems={shelfItems}
					shelfBubbleRef={shelfBubbleRef}
					isHovered={isHovered}
					setIsHovered={setIsHovered}
					reportNotchRect={reportNotchRect}
					openNotch={openNotch}
					getDynamicWidth={getDynamicWidth}
				/>
				{/* Music in its own bubble while a timer holds the collapsed pill */}
				<MusicBubble
					showMusicBubble={showMusicBubble}
					mediaInfo={mediaInfo}
					albumArtUrl={albumArtUrl}
					settingsAlbumArtEnabled={settingsAlbumArtEnabled}
					musicBubbleRef={musicBubbleRef}
					isHovered={isHovered}
					setIsHovered={setIsHovered}
					reportNotchRect={reportNotchRect}
					openNotch={openNotch}
					getDynamicWidth={getDynamicWidth}
				/>
			</div>
		</div>
	);
}

export default App;
