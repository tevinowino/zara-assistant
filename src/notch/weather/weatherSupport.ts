import { invoke } from "@tauri-apps/api/core";
import { Sun, Moon, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle, Thermometer, type GlyphProps } from "../../icons/glyphs";
import type { ComponentType } from "react";

/*
 * What the weather widgets share: how a weather code reads in words and as an icon, and
 * where the weather is for. Used by the notch's weather chip (useWeather) and its Weather
 * panel (useForecast).
 */

// WMO weather interpretation codes
// https://open-meteo.com/en/docs#weathervariables
export const WMO_CODES: Record<number, string> = {
	0: "Clear",
	1: "Mostly Clear",
	2: "Partly Cloudy",
	3: "Overcast",
	45: "Foggy",
	48: "Foggy",
	51: "Drizzle",
	53: "Drizzle",
	55: "Drizzle",
	56: "Freezing Drizzle",
	57: "Freezing Drizzle",
	61: "Rainy",
	63: "Rainy",
	65: "Rainy",
	66: "Freezing Rain",
	67: "Freezing Rain",
	71: "Snowy",
	73: "Snowy",
	75: "Snowy",
	77: "Snowy",
	80: "Rain Showers",
	81: "Rain Showers",
	82: "Rain Showers",
	85: "Snow Showers",
	86: "Snow Showers",
	95: "Stormy",
	96: "Stormy",
	99: "Stormy"
};

const DELHI_LAT = 28.6139;
const DELHI_LON = 77.209;

export interface ResolvedLocation {
	lat: number;
	lon: number;
	city?: string;
}

export function getWeatherIcon(condition: string, isDay = true): ComponentType<GlyphProps> {
	switch (condition) {
		case "Clear":
		case "Mostly Clear":
			return isDay ? Sun : Moon;
		case "Partly Cloudy":
		case "Overcast":
			return Cloud;
		case "Foggy":
			return CloudFog;
		case "Drizzle":
		case "Freezing Drizzle":
			return CloudDrizzle;
		case "Rainy":
		case "Rain Showers":
		case "Freezing Rain":
			return CloudRain;
		case "Snowy":
		case "Snow Showers":
			return CloudSnow;
		case "Stormy":
			return CloudLightning;
		default:
			return Thermometer;
	}
}

export async function resolveLocation(): Promise<ResolvedLocation> {
	// 1. Check saved coordinates from the backend settings file.
	try {
		const settings = (await invoke("load_settings").catch(() => ({}))) as Record<string, any>;
		const savedLat = settings["zara-weather-lat"];
		const savedLon = settings["zara-weather-lon"];
		const savedCity = settings["zara-weather-city"] || localStorage.getItem("zara-weather-city");

		if (savedLat && savedLon) {
			return {
				lat: parseFloat(savedLat),
				lon: parseFloat(savedLon),
				city: savedCity || undefined
			};
		}
	} catch {
		// continue to IP geolocation
	}

	// 2. Try IP-based geolocation
	try {
		const res = await fetch("https://ipapi.co/json/");
		if (res.ok) {
			const data = await res.json();
			const lat = data.latitude || data.lat;
			const lon = data.longitude || data.lon;
			if (lat && lon) {
				return { lat, lon, city: data.city || undefined };
			}
		}
	} catch {
		// try fallback
	}

	// 3. Fallback IP geolocation. ip-api.com's free tier is HTTP-only: the
	// https:// endpoint answers 403 unless the request carries a paid key.
	try {
		const res = await fetch("http://ip-api.com/json/?fields=status,lat,lon,city,country");
		if (res.ok) {
			const data = await res.json();
			if (data.lat && data.lon) {
				return { lat: data.lat, lon: data.lon, city: data.city || undefined };
			}
		}
	} catch {
		// fall through to default
	}

	// 4. Default to Delhi
	return { lat: DELHI_LAT, lon: DELHI_LON, city: "Delhi" };
}
