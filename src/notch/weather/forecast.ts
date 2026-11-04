import { WMO_CODES } from "./weatherSupport";

/** The hours shown in the strip, starting with the current one. */
export const FORECAST_HOURS_SHOWN = 6;
/** Days shown, starting with today. */
export const FORECAST_DAYS_SHOWN = 5;

export type TemperatureUnit = "celsius" | "fahrenheit";

export interface ForecastHour {
	/** The hour as a wall-clock time in the place the forecast is for, shown with timeZone "UTC". */
	wallClock: Date;
	temperature: number;
	condition: string;
	isDay: boolean;
	/** True for the hour that is under way. */
	isNow: boolean;
}

export interface ForecastDay {
	/** Midnight of the day in the place the forecast is for, shown with timeZone "UTC". */
	wallClock: Date;
	condition: string;
	high: number;
	low: number;
	isToday: boolean;
}

export interface Forecast {
	temperature: number;
	feelsLike: number | null;
	condition: string;
	isDay: boolean;
	/** Percent. */
	humidity: number | null;
	windSpeed: number | null;
	windUnit: "km/h" | "mph";
	unit: TemperatureUnit;
	hours: ForecastHour[];
	days: ForecastDay[];
}

export function forecastUrl(latitude: number, longitude: number, unit: TemperatureUnit): string {
	const params = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current:
			"temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
		hourly: "temperature_2m,weather_code,is_day",
		daily: "weather_code,temperature_2m_max,temperature_2m_min",
		forecast_days: String(FORECAST_DAYS_SHOWN + 1),
		timezone: "auto"
	});
	if (unit === "fahrenheit") {
		params.set("temperature_unit", "fahrenheit");
		params.set("wind_speed_unit", "mph");
	}
	return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;
const numberOrNull = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

function arrayOf(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/**
 * A wall-clock string from the forecast ("2026-11-04T15:00", or a date alone) as a Date whose
 * UTC fields read that same wall-clock time. The forecast gives times in the place it is for,
 * without an offset, so reading them as UTC and displaying them as UTC keeps "3 PM" 3 PM
 * there, whichever timezone the user is in.
 */
function wallClockDate(text: string): Date {
	return new Date(text.length === 10 ? `${text}T00:00:00Z` : `${text}:00Z`);
}

/** The wall-clock reading in the forecast's place right now, as a UTC-field Date. */
function wallClockNow(nowMs: number, utcOffsetSeconds: number): number {
	return nowMs + utcOffsetSeconds * 1000;
}

function describe(code: unknown): string {
	return typeof code === "number" ? (WMO_CODES[code] ?? "Unknown") : "Unknown";
}

/**
 * Reads Open-Meteo's answer into what the Weather panel shows: the current conditions, the
 * next few hours and the next few days. Throws if the answer does not have the current
 * temperature, which means it is not a forecast.
 */
export function parseForecast(data: unknown, nowMs: number, unit: TemperatureUnit): Forecast {
	if (!isObject(data) || !isObject(data.current)) throw new Error("Not a forecast");
	const current = data.current;
	const temperature = numberOrNull(current.temperature_2m);
	if (temperature === null) throw new Error("The forecast has no current temperature");

	const offset = numberOrNull(data.utc_offset_seconds) ?? 0;
	const nowWall = wallClockNow(nowMs, offset);

	const hourly = isObject(data.hourly) ? data.hourly : {};
	const times = arrayOf(hourly.time);
	const temperatures = arrayOf(hourly.temperature_2m);
	const codes = arrayOf(hourly.weather_code);
	const dayFlags = arrayOf(hourly.is_day);
	const startOfThisHour = Math.floor(nowWall / 3_600_000) * 3_600_000;

	const hours: ForecastHour[] = [];
	for (let i = 0; i < times.length && hours.length < FORECAST_HOURS_SHOWN; i++) {
		const text = times[i];
		const hourTemperature = numberOrNull(temperatures[i]);
		if (typeof text !== "string" || hourTemperature === null) continue;
		const wallClock = wallClockDate(text);
		if (wallClock.getTime() < startOfThisHour) continue;
		hours.push({
			wallClock,
			temperature: Math.round(hourTemperature),
			condition: describe(codes[i]),
			isDay: dayFlags[i] === 1,
			isNow: wallClock.getTime() === startOfThisHour
		});
	}

	const daily = isObject(data.daily) ? data.daily : {};
	const dates = arrayOf(daily.time);
	const dailyCodes = arrayOf(daily.weather_code);
	const highs = arrayOf(daily.temperature_2m_max);
	const lows = arrayOf(daily.temperature_2m_min);
	const startOfToday = Math.floor(nowWall / 86_400_000) * 86_400_000;

	const days: ForecastDay[] = [];
	for (let i = 0; i < dates.length && days.length < FORECAST_DAYS_SHOWN; i++) {
		const text = dates[i];
		const high = numberOrNull(highs[i]);
		const low = numberOrNull(lows[i]);
		if (typeof text !== "string" || high === null || low === null) continue;
		const wallClock = wallClockDate(text);
		if (wallClock.getTime() < startOfToday) continue;
		days.push({
			wallClock,
			condition: describe(dailyCodes[i]),
			high: Math.round(high),
			low: Math.round(low),
			isToday: wallClock.getTime() === startOfToday
		});
	}

	const feelsLike = numberOrNull(current.apparent_temperature);
	const windSpeed = numberOrNull(current.wind_speed_10m);
	const humidity = numberOrNull(current.relative_humidity_2m);
	return {
		temperature: Math.round(temperature),
		feelsLike: feelsLike === null ? null : Math.round(feelsLike),
		condition: describe(current.weather_code),
		isDay: current.is_day === 1,
		humidity: humidity === null ? null : Math.round(humidity),
		windSpeed: windSpeed === null ? null : Math.round(windSpeed),
		windUnit: unit === "fahrenheit" ? "mph" : "km/h",
		unit,
		hours,
		days
	};
}

export async function fetchForecast(
	latitude: number,
	longitude: number,
	unit: TemperatureUnit,
	nowMs: number = Date.now()
): Promise<Forecast> {
	const response = await fetch(forecastUrl(latitude, longitude, unit));
	if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
	return parseForecast(await response.json(), nowMs, unit);
}
