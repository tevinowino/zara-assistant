import { describe, expect, it } from "vitest";
import {
	addQuickApp,
	appNameFromPath,
	hasQuickApp,
	isQuickAppsFull,
	MAX_QUICK_APPS,
	moveQuickApp,
	parseQuickApps,
	removeQuickApp,
	serializeQuickApps,
	type QuickApp
} from "./quickApps";

const app = (name: string, target = `C:\\Apps\\${name}.lnk`): QuickApp => ({ name, target });

describe("parseQuickApps", () => {
	it("is empty when nothing was saved", () => {
		expect(parseQuickApps(null)).toEqual([]);
	});

	it("reads a saved list", () => {
		const saved = JSON.stringify([app("Spotify"), app("Notepad")]);

		expect(parseQuickApps(saved)).toEqual([app("Spotify"), app("Notepad")]);
	});

	it("reads a list that was not stored as text", () => {
		expect(parseQuickApps([app("Spotify")])).toEqual([app("Spotify")]);
	});

	it("is empty for text that is not JSON", () => {
		expect(parseQuickApps("{oops")).toEqual([]);
	});

	it("is empty for JSON that is not a list", () => {
		expect(parseQuickApps('{"name":"x"}')).toEqual([]);
	});

	it("drops entries without a name or a target", () => {
		const saved = JSON.stringify([
			{ name: "No target" },
			{ target: "C:\\x.lnk" },
			{ name: "  ", target: "C:\\y.lnk" },
			{ name: "Blank target", target: "  " },
			app("Good")
		]);

		expect(parseQuickApps(saved)).toEqual([app("Good")]);
	});

	it("drops things in the list that are not objects", () => {
		expect(parseQuickApps(JSON.stringify([1, "x", null, app("Good")]))).toEqual([app("Good")]);
	});

	it("drops a repeated app, whatever the case of its path", () => {
		const saved = JSON.stringify([
			app("Spotify", "C:\\Apps\\Spotify.lnk"),
			app("Spotify again", "c:\\apps\\spotify.LNK")
		]);

		expect(parseQuickApps(saved)).toEqual([app("Spotify", "C:\\Apps\\Spotify.lnk")]);
	});

	it("keeps only the first four", () => {
		const saved = JSON.stringify(["a", "b", "c", "d", "e", "f"].map((name) => app(name)));

		expect(parseQuickApps(saved).map((a) => a.name)).toEqual(["a", "b", "c", "d"]);
	});

	it("trims a name", () => {
		const saved = JSON.stringify([{ name: "  Notepad  ", target: "C:\\n.lnk" }]);

		expect(parseQuickApps(saved)[0].name).toBe("Notepad");
	});
});

describe("serializeQuickApps", () => {
	it("round-trips", () => {
		const apps = [app("Spotify"), app("Notepad")];

		expect(parseQuickApps(serializeQuickApps(apps))).toEqual(apps);
	});
});

describe("addQuickApp", () => {
	it("adds an app at the end", () => {
		expect(addQuickApp([app("A")], app("B"))).toEqual([app("A"), app("B")]);
	});

	it("trims the name it adds", () => {
		expect(addQuickApp([], { name: "  Spotify ", target: "C:\\s.lnk" })[0].name).toBe("Spotify");
	});

	it("will not add the same app twice", () => {
		const apps = [app("A")];

		expect(addQuickApp(apps, app("A"))).toBe(apps);
	});

	it("will not add a fifth app", () => {
		const full = ["a", "b", "c", "d"].map((name) => app(name));

		expect(addQuickApp(full, app("e"))).toBe(full);
	});
});

describe("isQuickAppsFull", () => {
	it("is full at four", () => {
		expect(isQuickAppsFull(["a", "b", "c", "d"].map((n) => app(n)))).toBe(true);
		expect(isQuickAppsFull(["a", "b", "c"].map((n) => app(n)))).toBe(false);
		expect(MAX_QUICK_APPS).toBe(4);
	});
});

describe("hasQuickApp", () => {
	it("finds an app by its target, ignoring case", () => {
		expect(hasQuickApp([app("A", "C:\\A.lnk")], "c:\\a.LNK")).toBe(true);
		expect(hasQuickApp([app("A")], "C:\\Other.lnk")).toBe(false);
	});
});

describe("removeQuickApp", () => {
	it("removes an app, keeping the others in order", () => {
		const apps = [app("A"), app("B"), app("C")];

		expect(removeQuickApp(apps, app("B").target)).toEqual([app("A"), app("C")]);
	});

	it("leaves the list as it is when the app is not in it", () => {
		const apps = [app("A")];

		expect(removeQuickApp(apps, "C:\\nope.lnk")).toBe(apps);
	});
});

describe("moveQuickApp", () => {
	it("moves an app earlier", () => {
		const apps = [app("A"), app("B"), app("C")];

		expect(moveQuickApp(apps, app("C").target, -1).map((a) => a.name)).toEqual(["A", "C", "B"]);
	});

	it("moves an app later", () => {
		const apps = [app("A"), app("B"), app("C")];

		expect(moveQuickApp(apps, app("A").target, 1).map((a) => a.name)).toEqual(["B", "A", "C"]);
	});

	it("will not move the first app earlier or the last later", () => {
		const apps = [app("A"), app("B")];

		expect(moveQuickApp(apps, app("A").target, -1)).toBe(apps);
		expect(moveQuickApp(apps, app("B").target, 1)).toBe(apps);
	});

	it("ignores an app that is not in the list", () => {
		const apps = [app("A"), app("B")];

		expect(moveQuickApp(apps, "C:\\nope.lnk", 1)).toBe(apps);
	});
});

describe("appNameFromPath", () => {
	it("is the file name without its extension", () => {
		expect(appNameFromPath("C:\\Program Files\\Spotify\\Spotify.exe")).toBe("Spotify");
	});

	it("handles forward slashes", () => {
		expect(appNameFromPath("C:/Apps/Notepad.lnk")).toBe("Notepad");
	});

	it("keeps a name that has dots in it", () => {
		expect(appNameFromPath("C:\\Apps\\Visual.Studio.Code.lnk")).toBe("Visual.Studio.Code");
	});

	it("keeps a name with no extension", () => {
		expect(appNameFromPath("C:\\Apps\\tool")).toBe("tool");
	});
});
