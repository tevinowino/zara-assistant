import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, searchSettingsTabs, settingsTabFor } from "./settingsTabs";

describe("SETTINGS_TABS", () => {
	it("lists the seven sections in the order the sidebar shows them", () => {
		expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
			"general",
			"appearance",
			"notch",
			"assistant",
			"library",
			"overlays",
			"about"
		]);
	});

	it("gives each section a unique id", () => {
		const ids = SETTINGS_TABS.map((tab) => tab.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	it("gives each section a label and a description to show under its title", () => {
		for (const tab of SETTINGS_TABS) {
			expect(tab.label.length).toBeGreaterThan(0);
			expect(tab.description.endsWith(".")).toBe(true);
		}
	});

	it("gives each section an icon", () => {
		for (const tab of SETTINGS_TABS) expect(tab.icon).toBeDefined();
	});

	it("keeps the Appearance section purple and the Assistant section pink", () => {
		expect(settingsTabFor("appearance").tone).toBe("purple");
		expect(settingsTabFor("assistant").tone).toBe("pink");
	});
});

describe("settingsTabFor", () => {
	it("finds a section by its id", () => {
		expect(settingsTabFor("library").label).toBe("Library");
	});

	it("refuses an id that is not a section", () => {
		expect(() => settingsTabFor("nonsense" as never)).toThrow("Unknown settings section");
	});
});

describe("searchSettingsTabs", () => {
	it("matches every section for an empty or blank search", () => {
		expect(searchSettingsTabs(SETTINGS_TABS, "")).toEqual([...SETTINGS_TABS]);
		expect(searchSettingsTabs(SETTINGS_TABS, "   ")).toEqual([...SETTINGS_TABS]);
	});

	it("matches a section by its label, whatever the case", () => {
		expect(searchSettingsTabs(SETTINGS_TABS, "NOTCH").map((tab) => tab.id)).toContain("notch");
	});

	it("matches a section by one of its keywords", () => {
		expect(searchSettingsTabs(SETTINGS_TABS, "clipboard").map((tab) => tab.id)).toEqual(["notch"]);
	});

	it("matches nothing for text no section mentions", () => {
		expect(searchSettingsTabs(SETTINGS_TABS, "qqqq")).toEqual([]);
	});

	it("keeps the sidebar's order among the matches", () => {
		const ids = searchSettingsTabs(SETTINGS_TABS, "notes").map((tab) => tab.id);

		expect(ids).toEqual(["notch", "library"]);
	});
});

describe("section groups", () => {
	it("lists About alone under Other and every other section under main", () => {
		expect(SETTINGS_TABS.filter((tab) => tab.group === "other").map((tab) => tab.id)).toEqual([
			"about"
		]);
		expect(SETTINGS_TABS.filter((tab) => tab.group === "main")).toHaveLength(6);
	});
});
