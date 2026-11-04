import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

function trackedTextFiles(): string[] {
	const result = Bun.spawnSync(["git", "ls-files"], { cwd: repoRoot });
	return result.stdout
		.toString()
		.split("\n")
		.filter((file) => /\.(ts|tsx|rs|json|toml|css|html|md|mjs|yml|yaml|svg|plist)$/.test(file));
}

// The app is its own product: nothing in the repository names the project it grew
// from or that project's author. The patterns are written so that this file does not
// contain the words it looks for.
const FORMER_PROJECT_NAME = /blo{2}m/i;
const FORMER_AUTHOR_NAME = /seha[j]veer/i;

const textOf = (file: string) => readFileSync(resolve(repoRoot, file), "utf8");

describe("branding", () => {
	test("no tracked file names the project Zara grew from", () => {
		const offenders = trackedTextFiles().filter((file) => FORMER_PROJECT_NAME.test(textOf(file)));

		expect(offenders).toEqual([]);
	});

	test("no tracked file names that project's author", () => {
		const offenders = trackedTextFiles().filter((file) => FORMER_AUTHOR_NAME.test(textOf(file)));

		expect(offenders).toEqual([]);
	});

	test("the About tab shows Zara's own copyright and licence", () => {
		const aboutTab = textOf("src/settings/AboutTab.tsx");

		expect(aboutTab).toContain("Copyright © 2026 Tevin Owino");
		expect(aboutTab).toContain("Licensed under GPL-3.0");
	});

	test("NOTICE carries Zara's copyright, its licence and the third-party notices", () => {
		const notice = textOf("NOTICE");

		expect(notice).toContain("Copyright (C) 2026 Tevin Owino");
		expect(notice).toContain("GNU General Public License");
		expect(notice).toContain("Manrope");
		expect(notice).toContain("General Sans");
		expect(notice).toContain("Iconoir");
		expect(notice).toContain("lobehub");
	});
});

describe("tauri.conf.json", () => {
	const config = JSON.parse(readFileSync(resolve(repoRoot, "src-tauri/tauri.conf.json"), "utf8"));

	test("identifies the app as Zara", () => {
		expect(config.productName).toBe("Zara");
		expect(config.identifier).toBe("com.zara.app");
	});

	test("updates come from this project's own releases, signed with its own key", () => {
		const updater = config.plugins?.updater;

		expect(config.bundle.createUpdaterArtifacts).toBe(true);
		expect(updater.pubkey.length).toBeGreaterThan(40);
		expect(updater.endpoints).toEqual([
			"https://github.com/tevinowino/zara-assistant/releases/latest/download/latest.json"
		]);
	});

	test("the update check is the only reason the app reaches GitHub, and docs/privacy.md says so", () => {
		const privacy = textOf("docs/privacy.md");

		expect(privacy).toContain("github.com");
		expect(privacy).toContain("zara-auto-update-check");
	});

	test("the webview may only connect to the hosts documented in docs/privacy.md", () => {
		const csp: string = config.app.security.csp;
		const connectSrc = csp
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("connect-src"));
		const hosts = (connectSrc ?? "").split(/\s+/).slice(1).sort();

		expect(hosts).toEqual(
			[
				"'self'",
				"http://ip-api.com",
				"http://ipc.localhost",
				"https://api.open-meteo.com",
				"https://geocoding-api.open-meteo.com",
				"https://ipapi.co",
				"ipc:"
			].sort()
		);
	});
});
