import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";

function Harness() {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} />;
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);

function backend(answers: Array<() => unknown>) {
	let asked = 0;
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("conv_list", () => []);
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
	setInvokeHandler("ai_get_model_controls", () => []);
	setInvokeHandler("ai_list_models", () => []);
	setInvokeHandler("ai_get_settings", () =>
		aiSettingsView("openrouter", {
			openrouter: { hasKey: true, model: "google/gemma-4-31b-it" },
			google: { hasKey: true, model: "gemini-3.8-flash" }
		})
	);
	setInvokeHandler("ai_chat", () => answers[Math.min(asked++, answers.length - 1)]());
}

const answer = (text: string) => () => ({
	text,
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: []
});

describe("choosing a model from the message box", () => {
	it("has the model chip beside the send button", async () => {
		backend([answer("Hello.")]);

		render(<Harness />);

		const chip = await screen.findByRole("button", { name: /^Model:/ });
		expect(chip).toHaveTextContent("gemma-4-31b-it");
		expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
	});

	it("asks a question that failed again of the model just chosen", async () => {
		backend([
			() => {
				throw { kind: "rate-limited", message: "That service is busy. Try again in a moment." };
			},
			answer("Here you go.")
		]);
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "what is 2+2?{Enter}");
		await screen.findByRole("alert");

		await user.click(await screen.findByRole("button", { name: /^Model:/ }));
		await user.click(await screen.findByRole("button", { name: /^Google/ }));
		await user.click(await screen.findByRole("menuitemradio", { name: "gemini-3.8-flash" }));

		expect(await screen.findByText("Here you go.")).toBeInTheDocument();
		await waitFor(() => expect(calls("ai_chat")).toHaveLength(2));
		expect(calls("ai_chat")[1].args?.message).toBe("what is 2+2?");
	});

	it("does not ask anything again when the model is changed with nothing wrong", async () => {
		backend([answer("Hello.")]);
		render(<Harness />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: /^Model:/ }));
		await user.click(await screen.findByRole("button", { name: /^Google/ }));

		await user.click(await screen.findByRole("menuitemradio", { name: "gemini-3.8-flash" }));

		await waitFor(() => expect(calls("save_setting").length).toBeGreaterThan(0));
		expect(calls("ai_chat")).toHaveLength(0);
	});
});
