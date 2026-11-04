import { describe, expect, it } from "vitest";
import { buildSurfaces, MAX_COMPONENTS, MAX_SURFACES } from "./surface";

const CATALOG = "zara:notch/v1";

describe("buildSurfaces", () => {
	it("builds a surface from create, components and data messages", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [
						{ id: "root", component: "Column", children: ["title"] },
						{ id: "title", component: "Text", text: { path: "/heading" } }
					]
				}
			},
			{
				version: "v0.9",
				updateDataModel: { surfaceId: "s1", path: "/heading", value: "Hello" }
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
		expect(surfaces[0].id).toBe("s1");
		expect(surfaces[0].catalogId).toBe(CATALOG);
		expect(Object.keys(surfaces[0].components)).toEqual(["root", "title"]);
		expect(surfaces[0].dataModel).toEqual({ heading: "Hello" });
	});

	it("accepts a root whose children are defined in a later message", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Column", children: ["late"] }]
				}
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "late", component: "Text", text: "arrived" }]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(problems).toEqual([]);
		expect(surfaces).toHaveLength(1);
	});

	it("replaces a component sent again with the same id", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Text", text: "first" }]
				}
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Text", text: "second" }]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces } = buildSurfaces(jsonl);

		expect(surfaces[0].components.root).toMatchObject({ text: "second" });
	});

	it("removes a data key when a data message has no value", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Divider" }]
				}
			},
			{
				version: "v0.9",
				updateDataModel: { surfaceId: "s1", value: { a: 1, b: 2 } }
			},
			{ version: "v0.9", updateDataModel: { surfaceId: "s1", path: "/a" } }
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces } = buildSurfaces(jsonl);

		expect(surfaces[0].dataModel).toEqual({ b: 2 });
	});

	it("drops a surface that has no root component and says so", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "title", component: "Text", text: "orphan" }]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['surface "s1" has no component with id "root"']);
	});

	it("drops a surface whose component names a child that does not exist", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Column", children: ["ghost"] }]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['surface "s1": "root" refers to missing component "ghost"']);
	});

	it("drops a surface whose component contains itself", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [
						{ id: "root", component: "Column", children: ["loop"] },
						{ id: "loop", component: "Card", child: "root" }
					]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['surface "s1": component "root" contains itself']);
	});

	it("drops a surface nested deeper than five levels", () => {
		const chain = ["root", "a", "b", "c", "d", "e"];
		const components = chain.map((id, index) =>
			index < chain.length - 1
				? { id, component: "Card", child: chain[index + 1] }
				: { id, component: "Text", text: "too deep" }
		);
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{ version: "v0.9", updateComponents: { surfaceId: "s1", components } }
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['surface "s1" is nested deeper than 5 levels']);
	});

	it("follows a list template to the component it repeats", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [
						{
							id: "root",
							component: "List",
							children: { path: "/items", componentId: "row" }
						}
					]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { problems } = buildSurfaces(jsonl);

		expect(problems).toEqual(['surface "s1": "root" refers to missing component "row"']);
	});

	it("ignores updates for a surface that was never created", () => {
		const jsonl = JSON.stringify({
			version: "v0.9",
			updateComponents: {
				surfaceId: "nope",
				components: [{ id: "root", component: "Divider" }]
			}
		});

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toEqual(['updateComponents names unknown surface "nope"']);
	});

	it("reports a surface created twice and keeps the first", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: "other" }
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

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(problems).toEqual(['surface "s1" was created twice']);
		expect(surfaces[0].catalogId).toBe(CATALOG);
	});

	it("keeps only the first two surfaces", () => {
		const jsonl = ["s1", "s2", "s3"]
			.flatMap((surfaceId) => [
				{ version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG } },
				{
					version: "v0.9",
					updateComponents: {
						surfaceId,
						components: [{ id: "root", component: "Divider" }]
					}
				}
			])
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces.map((surface) => surface.id)).toEqual(["s1", "s2"]);
		expect(MAX_SURFACES).toBe(2);
		expect(problems).toContain("more than 2 surfaces");
	});

	it("stops adding components past the limit", () => {
		const components = Array.from({ length: MAX_COMPONENTS + 5 }, (_, index) => ({
			id: index === 0 ? "root" : `c${index}`,
			component: "Divider"
		}));
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{ version: "v0.9", updateComponents: { surfaceId: "s1", components } }
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(Object.keys(surfaces[0].components)).toHaveLength(MAX_COMPONENTS);
		expect(problems).toEqual([`surface "s1" has more than ${MAX_COMPONENTS} components`]);
	});

	it("refuses a data path that could pollute prototypes", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Divider" }]
				}
			},
			{
				version: "v0.9",
				updateDataModel: { surfaceId: "s1", path: "/__proto__/x", value: true }
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(problems).toEqual(['updateDataModel path "/__proto__/x" is not allowed']);
		expect(surfaces[0].dataModel).toEqual({});
	});

	it("removes a surface that a later message deletes", () => {
		const jsonl = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Divider" }]
				}
			},
			{ version: "v0.9", deleteSurface: { surfaceId: "s1" } }
		]
			.map((message) => JSON.stringify(message))
			.join("\n");

		expect(buildSurfaces(jsonl).surfaces).toEqual([]);
	});

	it("reports a line that is not JSON with its line number and keeps the good lines", () => {
		const jsonl = [
			JSON.stringify({
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: CATALOG }
			}),
			"{not json",
			JSON.stringify({
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [{ id: "root", component: "Divider" }]
				}
			})
		].join("\n");

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toHaveLength(1);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^line 2: /);
	});

	it("rejects an envelope with the wrong version", () => {
		const jsonl = JSON.stringify({
			version: "v0.8",
			createSurface: { surfaceId: "s1", catalogId: CATALOG }
		});

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems[0]).toMatch(/^line 1: /);
	});

	it("rejects an envelope that carries two message kinds at once", () => {
		const jsonl = JSON.stringify({
			version: "v0.9",
			createSurface: { surfaceId: "s1", catalogId: CATALOG },
			deleteSurface: { surfaceId: "s1" }
		});

		const { surfaces, problems } = buildSurfaces(jsonl);

		expect(surfaces).toEqual([]);
		expect(problems).toHaveLength(1);
	});
});
