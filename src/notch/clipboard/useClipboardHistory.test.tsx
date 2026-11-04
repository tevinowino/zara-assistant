import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { emitTauriEvent } from "../../test/shims/tauriEvent";
import {
	useClipboardHistory,
	useClipboardMonitor,
	type ClipboardEntry
} from "./useClipboardHistory";

const writeText = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

const entry = (id: number, text: string, copiedAt = 1000): ClipboardEntry => ({
	id,
	text,
	copiedAt
});
const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("useClipboardHistory", () => {
	beforeEach(() => {
		writeText.mockReset();
		writeText.mockResolvedValue(undefined);
	});

	it("is empty until the history has been read", () => {
		setInvokeHandler("clipboard_history_list", () => new Promise(() => {}));

		const { result } = renderHook(() => useClipboardHistory());

		expect(result.current.entries).toBeNull();
		expect(result.current.failed).toBe(false);
	});

	it("lists what the backend remembers", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(2, "second"), entry(1, "first")]);

		const { result } = renderHook(() => useClipboardHistory());

		await waitFor(() =>
			expect(result.current.entries?.map((e) => e.text)).toEqual(["second", "first"])
		);
	});

	it("says so when the history cannot be read", async () => {
		setInvokeHandler("clipboard_history_list", () => {
			throw new Error("unavailable");
		});

		const { result } = renderHook(() => useClipboardHistory());

		await waitFor(() => expect(result.current.failed).toBe(true));
	});

	it("shows a new copy as it happens", async () => {
		let stored = [entry(1, "first")];
		setInvokeHandler("clipboard_history_list", () => stored);
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toHaveLength(1));

		stored = [entry(2, "second"), entry(1, "first")];
		emitTauriEvent("clipboard-history-changed", null);

		await waitFor(() => expect(result.current.entries).toHaveLength(2));
		expect(result.current.entries?.[0].text).toBe("second");
	});

	it("puts an entry back on the clipboard", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(1, "hello")]);
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toHaveLength(1));

		let copied = false;
		await act(async () => {
			copied = await result.current.copyAgain(entry(1, "hello"));
		});

		expect(copied).toBe(true);
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("reports a copy that did not work", async () => {
		setInvokeHandler("clipboard_history_list", () => []);
		writeText.mockRejectedValue(new Error("denied"));
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toEqual([]));

		let copied = true;
		await act(async () => {
			copied = await result.current.copyAgain(entry(1, "hello"));
		});

		expect(copied).toBe(false);
	});

	it("removes one entry and shows the list without it", async () => {
		let stored = [entry(2, "b"), entry(1, "a")];
		setInvokeHandler("clipboard_history_list", () => stored);
		setInvokeHandler("clipboard_history_remove", (args) => {
			stored = stored.filter((e) => e.id !== (args as { id: number }).id);
			return null;
		});
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toHaveLength(2));

		await act(async () => {
			await result.current.remove(2);
		});

		expect(callsTo("clipboard_history_remove")[0].args).toEqual({ id: 2 });
		expect(result.current.entries?.map((e) => e.id)).toEqual([1]);
	});

	it("clears the history", async () => {
		let stored = [entry(1, "a")];
		setInvokeHandler("clipboard_history_list", () => stored);
		setInvokeHandler("clipboard_history_clear", () => {
			stored = [];
			return null;
		});
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toHaveLength(1));

		await act(async () => {
			await result.current.clearAll();
		});

		expect(result.current.entries).toEqual([]);
	});

	it("reads the list again after a failed remove, so what is shown is what is stored", async () => {
		setInvokeHandler("clipboard_history_list", () => [entry(1, "a")]);
		setInvokeHandler("clipboard_history_remove", () => {
			throw new Error("busy");
		});
		const { result } = renderHook(() => useClipboardHistory());
		await waitFor(() => expect(result.current.entries).toHaveLength(1));
		const readsBefore = callsTo("clipboard_history_list").length;

		await act(async () => {
			await result.current.remove(1);
		});

		expect(callsTo("clipboard_history_list").length).toBeGreaterThan(readsBefore);
		expect(result.current.entries).toHaveLength(1);
	});
});

describe("useClipboardMonitor", () => {
	it("tells the backend to watch while the widget is on", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		renderHook(() => useClipboardMonitor(true));

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: true });
	});

	it("tells the backend to stop, and so forget, when the widget is turned off", () => {
		setInvokeHandler("clipboard_history_enable", () => null);
		const { rerender } = renderHook(({ on }) => useClipboardMonitor(on), {
			initialProps: { on: true }
		});

		rerender({ on: false });

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("does not fail if the backend cannot be reached", () => {
		setInvokeHandler("clipboard_history_enable", () => {
			throw new Error("no backend");
		});

		expect(() => renderHook(() => useClipboardMonitor(true))).not.toThrow();
	});
});
