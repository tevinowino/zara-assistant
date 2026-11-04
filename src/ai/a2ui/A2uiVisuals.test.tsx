import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { A2uiSurface } from "./A2uiSurface";
import { CATALOG_ID } from "./catalog";
import { readSurfaces } from "./index";
import { ACCENT_HEX } from "../protocol/accent";

function surfaceFrom(components: unknown[], dataModel?: unknown) {
	const lines = [
		{ version: "v0.9", createSurface: { surfaceId: "s1", catalogId: CATALOG_ID } },
		{ version: "v0.9", updateComponents: { surfaceId: "s1", components } },
		...(dataModel === undefined
			? []
			: [{ version: "v0.9", updateDataModel: { surfaceId: "s1", value: dataModel } }])
	]
		.map((message) => JSON.stringify(message))
		.join("\n");
	const { surfaces, problems } = readSurfaces(lines);
	expect(problems).toEqual([]);
	return surfaces[0];
}

function problemsFor(components: unknown[]): string[] {
	const lines = [
		{ version: "v0.9", createSurface: { surfaceId: "s1", catalogId: CATALOG_ID } },
		{ version: "v0.9", updateComponents: { surfaceId: "s1", components } }
	]
		.map((message) => JSON.stringify(message))
		.join("\n");
	return readSurfaces(lines).problems;
}

describe("Badge", () => {
	it("shows its label in the colour it was given", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Badge", label: "On track", color: "green" }
		]);

		render(<A2uiSurface surface={surface} />);

		const badge = screen.getByText("On track");
		expect(badge.style.getPropertyValue("--zai-accent")).toBe(ACCENT_HEX.green);
	});

	it("is drawn without a colour when none is given", () => {
		const surface = surfaceFrom([{ id: "root", component: "Badge", label: "Draft" }]);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Draft").style.getPropertyValue("--zai-accent")).toBe("");
	});

	it("rejects a colour that is not in the palette", () => {
		expect(
			problemsFor([{ id: "root", component: "Badge", label: "x", color: "orange" }])
		).toHaveLength(1);
	});
});

describe("Callout", () => {
	it("shows a title and text for a tone", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Callout", tone: "warning", title: "Heads up", text: "Rain at 3 pm" }
		]);

		render(<A2uiSurface surface={surface} />);

		const callout = screen.getByRole("note");
		expect(within(callout).getByText("Heads up")).toBeInTheDocument();
		expect(within(callout).getByText("Rain at 3 pm")).toBeInTheDocument();
		expect(callout.style.getPropertyValue("--zai-accent")).toBe(ACCENT_HEX.amber);
	});

	it("takes its text from the data model", () => {
		const surface = surfaceFrom(
			[{ id: "root", component: "Callout", tone: "success", text: { path: "/message" } }],
			{ message: "All saved" }
		);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("All saved")).toBeInTheDocument();
	});

	it("rejects a tone it does not have", () => {
		expect(
			problemsFor([{ id: "root", component: "Callout", tone: "danger", text: "x" }])
		).toHaveLength(1);
	});
});

describe("Progress", () => {
	it("tells assistive technology how far along it is", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Progress", label: "Storage", value: 72, color: "blue" }
		]);

		render(<A2uiSurface surface={surface} />);

		const bar = screen.getByRole("progressbar", { name: "Storage" });
		expect(bar).toHaveAttribute("aria-valuenow", "72");
		expect(bar).toHaveAttribute("aria-valuemin", "0");
		expect(bar).toHaveAttribute("aria-valuemax", "100");
		expect(screen.getByText("72%")).toBeInTheDocument();
	});

	it("reads its value from the data model", () => {
		const surface = surfaceFrom(
			[{ id: "root", component: "Progress", label: "Goal", value: { path: "/done" } }],
			{
				done: 40
			}
		);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByRole("progressbar", { name: "Goal" })).toHaveAttribute(
			"aria-valuenow",
			"40"
		);
	});

	it("keeps a value from the data model inside zero to one hundred", () => {
		const surface = surfaceFrom(
			[{ id: "root", component: "Progress", label: "Goal", value: { path: "/done" } }],
			{
				done: 250
			}
		);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByRole("progressbar", { name: "Goal" })).toHaveAttribute(
			"aria-valuenow",
			"100"
		);
	});

	it("treats a missing value as zero", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Progress", label: "Goal", value: { path: "/nope" } }
		]);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByRole("progressbar", { name: "Goal" })).toHaveAttribute("aria-valuenow", "0");
	});

	it("rejects a literal value above one hundred", () => {
		expect(problemsFor([{ id: "root", component: "Progress", value: 150 }])).toHaveLength(1);
	});
});

