import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiPanel } from "./AiPanel";
import { AI_PANEL_HEIGHT } from "./panelSize";
import { useAiSession } from "./useAiSession";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import { openedUrls } from "../test/shims/pluginOpener";

// The notch mounts the session once and hands it to the panel; this does the same.
function Harness({
	onClose = () => {},
	onDesiredHeight
}: {
	onClose?: () => void;
	onDesiredHeight?: (h: number) => void;
}) {
	const session = useAiSession();
	return <AiPanel session={session} onClose={onClose} onDesiredHeight={onDesiredHeight} />;
}

const reply = (text: string, extra: Record<string, unknown> = {}) => ({
	text,
	usedScreen: false,
	usedNotes: false,
	savedMemories: [],
	noteChanges: [],
	...extra
});

function backendWithKey(chat: () => unknown) {
	setInvokeHandler("shortcut_active", () => ({ "ai.reset": "Ctrl+R" }));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("ai_chat", chat);
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
}

describe("AiPanel", () => {
	it("asks for an API key on first use instead of showing the input", async () => {
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));

		render(<Harness />);

		expect(await screen.findByText("Add your OpenRouter API key")).toBeInTheDocument();
		expect(screen.queryByLabelText("Message Zara")).not.toBeInTheDocument();
	});

	it("asks for the key of the service that is in use, and says where to get one", async () => {
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("anthropic"));

		render(<Harness />);

		expect(await screen.findByText("Add your Anthropic API key")).toBeInTheDocument();
		expect(screen.getByLabelText("Anthropic API key")).toBeInTheDocument();
		expect(screen.getByText(/console\.anthropic\.com/)).toBeInTheDocument();
	});

	it("still asks for a key, without naming a service, when the settings cannot be read", async () => {
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => {
			throw new Error("unreadable");
		});

		render(<Harness />);

		expect(await screen.findByText("Add your API key")).toBeInTheDocument();
		expect(screen.getByLabelText("API key")).toBeInTheDocument();
	});

	it("points the user to Settings to use a different service or model", async () => {
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));

		render(<Harness />);

		expect(await screen.findByText(/choose Assistant/)).toBeInTheDocument();
	});

	it("saves the key, checks it, and then shows the message input", async () => {
		setInvokeHandler("shortcut_active", () => ({}));
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("OpenRouter API key"), "sk-or-v1-secret");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByLabelText("Message Zara")).toBeInTheDocument();
		// The message box brings its own model chooser, which reads the settings once the card is gone.
		const keyFlow = invokeCalls.filter((c) => c.command.startsWith("ai_")).slice(0, 4);
		// The settings lookup is for the card's wording; the key goes to the service in use.
		expect(keyFlow.map((c) => c.command)).toEqual([
			"ai_has_api_key",
			"ai_get_settings",
			"ai_set_api_key",
			"ai_test_connection"
		]);
		expect(keyFlow[2].args).toEqual({ key: "sk-or-v1-secret" });
	});

	it("keeps the key card and explains the problem when OpenRouter rejects the key", async () => {
		setInvokeHandler("ai_has_api_key", () => false);
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => {
			throw {
				kind: "invalid-key",
				message: "OpenRouter rejected the API key. Check it in Settings."
			};
		});
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("OpenRouter API key"), "wrong");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("OpenRouter rejected the API key");
		expect(screen.queryByLabelText("Message Zara")).not.toBeInTheDocument();
	});

	it("sends on Enter, clears the input and shows the answer", async () => {
		backendWithKey(() => reply("Steep it for three minutes."));
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "how do I brew tea?{Enter}");

		expect(await screen.findByText("Steep it for three minutes.")).toBeInTheDocument();
		expect(screen.getByText("how do I brew tea?")).toBeInTheDocument();
		expect(screen.getByLabelText("Message Zara")).toHaveValue("");
	});

	it("Shift+Enter adds a new line instead of sending", async () => {
		backendWithKey(() => reply("unused"));
		render(<Harness />);
		const user = userEvent.setup();
		const input = await screen.findByLabelText("Message Zara");

		await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");

		expect(input).toHaveValue("line one\nline two");
		expect(invokeCalls.some((c) => c.command === "ai_chat")).toBe(false);
	});

	it("does not send when Enter only confirms an input-method composition", async () => {
		backendWithKey(() => reply("unused"));
		render(<Harness />);
		const input = await screen.findByLabelText("Message Zara");
		fireEvent.change(input, { target: { value: "こんにちは" } });

		fireEvent.keyDown(input, { key: "Enter", isComposing: true });

		expect(invokeCalls.some((c) => c.command === "ai_chat")).toBe(false);
		expect(input).toHaveValue("こんにちは");
	});

	it("does not send an empty or whitespace-only message", async () => {
		backendWithKey(() => reply("unused"));
		render(<Harness />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "   {Enter}");

		expect(invokeCalls.some((c) => c.command === "ai_chat")).toBe(false);
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
	});

	it("closes when Escape is pressed in the input", async () => {
		backendWithKey(() => reply("unused"));
		const onClose = vi.fn();
		render(<Harness onClose={onClose} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "{Escape}");

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("shows what Zara is doing while it works on the answer", async () => {
		let finish: (value: unknown) => void = () => {};
		backendWithKey(() => new Promise((resolve) => (finish = resolve)));
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "what is on my screen?{Enter}");

		expect(await screen.findByText("Thinking…")).toBeInTheDocument();
		emitTauriEvent("ai-chat-status", "looking-at-screen");
		expect(await screen.findByText("Looking at your screen…")).toBeInTheDocument();
		expect(screen.getByLabelText("Message Zara")).toBeDisabled();

		finish(reply("A terminal window."));
		expect(await screen.findByText("A terminal window.")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByText("Looking at your screen…")).not.toBeInTheDocument()
		);
	});

	it("shows a failed request with a Retry that sends the same message again", async () => {
		let attempts = 0;
		backendWithKey(() => {
			attempts += 1;
			if (attempts === 1)
				throw {
					kind: "network",
					message: "Could not reach OpenRouter. Check your internet connection."
				};
			return reply("Back online.");
		});
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "are you there?{Enter}");

		expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach OpenRouter");
		await user.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByText("Back online.")).toBeInTheDocument();
		expect(screen.getAllByText("are you there?")).toHaveLength(1);
	});

	it("shows the key card again when a request is rejected because the key is missing", async () => {
		setInvokeHandler("ai_get_settings", () => aiSettingsView("openrouter"));
		backendWithKey(() => {
			throw {
				kind: "key-missing",
				message: "Add your OpenRouter API key in Settings to use Zara."
			};
		});
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "hello{Enter}");

		expect(
			await screen.findByText("Add your OpenRouter API key in Settings to use Zara.")
		).toBeInTheDocument();
		expect(screen.getByLabelText("OpenRouter API key")).toBeInTheDocument();
	});

	it("tells the user what Zara saved to memory and lets them undo it", async () => {
		backendWithKey(() => reply("Nice to meet you.", { savedMemories: ["name is Tevin"] }));
		setInvokeHandler("memory_list", () => [{ id: "m1", text: "name is Tevin", createdAt: 1 }]);
		setInvokeHandler("memory_delete", () => ({ success: true }));
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "I am Tevin{Enter}");

		expect(await screen.findByText(/Saved to memory: name is Tevin/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Undo" }));

		await waitFor(() => expect(screen.queryByText(/Saved to memory/)).not.toBeInTheDocument());
		expect(invokeCalls.find((c) => c.command === "memory_delete")?.args).toEqual({ id: "m1" });
	});

	it("starts a new conversation from the header button", async () => {
		backendWithKey(() => reply("An answer."));
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "first{Enter}");
		await screen.findByText("An answer.");

		await user.click(screen.getByRole("button", { name: "New conversation" }));

		expect(screen.queryByText("An answer.")).not.toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
	});

	it("starts a new conversation with the user's panel shortcut", async () => {
		backendWithKey(() => reply("An answer."));
		render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "first{Enter}");
		await screen.findByText("An answer.");

		await user.type(screen.getByLabelText("Message Zara"), "{Control>}r{/Control}");

		expect(screen.queryByText("An answer.")).not.toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
	});

	it("asks the notch for the welcome height at first and a taller one once there is a conversation", async () => {
		backendWithKey(() => reply("An answer."));
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();
		await screen.findByLabelText("Message Zara");
		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.welcome);

		await user.type(screen.getByLabelText("Message Zara"), "hello{Enter}");
		await screen.findByText("An answer.");

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.conversation);
	});
});

