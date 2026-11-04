// Zara's A2UI catalog: the components the model may put on a surface.
//
// A2UI's safety rests on the client approving a fixed catalog, so this file is
// the one place that decides what a reply can draw. Each entry pairs a Zod
// schema (what is accepted) with the line the model reads about it (what it is
// told). The renderer (A2uiSurface.tsx) has a total mapped type over these
// entries, so a component without a renderer is a compile error.
//
// Colour is not part of the catalog on purpose: every surface is drawn in the
// notch's own ink, the same rule the rest of the assistant follows.

import { z } from "zod";
import { BLOCK_CONTRACTS } from "../protocol";
import { ACCENT_NAMES, accentSchema } from "../protocol/accent";
import { FUNCTION_ACTION_NAMES } from "./actions";
import type { Surface } from "./surface";

export const CATALOG_ID = "zara:notch/v1";

const identifier = z.string().min(1).max(64);
const pathReference = z.object({ path: z.string().min(1).max(200) });
const functionCall = z.object({
	call: z.string().min(1).max(40),
	args: z.record(z.string(), z.unknown()).optional()
});

/** Text that is a literal, a data-model reference, or a function call. */
const dynamicText = z.union([z.string().max(600), pathReference, functionCall]);

/** Child ids, or one component repeated for each item of a list in the data model. */
const childList = z.union([
	z.array(identifier).min(1).max(20),
	z.object({ path: z.string().min(1).max(200), componentId: identifier })
]);

export const ICON_NAMES = [
	"check",
	"clock",
	"calendar",
	"mail",
	"info",
	"warning",
	"star",
	"timer",
	"copy",
	"link",
	"note"
] as const;

const alignment = z.enum(["start", "center", "end", "stretch"]);

/** An optional colour from the palette in protocol/accent.ts. */
const accent = accentSchema.optional();

/** A percentage: a literal from 0 to 100, or a data-model reference read when drawn. */
const percent = z.union([z.number().min(0).max(100), pathReference]);

export const CALLOUT_TONES = ["info", "success", "warning", "error", "tip"] as const;

const ACCENT_LIST = ACCENT_NAMES.join(", ");

const argumentMap = z.record(z.string(), z.unknown()).optional();

/**
 * What a button does: send a message back to the assistant, or call one of the
 * functions in actions.ts. The name is checked here so a typo is reported to the
 * model; the arguments are checked when the button is clicked.
 */
const action = z.union([
	z.object({
		event: z.object({
			name: z.string().min(1).max(40),
			context: z.record(z.string(), z.unknown()).optional()
		})
	}),
	z.object({
		functionCall: z.object({
			call: z.string().refine((name) => FUNCTION_ACTION_NAMES.includes(name), {
				message: "Unknown function."
			}),
			args: argumentMap
		})
	})
]);

/** A rule that must hold for a button to be enabled, e.g. a field is filled in. */
const check = z.object({
	call: z.string().min(1).max(40),
	args: argumentMap,
	message: z.string().max(100)
});

const boundValue = pathReference;

function entry<T extends z.ZodTypeAny>(
	component: string,
	shape: T,
	doc: { summary: string; props: string }
) {
	const base = z.object({ id: identifier, component: z.literal(component) });
	return { component, schema: z.intersection(base, shape), doc };
}

/** A data widget from the block protocol, reused as a catalog component. */
function widget(component: string, blockType: keyof typeof BLOCK_CONTRACTS, props: string) {
	const contract = BLOCK_CONTRACTS[blockType];
	return entry(component, contract.schema, {
		summary: `${contract.doc.summary} USE WHEN: ${contract.doc.whenToUse} DO NOT USE WHEN: ${contract.doc.whenNotToUse}`,
		props
	});
}

