import { describe, expect, it } from "vitest";
import {
	decideClaudeCodeAlert,
	decideNotification,
	HIDDEN_TEXT_BODY,
	parseNotificationPreferences,
	withAppAllowed,
	withAppSeen,
	type ClaudeCodeAlert,
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
	durationMs: 5000,
	claudeCodeNeedsInput: true,
	claudeCodeDone: true
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
			durationMs: 5000,
			claudeCodeNeedsInput: true,
			claudeCodeDone: true
		});
	});

	it("reads what the user saved", () => {
		const preferences = parseNotificationPreferences(
			readFrom({
				"zara-notifications-enabled": "true",
				"zara-notifications-apps": JSON.stringify(["Chat.App", "Mail.App"]),
				"zara-notifications-seen-apps": JSON.stringify([{ id: "Chat.App", name: "Chat" }]),
				"zara-notifications-show-text": "false",
				"zara-notifications-duration-ms": "8000",
				"zara-claude-code-alert-input": "false",
				"zara-claude-code-alert-done": "false"
			})
		);

		expect(preferences).toEqual({
			enabled: true,
			allowedAppIds: ["Chat.App", "Mail.App"],
			seenApps: [{ id: "Chat.App", name: "Chat" }],
			showText: false,
			durationMs: 8000,
			claudeCodeNeedsInput: false,
			claudeCodeDone: false
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

const claudeFinished: ClaudeCodeAlert = {
	kind: "done",
	sessionId: "s1",
	project: "zara",
	excerpt: "Fixed the notch."
};

const claudeNeedsYou: ClaudeCodeAlert = {
	kind: "needsInput",
	sessionId: "s1",
	project: "zara",
	excerpt: "Claude needs your permission to use Bash"
};

describe("decideClaudeCodeAlert", () => {
	it("says which project finished and what Claude said", () => {
		const pill = decideClaudeCodeAlert(claudeFinished, allowingChat, { forceHideText: false }, -1);

		expect(pill).toEqual({
			id: -1,
			appId: "claude-code",
			appName: "Claude Code",
			appIcon: null,
			title: "zara finished",
			body: "Fixed the notch."
		});
	});

	it("says which project needs the user and why", () => {
		const pill = decideClaudeCodeAlert(claudeNeedsYou, allowingChat, { forceHideText: false }, -2);

		expect(pill?.title).toBe("zara needs you");
		expect(pill?.body).toBe("Claude needs your permission to use Bash");
	});

	it("has no text line when Claude said nothing", () => {
		const pill = decideClaudeCodeAlert(
			{ ...claudeFinished, excerpt: null },
			allowingChat,
			{ forceHideText: false },
			-3
		);

		expect(pill?.body).toBe("");
	});

	it("shows an alert even though Windows notifications are off", () => {
		const pill = decideClaudeCodeAlert(
			claudeFinished,
			{ ...allowingChat, enabled: false, allowedAppIds: [] },
			{ forceHideText: false },
			-4
		);

		expect(pill).not.toBeNull();
	});

	it("shows nothing for a finished session when the user turned that alert off", () => {
		const pill = decideClaudeCodeAlert(
			claudeFinished,
			{ ...allowingChat, claudeCodeDone: false },
			{ forceHideText: false },
			-5
		);

		expect(pill).toBeNull();
	});

	it("shows nothing for a session that needs the user when the user turned that alert off", () => {
		const pill = decideClaudeCodeAlert(
			claudeNeedsYou,
			{ ...allowingChat, claudeCodeNeedsInput: false },
			{ forceHideText: false },
			-6
		);

		expect(pill).toBeNull();
	});

	it("still shows the other kind of alert when one is turned off", () => {
		const pill = decideClaudeCodeAlert(
			claudeNeedsYou,
			{ ...allowingChat, claudeCodeDone: false },
			{ forceHideText: false },
			-7
		);

		expect(pill).not.toBeNull();
	});

	it("says only what happened, not which project or what was said, when the text is hidden", () => {
		const pill = decideClaudeCodeAlert(
			claudeFinished,
			{ ...allowingChat, showText: false },
			{ forceHideText: false },
			-8
		);

		expect(pill?.title).toBe("Finished");
		expect(pill?.body).toBe("");
		expect(JSON.stringify(pill)).not.toContain("zara");
		expect(JSON.stringify(pill)).not.toContain("Fixed the notch");
	});

	it("hides the text when told to, even though the user chose to show it", () => {
		const pill = decideClaudeCodeAlert(claudeNeedsYou, allowingChat, { forceHideText: true }, -9);

		expect(pill?.title).toBe("Needs your input");
		expect(JSON.stringify(pill)).not.toContain("Bash");
	});
});
