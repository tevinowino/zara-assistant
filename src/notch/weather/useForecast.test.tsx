import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { setInvokeHandler } from "../../test/shims/tauriCore";
import { clearForecastCache, useForecast } from "./useForecast";

function answer(temperature: number) {
	return {
		utc_offset_seconds: 32400,
		current: { temperature_2m: temperature, weather_code: 0, is_day: 1 },
		hourly: { time: [], temperature_2m: [], weather_code: [], is_day: [] },
		daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] }
	};
}

function chooseTokyo() {
	setInvokeHandler("load_settings", () => ({
		"zara-weather-lat": "35.68",
		"zara-weather-lon": "139.69",
		"zara-weather-city": "Tokyo"
	}));
}

describe("useForecast", () => {
	beforeEach(() => {
		clearForecastCache();
		localStorage.clear();
		chooseTokyo();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("is loading until the forecast arrives", () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise(() => {}))
		);

		const { result } = renderHook(() => useForecast());

		expect(result.current.loading).toBe(true);
		expect(result.current.forecast).toBeNull();
		expect(result.current.failed).toBe(false);
	});

	it("fetches the forecast for the city chosen in Settings", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => answer(21.4) }));
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useForecast());

		await waitFor(() => expect(result.current.forecast?.temperature).toBe(21));
		expect(result.current.city).toBe("Tokyo");
		expect(result.current.loading).toBe(false);
		const url = String((fetchMock.mock.calls as unknown[][])[0][0]);
		expect(url).toContain("latitude=35.68");
		expect(url).toContain("longitude=139.69");
	});

	it("asks for Fahrenheit when that is the chosen unit", async () => {
		localStorage.setItem("zara-temp-unit", "fahrenheit");
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => answer(70) }));
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useForecast());

		await waitFor(() => expect(result.current.forecast?.unit).toBe("fahrenheit"));
		expect(String((fetchMock.mock.calls as unknown[][])[0][0])).toContain(
			"temperature_unit=fahrenheit"
		);
	});

	it("says so when the forecast cannot be fetched", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500 }))
		);

		const { result } = renderHook(() => useForecast());

		await waitFor(() => expect(result.current.failed).toBe(true));
		expect(result.current.loading).toBe(false);
	});

	it("shows a forecast fetched a moment ago without asking again", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => answer(15) }));
		vi.stubGlobal("fetch", fetchMock);
		const first = renderHook(() => useForecast());
		await waitFor(() => expect(first.result.current.forecast?.temperature).toBe(15));
		first.unmount();

		const second = renderHook(() => useForecast());

		expect(second.result.current.forecast?.temperature).toBe(15);
		await waitFor(() => expect(second.result.current.loading).toBe(false));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("asks again once the remembered forecast is old", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => answer(15) })
			.mockResolvedValueOnce({ ok: true, json: async () => answer(19) });
		vi.stubGlobal("fetch", fetchMock);
		const first = renderHook(() => useForecast());
		await waitFor(() => expect(first.result.current.forecast?.temperature).toBe(15));
		first.unmount();

		vi.setSystemTime(new Date(2026, 10, 4, 12, 11, 0));
		const second = renderHook(() => useForecast());

		await waitFor(() => expect(second.result.current.forecast?.temperature).toBe(19));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it("keeps showing the old forecast when a refresh fails", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => answer(15) })
			.mockResolvedValueOnce({ ok: false, status: 503 });
		vi.stubGlobal("fetch", fetchMock);
		const first = renderHook(() => useForecast());
		await waitFor(() => expect(first.result.current.forecast?.temperature).toBe(15));
		first.unmount();

		vi.setSystemTime(new Date(2026, 10, 4, 12, 30, 0));
		const second = renderHook(() => useForecast());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(second.result.current.loading).toBe(false));

		expect(second.result.current.forecast?.temperature).toBe(15);
		expect(second.result.current.failed).toBe(false);
		vi.useRealTimers();
	});

	it("fetches again when reloaded, even if the forecast is fresh", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => answer(15) })
			.mockResolvedValueOnce({ ok: true, json: async () => answer(16) });
		vi.stubGlobal("fetch", fetchMock);
		const { result } = renderHook(() => useForecast());
		await waitFor(() => expect(result.current.forecast?.temperature).toBe(15));

		act(() => result.current.reload());

		await waitFor(() => expect(result.current.forecast?.temperature).toBe(16));
	});
});
