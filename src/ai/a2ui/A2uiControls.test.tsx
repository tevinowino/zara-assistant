import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { A2uiSurface } from "./A2uiSurface";
import type { ActionHost } from "./actions";
import { CATALOG_ID } from "./catalog";
import { readSurfaces } from "./index";
import { SurfaceInteractionContext, type SurfaceInteraction } from "./interaction";

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

function interaction(overrides: Partial<SurfaceInteraction> = {}, host: Partial<ActionHost> = {}) {
	return {
		host: {
			copyText: vi.fn(async () => {}),
			openUrl: vi.fn(async () => {}),
			saveNote: vi.fn(async () => {}),
			...host
		},
		sendEvent: vi.fn(),
		busy: false,
		...overrides
	} satisfies SurfaceInteraction;
}

function renderWith(surface: ReturnType<typeof surfaceFrom>, value: SurfaceInteraction | null) {
	return render(
		<SurfaceInteractionContext.Provider value={value}>
			<A2uiSurface surface={surface} />
		</SurfaceInteractionContext.Provider>
	);
}

const timerButton = surfaceFrom([
	{
		id: "root",
		component: "Button",
		child: "label",
		action: { functionCall: { call: "startTimer", args: { minutes: 25 } } }
	},
	{ id: "label", component: "Text", text: "Start 25 minute timer" }
]);

describe("surface buttons", () => {
	it("starts a timer through the notch when clicked", async () => {
		const startTimer = vi.fn();
		const user = userEvent.setup();
		renderWith(timerButton, interaction({}, { startTimer }));

		await user.click(screen.getByRole("button", { name: "Start 25 minute timer" }));

		expect(startTimer).toHaveBeenCalledTimes(1);
		expect(startTimer).toHaveBeenCalledWith(1500);
		expect(await screen.findByText("Done")).toBeInTheDocument();
	});

	it("does nothing until it is clicked", () => {
		const startTimer = vi.fn();
		renderWith(timerButton, interaction({}, { startTimer }));

		expect(startTimer).not.toHaveBeenCalled();
	});

	it("is disabled when the notch cannot start a timer", () => {
		renderWith(timerButton, interaction());

		expect(screen.getByRole("button", { name: "Start 25 minute timer" })).toBeDisabled();
	});

	it("is disabled when the surface is shown where nothing can act", () => {
		renderWith(timerButton, null);

		expect(screen.getByRole("button", { name: "Start 25 minute timer" })).toBeDisabled();
	});

	it("sends a message back as the user's next turn for an event button", async () => {
		const surface = surfaceFrom(
			[
				{
					id: "root",
					component: "Button",
					child: "label",
					action: {
						event: { name: "shorter", context: { tone: { path: "/tone" } } }
					}
				},
				{ id: "label", component: "Text", text: "Make it shorter" }
			],
			{ tone: "plain" }
		);
		const value = interaction();
		const user = userEvent.setup();
		renderWith(surface, value);

		await user.click(screen.getByRole("button", { name: "Make it shorter" }));

		expect(value.sendEvent).toHaveBeenCalledWith('Make it shorter\n(shorter: {"tone":"plain"})');
	});

	it("sends only the label when an event button has no context", async () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: { event: { name: "again" } }
			},
			{ id: "label", component: "Text", text: "Try again" }
		]);
		const value = interaction();
		const user = userEvent.setup();
		renderWith(surface, value);

		await user.click(screen.getByRole("button", { name: "Try again" }));

		expect(value.sendEvent).toHaveBeenCalledWith("Try again");
	});

	it("is disabled while the assistant is still answering", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: { event: { name: "go" } }
			},
			{ id: "label", component: "Text", text: "Go" }
		]);

		renderWith(surface, interaction({ busy: true }));

		expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
	});

	it("needs a second click before saving a note", async () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: {
					functionCall: { call: "saveNote", args: { text: "Buy milk" } }
				}
			},
			{ id: "label", component: "Text", text: "Save as note" }
		]);
		const saveNote = vi.fn(async () => {});
		const user = userEvent.setup();
		renderWith(surface, interaction({}, { saveNote }));

		await user.click(screen.getByRole("button", { name: "Save as note" }));
		expect(saveNote).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Click again to confirm" }));
		expect(saveNote).toHaveBeenCalledWith("Buy milk");
	});

	it("refuses a link that is not a web link, leaving the button disabled", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: {
					functionCall: {
						call: "openUrl",
						args: { url: "javascript:alert(1)" }
					}
				}
			},
			{ id: "label", component: "Text", text: "Open" }
		]);
		const openUrl = vi.fn(async () => {});

		renderWith(surface, interaction({}, { openUrl }));

		expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("tells the user which site a link button opens", () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: {
					functionCall: {
						call: "openUrl",
						args: { url: "https://example.com/a" }
					}
				}
			},
			{ id: "label", component: "Text", text: "Read more" }
		]);

		renderWith(surface, interaction());

		expect(screen.getByRole("button", { name: "Read more" })).toHaveAttribute(
			"title",
			"Opens example.com"
		);
	});

	it("reports a failure when the action throws", async () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "Button",
				child: "label",
				action: { functionCall: { call: "copyText", args: { text: "hi" } } }
			},
			{ id: "label", component: "Text", text: "Copy" }
		]);
		const copyText = vi.fn(async () => {
			throw new Error("clipboard unavailable");
		});
		const user = userEvent.setup();
		renderWith(surface, interaction({}, { copyText }));

		await user.click(screen.getByRole("button", { name: "Copy" }));

		expect(await screen.findByText("That didn't work")).toBeInTheDocument();
	});
});