export const CATALOG = {
	Text: entry(
		"Text",
		z.object({
			text: dynamicText,
			variant: z.enum(["h2", "body", "caption"]).optional(),
			color: accent
		}),
		{
			summary: "A line or short paragraph of plain text.",
			props: `text (a string, {"path":"/key"}, or {"call":"formatString","args":{"value":"Hi \${/name}"}}), variant? (h2, body or caption), color? (${ACCENT_LIST})`
		}
	),
	Column: entry("Column", z.object({ children: childList, align: alignment.optional() }), {
		summary: "Stacks its children vertically.",
		props: "children (ids), align? (start, center, end or stretch)"
	}),
	Row: entry("Row", z.object({ children: childList, align: alignment.optional() }), {
		summary: "Places its children side by side; wraps when there is no room.",
		props: "children (ids), align?"
	}),
	Card: entry("Card", z.object({ child: identifier, color: accent }), {
		summary: "Groups one child inside a bordered card, optionally tinted with a colour.",
		props: `child (an id), color? (${ACCENT_LIST})`
	}),
	List: entry("List", z.object({ children: childList }), {
		summary:
			"A vertical list of rows with dividers. Give ids, or repeat one component for each item of a list in the data model.",
		props:
			'children (ids, or {"path":"/items","componentId":"row"} where "row" reads item fields with relative paths such as {"path":"name"})'
	}),
	Divider: entry("Divider", z.object({}), {
		summary: "A thin horizontal rule.",
		props: "none"
	}),
	Icon: entry("Icon", z.object({ name: z.enum(ICON_NAMES), color: accent }), {
		summary: "A small icon.",
		props: `name (${ICON_NAMES.join(", ")}), color? (${ACCENT_LIST})`
	}),
	Badge: entry("Badge", z.object({ label: z.string().min(1).max(30), color: accent }), {
		summary: "A small coloured pill for a status or tag, such as On track or New.",
		props: `label, color? (${ACCENT_LIST})`
	}),
	Callout: entry(
		"Callout",
		z.object({
			tone: z.enum(CALLOUT_TONES),
			title: z.string().max(60).optional(),
			text: dynamicText
		}),
		{
			summary:
				"A highlighted note with a coloured edge and icon. The tone sets the colour: info is blue, success green, warning amber, error red, tip purple.",
			props: `tone (${CALLOUT_TONES.join(", ")}), title?, text`
		}
	),
	Progress: entry(
		"Progress",
		z.object({
			label: z.string().max(40).optional(),
			value: percent,
			caption: z.string().max(40).optional(),
			color: accent
		}),
		{
			summary: "A horizontal progress bar with a percentage.",
			props: `value (0 to 100, or {"path":"/key"}), label?, caption?, color? (${ACCENT_LIST})`
		}
	),
	Ring: entry(
		"Ring",
		z.object({
			value: percent,
			label: z.string().max(30).optional(),
			caption: z.string().max(40).optional(),
			color: accent
		}),
		{
			summary:
				"A circular gauge with the percentage in the middle, for one standout number such as battery or completion.",
			props: `value (0 to 100, or {"path":"/key"}), label?, caption?, color? (${ACCENT_LIST})`
		}
	),
	KeyValue: entry(
		"KeyValue",
		z.object({
			items: z
				.array(
					z.object({
						label: z.string().min(1).max(30),
						value: z.string().max(80),
						color: accent
					})
				)
				.min(1)
				.max(8)
		}),
		{
			summary: "Labelled details as a tidy two-column list, such as a flight, a booking or a spec.",
			props: `items ([{"label":"Gate","value":"B12","color"?}], 1 to 8)`
		}
	),
	Timeline: entry(
		"Timeline",
		z.object({
			items: z
				.array(
					z.object({
						title: z.string().min(1).max(50),
						time: z.string().max(24).optional(),
						description: z.string().max(120).optional(),
						color: accent
					})
				)
				.min(2)
				.max(8)
		}),
		{
			summary: "Events in order down a vertical line, each with a coloured dot.",
			props: `items ([{"title":"Shipped","time":"Tue","description"?,"color"?}], 2 to 8)`
		}
	),
	Checklist: entry(
		"Checklist",
		z.object({
			items: z
				.array(z.object({ text: z.string().min(1).max(80), done: z.boolean().optional() }))
				.min(1)
				.max(10)
		}),
		{
			summary: "Things to do, each shown as done or not done.",
			props: `items ([{"text":"Pack passport","done":true}], 1 to 10)`
		}
	),
	Button: entry(
		"Button",
		z.object({
			child: identifier,
			action,
			variant: z.enum(["primary", "borderless"]).optional(),
			checks: z.array(check).max(4).optional()
		}),
		{
			summary:
				"A button. Its child is the Text shown on it. Each button does exactly one thing when clicked.",
			props: `child (id of a Text), action, variant? (primary or borderless), checks? ([{"call":"required","args":{"value":{"path":"/name"}},"message":"Enter a name"}], the button stays disabled until every check is true). action is either {"event":{"name":"short_name","context":{"key":{"path":"/name"}}}}, which sends the user's choice back to you as their next message, or {"functionCall":{"call":"<function>","args":{...}}} which runs in the app. Functions: startTimer {minutes: 1-180}, openPanel {panel: calendar|command-center|devices}, copyText {text}, openUrl {url: an https link}, saveNote {text} (the user is asked to confirm)`
		}
	),
	TextField: entry(
		"TextField",
		z.object({
			label: z.string().min(1).max(60),
			value: boundValue,
			variant: z.enum(["shortText", "longText"]).optional()
		}),
		{
			summary: "A text input bound to a value in the data model.",
			props: 'label, value ({"path":"/name"}), variant? (shortText or longText)'
		}
	),
	CheckBox: entry("CheckBox", z.object({ label: z.string().min(1).max(80), value: boundValue }), {
		summary: "A checkbox bound to a true or false value in the data model.",
		props: 'label, value ({"path":"/agree"})'
	}),
	ChoicePicker: entry(
		"ChoicePicker",
		z.object({
			options: z
				.array(
					z.object({
						label: z.string().min(1).max(40),
						value: z.string().min(1).max(40)
					})
				)
				.min(2)
				.max(8),
			value: boundValue,
			variant: z.enum(["mutuallyExclusive", "multiple"]).optional()
		}),
		{
			summary: "A choice between a few options, bound to the chosen value (a list for multiple).",
			props:
				'options ([{"label":"Short","value":"short"}], 2 to 8), value ({"path":"/length"}), variant? (mutuallyExclusive or multiple)'
		}
	),
	Stat: widget("Stat", "stat", "items, exactly as in the zara:stat block"),
	Chart: widget("Chart", "chart", "kind, title, data, series, as in the zara:chart block"),
	Table: widget("Table", "table", "columns, rows, as in the zara:table block"),
	Carousel: widget("Carousel", "carousel", "items, as in the zara:carousel block"),
	Diagram: widget("Diagram", "mermaid", "source, as in the zara:mermaid block")
} as const;

