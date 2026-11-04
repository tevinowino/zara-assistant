import type { Dispatch, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DeviceArt } from "../../devices/DeviceArt";
import { DeviceBatteryRing, DeviceBudsBattery } from "../components/DeviceBattery";
import { deviceAlertStatus } from "../deviceAlertPresentation";
import type { useDeviceAlerts } from "../hooks/useDeviceAlerts";
import type { ZaraMode } from "../types";

export interface DeviceAlertBubbleProps {
	/** The device-alert hook's state: the alert showing, its queue and on-screen flag. */
	deviceAlerts: ReturnType<typeof useDeviceAlerts>;
	/** The view the notch is showing; the alert is only drawn while this is "device". */
	zaraMode: ZaraMode;
	setIsOpen: Dispatch<SetStateAction<boolean>>;
	setZaraMode: Dispatch<SetStateAction<ZaraMode>>;
}

/** A device that just connected or was removed, shown briefly in the pill. A click opens the Bluetooth view. */
export function DeviceAlertBubble({
	deviceAlerts,
	zaraMode,
	setIsOpen,
	setZaraMode
}: DeviceAlertBubbleProps) {
	const {
		deviceAlert,
		setDeviceAlert,
		setDeviceAlertOnScreen,
		deviceAlertRef,
		deviceAlertQueueRef
	} = deviceAlerts;
	return (
		<AnimatePresence
			// An alert arriving while the last one fades out keeps the
			// clock row hidden.
			onExitComplete={() => setDeviceAlertOnScreen(deviceAlertRef.current !== null)}
		>
			{zaraMode === "device" && deviceAlert && (
				<motion.div
					className="device-alert"
					onClick={(e) => {
						e.stopPropagation();
						const usb = deviceAlert.usb;
						deviceAlertQueueRef.current = [];
						setDeviceAlert(null);
						// Bluetooth devices open their list; USB ones
						// have none, so the click just dismisses.
						if (usb) return;
						setIsOpen(true);
						setZaraMode("bluetooth");
					}}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.12 } }}
					transition={{ duration: 0.2 }}
				>
					<DeviceArt
						art={deviceAlert.art}
						phase={deviceAlert.connected ? "play" : "leave"}
						runId={deviceAlert.runId}
						size={60}
					/>
					<div className="device-alert-text">
						<span className="device-alert-name">{deviceAlert.name}</span>
						<span className="device-alert-status">
							{deviceAlertStatus(deviceAlert.art, deviceAlert.connected, deviceAlert.usb)}
						</span>
					</div>
					{deviceAlert.connected && deviceAlert.buds ? (
						<DeviceBudsBattery buds={deviceAlert.buds} />
					) : (
						deviceAlert.connected &&
						deviceAlert.battery !== null && <DeviceBatteryRing level={deviceAlert.battery} />
					)}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
