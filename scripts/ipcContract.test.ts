import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

// Application code only: test files and test shims deliberately use made-up
// command and event names.
function sourceFiles(directory: string, extensions: string[]): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) return entry === "test" ? [] : sourceFiles(full, extensions);
		if (/\.test\.(ts|tsx)$/.test(entry)) return [];
		return extensions.some((extension) => full.endsWith(extension)) ? [full] : [];
	});
}

function read(path: string): string {
	return readFileSync(path, "utf8");
}

const frontendSource = sourceFiles(join(repoRoot, "src"), [".ts", ".tsx"]).map(read).join("\n");
const rustSource = sourceFiles(join(repoRoot, "src-tauri", "src"), [".rs"])
	.map(read)
	.join("\n");

describe("frontend and backend agree on commands", () => {
	test("every command the frontend invokes is registered in generate_handler!", () => {
		const mainRs = read(join(repoRoot, "src-tauri", "src", "main.rs"));
		const handlerBlock = mainRs.slice(
			mainRs.indexOf("generate_handler!["),
			mainRs.indexOf("])", mainRs.indexOf("generate_handler!["))
		);
		const registered = new Set(
			handlerBlock
				.split(/[\s,]+/)
				.map((name) => name.split("::").pop() ?? "")
				.filter((name) => /^[a-z_0-9]+$/.test(name))
		);
		const invoked = new Set(
			[...frontendSource.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_0-9]+)"/g)].map(
				(match) => match[1]
			)
		);

		const missing = [...invoked].filter((name) => !registered.has(name));

		expect(missing).toEqual([]);
	});

	test("every plugin or core command prefix used by the frontend is limited to known ones", () => {
		const pluginCommands = new Set(
			[...frontendSource.matchAll(/invoke(?:<[^>]*>)?\(\s*"(plugin:[a-z-]+\|[a-z_-]+)"/g)].map(
				(match) => match[1]
			)
		);

		expect([...pluginCommands]).toEqual([]);
	});
});

describe("frontend listeners have an emitter", () => {
	test("every event the frontend listens for is emitted by Rust or by the frontend itself", () => {
		const listened = new Set(
			[...frontendSource.matchAll(/listen(?:<[^>]*>)?\(\s*"([a-z0-9_-]+)"/g)].map(
				(match) => match[1]
			)
		);
		const emittedByRust = (name: string) =>
			new RegExp(`emit(?:_to)?\\(\\s*(?:"[a-z]+"\\s*,\\s*)?"${name}"`).test(rustSource) ||
			new RegExp(`"${name}"`).test(rustSource);
		// An event name may be emitted directly as a literal, or through a constant
		// (`const NAME = "event"; emit(NAME, ...)`), which is how Settings names the
		// event it sends to the notch window.
		const emittedByFrontend = (name: string) => {
			const emitsLiteral = new RegExp(
				`emit(?:To)?\\(\\s*(?:"[a-z]+"\\s*,\\s*)?"${name}"`
			).test(frontendSource);
			const constantsHoldingName = [
				...frontendSource.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*"${name}"`, "g")),
			].map((match) => match[1]);
			const emitsViaConstant = constantsHoldingName.some((constant) =>
				new RegExp(`emit(?:To)?\\(\\s*(?:"[a-z]+"\\s*,\\s*)?${constant}\\b`).test(frontendSource)
			);
			return emitsLiteral || emitsViaConstant;
		};

		const orphaned = [...listened].filter(
			(name) => !emittedByRust(name) && !emittedByFrontend(name)
		);

		expect(orphaned).toEqual([]);
	});
});

describe("the notch-only window layout", () => {
	const config = JSON.parse(read(join(repoRoot, "src-tauri", "tauri.conf.json")));
	const capabilities = JSON.parse(
		read(join(repoRoot, "src-tauri", "capabilities", "default.json"))
	);

	test("tauri.conf.json declares exactly the notch, settings and overlay windows", () => {
		const labels = config.app.windows.map((window: { label: string }) => window.label).sort();

		expect(labels).toEqual(["main", "overlay", "settings"]);
	});

	test("the default capability covers the same windows", () => {
		expect([...capabilities.windows].sort()).toEqual(["main", "overlay", "settings"]);
	});

	test("the frontend build has no dock entry point", () => {
		const viteConfig = read(join(repoRoot, "vite.config.ts"));

		expect(viteConfig).not.toContain("dock");
	});
});

describe("no taskbar replacement remains", () => {
	test("source code never mentions the dock", () => {
		const offenders = [
			...sourceFiles(join(repoRoot, "src"), [".ts", ".tsx", ".css"]),
			...sourceFiles(join(repoRoot, "src-tauri", "src"), [".rs"])
		].filter((file) => /\bdocks?\b/i.test(read(file)));

		expect(offenders).toEqual([]);
	});

	test("the backend never hides the native taskbar", () => {
		const hidingCalls = [
			"set_taskbar_visibility",
			"NATIVE_TASKBAR_HIDDEN",
			"ABM_SETSTATE",
			"ABS_AUTOHIDE",
			"register_dock_appbar"
		].filter((identifier) => rustSource.includes(identifier));

		expect(hidingCalls).toEqual([]);
	});
});