describe("surface inputs", () => {
	it("keeps a button disabled until the field it checks is filled in", async () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Column", children: ["name", "go"] },
			{
				id: "name",
				component: "TextField",
				label: "Name",
				value: { path: "/name" }
			},
			{
				id: "go",
				component: "Button",
				child: "label",
				action: {
					event: { name: "greet", context: { name: { path: "/name" } } }
				},
				checks: [
					{
						call: "required",
						args: { value: { path: "/name" } },
						message: "Enter a name"
					}
				]
			},
			{ id: "label", component: "Text", text: "Greet" }
		]);
		const value = interaction();
		const user = userEvent.setup();
		renderWith(surface, value);
		expect(screen.getByRole("button", { name: "Greet" })).toBeDisabled();

		await user.type(screen.getByLabelText("Name"), "Ada");
		await user.click(screen.getByRole("button", { name: "Greet" }));

		expect(value.sendEvent).toHaveBeenCalledWith('Greet\n(greet: {"name":"Ada"})');
	});

	it("shows what was typed anywhere the surface reads the same value", async () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Column", children: ["name", "echo"] },
			{
				id: "name",
				component: "TextField",
				label: "Name",
				value: { path: "/name" }
			},
			{
				id: "echo",
				component: "Text",
				text: { call: "formatString", args: { value: "Hello ${/name}" } }
			}
		]);
		const user = userEvent.setup();
		renderWith(surface, interaction());

		await user.type(screen.getByLabelText("Name"), "Grace");

		expect(screen.getByText("Hello Grace")).toBeInTheDocument();
	});

	it("tracks a checkbox in the data model", async () => {
		const surface = surfaceFrom([
			{ id: "root", component: "Column", children: ["agree", "state"] },
			{
				id: "agree",
				component: "CheckBox",
				label: "I agree",
				value: { path: "/agree" }
			},
			{
				id: "state",
				component: "Text",
				text: { call: "formatString", args: { value: "Agreed: ${/agree}" } }
			}
		]);
		const user = userEvent.setup();
		renderWith(surface, interaction());

		await user.click(screen.getByLabelText("I agree"));

		await waitFor(() => expect(screen.getByText("Agreed: true")).toBeInTheDocument());
	});

	it("lets the user choose one option at a time", async () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "ChoicePicker",
				options: [
					{ label: "Short", value: "short" },
					{ label: "Long", value: "long" }
				],
				value: { path: "/length" }
			}
		]);
		const user = userEvent.setup();
		renderWith(surface, interaction());

		await user.click(screen.getByRole("button", { name: "Short" }));
		await user.click(screen.getByRole("button", { name: "Long" }));

		expect(screen.getByRole("button", { name: "Short" })).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByRole("button", { name: "Long" })).toHaveAttribute("aria-pressed", "true");
	});

	it("lets the user choose several options when the picker allows it", async () => {
		const surface = surfaceFrom([
			{
				id: "root",
				component: "ChoicePicker",
				variant: "multiple",
				options: [
					{ label: "Email", value: "email" },
					{ label: "Chat", value: "chat" }
				],
				value: { path: "/channels" }
			}
		]);
		const user = userEvent.setup();
		renderWith(surface, interaction());

		await user.click(screen.getByRole("button", { name: "Email" }));
		await user.click(screen.getByRole("button", { name: "Chat" }));

		expect(screen.getByRole("button", { name: "Email" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
	});
});
