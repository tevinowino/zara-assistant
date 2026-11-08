import { RefreshCw } from "../../icons/glyphs";
import type { Forecast } from "../weather/forecast";
import { useForecast } from "../weather/useForecast";
import { getWeatherIcon } from "../weather/weatherSupport";
import type { ZaraMode } from "../types";
import { WidgetPanelShell } from "../widgets/WidgetPanelShell";

/** Size of the notch while it shows the weather, including its 36px top row. */
export const WEATHER_PANEL_WIDTH_PX = 380;
export const WEATHER_PANEL_HEIGHT_PX = 356;

export interface WeatherPanelProps {
	/** The view the notch is showing; the panel is only drawn while this is "weather". */
	zaraMode: ZaraMode;
	/** Whether hours are shown on a 24-hour clock. */
	timeFormat24h: boolean;
}

/** The weather widget: now, the next hours and the next days for the user's place. */
export function WeatherPanel({ zaraMode, timeFormat24h }: WeatherPanelProps) {
	return (
		<WidgetPanelShell panel="weather" zaraMode={zaraMode} className="weather-panel">
			<WeatherContent timeFormat24h={timeFormat24h} />
		</WidgetPanelShell>
	);
}

function WeatherContent({ timeFormat24h }: { timeFormat24h: boolean }) {
	const { forecast, city, loading, failed, reload } = useForecast();

	if (failed) {
		return (
			<div className="weather-message" role="alert">
				<p>The forecast is not available right now.</p>
				<button type="button" className="weather-retry" onClick={reload}>
					<RefreshCw size={13} strokeWidth={2.2} /> Try again
				</button>
			</div>
		);
	}
	if (forecast === null) {
		return (
			<div className="weather-message" role="status">
				<p>{loading ? "Loading the forecast…" : "No forecast yet."}</p>
			</div>
		);
	}
	return <Conditions forecast={forecast} city={city} timeFormat24h={timeFormat24h} />;
}

const degrees = (value: number) => `${value}°`;

function Conditions({
	forecast,
	city,
	timeFormat24h
}: {
	forecast: Forecast;
	city: string;
	timeFormat24h: boolean;
}) {
	const NowIcon = getWeatherIcon(forecast.condition, forecast.isDay);
	const hourFormat = new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		hour12: !timeFormat24h,
		timeZone: "UTC"
	});
	const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

	const weekLow = Math.min(...forecast.days.map((day) => day.low));
	const weekHigh = Math.max(...forecast.days.map((day) => day.high));
	const weekSpan = Math.max(1, weekHigh - weekLow);

	const details = [
		forecast.feelsLike !== null ? `Feels like ${degrees(forecast.feelsLike)}` : null,
		forecast.humidity !== null ? `${forecast.humidity}% humidity` : null,
		forecast.windSpeed !== null ? `${forecast.windSpeed} ${forecast.windUnit}` : null
	].filter((detail): detail is string => detail !== null);

	return (
		<>
			<header className="weather-now">
				<NowIcon size={34} strokeWidth={1.6} className="weather-now-icon" aria-hidden="true" />
				<div className="weather-now-main">
					<span className="weather-temperature">{degrees(forecast.temperature)}</span>
					<span className="weather-condition">{forecast.condition}</span>
				</div>
				<div className="weather-now-place">
					{city && <strong>{city}</strong>}
					<span>{details.join(" · ")}</span>
				</div>
			</header>

			{forecast.hours.length > 0 && (
				<ol className="weather-hours" aria-label="Next hours">
					{forecast.hours.map((hour) => {
						const Icon = getWeatherIcon(hour.condition, hour.isDay);
						const label = hour.isNow ? "Now" : hourFormat.format(hour.wallClock);
						return (
							<li
								key={hour.wallClock.getTime()}
								className="weather-hour"
								aria-label={`${label}, ${hour.temperature} degrees, ${hour.condition}`}
							>
								<span className="weather-hour-time">{label}</span>
								<Icon size={18} strokeWidth={1.8} aria-hidden="true" />
								<span className="weather-hour-temperature">{degrees(hour.temperature)}</span>
							</li>
						);
					})}
				</ol>
			)}

			{forecast.days.length > 0 && (
				<ul className="weather-days" aria-label="Next days">
					{forecast.days.map((day) => {
						const Icon = getWeatherIcon(day.condition, true);
						const label = day.isToday ? "Today" : weekdayFormat.format(day.wallClock);
						return (
							<li
								key={day.wallClock.getTime()}
								className="weather-day"
								aria-label={`${label}, low ${day.low}, high ${day.high}, ${day.condition}`}
							>
								<span className="weather-day-name">{label}</span>
								<Icon size={16} strokeWidth={1.8} aria-hidden="true" />
								<span className="weather-day-low">{degrees(day.low)}</span>
								<span className="weather-range" aria-hidden="true">
									<span
										className="weather-range-fill"
										style={{
											left: `${((day.low - weekLow) / weekSpan) * 100}%`,
											width: `${((day.high - day.low) / weekSpan) * 100}%`
										}}
									/>
								</span>
								<span className="weather-day-high">{degrees(day.high)}</span>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
