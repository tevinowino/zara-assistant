import { describe, expect, it } from "vitest";
import {
	asNotchPanel,
	defaultPanelPreferences,
	isPanelEnabled,
	movePanel,
	NOTCH_PANEL_DEFINITIONS,
	NOTCH_PANELS,
	notchPanelDefinition,
	parsePanelPreferences,
	readLegacyPanelFlags,
	serializePanelPreferences,
	setPanelEnabled
} from "./notchPanels";

describe("NOTCH_PANEL_DEFINITIONS", () => {
	it("lists the eight widgets", () => {
		expect(NOTCH_PANELS).toEqual([
			"ai",
			"calendar",
			"command-center",
			"devices",
			"notes",
			"clipboard",
			"weather",
			"lyrics"
		]);
	});

	it("gives every widget a name and a one-line description", () => {
		for (const definition of NOTCH_PANEL_DEFINITIONS) {
			expect(definition.label.length).toBeGreaterThan(0);
			expect(definition.description.endsWith(".")).toBe(true);
		}
	});

	it("gives every widget an icon for the picker", () => {
		for (const definition of NOTCH_PANEL_DEFINITIONS) {
			expect(definition.icon, definition.id).toBeTruthy();
		}
	});

	it("has no two widgets with the same id", () => {
		expect(new Set(NOTCH_PANELS).size).toBe(NOTCH_PANELS.length);
	});
});

describe("notchPanelDefinition", () => {
	it("finds a widget by id", () => {
		expect(notchPanelDefinition("notes").label).toBe("Notes");
	});

	it("refuses an id that is not a widget", () => {
		expect(() => notchPanelDefinition("nonsense" as never)).toThrow("Unknown notch panel");
	});
});

describe("asNotchPanel", () => {
	it("accepts a widget id", () => {
		expect(asNotchPanel("clipboard")).toBe("clipboard");
	});

	it("rejects anything else", () => {
		expect(asNotchPanel("nope")).toBeNull();
		expect(asNotchPanel(3)).toBeNull();
		expect(asNotchPanel(null)).toBeNull();
	});
});

describe("defaultPanelPreferences", () => {
	it("turns on the assistant, the calendar and the command center, and nothing else", () => {
		expect(defaultPanelPreferences().enabled).toEqual(["ai", "calendar", "command-center"]);
	});
});

describe("parsePanelPreferences with a stored choice", () => {
	it("reads a stored list, keeping the user's order", () => {
		expect(parsePanelPreferences('["notes","ai","weather"]').enabled).toEqual([
			"notes",
			"ai",
			"weather"
		]);
	});

	it("reads an array that was not stored as text", () => {
		expect(parsePanelPreferences(["clipboard", "calendar"]).enabled).toEqual([
			"clipboard",
			"calendar"
		]);
	});

	it("drops widgets that do not exist", () => {
		expect(parsePanelPreferences('["ai","hologram","notes"]').enabled).toEqual(["ai", "notes"]);
	});

	it("drops repeats, keeping the first", () => {
		expect(parsePanelPreferences('["notes","ai","notes"]').enabled).toEqual(["notes", "ai"]);
	});

	it("does not let old settings override a stored choice", () => {
		const preferences = parsePanelPreferences('["notes"]', { ai: true, calendar: true });

		expect(preferences.enabled).toEqual(["notes"]);
	});
});

describe("parsePanelPreferences without a stored choice", () => {
	it("uses the defaults when nothing was ever saved", () => {
		expect(parsePanelPreferences(null).enabled).toEqual(["ai", "calendar", "command-center"]);
	});

	it("keeps the panels the old settings had on", () => {
		const preferences = parsePanelPreferences(null, {
			ai: true,
			calendar: false,
			"command-center": true,
			devices: true
		});

		expect(preferences.enabled).toEqual(["ai", "command-center", "devices"]);
	});

	it("keeps a panel the old settings turned off, off", () => {
		const preferences = parsePanelPreferences(null, { ai: false });

		expect(preferences.enabled).toEqual(["calendar", "command-center"]);
	});

	it("falls back to the old settings when the stored value is not JSON", () => {
		expect(parsePanelPreferences("{oops", { devices: true }).enabled).toEqual([
			"ai",
			"calendar",
			"command-center",
			"devices"
		]);
	});

	it("falls back to the old settings when the stored list has no real widget in it", () => {
		expect(parsePanelPreferences('["x","y"]', { devices: true }).enabled).toContain("devices");
	});

	it("falls back to the old settings when the stored list is empty", () => {
		expect(parsePanelPreferences("[]").enabled).toEqual(["ai", "calendar", "command-center"]);
	});

	it("keeps the command center when the old settings turned everything off", () => {
		const preferences = parsePanelPreferences(null, {
			ai: false,
			calendar: false,
			"command-center": false,
			devices: false
		});

		expect(preferences.enabled).toEqual(["command-center"]);
	});
});

