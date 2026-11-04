import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { useSystemStats } from "./useSystemStats";

const metricRequests = () => invokeCalls.filter((call) => call.command === "get_system_metrics");

const readings = {
	cpu_percent: 12,
	ram_percent: 48,
	disk_free_gigabytes: 210,
	network_upload_bytes_per_second: 1500,
	network_download_bytes_per_second: 9000
};

describe("useSystemStats", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reads every figure with a single request", async () => {
		setInvokeHandler("get_system_metrics", () => readings);

		const { result } = renderHook(() => useSystemStats());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(metricRequests()).toHaveLength(1);
		expect(result.current).toEqual({
			cpuUsage: 12,
			ramUsage: 48,
			diskSpace: 210,
			netUpSpeed: 1500,
			netDownSpeed: 9000
		});
	});

	it("asks again every three seconds", async () => {
		setInvokeHandler("get_system_metrics", () => readings);
		renderHook(() => useSystemStats());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		const requestsAtStart = metricRequests().length;

		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});

		expect(metricRequests().length - requestsAtStart).toBe(2);
	});

	it("keeps the previous value of a figure the system could not read this time", async () => {
		setInvokeHandler("get_system_metrics", () => readings);
		const { result } = renderHook(() => useSystemStats());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		setInvokeHandler("get_system_metrics", () => ({
			...readings,
			cpu_percent: null,
			ram_percent: 51
		}));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(result.current.cpuUsage).toBe(12);
		expect(result.current.ramUsage).toBe(51);
	});

	it("asks nothing of the system while the notch is hidden", async () => {
		setInvokeHandler("get_system_metrics", () => readings);

		renderHook(() => useSystemStats(false));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000);
		});

		expect(metricRequests()).toHaveLength(0);
	});

	it("reads at once when the notch becomes visible again", async () => {
		setInvokeHandler("get_system_metrics", () => readings);
		const { rerender } = renderHook(({ active }) => useSystemStats(active), {
			initialProps: { active: false }
		});

		rerender({ active: true });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(metricRequests()).toHaveLength(1);
	});
});
