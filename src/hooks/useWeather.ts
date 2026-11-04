import { useState, useEffect, useRef, useCallback, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cloud, Thermometer, type GlyphProps } from "../icons/glyphs";
import { WMO_CODES, getWeatherIcon, resolveLocation } from "../notch/weather/weatherSupport";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface WeatherState {
	temperature: number | null;
	weatherCondition: string;
	weatherIcon: ComponentType<GlyphProps>;
}

async function fetchWeatherForCoords(
	latitude: number,
	longitude: number,
	unit: string
): Promise<WeatherState> {
	const unitParam = unit === "fahrenheit" ? "&temperature_unit=fahrenheit" : "";
	const response = await fetch(
		`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day&timezone=auto${unitParam}`
	);

	if (!response.ok) {
		throw new Error(`Weather API returned ${response.status}`);
	}

	const data = await response.json();

	if (!data?.current?.temperature_2m) {
		throw new Error("Invalid weather API response shape");
	}

	const temp = Math.round(data.current.temperature_2m);
	const code = data.current.weather_code;
	const condition = WMO_CODES[code] || "Unknown";
	const isDay = data.current.is_day === 1;

	return {
		temperature: temp,
		weatherCondition: condition,
		weatherIcon: getWeatherIcon(condition, isDay)
	};
}

async function persistWeather(temp: number | null, condition: string): Promise<void> {
	if (temp !== null) {
		invoke("save_setting", {
			key: "zara-weather-cached-temp",
			value: temp
		}).catch(() => {});
	}
	if (condition) {
		invoke("save_setting", {
			key: "zara-weather-cached-condition",
			value: condition
		}).catch(() => {});
	}
}

export function useWeather(enabled: boolean) {
	const [temperature, setTemperature] = useState<number | null>(() => {
		const cached = localStorage.getItem("zara-weather-cached-temp");
		return cached !== null ? Number(cached) : null;
	});
	const [weatherCondition, setWeatherCondition] = useState<string>(
		() => localStorage.getItem("zara-weather-cached-condition") || ""
	);
	const [weatherIcon, setWeatherIcon] = useState<ComponentType<GlyphProps>>(() => Thermometer);
	const [cityName, setCityName] = useState<string>(
		() => localStorage.getItem("zara-weather-city") || ""
	);
	const [tempUnit, setTempUnit] = useState<string>(
		() => localStorage.getItem("zara-temp-unit") || "celsius"
	);

	const tempUnitRef = useRef(tempUnit);
	tempUnitRef.current = tempUnit;

	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	// Core fetch + refresh logic
	const doFetch = useCallback(
		async (showStaleOnError = true, coords?: { lat: number; lon: number }) => {
			if (!enabledRef.current) return;

			try {
				const location = coords ? { ...coords, city: undefined } : await resolveLocation();
				const result = await fetchWeatherForCoords(location.lat, location.lon, tempUnitRef.current);

				setTemperature(result.temperature);
				setWeatherCondition(result.weatherCondition);
				setWeatherIcon(() => result.weatherIcon);
				persistWeather(result.temperature, result.weatherCondition);

				// Update city name if resolved from IP geolocation
				if (location.city) {
					setCityName(location.city);
					localStorage.setItem("zara-weather-city", location.city);
					invoke("save_setting", { key: "zara-weather-city", value: location.city }).catch(
						() => {}
					);
				}
			} catch (e) {
				console.warn("Weather fetch failed:", e);
				if (!showStaleOnError && import.meta.env.DEV) {
					const mockTemp = tempUnitRef.current === "fahrenheit" ? 72 : 22;
					setTemperature(mockTemp);
					setWeatherCondition("Partly Cloudy");
					setWeatherIcon(() => Cloud);
				}
			}
		},
		[]
	);

	// Load cached values from Tauri settings on mount
	useEffect(() => {
		invoke("load_settings")
			.then((settings: any) => {
				const cachedTemp =
					settings["zara-weather-cached-temp"] ?? localStorage.getItem("zara-weather-cached-temp");
				if (cachedTemp !== undefined && cachedTemp !== null) {
					setTemperature(Number(cachedTemp));
				}
				const cachedCond =
					settings["zara-weather-cached-condition"] ??
					localStorage.getItem("zara-weather-cached-condition");
				if (cachedCond) {
					setWeatherCondition(String(cachedCond));
					setWeatherIcon(() => getWeatherIcon(String(cachedCond)));
				}
				const savedUnit = settings["zara-temp-unit"] ?? localStorage.getItem("zara-temp-unit");
				if (savedUnit) {
					setTempUnit(String(savedUnit));
				}
				const savedCity =
					settings["zara-weather-city"] ?? localStorage.getItem("zara-weather-city");
				if (savedCity) {
					setCityName(String(savedCity));
				}
			})
			.catch(() => {});
	}, []);

	// Listen for temp unit changes
	useEffect(() => {
		const unlisten = listen<{ key: string; value: any }>("settings-changed", (event) => {
			const { key, value } = event.payload;
			if (key === "temp-unit") {
				setTempUnit(value ? "fahrenheit" : "celsius");
			}
		});
		const unlistenExternal = listen<{ key: string; value: any }>(
			"settings-external-changed",
			(event) => {
				const { key, value } = event.payload;
				if (key === "zara-temp-unit") {
					setTempUnit(String(value));
				}
			}
		);
		return () => {
			unlisten.then((fn) => fn());
			unlistenExternal.then((fn) => fn());
		};
	}, []);

	// Listen for instant refresh from Settings (direct Tauri event with coords)
	useEffect(() => {
		if (!enabled) return;

		const unlisten = listen<{ lat: number; lon: number } | true>("weather-refresh", (event) => {
			const payload = event.payload;
			if (payload && typeof payload === "object" && "lat" in payload && "lon" in payload) {
				doFetch(false, { lat: (payload as any).lat, lon: (payload as any).lon });
			} else {
				doFetch(false);
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [enabled, doFetch]);

	// Listen for city name changes from Settings
	useEffect(() => {
		const unlisten = listen<{ key: string; value: any }>("settings-changed", (event) => {
			const { key, value } = event.payload;
			if (key === "weather-city") {
				setCityName(String(value || ""));
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Initial fetch + 30-min interval
	useEffect(() => {
		if (!enabled) return;

		doFetch(false);

		const interval = setInterval(() => doFetch(false), REFRESH_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [enabled, doFetch]);

	// Re-fetch when temperature unit changes (without resetting interval)
	useEffect(() => {
		if (!enabled) return;
		doFetch(true);
	}, [tempUnit, enabled, doFetch]);

	return {
		temperature,
		weatherCondition,
		weatherIcon,
		cityName,
		tempUnit
	};
}
