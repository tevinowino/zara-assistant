import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchForecast, forecastUrl, parseForecast } from "./forecast";

const TOKYO_OFFSET_SECONDS = 9 * 3600;

// It is 15:20 on 4 November 2026 in Tokyo, which is 06:20 UTC.
const tokyoThreeTwenty = Date.UTC(2026, 10, 4, 6, 20);

function hourlyTimes(date: string, fromHour = 0, toHour = 23): string[] {
	return Array.from(
		{ length: toHour - fromHour + 1 },
		(_, i) => `${date}T${String(fromHour + i).padStart(2, "0")}:00`
	);
}

function tokyoForecast() {
	const times = [...hourlyTimes("2026-11-04"), ...hourlyTimes("2026-11-05")];
	return {
		utc_offset_seconds: TOKYO_OFFSET_SECONDS,
		current: {
			temperature_2m: 18.4,
			apparent_temperature: 16.6,
			relative_humidity_2m: 62,
			wind_speed_10m: 11.3,
			weather_code: 2,
			is_day: 1
		},
		hourly: {
			time: times,
			temperature_2m: times.map((_, i) => 10 + i * 0.5),
			weather_code: times.map(() => 3),
			is_day: times.map((_, i) => (i % 24 >= 6 && i % 24 < 17 ? 1 : 0))
		},
		daily: {
			time: ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"],
			weather_code: [2, 61, 0, 3, 71, 95],
			temperature_2m_max: [19.2, 17.5, 21.1, 18, 12.4, 14],
			temperature_2m_min: [11.1, 12.6, 10.2, 9.8, 4.5, 6]
		}
	};
}

const wallClockLabel = (date: Date) =>
	new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(date);
const weekdayLabel = (date: Date) =>
	new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);

