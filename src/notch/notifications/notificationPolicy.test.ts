import { describe, expect, it } from "vitest";
import {
	decideNotification,
	HIDDEN_TEXT_BODY,
	parseNotificationPreferences,
	withAppAllowed,
	withAppSeen,
	type IncomingNotification,
	type NotificationPreferences
} from "./notificationPolicy";

const messageFromMaria: IncomingNotification = {
	id: 41,
	appId: "Chat.App",
	appName: "Chat",
	title: "Maria",
	body: "Are you free at 3?",
	appIcon: "data:image/png;base64,icon",
	createdAtMs: 1_700_000_000_000
};

const allowingChat: NotificationPreferences = {
	enabled: true,
	allowedAppIds: ["Chat.App"],
	seenApps: [{ id: "Chat.App", name: "Chat" }],
	showText: true,
	durationMs: 5000
};

const readFrom = (stored: Record<string, string>) => (key: string) => stored[key];

describe("parseNotificationPreferences", () => {
	it("is off, allows no app and shows the text when nothing was saved", () => {
		const preferences = parseNotificationPreferences(readFrom({}));

		expect(preferences).toEqual({
			enabled: false,
			allowedAppIds: [],
			seenApps: [],
			showText: true,
			durationMs: 5000
		});
	});

	it("reads what the user saved", () => {
		const preferences = parseNotificationPreferences(
			readFrom({
				"zara-notifications-enabled": "true",
				"zara-notifications-apps": JSON.stringify(["Chat.App", "Mail.App"]),
				"zara-notifications-seen-apps": JSON.stringify([{ id: "Chat.App", name: "Chat" }]),
				"zara-notifications-show-text": "false",
				"zara-notifications-duration-ms": "8000"
			})
		);

		expect(preferences).toEqual({
			enabled: true,
			allowedAppIds: ["Chat.App", "Mail.App"],
			seenApps: [{ id: "Chat.App", name: "Chat" }],
			showText: false,
			durationMs: 8000
		});
	});

	it("is off for anything but the word true", () => {
		const preferences = parseNotificationPreferences(
			readFrom({ "zara-notifications-enabled": "yes" })
		);

		expect(preferences.enabled).toBe(false);
	});

	it("allows no app when the saved list is not readable", () => {
		const preferences = parseNotificationPreferences(
			readFrom({ "zara-notifications-apps": "{not json" })
		);

		expect(preferences.allowedAppIds).toEqual([]);
	});

	it("drops entries in the saved lists that are not what they should be", () => {
		const preferences = parseNotificationPreferences(
			readFrom({
				"zara-notifications-apps": JSON.stringify(["Chat.App", 7, "", null, "Chat.App"]),
				"zara-notifications-seen-apps": JSON.stringify([
					{ id: "Chat.App", name: "Chat" },
					{ id: 3 },
					"Mail",
					null
				])
			})
		);

		expect(preferences.allowedAppIds).toEqual(["Chat.App"]);
		expect(preferences.seenApps).toEqual([{ id: "Chat.App", name: "Chat" }]);
	});

	it("keeps the duration between two and fifteen seconds", () => {
		const read = (value: string) =>
			parseNotificationPreferences(readFrom({ "zara-notifications-duration-ms": value }))
				.durationMs;

		expect(read("100")).toBe(2000);
		expect(read("999999")).toBe(15000);
		expect(read("nonsense")).toBe(5000);
	});
});

describe("withAppAllowed", () => {
	it("adds an app that is newly allowed", () => {
		expect(withAppAllowed(["Mail.App"], "Chat.App", true)).toEqual(["Mail.App", "Chat.App"]);
	});

	it("does not list an app twice", () => {
		expect(withAppAllowed(["Chat.App"], "Chat.App", true)).toEqual(["Chat.App"]);
	});

	it("removes an app that is no longer allowed", () => {
		expect(withAppAllowed(["Mail.App", "Chat.App"], "Chat.App", false)).toEqual(["Mail.App"]);
	});
});

describe("withAppSeen", () => {
	it("puts the app that was just seen first", () => {
		const seen = withAppSeen([{ id: "Mail.App", name: "Mail" }], { id: "Chat.App", name: "Chat" });

		expect(seen.map((app) => app.id)).toEqual(["Chat.App", "Mail.App"]);
	});

	it("moves an app seen again to the front instead of listing it twice", () => {
		const seen = withAppSeen(
			[
				{ id: "Mail.App", name: "Mail" },
				{ id: "Chat.App", name: "Chat" }
			],
			{ id: "Chat.App", name: "Chat" }
		);

		expect(seen.map((app) => app.id)).toEqual(["Chat.App", "Mail.App"]);
	});

	it("keeps at most forty apps, forgetting the longest unseen", () => {
		const many = Array.from({ length: 40 }, (_, index) => ({
			id: `app-${index}`,
			name: `App ${index}`
		}));

		const seen = withAppSeen(many, { id: "new", name: "New" });

		expect(seen).toHaveLength(40);
		expect(seen[0].id).toBe("new");
		expect(seen.some((app) => app.id === "app-39")).toBe(false);
	});
});

describe("decideNotification", () => {
	it("shows a pill with the title and text for an allowed app", () => {
		const decision = decideNotification(messageFromMaria, allowingChat, { forceHideText: false });

		expect(decision.pill).toEqual({
			id: 41,
			appId: "Chat.App",
			appName: "Chat",
			appIcon: "data:image/png;base64,icon",
			title: "Maria",
			body: "Are you free at 3?"
		});
	});

	it("shows nothing at all while the feature is off", () => {
		const decision = decideNotification(
			messageFromMaria,
			{ ...allowingChat, enabled: false },
			{ forceHideText: false }
		);

		expect(decision).toEqual({ pill: null, newlySeenApp: null });
	});

	it("shows nothing for an app the user has not allowed, but remembers the app by name", () => {
		const decision = decideNotification(
			messageFromMaria,
			{ ...allowingChat, allowedAppIds: [], seenApps: [] },
			{ forceHideText: false }
		);

		expect(decision.pill).toBeNull();
		expect(decision.newlySeenApp).toEqual({ id: "Chat.App", name: "Chat" });
	});

	it("does not report an app it already knows by that name", () => {
		const decision = decideNotification(messageFromMaria, allowingChat, { forceHideText: false });

		expect(decision.newlySeenApp).toBeNull();
	});

	it("reports an app again when it comes under a new name", () => {
		const decision = decideNotification(
			{ ...messageFromMaria, appName: "Chat Pro" },
			allowingChat,
			{ forceHideText: false }
		);

		expect(decision.newlySeenApp).toEqual({ id: "Chat.App", name: "Chat Pro" });
	});

	it("shows only the app's name when the user chose to hide the text", () => {
		const decision = decideNotification(
			messageFromMaria,
			{ ...allowingChat, showText: false },
			{ forceHideText: false }
		);

		expect(decision.pill?.title).toBe("Chat");
		expect(decision.pill?.body).toBe(HIDDEN_TEXT_BODY);
	});

	it("hides the text when told to, even though the user chose to show it", () => {
		const decision = decideNotification(messageFromMaria, allowingChat, { forceHideText: true });

		expect(decision.pill?.title).toBe("Chat");
		expect(decision.pill?.body).toBe(HIDDEN_TEXT_BODY);
		expect(JSON.stringify(decision.pill)).not.toContain("Maria");
		expect(JSON.stringify(decision.pill)).not.toContain("free at 3");
	});
});