describe("Ring", () => {
	it("shows the percentage and a label", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Ring", value: 64, label: "Battery", color: "green" }
		]);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByRole("progressbar", { name: "Battery" })).toHaveAttribute(
			"aria-valuenow",
			"64"
		);
		expect(screen.getByText("64%")).toBeInTheDocument();
	});
});

describe("KeyValue", () => {
	it("lists each label with its value", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "KeyValue",
				items: [
					{ label: "Flight", value: "LH 401" },
					{ label: "Gate", value: "B12", color: "amber" }
				]
			}
		]);

		render(<A2uiSurface surface={surface} />);

		expect(screen.getByText("Flight")).toBeInTheDocument();
		expect(screen.getByText("LH 401")).toBeInTheDocument();
		expect(screen.getByText("B12").style.getPropertyValue("--zai-accent")).toBe(ACCENT_HEX.amber);
	});

	it("rejects more than eight rows", () => {
		const items = Array.from({ length: 9 }, (_, index) => ({ label: `L${index}`, value: "v" }));

		expect(problemsFor([{ id: "root", component: "KeyValue", items }])).toHaveLength(1);
	});
});

describe("Timeline", () => {
	it("lists each event in order with its time and description", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Timeline",
				items: [
					{ title: "Order placed", time: "Mon", color: "blue" },
					{ title: "Shipped", time: "Tue", description: "Left the warehouse", color: "green" }
				]
			}
		]);

		render(<A2uiSurface surface={surface} />);

		const items = screen.getAllByRole("listitem");
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByText("Order placed")).toBeInTheDocument();
		expect(within(items[1]).getByText("Tue")).toBeInTheDocument();
		expect(within(items[1]).getByText("Left the warehouse")).toBeInTheDocument();
	});

	it("needs at least two events", () => {
		expect(
			problemsFor([{ id: "root", component: "Timeline", items: [{ title: "Only one" }] }])
		).toHaveLength(1);
	});
});

describe("Checklist", () => {
	it("says which items are done to assistive technology", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Checklist",
				items: [{ text: "Pack passport", done: true }, { text: "Book taxi" }]
			}
		]);

		render(<A2uiSurface surface={surface} />);

		const items = screen.getAllByRole("listitem");
		expect(within(items[0]).getByText("Pack passport")).toBeInTheDocument();
		expect(within(items[0]).getByText("Done")).toBeInTheDocument();
		expect(within(items[1]).getByText("To do")).toBeInTheDocument();
	});
});

describe("colour on existing components", () => {
	it("tints a Card, a Text and an Icon with a palette colour", () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Card", child: "row", color: "purple" },
			{ id: "row", component: "Row", children: ["note", "star"] },
			{ id: "note", component: "Text", text: "Premium", color: "pink" },
			{ id: "star", component: "Icon", name: "star", color: "amber" }
		]);

		const { container } = render(<A2uiSurface surface={surface} />);

		expect(container.querySelector(".zai-s-card")).toHaveStyle({
			"--zai-accent": ACCENT_HEX.purple
		});
		expect(screen.getByText("Premium").style.getPropertyValue("--zai-accent")).toBe(
			ACCENT_HEX.pink
		);
		expect(container.querySelector(".zai-s-icon")).toHaveStyle({
			"--zai-accent": ACCENT_HEX.amber
		});
	});
});
