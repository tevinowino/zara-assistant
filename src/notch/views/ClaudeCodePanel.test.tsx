import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

describe("ClaudeCodePanel", () => {
	it("is not drawn on another view", () => {
		setInvokeHandler("claude_code_sessions", () => [session()]);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		render(<ClaudeCodePanel zaraMode="calendar" />);

		expect(screen.queryByText("zara")).not.toBeInTheDocument();
	});

	it("says Claude Code is not connected, and where to connect it", async () => {
		setInvokeHandler("claude_code_sessions", () => []);
		setInvokeHandler("claude_code_connection", () => ({ connected: false, settingsPath: null }));

		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(await screen.findByText(/Claude Code is not connected yet/)).toBeInTheDocument();
	});

	it("invites the user to start a session when it is connected and there are none", async () => {
		setInvokeHandler("claude_code_sessions", () => []);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));

		render(<ClaudeCodePanel zaraMode="claude-code" />);

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

		render(<ClaudeCodePanel zaraMode="claude-code" />);

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

		render(<ClaudeCodePanel zaraMode="claude-code" />);

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

		render(<ClaudeCodePanel zaraMode="claude-code" />);

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

		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(await screen.findByText(/5 min/)).toBeInTheDocument();
	});

	it("follows the sessions as hooks report", async () => {
		let sessions: ClaudeCodeSession[] = [session({ project: "zara", state: "working" })];
		setInvokeHandler("claude_code_sessions", () => sessions);
		setInvokeHandler("claude_code_connection", () => ({ connected: true, settingsPath: null }));
		render(<ClaudeCodePanel zaraMode="claude-code" />);
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

		render(<ClaudeCodePanel zaraMode="claude-code" />);

		expect(await screen.findByText(/No Claude Code sessions yet/)).toBeInTheDocument();
	});
});
