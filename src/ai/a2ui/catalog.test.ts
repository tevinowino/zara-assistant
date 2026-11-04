import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_ID, buildSurfaceCatalogDoc, SURFACE_EXAMPLE } from "./catalog";
import { readSurfaces } from "./index";

function surfaceLines(components: unknown[], extra: unknown[] = []): string {
	return [
		{
			version: "v0.9",
			createSurface: { surfaceId: "s1", catalogId: CATALOG_ID }
		},
		{ version: "v0.9", updateComponents: { surfaceId: "s1", components } },
		...extra
	]
		.map((message) => JSON.stringify(message))
		.join("\n");
}

describe("readSurfaces", () => {
	it("accepts text, layout, card, list and icon components", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "Card", child: "col" },
			{
				id: "col",
				component: "Column",
				children: ["title", "row", "div"],
				align: "start"
			},
			{ id: "title", component: "Text", text: "Plan", variant: "h2" },
			{ id: "row", component: "Row", children: ["icon", "note"] },
			{ id: "icon", component: "Icon", name: "clock" },
			{ id: "note", component: "Text", text: { path: "/note" } },
			{ id: "div", component: "Divider" }
		]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
	});

	it("accepts the existing data widgets as catalog components", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "Column", children: ["t", "s"] },
			{
				id: "t",
				component: "Table",
				columns: ["Model", "Price"],
				rows: [["A", "$10"]]
			},
			{
				id: "s",
				component: "Stat",
				items: [{ label: "Revenue", value: "$482K" }]
			}
		]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
	});

	it("rejects a component type the catalog does not have", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "Video", url: "https://example.com/a.mp4" }
		]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['component "root" has unknown type "Video"']);
	});

	it("names the component and field when a property is invalid", () => {
		const jsonl = surfaceLines([{ id: "root", component: "Icon", name: "skull" }]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^component "root" \(Icon\): name: /);
	});

	it("rejects a surface that names a catalog Zara does not have", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: {
					surfaceId: "s1",
					catalogId: "https://example.com/other"
				}
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Divider" }]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['surface "s1" uses an unknown catalog']);
	});

	it("drops properties the catalog does not define", () => {
		const jsonl = surfaceLines([
			{
				id: "root",
				component: "Text",
				text: "hi",
				onClick: "alert(1)",
				style: "color:red"
			}
		]);

		const { surfaces } = readSurfaces(jsonl);

		expect(surfaces[0].components.root).toEqual({
			id: "root",
			component: "Text",
			text: "hi"
		});
	});
});

describe("readSurfaces with interactive components", () => {
	it("accepts a button, a text field, a checkbox and a choice picker", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "Column", children: ["name", "agree", "size", "go"] },
			{ id: "name", component: "TextField", label: "Name", value: { path: "/name" } },
			{ id: "agree", component: "CheckBox", label: "I agree", value: { path: "/agree" } },
			{
				id: "size",
				component: "ChoicePicker",
				options: [
					{ label: "Short", value: "short" },
					{ label: "Long", value: "long" }
				],
				value: { path: "/size" }
			},
			{
				id: "go",
				component: "Button",
				child: "label",
				action: { event: { name: "submit", context: { name: { path: "/name" } } } },
				checks: [{ call: "required", args: { value: { path: "/name" } }, message: "Enter a name" }]
			},
			{ id: "label", component: "Text", text: "Submit" }
		]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
	});

	it("rejects a button whose action names a function the app does not offer", () => {
		const jsonl = surfaceLines([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: { functionCall: { call: "runShell", args: { command: "dir" } } }
			},
			{ id: "label", component: "Text", text: "Run" }
		]);

		const { surfaces, problems } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^component "root" \(Button\): action/);
	});

	it("rejects a button that has no action at all", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "Button", child: "label" },
			{ id: "label", component: "Text", text: "Nothing" }
		]);

		const { surfaces } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
	});

	it("rejects a text field bound to a literal instead of a data path", () => {
		const jsonl = surfaceLines([
			{ id: "root", component: "TextField", label: "Name", value: "Ada" }
		]);

		const { surfaces } = readSurfaces(jsonl);

		expect(surfaces).toEqual([]);
	});
});

describe("the surface catalog the Rust backend shows the model", () => {
	it("is identical to the copy embedded in src-tauri, so the model never reads about a component the UI cannot draw", () => {
		const embeddedInRust = readFileSync(
			resolve(process.cwd(), "src-tauri/src/ai/a2ui_catalog.txt"),
			"utf8"
		);

		expect(embeddedInRust).toBe(buildSurfaceCatalogDoc());
	});

	it("includes a worked example that itself reads back as a valid surface", () => {
		const { surfaces, problems } = readSurfaces(SURFACE_EXAMPLE);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
		expect(buildSurfaceCatalogDoc()).toContain(SURFACE_EXAMPLE);
	});
});
