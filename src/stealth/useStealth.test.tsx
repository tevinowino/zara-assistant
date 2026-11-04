import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { emitTauriEvent } from "../test/shims/tauriEvent";
import type { StealthStatus } from "../ai/api";
import { useStealth } from "./useStealth";

const off: StealthStatus = {
	requested: false,
	supported: true,
	active: false,
	problem: null,
	windows: []
};
const on: StealthStatus = { ...off, requested: true, active: true };

describe("useStealth", () => {
	it("is unknown until the status has been read", () => {
		setInvokeHandler("stealth_status", () => new Promise(() => {}));

		const { result } = renderHook(() => useStealth());

		expect(result.current.status).toBeNull();
		expect(result.current.busy).toBe(false);
	});

	it("reads the status when it starts", async () => {
		setInvokeHandler("stealth_status", () => on);

		const { result } = renderHook(() => useStealth());

		await waitFor(() => expect(result.current.status).toEqual(on));
	});

	it("is unknown when the status cannot be read", async () => {
		setInvokeHandler("stealth_status", () => {
			throw new Error("unavailable");
		});

		const { result } = renderHook(() => useStealth());

		await waitFor(() => expect(invokeCalls.some((c) => c.command === "stealth_status")).toBe(true));
		expect(result.current.status).toBeNull();
	});

	it("asks for stealth on when it is off, and shows what the backend reports", async () => {
		setInvokeHandler("stealth_status", () => off);
		setInvokeHandler("stealth_set", () => on);
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));

		await act(async () => {
			await result.current.toggle();
		});

		expect(invokeCalls.find((c) => c.command === "stealth_set")?.args).toEqual({ enabled: true });
		expect(result.current.status).toEqual(on);
	});

	it("asks for stealth off when it is on", async () => {
		setInvokeHandler("stealth_status", () => on);
		setInvokeHandler("stealth_set", () => off);
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(on));

		await act(async () => {
			await result.current.toggle();
		});

		expect(invokeCalls.find((c) => c.command === "stealth_set")?.args).toEqual({
			enabled: false
		});
		expect(result.current.status).toEqual(off);
	});

	it("does nothing when toggled before the status is known", async () => {
		setInvokeHandler("stealth_status", () => new Promise(() => {}));
		setInvokeHandler("stealth_set", () => on);
		const { result } = renderHook(() => useStealth());

		await act(async () => {
			await result.current.toggle();
		});

		expect(invokeCalls.some((c) => c.command === "stealth_set")).toBe(false);
	});

	it("reads the status again if the change fails", async () => {
		let reads = 0;
		setInvokeHandler("stealth_status", () => (reads++ === 0 ? off : { ...off, problem: "later" }));
		setInvokeHandler("stealth_set", () => {
			throw new Error("refused");
		});
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));

		await act(async () => {
			await result.current.toggle();
		});

		expect(result.current.status).toEqual({ ...off, problem: "later" });
		expect(result.current.busy).toBe(false);
	});

	it("is busy while a change is under way and refuses a second one", async () => {
		setInvokeHandler("stealth_status", () => off);
		let finish: (status: StealthStatus) => void = () => {};
		setInvokeHandler("stealth_set", () => new Promise((resolve) => (finish = resolve)));
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));

		let first: Promise<void> = Promise.resolve();
		act(() => {
			first = result.current.toggle();
		});
		await waitFor(() => expect(result.current.busy).toBe(true));
		await act(async () => {
			await result.current.toggle();
		});
		expect(invokeCalls.filter((c) => c.command === "stealth_set")).toHaveLength(1);

		await act(async () => {
			finish(on);
			await first;
		});
		expect(result.current.busy).toBe(false);
	});

	it("follows a change made from another window", async () => {
		let current = off;
		setInvokeHandler("stealth_status", () => current);
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));

		current = on;
		emitTauriEvent("settings-changed", { key: "zara-stealth-enabled", value: "true" });

		await waitFor(() => expect(result.current.status).toEqual(on));
	});

	it("ignores a change to some other setting", async () => {
		setInvokeHandler("stealth_status", () => off);
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));
		const readsBefore = invokeCalls.filter((c) => c.command === "stealth_status").length;

		emitTauriEvent("settings-changed", { key: "zara-theme-mode", value: "light" });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(invokeCalls.filter((c) => c.command === "stealth_status").length).toBe(readsBefore);
	});

	it("re-applies and reads back the status when verified", async () => {
		setInvokeHandler("stealth_status", () => off);
		setInvokeHandler("stealth_verify", () => ({ ...on, problem: null }));
		const { result } = renderHook(() => useStealth());
		await waitFor(() => expect(result.current.status).toEqual(off));

		await act(async () => {
			await result.current.verify();
		});

		expect(invokeCalls.some((c) => c.command === "stealth_verify")).toBe(true);
		expect(result.current.status?.active).toBe(true);
	});
});