describe("answers from the model are untrusted", () => {
	async function askAndReceive(markdown: string) {
		backendWithKey(() => reply(markdown));
		const view = render(<Harness />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "go{Enter}");
		await waitFor(() => expect(invokeCalls.some((c) => c.command === "conv_save")).toBe(true));
		return view;
	}

	it("opens an https link in the system browser instead of navigating the notch", async () => {
		await askAndReceive("See [the docs](https://example.com/docs).");
		const user = userEvent.setup();

		await user.click(await screen.findByText("the docs"));

		expect(openedUrls).toEqual(["https://example.com/docs"]);
	});

	it("refuses a javascript: link", async () => {
		await askAndReceive("[click me](javascript:alert(1))");
		const user = userEvent.setup();

		await user.click(await screen.findByText("click me"));

		expect(openedUrls).toEqual([]);
	});

	it("drops script tags and image tags smuggled in as raw HTML", async () => {
		const { container } = await askAndReceive(
			'safe text <script>window.pwned = true</script><img src="https://tracker.example/pixel.png">'
		);

		await screen.findByText(/safe text/);
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("img[src*='tracker']")).toBeNull();
		expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
	});

	it("shows a widget the model asked for, and a clear card when the widget is malformed", async () => {
		await askAndReceive(
			'Here:\n\n```zara:stat\n{"items":[{"label":"Users","value":"1,204","delta":"+8%","trend":"up"}]}\n```\n\n```zara:table\n{"columns":["A"],"rows":[["1","2"]]}\n```'
		);

		expect(await screen.findByText("1,204")).toBeInTheDocument();
		expect(await screen.findByText(/table · couldn't render/)).toBeInTheDocument();
	});
});
