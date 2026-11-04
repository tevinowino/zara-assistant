import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeatherPanel } from "./WeatherPanel";
import { setInvokeHandler } from "../../test/shims/tauriCore";
import { clearForecastCache } from "../weather/useForecast";

// It is 15:20 in Tokyo (UTC+9), 06:20 UTC, on Wednesday 4 November 2026.
const NOW = Date.UTC(2026, 10, 4, 6, 20);

function hourly(date: string, from: number, to: number) {
	return Array.from(
		{ length: to - from + 1 },
		(_, i) => `${date}T${String(from + i).padStart(2, "0")}:00`
	);
}

function tokyoAnswer() {
	const times = [...hourly("2026-11-04", 0, 23), ...hourly("2026-11-05", 0, 23)];
	return {
		utc_offset_seconds: 32400,
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
			temperature_2m: times.map((_, i) => 10 + i),
			weather_code: times.map(() => 3),
			is_day: times.map(() => 1)
		},
		daily: {
			time: ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"],
			weather_code: [2, 61, 0, 3, 71, 95],
			temperature_2m_max: [19, 17, 21, 18, 12, 14],
			temperature_2m_min: [11, 13, 10, 10, 5, 6]
		}
	};
}

function serveTokyo() {
	setInvokeHandler("load_settings", () => ({
		"zara-weather-lat": "35.68",
		"zara-weather-lon": "139.69",
		"zara-weather-city": "Tokyo"
	}));
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, json: async () => tokyoAnswer() }))
	);
}

describe("WeatherPanel", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		clearForecastCache();
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("is not drawn on another panel", () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="calendar" timeFormat24h={false} />);

		expect(screen.queryByText("Loading the forecast…")).not.toBeInTheDocument();
	});

	it("says it is loading until the forecast arrives", () => {
		setInvokeHandler("load_settings", () => ({
			"zara-weather-lat": "1",
			"zara-weather-lon": "2"
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise(() => {}))
		);

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		expect(screen.getByRole("status")).toHaveTextContent("Loading the forecast…");
	});

	it("shows the temperature, condition and place", async () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		expect(
			await screen.findByText("18°", { selector: ".weather-temperature" })
		).toBeInTheDocument();
		expect(screen.getByText("Partly Cloudy")).toBeInTheDocument();
		expect(screen.getByText("Tokyo")).toBeInTheDocument();
	});

	it("shows how it feels, the humidity and the wind", async () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		expect(await screen.findByText("Feels like 17° · 62% humidity · 11 km/h")).toBeInTheDocument();
	});

	it("lists the next six hours, starting with Now, in the place's own time", async () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		const hours = await screen.findByRole("list", { name: "Next hours" });
		const labels = Array.from(hours.querySelectorAll("li")).map((li) =>
			li.getAttribute("aria-label")
		);
		expect(labels).toHaveLength(6);
		expect(labels[0]).toBe("Now, 25 degrees, Overcast");
		expect(labels[1]).toMatch(/^4\s?PM, 26 degrees/);
	});

	it("shows the hours on a 24-hour clock when asked", async () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="weather" timeFormat24h />);

		const hours = await screen.findByRole("list", { name: "Next hours" });
		expect(hours.querySelectorAll("li")[1].getAttribute("aria-label")).toMatch(/^16, 26 degrees/);
	});

	it("lists five days starting with Today, with highs and lows", async () => {
		serveTokyo();

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		const days = await screen.findByRole("list", { name: "Next days" });
		const labels = Array.from(days.querySelectorAll("li")).map((li) =>
			li.getAttribute("aria-label")
		);
		expect(labels).toEqual([
			"Today, low 11, high 19, Partly Cloudy",
			"Thu, low 13, high 17, Rainy",
			"Fri, low 10, high 21, Clear",
			"Sat, low 10, high 18, Overcast",
			"Sun, low 5, high 12, Snowy"
		]);
	});

	it("draws each day's range as a bar within the week's range", async () => {
		serveTokyo();

		const { container } = render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		await screen.findByRole("list", { name: "Next days" });
		const fills = Array.from(container.querySelectorAll<HTMLElement>(".weather-range-fill"));
		// The week runs from 5 to 21, 16 degrees. Friday is 10 to 21.
		expect(fills[2].style.left).toBe("31.25%");
		expect(fills[2].style.width).toBe("68.75%");
	});

	it("says when the forecast is not available, and offers to try again", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-weather-lat": "1",
			"zara-weather-lon": "2"
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500 }))
		);

		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The forecast is not available right now."
		);
		expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
	});

	it("tries again when asked", async () => {
		setInvokeHandler("load_settings", () => ({
			"zara-weather-lat": "35.68",
			"zara-weather-lon": "139.69",
			"zara-weather-city": "Tokyo"
		}));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockResolvedValueOnce({ ok: true, json: async () => tokyoAnswer() });
		vi.stubGlobal("fetch", fetchMock);
		render(<WeatherPanel zaraMode="weather" timeFormat24h={false} />);
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		await user.click(await screen.findByRole("button", { name: /Try again/ }));

		expect(
			await screen.findByText("18°", { selector: ".weather-temperature" })
		).toBeInTheDocument();
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});

	it("keeps clicks inside from reaching the notch, which would switch its mode", async () => {
		serveTokyo();
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<WeatherPanel zaraMode="weather" timeFormat24h={false} />
			</div>
		);
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		await user.click(await screen.findByText("Tokyo"));

		expect(notchClick).not.toHaveBeenCalled();
	});
});