describe("parseForecast current conditions", () => {
	it("rounds the temperature and feels-like", () => {
		const forecast = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(forecast.temperature).toBe(18);
		expect(forecast.feelsLike).toBe(17);
	});

	it("names the condition from the weather code", () => {
		const forecast = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(forecast.condition).toBe("Partly Cloudy");
	});

	it("reads humidity and wind", () => {
		const forecast = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(forecast.humidity).toBe(62);
		expect(forecast.windSpeed).toBe(11);
		expect(forecast.windUnit).toBe("km/h");
	});

	it("reports wind in miles per hour for Fahrenheit", () => {
		const forecast = parseForecast(tokyoForecast(), tokyoThreeTwenty, "fahrenheit");

		expect(forecast.windUnit).toBe("mph");
		expect(forecast.unit).toBe("fahrenheit");
	});

	it("knows whether it is day", () => {
		expect(parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius").isDay).toBe(true);
	});

	it("is unknown for a weather code it has no name for", () => {
		const data = tokyoForecast();
		data.current.weather_code = 1234;

		expect(parseForecast(data, tokyoThreeTwenty, "celsius").condition).toBe("Unknown");
	});

	it("leaves out the details the forecast did not include", () => {
		const data = tokyoForecast() as Record<string, unknown>;
		data.current = { temperature_2m: 20 };

		const forecast = parseForecast(data, tokyoThreeTwenty, "celsius");

		expect(forecast.feelsLike).toBeNull();
		expect(forecast.humidity).toBeNull();
		expect(forecast.windSpeed).toBeNull();
	});
});

describe("parseForecast hours", () => {
	it("starts with the hour that is under way, in the forecast's own timezone", () => {
		const { hours } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(hours[0].isNow).toBe(true);
		expect(wallClockLabel(hours[0].wallClock)).toBe("3 PM");
	});

	it("shows the next six hours", () => {
		const { hours } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(hours.map((hour) => wallClockLabel(hour.wallClock))).toEqual([
			"3 PM",
			"4 PM",
			"5 PM",
			"6 PM",
			"7 PM",
			"8 PM"
		]);
		expect(hours.slice(1).every((hour) => !hour.isNow)).toBe(true);
	});

	it("does not depend on the timezone of the machine", () => {
		// 06:20 UTC is 15:20 in Tokyo and 22:20 the day before in Los Angeles; the forecast
		// is for Tokyo either way.
		const forecast = parseForecast(tokyoForecast(), Date.UTC(2026, 10, 4, 6, 20), "celsius");

		expect(wallClockLabel(forecast.hours[0].wallClock)).toBe("3 PM");
	});

	it("rounds each hour's temperature and names its condition", () => {
		const { hours } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(hours[0].temperature).toBe(18); // hour 15: 10 + 15 * 0.5 = 17.5, which rounds to 18
		expect(hours[0].condition).toBe("Overcast");
	});

	it("carries on past midnight into the next day", () => {
		const lateEvening = Date.UTC(2026, 10, 4, 13, 10); // 22:10 in Tokyo

		const { hours } = parseForecast(tokyoForecast(), lateEvening, "celsius");

		expect(hours.map((hour) => wallClockLabel(hour.wallClock))).toEqual([
			"10 PM",
			"11 PM",
			"12 AM",
			"1 AM",
			"2 AM",
			"3 AM"
		]);
	});

	it("shows fewer hours when the forecast runs out", () => {
		const nearTheEnd = Date.UTC(2026, 10, 5, 13, 30); // 22:30 on the 5th in Tokyo

		const { hours } = parseForecast(tokyoForecast(), nearTheEnd, "celsius");

		expect(hours).toHaveLength(2);
	});

	it("has no hours when the forecast has none", () => {
		const data = tokyoForecast() as Record<string, unknown>;
		delete data.hourly;

		expect(parseForecast(data, tokyoThreeTwenty, "celsius").hours).toEqual([]);
	});

	it("skips an hour that has no temperature", () => {
		const data = tokyoForecast();
		(data.hourly.temperature_2m as (number | null)[])[16] = null;

		const { hours } = parseForecast(data, tokyoThreeTwenty, "celsius");

		expect(hours.map((hour) => wallClockLabel(hour.wallClock))[1]).toBe("5 PM");
	});
});

describe("parseForecast days", () => {
	it("starts with today", () => {
		const { days } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(days[0].isToday).toBe(true);
		expect(weekdayLabel(days[0].wallClock)).toBe("Wed");
	});

	it("shows five days with their highs and lows", () => {
		const { days } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(days).toHaveLength(5);
		expect(days.map((day) => [day.high, day.low])).toEqual([
			[19, 11],
			[18, 13],
			[21, 10],
			[18, 10],
			[12, 5]
		]);
		expect(days.slice(1).every((day) => !day.isToday)).toBe(true);
	});

	it("names each day's condition", () => {
		const { days } = parseForecast(tokyoForecast(), tokyoThreeTwenty, "celsius");

		expect(days.map((day) => day.condition)).toEqual([
			"Partly Cloudy",
			"Rainy",
			"Clear",
			"Overcast",
			"Snowy"
		]);
	});

	it("treats it as the next day once the forecast's own clock passes midnight", () => {
		const afterMidnightInTokyo = Date.UTC(2026, 10, 4, 15, 30); // 00:30 on the 5th in Tokyo

		const { days } = parseForecast(tokyoForecast(), afterMidnightInTokyo, "celsius");

		expect(weekdayLabel(days[0].wallClock)).toBe("Thu");
		expect(days[0].isToday).toBe(true);
	});

	it("has no days when the forecast has none", () => {
		const data = tokyoForecast() as Record<string, unknown>;
		delete data.daily;

		expect(parseForecast(data, tokyoThreeTwenty, "celsius").days).toEqual([]);
	});
});

describe("parseForecast with something that is not a forecast", () => {
	it("refuses a value that is not an object", () => {
		expect(() => parseForecast("nope", tokyoThreeTwenty, "celsius")).toThrow("Not a forecast");
	});

	it("refuses an answer with no current conditions", () => {
		expect(() => parseForecast({ hourly: {} }, tokyoThreeTwenty, "celsius")).toThrow(
			"Not a forecast"
		);
	});

	it("refuses an answer with no current temperature", () => {
		expect(() =>
			parseForecast({ current: { weather_code: 1 } }, tokyoThreeTwenty, "celsius")
		).toThrow("no current temperature");
	});

	it("accepts a temperature of zero", () => {
		const forecast = parseForecast({ current: { temperature_2m: 0 } }, tokyoThreeTwenty, "celsius");

		expect(forecast.temperature).toBe(0);
	});
});

describe("forecastUrl", () => {
	it("asks for the current conditions, hours and days in the place's timezone", () => {
		const url = new URL(forecastUrl(35.68, 139.69, "celsius"));

		expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
		expect(url.searchParams.get("latitude")).toBe("35.68");
		expect(url.searchParams.get("longitude")).toBe("139.69");
		expect(url.searchParams.get("timezone")).toBe("auto");
		expect(url.searchParams.get("current")).toContain("apparent_temperature");
		expect(url.searchParams.get("hourly")).toContain("temperature_2m");
		expect(url.searchParams.get("daily")).toContain("temperature_2m_max");
		expect(url.searchParams.get("forecast_days")).toBe("6");
	});

	it("keeps Celsius and kilometres per hour by default", () => {
		const url = new URL(forecastUrl(1, 2, "celsius"));

		expect(url.searchParams.has("temperature_unit")).toBe(false);
		expect(url.searchParams.has("wind_speed_unit")).toBe(false);
	});

	it("asks for Fahrenheit and miles per hour together", () => {
		const url = new URL(forecastUrl(1, 2, "fahrenheit"));

		expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit");
		expect(url.searchParams.get("wind_speed_unit")).toBe("mph");
	});
});

describe("fetchForecast", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches and reads the forecast", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => tokyoForecast() }));
		vi.stubGlobal("fetch", fetchMock);

		const forecast = await fetchForecast(35.68, 139.69, "celsius", tokyoThreeTwenty);

		expect(forecast.temperature).toBe(18);
		expect(String((fetchMock.mock.calls as unknown[][])[0][0])).toContain("latitude=35.68");
	});

	it("fails when the service answers with an error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 503 }))
		);

		await expect(fetchForecast(1, 2, "celsius", tokyoThreeTwenty)).rejects.toThrow(
			"Weather API returned 503"
		);
	});
});
