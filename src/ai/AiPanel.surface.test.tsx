import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { CATALOG_ID } from "./a2ui/catalog";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";

function Harness({ startTimer }: { startTimer?: (seconds: number) => void }) {
	const session = useAiSession();
	return (
		<AiPanel session={session} onClose={() => {}} notchActions={startTimer ? { startTimer } : {}} />
	);
}

function surfaceReply(components: unknown[]): string {
	const lines = [
		{ version: "v0.9", createSurface: { surfaceId: "s1", catalogId: CATALOG_ID } },
		{ version: "v0.9", updateComponents: { surfaceId: "s1", components } }
	]
		.map((message) => JSON.stringify(message))
		.join("\n");
	return "Here you go.\n\n```a2ui\n" + lines + "\n```";
}

function backendReplying(texts: string[]) {
	let next = 0;
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("ai_chat", () => ({
		text: texts[Math.min(next++, texts.length - 1)],
		usedScreen: false,
		usedNotes: false,
		savedMemories: [],
		noteChanges: []
	}));
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
}

const aiChatCalls = () => invokeCalls.filter((call) => call.command === "ai_chat");

describe("a surface inside an assistant answer", () => {
	it("sends the label of an event button as the user's next message", async () => {
		backendReplying([
			surfaceReply([
				{
					id: "root",
					component: "Button",
					child: "label",
					action: { event: { name: "shorter" } }
				},
				{ id: "label", component: "Text", text: "Make it shorter" }
			]),
			"Shorter version."
		]);
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "Write a summary{Enter}");
		await user.click(await screen.findByRole("button", { name: "Make it shorter" }));

		expect(await screen.findByText("Shorter version.")).toBeInTheDocument();
		expect(aiChatCalls()).toHaveLength(2);
		expect(aiChatCalls()[1].args).toMatchObject({ message: "Make it shorter" });
	});

	it("starts a timer in the notch when the panel is given that ability", async () => {
		const timers: number[] = [];
		backendReplying([
			surfaceReply([
				{
					id: "root",
					component: "Button",
					child: "label",
					action: { functionCall: { call: "startTimer", args: { minutes: 15 } } }
				},
				{ id: "label", component: "Text", text: "Start 15 minute timer" }
			])
		]);
		render(<Harness startTimer={(seconds) => timers.push(seconds)} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "Time my break{Enter}");
		await user.click(await screen.findByRole("button", { name: "Start 15 minute timer" }));

		expect(timers).toEqual([900]);
	});

	it("leaves a timer button disabled when the panel cannot start timers", async () => {
		backendReplying([
			surfaceReply([
				{
					id: "root",
					component: "Button",
					child: "label",
					action: { functionCall: { call: "startTimer", args: { minutes: 15 } } }
				},
				{ id: "label", component: "Text", text: "Start 15 minute timer" }
			])
		]);
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "Time my break{Enter}");

		expect(await screen.findByRole("button", { name: "Start 15 minute timer" })).toBeDisabled();
	});

	it("shows a fallback card instead of crashing when the surface is invalid", async () => {
		backendReplying([
			surfaceReply([{ id: "root", component: "Video", url: "https://example.com/v.mp4" }])
		]);
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "Show me{Enter}");

		expect(
			await screen.findByText('component "root" has unknown type "Video"')
		).toBeInTheDocument();
		expect(screen.getByText("Here you go.")).toBeInTheDocument();
	});
});
