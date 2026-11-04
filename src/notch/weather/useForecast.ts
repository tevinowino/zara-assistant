import { useCallback, useEffect, useState } from "react";
import { fetchForecast, type Forecast, type TemperatureUnit } from "./forecast";
import { resolveLocation } from "./weatherSupport";

/** A forecast younger than this is shown without asking again. */
const FRESH_FOR_MS = 10 * 60 * 1000;

interface CachedForecast {
	key: string;
	at: number;
	city: string;
	forecast: Forecast;
}

let cached: CachedForecast | null = null;

/** Forgets the remembered forecast (tests, and a change of place or unit). */
export function clearForecastCache(): void {
	cached = null;
}

function savedUnit(): TemperatureUnit {
	return localStorage.getItem("zara-temp-unit") === "fahrenheit" ? "fahrenheit" : "celsius";
}

export interface ForecastController {
	/** The forecast, once there is one; kept while a newer one is fetched. */
	forecast: Forecast | null;
	/** The place it is for, as best it is known. */
	city: string;
	loading: boolean;
	/** The forecast could not be fetched, and there is none to show. */
	failed: boolean;
	/** Fetches it again, whatever is remembered. */
	reload: () => void;
}

/**
 * The forecast for the user's place: the city and coordinates chosen in Settings, or the
 * ones found from their connection. A forecast fetched in the last ten minutes is shown at
 * once, so reopening the panel does not wait; an older one is shown while a new one loads.
 */
export function useForecast(): ForecastController {
	const [forecast, setForecast] = useState<Forecast | null>(cached?.forecast ?? null);
	const [city, setCity] = useState(cached?.city ?? localStorage.getItem("zara-weather-city") ?? "");
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);

	const load = useCallback(async (force: boolean) => {
		setLoading(true);
		setFailed(false);
		try {
			const unit = savedUnit();
			const location = await resolveLocation();
			const key = `${location.lat},${location.lon},${unit}`;
			const placeName = location.city ?? localStorage.getItem("zara-weather-city") ?? "";
			if (!force && cached && cached.key === key && Date.now() - cached.at < FRESH_FOR_MS) {
				setForecast(cached.forecast);
				setCity(cached.city);
				return;
			}
			const fresh = await fetchForecast(location.lat, location.lon, unit);
			cached = { key, at: Date.now(), city: placeName, forecast: fresh };
			setForecast(fresh);
			setCity(placeName);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(false);
	}, [load]);

	const reload = useCallback(() => void load(true), [load]);

	return { forecast, city, loading, failed: failed && forecast === null, reload };
}