describe("serializePanelPreferences", () => {
	it("round-trips", () => {
		const preferences = { enabled: ["weather", "ai"] } as const;

		expect(parsePanelPreferences(serializePanelPreferences(preferences))).toEqual(preferences);
	});
});

describe("isPanelEnabled", () => {
	it("says whether a widget is on", () => {
		const preferences = { enabled: ["ai", "notes"] } as const;

		expect(isPanelEnabled(preferences, "notes")).toBe(true);
		expect(isPanelEnabled(preferences, "weather")).toBe(false);
	});
});

describe("setPanelEnabled", () => {
	it("adds a widget at the end of the cycle", () => {
		expect(setPanelEnabled({ enabled: ["ai", "calendar"] }, "notes", true).enabled).toEqual([
			"ai",
			"calendar",
			"notes"
		]);
	});

	it("removes a widget, keeping the others in order", () => {
		expect(
			setPanelEnabled({ enabled: ["ai", "calendar", "notes"] }, "calendar", false).enabled
		).toEqual(["ai", "notes"]);
	});

	it("leaves things as they are when turning on a widget that is on", () => {
		const preferences = { enabled: ["ai"] } as const;

		expect(setPanelEnabled(preferences, "ai", true)).toBe(preferences);
	});

	it("leaves things as they are when turning off a widget that is off", () => {
		const preferences = { enabled: ["ai"] } as const;

		expect(setPanelEnabled(preferences, "notes", false)).toBe(preferences);
	});

	it("will not turn off the last widget", () => {
		const preferences = { enabled: ["ai"] } as const;

		expect(setPanelEnabled(preferences, "ai", false)).toBe(preferences);
	});
});

describe("movePanel", () => {
	it("moves a widget earlier", () => {
		expect(movePanel({ enabled: ["ai", "calendar", "notes"] }, "notes", -1).enabled).toEqual([
			"ai",
			"notes",
			"calendar"
		]);
	});

	it("moves a widget later", () => {
		expect(movePanel({ enabled: ["ai", "calendar", "notes"] }, "ai", 1).enabled).toEqual([
			"calendar",
			"ai",
			"notes"
		]);
	});

	it("will not move the first widget earlier", () => {
		const preferences = { enabled: ["ai", "calendar"] } as const;

		expect(movePanel(preferences, "ai", -1)).toBe(preferences);
	});

	it("will not move the last widget later", () => {
		const preferences = { enabled: ["ai", "calendar"] } as const;

		expect(movePanel(preferences, "calendar", 1)).toBe(preferences);
	});

	it("ignores a widget that is not on", () => {
		const preferences = { enabled: ["ai", "calendar"] } as const;

		expect(movePanel(preferences, "weather", 1)).toBe(preferences);
	});
});

describe("readLegacyPanelFlags", () => {
	it("reads nothing as unset, so the defaults apply", () => {
		expect(readLegacyPanelFlags(() => null)).toEqual({
			ai: undefined,
			calendar: undefined,
			"command-center": undefined,
			devices: undefined
		});
	});

	it("reads the three default-on panels as on unless they were saved as false", () => {
		const saved: Record<string, string> = {
			"zara-notch-ai-enabled": "true",
			"zara-calendar-enabled": "false",
			"zara-notch-command-center-enabled": "whatever"
		};

		const flags = readLegacyPanelFlags((key) => saved[key] ?? null);

		expect(flags.ai).toBe(true);
		expect(flags.calendar).toBe(false);
		expect(flags["command-center"]).toBe(true);
	});

	it("reads the devices panel as on only when it was saved as true", () => {
		expect(readLegacyPanelFlags(() => "true").devices).toBe(true);
		expect(readLegacyPanelFlags(() => "false").devices).toBe(false);
		expect(readLegacyPanelFlags(() => "1").devices).toBe(false);
	});
});
