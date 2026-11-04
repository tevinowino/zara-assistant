import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { A2uiSurface } from "./A2uiSurface";
import { CATALOG_ID, SURFACE_EXAMPLE } from "./catalog";
import { readSurfaces } from "./index";

function surfaceFrom(components: unknown[], dataModel?: unknown) {
	const lines = [
		{
			version: "v0.9",
			createSurface: { surfaceId: "s1", catalogId: CATALOG_ID }
		},
		{ version: "v0.9", updateComponents: { surfaceId: "s1", components } },
		...(dataModel === undefined
			? []
			: [
					{
						version: "v0.9",
						updateDataModel: { surfaceId: "s1", value: dataModel }
					}
				])
	]
		.map((message) => JSON.stringify(message))
		.join("\n");
	const { surfaces, problems } = readSurfaces(lines);
	expect(problems).toEqual([]);
	return surfaces[0];
}

describe("A2uiSurface", () => {
	it("draws the worked example the model is shown, filling a formatted string from data", () => {
		const surface = readSurfaces(SURFACE_EXAMPLE).surfaces[0];

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Focus block")).toBeInTheDocument();
		expect(screen.getByText("25 minutes, starting now")).toBeInTheDocument();
	});

	it("draws a list of rows from a data list, each reading its own item", () => {
		const surface = surfaceFrom(
			[
				{
					id: "root",
					component: "List",
					children: { path: "/people", componentId: "row" }
				},
				{ id: "row", component: "Text", text: { path: "name" } }
			],
			{ people: [{ name: "Ada" }, { name: "Grace" }, { name: "Linus" }] }
		);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Ada")).toBeInTheDocument();
		expect(screen.getByText("Grace")).toBeInTheDocument();
		expect(screen.getByText("Linus")).toBeInTheDocument();
	});

	it("draws at most thirty items of a long data list", () => {
		const items = Array.from({ length: 45 }, (_, index) => ({
			name: `Item ${index + 1}`
		}));
		const surface = surfaceFrom(
			[
				{
					id: "root",
					component: "List",
					children: { path: "/items", componentId: "row" }
				},
				{ id: "row", component: "Text", text: { path: "name" } }
			],
			{ items }
		);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Item 30")).toBeInTheDocument();
		expect(screen.queryByText("Item 31")).not.toBeInTheDocument();
	});

	it("draws nothing for text bound to data that is missing", () => {
		const surface = surfaceFrom([{ id: "root", component: "Text", text: { path: "/missing" } }]);

		const { container } = render(<A2uiSurface surface={surface} />);

		expect(container.querySelector("p")).toHaveTextContent("");
	});

	it("draws a data widget inside a layout, using the existing table renderer", async () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Column", children: ["heading", "prices"] },
			{ id: "heading", component: "Text", text: "Plans", variant: "h2" },
			{
				id: "prices",
				component: "Table",
				columns: ["Model", "Price"],
				rows: [
					["Alpha", "$10"],
					["Beta", "$8"]
				]
			}
		]);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Plans")).toBeInTheDocument();
		expect(await screen.findByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
	});

	it("never turns text from the model into markup", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Text",
				text: "<img src=x onerror=alert(1)> <b>bold</b>"
			}
		]);

		const { container } = render(<A2uiSurface surface={surface} />);

		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("b")).toBeNull();
		expect(screen.getByText("<img src=x onerror=alert(1)> <b>bold</b>")).toBeInTheDocument();
	});
});
