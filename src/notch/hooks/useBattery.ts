import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BatteryDetails } from "../../batteryTooltip";

export interface UseBatteryOptions {
	/** The notch has finished its start-up animation; pulses are held back until then. */
	isReady: boolean;
	/** The notch's mode setting; "peek" reveals the notch when a pulse fires. */
	notchMode: string;
	/** Reveals the notch for the given number of milliseconds. */
	triggerEventPeek: (duration?: number) => void;
	/** Charge percentage at or below which the low-battery pulse fires. */
	lowBatteryThreshold: number;
}

/**
 * The computer's battery for the status widgets: level, charging state, the details
 * shown in the tooltip, and the two pulses (plugged in or out, and low battery) that
 * draw attention to the notch.
 */
export function useBattery({
	isReady,
	notchMode,
	triggerEventPeek,
	lowBatteryThreshold
}: UseBatteryOptions) {
	const [batteryLevel, setBatteryLevel] = useState(100);
	const [isCharging, setIsCharging] = useState(false);
	// Fetched when the pointer reaches the battery widget, for its tooltip.
	const [batteryDetails, setBatteryDetails] = useState<BatteryDetails | null>(null);

	const [showPowerPulse, setShowPowerPulse] = useState(false);
	const [showLowBatteryPulse, setShowLowBatteryPulse] = useState(false);
	const prevChargingRef = useRef<boolean | null>(null);
	const powerPulseTimeoutRef = useRef<any>(null);
	const lowBatteryPulseShownRef = useRef<boolean>(false);

	useEffect(() => {
		if (isReady && prevChargingRef.current !== null && prevChargingRef.current !== isCharging) {
			setShowPowerPulse(true);
			if (notchMode === "peek") triggerEventPeek(4000);
			if (powerPulseTimeoutRef.current) clearTimeout(powerPulseTimeoutRef.current);
			powerPulseTimeoutRef.current = setTimeout(() => {
				setShowPowerPulse(false);
			}, 4000);
		}
		prevChargingRef.current = isCharging;
	}, [isCharging, isReady, notchMode, triggerEventPeek]);

	useEffect(() => {
		// Trigger pulse when dropping below threshold while discharging
		if (
			isReady &&
			batteryLevel <= lowBatteryThreshold &&
			!isCharging &&
			!lowBatteryPulseShownRef.current
		) {
			setShowLowBatteryPulse(true);
			if (notchMode === "peek") triggerEventPeek(5000);
			lowBatteryPulseShownRef.current = true;
			setTimeout(() => setShowLowBatteryPulse(false), 5000);
		}

		// Reset the "shown" state if battery is charged or threshold is lowered
		if (isCharging || batteryLevel > lowBatteryThreshold) {
			lowBatteryPulseShownRef.current = false;
		}
	}, [batteryLevel, isCharging, lowBatteryThreshold, isReady, notchMode, triggerEventPeek]);

	// Battery API
	useEffect(() => {
		let battery: any = null;

		const initBattery = async () => {
			try {
				battery = await (navigator as any).getBattery();

				const updateBattery = () => {
					setBatteryLevel(Math.round(battery.level * 100));
					setIsCharging(battery.charging);
				};

				updateBattery();

				battery.addEventListener("levelchange", updateBattery);
				battery.addEventListener("chargingchange", updateBattery);

				return () => {
					battery.removeEventListener("levelchange", updateBattery);
					battery.removeEventListener("chargingchange", updateBattery);
				};
			} catch (e) {
				// Battery API not supported
			}
		};

		initBattery();
	}, []);

	const refreshBatteryDetails = useCallback(() => {
		invoke<BatteryDetails>("get_battery_details")
			.then(setBatteryDetails)
			.catch((err) => console.error("Failed to read battery details:", err));
	}, []);

	return {
		batteryLevel,
		isCharging,
		batteryDetails,
		showPowerPulse,
		showLowBatteryPulse,
		refreshBatteryDetails
	};
}
