import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { ClaudeCodeSection } from "./ClaudeCodeSection";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);
const savedValue = (key: string) =>
	callsTo("save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === key)
		.map((args) => args.value)
		.at(-1);

const SETTINGS_PATH = "C:\\Users\\me\\.claude\\settings.json";
const HOOKS_PREVIEW = '{\n  "hooks": {\n    "Stop": []\n  }\n}';

function claudeCodeConnectedState(connected: boolean) {
	return { connected, settingsPath: SETTINGS_PATH };
}

describe("ClaudeCodeSection", () => {
	beforeEach(() => {
		localStorage.clear();
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(false));
		setInvokeHandler("claude_code_hooks_preview", () => HOOKS_PREVIEW);
	});

	it("offers to connect when Claude Code is not connected", async () => {
		render(<ClaudeCodeSection widgetOn />);

		expect(await screen.findByRole("button", { name: "Connect…" })).toBeEnabled();
		expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
	});

	it("shows exactly what will be added before it changes anything", async () => {
		render(<ClaudeCodeSection widgetOn />);

		await userEvent.click(await screen.findByRole("button", { name: "Connect…" }));

		expect(await screen.findByText(/"Stop": \[\]/)).toBeInTheDocument();
		expect(screen.getByText(SETTINGS_PATH)).toBeInTheDocument();
		expect(screen.getByText("settings.json.zara-backup")).toBeInTheDocument();
		expect(callsTo("claude_code_connect")).toHaveLength(0);
	});

	it("changes nothing when the user cancels", async () => {
		render(<ClaudeCodeSection widgetOn />);
		await userEvent.click(await screen.findByRole("button", { name: "Connect…" }));

		await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(callsTo("claude_code_connect")).toHaveLength(0);
		expect(screen.queryByRole("region", { name: "Connect Claude Code" })).not.toBeInTheDocument();
	});

	it("connects once the user agrees, and then offers to disconnect", async () => {
		setInvokeHandler("claude_code_connect", () => claudeCodeConnectedState(true));
		render(<ClaudeCodeSection widgetOn />);
		await userEvent.click(await screen.findByRole("button", { name: "Connect…" }));

		await userEvent.click(await screen.findByRole("button", { name: "Add these hooks" }));

		expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
		expect(callsTo("claude_code_connect")).toHaveLength(1);
		expect(screen.queryByRole("region", { name: "Connect Claude Code" })).not.toBeInTheDocument();
	});

	it("says why it could not connect and stays disconnected", async () => {
		setInvokeHandler("claude_code_connect", () => {
			throw "Claude Code's settings file is not valid JSON, so Zara left it alone.";
		});
		render(<ClaudeCodeSection widgetOn />);
		await userEvent.click(await screen.findByRole("button", { name: "Connect…" }));

		await userEvent.click(await screen.findByRole("button", { name: "Add these hooks" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("is not valid JSON");
		expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
	});

	it("starts connected when the hooks are already there", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));

		render(<ClaudeCodeSection widgetOn />);

		expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
		expect(screen.getByText(/Connected\./)).toBeInTheDocument();
	});

	it("disconnects when asked", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));
		setInvokeHandler("claude_code_disconnect", () => claudeCodeConnectedState(false));
		render(<ClaudeCodeSection widgetOn />);

		await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

		expect(await screen.findByRole("button", { name: "Connect…" })).toBeInTheDocument();
		expect(callsTo("claude_code_disconnect")).toHaveLength(1);
	});

	it("shows the alert choices only once connected", async () => {
		render(<ClaudeCodeSection widgetOn />);
		await screen.findByRole("button", { name: "Connect…" });

		expect(
			screen.queryByRole("switch", { name: "Alert When Claude Needs You" })
		).not.toBeInTheDocument();
	});

	it("has both alerts on to begin with", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));

		render(<ClaudeCodeSection widgetOn />);

		expect(
			await screen.findByRole("switch", { name: "Alert When Claude Needs You" })
		).toBeChecked();
		expect(screen.getByRole("switch", { name: "Alert When Claude Finishes" })).toBeChecked();
	});

	it("saves the choice to stop alerting when Claude needs the user", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));
		render(<ClaudeCodeSection widgetOn />);

		await userEvent.click(
			await screen.findByRole("switch", { name: "Alert When Claude Needs You" })
		);

		await waitFor(() => expect(savedValue("zara-claude-code-alert-input")).toBe("false"));
	});

	it("saves the choice to stop alerting when Claude finishes", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));
		render(<ClaudeCodeSection widgetOn />);

		await userEvent.click(
			await screen.findByRole("switch", { name: "Alert When Claude Finishes" })
		);

		await waitFor(() => expect(savedValue("zara-claude-code-alert-done")).toBe("false"));
	});

	it("reminds the user to turn the widget on when it is connected but the widget is off", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));

		render(<ClaudeCodeSection widgetOn={false} />);

		expect(await screen.findByText(/Turn on the Claude Code widget/)).toBeInTheDocument();
	});

	it("does not remind the user when the widget is on", async () => {
		setInvokeHandler("claude_code_connection", () => claudeCodeConnectedState(true));

		render(<ClaudeCodeSection widgetOn />);
		await screen.findByRole("button", { name: "Disconnect" });

		expect(screen.queryByText(/Turn on the Claude Code widget/)).not.toBeInTheDocument();
	});
});
