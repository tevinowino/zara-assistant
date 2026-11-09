import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";
import type { ClaudeCodeSession } from "../claudeCode/claudeCodeTypes";
import { ClaudeCodePanel } from "./ClaudeCodePanel";

const session = (overrides: Partial<ClaudeCodeSession> = {}): ClaudeCodeSession => ({
	sessionId: "s1",
	project: "zara",
	title: null,
	state: "working",
	excerpt: null,
	updatedAtMs: Date.now(),
	...overrides
});

/** The panel open on its Sessions view. */
async function openSessions() {
	render(<ClaudeCodePanel zaraMode="claude-code" />);
	await userEvent.click(screen.getByRole("tab", { name: "Sessions" }));
}

describe("ClaudeCodePanel views", () => {
	it("opens on the usage view", () => {
		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(screen.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "false");
	});

	it("asks permission on the usage view until the user has allowed counting", () => {
		localStorage.clear();

		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(screen.getByText("See your Claude Code usage")).toBeInTheDocument();
	});

	it("counts nothing until permission is given", () => {
		localStorage.clear();
		setInvokeHandler("claude_usage_summary", () => {
			throw new Error("must not be asked");
		});

		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
	});

	it("allows counting and saves it when the user presses Allow", async () => {
		localStorage.clear();
		setInvokeHandler("save_setting", () => undefined);
		setInvokeHandler("claude_usage_summary", () => ({ anyUsage: false }));
		render(<ClaudeCodePanel zaraMode="claude-code" />);

		await userEvent.click(screen.getByRole("button", { name: "Allow" }));

		expect(localStorage.getItem("zara-claude-usage-enabled")).toBe("true");
	});

	it("shows the sessions view when it is chosen", async () => {
		setInvokeHandler("claude_code_sessions", () => []);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));
		render(<ClaudeCodePanel zaraMode="claude-code" />);

		await userEvent.click(screen.getByRole("tab", { name: "Sessions" }));

		expect(await screen.findByText(/No Claude Code sessions yet/)).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");
	});
});

describe("ClaudeCodePanel sessions", () => {
	it("is not drawn on another view", () => {
		setInvokeHandler("claude_code_sessions", () => [session()]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		render(<ClaudeCodePanel zaraMode="calendar" />);

		expect(screen.queryByText("zara")).not.toBeInTheDocument();
	});

	it("says Claude Code is not connected, and where to connect it", async () => {
		setInvokeHandler("claude_code_sessions", () => []);
		setInvokeHandler("claude_code_connection", () => ({ connected: false, settingsPath: null }));

		await openSessions();

		expect(await screen.findByText(/Claude Code is not connected yet/)).toBeInTheDocument();
	});

	it("invites the user to start a session when it is connected and there are none", async () => {
		setInvokeHandler("claude_code_sessions", () => []);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		expect(await screen.findByText(/No Claude Code sessions yet/)).toBeInTheDocument();
	});

	it("lists each session with its project, state and what Claude said", async () => {
		setInvokeHandler("claude_code_sessions", () => [
			session({
				sessionId: "a",
				project: "zara",
				state: "done",
				excerpt: "Fixed the notch.",
				title: "Fix the notch"
			}),
			session({ sessionId: "b", project: "website", state: "needsInput", excerpt: "Allow Bash?" })
		]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		expect(await screen.findByText("zara")).toBeInTheDocument();
		expect(screen.getByText("Done")).toBeInTheDocument();
		expect(screen.getByText("Fixed the notch.")).toBeInTheDocument();
		expect(screen.getByText("Fix the notch")).toBeInTheDocument();
		expect(screen.getByText("website")).toBeInTheDocument();
		expect(screen.getByText("Needs you")).toBeInTheDocument();
		expect(screen.getByText("Allow Bash?")).toBeInTheDocument();
	});

	it("names each state a session can be in", async () => {
		setInvokeHandler("claude_code_sessions", () => [
			session({ sessionId: "1", project: "one", state: "working" }),
			session({ sessionId: "2", project: "two", state: "needsInput" }),
			session({ sessionId: "3", project: "three", state: "done" }),
			session({ sessionId: "4", project: "four", state: "idle" })
		]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		await screen.findByText("one");
		expect(screen.getByText("Working")).toBeInTheDocument();
		expect(screen.getByText("Needs you")).toBeInTheDocument();
		expect(screen.getByText("Done")).toBeInTheDocument();
		expect(screen.getByText("Idle")).toBeInTheDocument();
	});

	it("marks each card with its state so it can be coloured", async () => {
		setInvokeHandler("claude_code_sessions", () => [
			session({ project: "zara", state: "needsInput" })
		]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		expect((await screen.findByText("zara")).closest("li")).toHaveAttribute(
			"data-state",
			"needsInput"
		);
	});

	it("says how long ago a session was last active", async () => {
		setInvokeHandler("claude_code_sessions", () => [
			session({ project: "zara", updatedAtMs: Date.now() - 5 * 60_000 })
		]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		expect(await screen.findByText(/5 min/)).toBeInTheDocument();
	});

	it("follows the sessions as hooks report", async () => {
		let sessions: ClaudeCodeSession[] = [session({ project: "zara", state: "working" })];
		setInvokeHandler("claude_code_sessions", () => sessions);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));
		await openSessions();
		expect(await screen.findByText("Working")).toBeInTheDocument();

		sessions = [session({ project: "zara", state: "done", excerpt: "All finished." })];
		await act(async () => {
			emitTauriEvent("claude-code-changed");
		});

		expect(await screen.findByText("All finished.")).toBeInTheDocument();
		expect(screen.queryByText("Working")).not.toBeInTheDocument();
	});

	it("shows an empty list rather than failing when the sessions cannot be read", async () => {
		setInvokeHandler("claude_code_sessions", () => {
			throw new Error("backend down");
		});
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		await openSessions();

		expect(await screen.findByText(/No Claude Code sessions yet/)).toBeInTheDocument();
	});
});
