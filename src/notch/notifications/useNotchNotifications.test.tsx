import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";
import type { ZaraMode } from "../types";
import type { IncomingNotification } from "./notificationPolicy";
import { useNotchNotifications } from "./useNotchNotifications";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

function messageFromMaria(overrides: Partial<IncomingNotification> = {}): IncomingNotification {
	return {
		id: 41,
		appId: "Chat.App",
		appName: "Chat",
		title: "Maria",
		body: "Are you free at 3?",
		appIcon: null,
		createdAtMs: 1_700_000_000_000,
		...overrides
	};
}

/** Saved choices: the feature on, and only the Chat app allowed. */
function allowOnlyChat() {
	localStorage.setItem("zara-notifications-enabled", "true");
	localStorage.setItem("zara-notifications-apps", JSON.stringify(["Chat.App"]));
}

function renderNotificationsHook(
	options: { windowLabel?: string; protectionLapsed?: boolean } = {}
) {
	const isOpenRef = { current: false };
	const zaraModeRef: { current: ZaraMode } = { current: "status" };
	const setZaraMode = vi.fn((mode: ZaraMode) => {
		zaraModeRef.current = mode;
	});
	const triggerEventPeek = vi.fn();
	const rendered = renderHook(() =>
		useNotchNotifications({
			windowLabel: options.windowLabel ?? "main",
			notchMode: "fixed",
			triggerEventPeek,
			isOpenRef,
			zaraModeRef,
			setZaraMode,
			protectionLapsed: options.protectionLapsed ?? false
		})
	);
	return { ...rendered, isOpenRef, zaraModeRef, setZaraMode, triggerEventPeek };
}

async function flushListeners() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

async function receive(notification: IncomingNotification) {
	await act(async () => {
		emitTauriEvent("windows-notification", notification);
		await vi.advanceTimersByTimeAsync(0);
	});
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

describe("useNotchNotifications", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		setInvokeHandler("notifications_enable", () => "allowed");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("tells the backend to read notifications while the feature is on", async () => {
		allowOnlyChat();

		renderNotificationsHook();
		await flushListeners();

		expect(callsTo("notifications_enable").at(-1)?.args).toEqual({ enabled: true });
	});

	it("tells the backend not to read notifications while the feature is off", async () => {
		renderNotificationsHook();
		await flushListeners();

		expect(callsTo("notifications_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("shows a pill for a notification from an allowed app and switches the notch to it", async () => {
		allowOnlyChat();
		const { result, setZaraMode } = renderNotificationsHook();
		await flushListeners();

		await receive(messageFromMaria());

		expect(result.current.notification).toMatchObject({
			title: "Maria",
			body: "Are you free at 3?",
			appName: "Chat"
		});
		expect(setZaraMode).toHaveBeenCalledWith("notification");
		expect(result.current.notificationOnScreen).toBe(true);
	});

	it("shows nothing for an app the user has not allowed", async () => {
		allowOnlyChat();
		const { result, setZaraMode } = renderNotificationsHook();
		await flushListeners();

		await receive(messageFromMaria({ appId: "Mail.App", appName: "Mail" }));

		expect(result.current.notification).toBeNull();
		expect(setZaraMode).not.toHaveBeenCalled();
	});

	it("remembers an app it has not seen before by name, never by what it said", async () => {
		allowOnlyChat();
		renderNotificationsHook();
		await flushListeners();

		await receive(
			messageFromMaria({
				appId: "Mail.App",
				appName: "Mail",
				title: "Secret subject",
				body: "Secret"
			})
		);

		const saved = callsTo("save_setting").find(
			(call) => call.args?.key === "zara-notifications-seen-apps"
		);
		expect(JSON.parse(saved?.args?.value as string)).toEqual([{ id: "Mail.App", name: "Mail" }]);
		expect(saved?.args?.value as string).not.toContain("Secret");
	});

	it("shows nothing while the feature is off", async () => {
		localStorage.setItem("zara-notifications-apps", JSON.stringify(["Chat.App"]));
		const { result } = renderNotificationsHook();
		await flushListeners();

		await receive(messageFromMaria());

		expect(result.current.notification).toBeNull();
	});

	it("shows only the app's name while protection has lapsed", async () => {
		allowOnlyChat();
		const { result } = renderNotificationsHook({ protectionLapsed: true });
		await flushListeners();

		await receive(messageFromMaria());

		expect(result.current.notification?.title).toBe("Chat");
		expect(result.current.notification?.body).toBe("New notification");
	});

	it("goes away after the time the user chose", async () => {
		allowOnlyChat();
		localStorage.setItem("zara-notifications-duration-ms", "3000");
		const { result } = renderNotificationsHook();
		await flushListeners();
		await receive(messageFromMaria());

		await advance(2900);
		expect(result.current.notification).not.toBeNull();
		await advance(200);

		expect(result.current.notification).toBeNull();
	});

	it("goes away when it is clicked", async () => {
		allowOnlyChat();
		const { result } = renderNotificationsHook();
		await flushListeners();
		await receive(messageFromMaria());

		act(() => result.current.dismiss());

		expect(result.current.notification).toBeNull();
	});

	it("shows the next waiting pill once the first is gone", async () => {
		allowOnlyChat();
		localStorage.setItem("zara-notifications-duration-ms", "3000");
		const { result } = renderNotificationsHook();
		await flushListeners();
		await receive(messageFromMaria({ id: 1, title: "First" }));

		await receive(messageFromMaria({ id: 2, title: "Second" }));
		expect(result.current.notification?.title).toBe("First");
		await advance(3100);

		expect(result.current.notification?.title).toBe("Second");
	});

	it("waits while the notch is open and shows the pill once it closes", async () => {
		allowOnlyChat();
		const { result, isOpenRef } = renderNotificationsHook();
		await flushListeners();
		isOpenRef.current = true;

		await receive(messageFromMaria());
		expect(result.current.notification).toBeNull();
		isOpenRef.current = false;
		await advance(600);

		expect(result.current.notification?.title).toBe("Maria");
	});

	it("waits behind a device alert", async () => {
		allowOnlyChat();
		const { result, zaraModeRef } = renderNotificationsHook();
		await flushListeners();
		zaraModeRef.current = "device";

		await receive(messageFromMaria());

		expect(result.current.notification).toBeNull();
	});

	it("drops a pill that waited too long to be news", async () => {
		allowOnlyChat();
		const { result, isOpenRef } = renderNotificationsHook();
		await flushListeners();
		isOpenRef.current = true;
		await receive(messageFromMaria());

		await advance(16_000);
		isOpenRef.current = false;
		await advance(1_000);

		expect(result.current.notification).toBeNull();
	});

	it("does not listen for notifications in a window that is not the notch", async () => {
		allowOnlyChat();
		const { result } = renderNotificationsHook({ windowLabel: "settings" });
		await flushListeners();

		await receive(messageFromMaria());

		expect(result.current.notification).toBeNull();
		expect(callsTo("notifications_enable")).toHaveLength(0);
	});
});