export type CatalogComponentName = keyof typeof CATALOG;

/** A component that passed its catalog schema; unknown properties are gone. */
export type ValidComponent = {
	id: string;
	component: CatalogComponentName;
} & Record<string, unknown>;

/** A surface whose every component is a valid catalog component. */
export type ValidSurface = Omit<Surface, "components"> & {
	components: Record<string, ValidComponent>;
};

function isCatalogComponent(name: string): name is CatalogComponentName {
	return Object.prototype.hasOwnProperty.call(CATALOG, name);
}

/** The surface with each component checked and cleaned, or what is wrong with it. */
export function validateAgainstCatalog(
	surface: Surface
): { surface: ValidSurface } | { problem: string } {
	if (surface.catalogId !== CATALOG_ID) {
		return { problem: `surface "${surface.id}" uses an unknown catalog` };
	}

	const components: Record<string, ValidComponent> = {};
	for (const [id, raw] of Object.entries(surface.components)) {
		if (!isCatalogComponent(raw.component)) {
			return {
				problem: `component "${id}" has unknown type "${raw.component}"`
			};
		}
		const result = CATALOG[raw.component].schema.safeParse(raw);
		if (!result.success) {
			const issue = result.error.issues[0];
			const field = issue.path.join(".") || "(root)";
			return {
				problem: `component "${id}" (${raw.component}): ${field}: ${issue.message}`
			};
		}
		components[id] = result.data as ValidComponent;
	}
	return { surface: { ...surface, components } };
}

/** A complete reply body the model can pattern-match; checked by the tests. */
export const SURFACE_EXAMPLE = [
	{
		version: "v0.9",
		createSurface: { surfaceId: "plan", catalogId: CATALOG_ID }
	},
	{
		version: "v0.9",
		updateComponents: {
			surfaceId: "plan",
			components: [
				{ id: "root", component: "Card", child: "body" },
				{
					id: "body",
					component: "Column",
					children: ["heading", "status", "summary", "tip", "start"]
				},
				{
					id: "heading",
					component: "Text",
					text: "Focus block",
					variant: "h2"
				},
				{
					id: "summary",
					component: "Text",
					text: {
						call: "formatString",
						args: { value: "${/minutes} minutes, starting now" }
					}
				},
				{
					id: "start",
					component: "Button",
					child: "start-label",
					variant: "primary",
					action: {
						functionCall: { call: "startTimer", args: { minutes: 25 } }
					}
				},
				{ id: "start-label", component: "Text", text: "Start 25 minute timer" },
				{ id: "status", component: "Badge", label: "Ready", color: "green" },
				{
					id: "tip",
					component: "Callout",
					tone: "tip",
					text: "Take a short break when it ends."
				}
			]
		}
	},
	{
		version: "v0.9",
		updateDataModel: { surfaceId: "plan", path: "/minutes", value: 25 }
	}
]
	.map((message) => JSON.stringify(message))
	.join("\n");

/**
 * The documentation the model reads about surfaces, derived from CATALOG so it
 * can never describe a component the UI cannot draw. The Rust backend embeds
 * this text from src-tauri/src/ai/a2ui_catalog.txt; catalog.test.ts fails when
 * that file drifts from this function.
 */
export function buildSurfaceCatalogDoc(): string {
	const components = Object.values(CATALOG)
		.map((item) => `### ${item.component}\n${item.doc.summary}\nProps: ${item.doc.props}`)
		.join("\n\n");
	return `Catalog id: ${CATALOG_ID}\n\n${components}\n\nExample (the body of an \`a2ui\` fence):\n\`\`\`a2ui\n${SURFACE_EXAMPLE}\n\`\`\``;
}
