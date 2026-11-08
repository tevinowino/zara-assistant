import { AnimatePresence, motion } from "framer-motion";
import { BellRing } from "../../icons/glyphs";
import type { PillNotification } from "../notifications/notificationPolicy";
import type { ZaraMode } from "../types";

/** Size of the notch while it shows a notification. */
export const NOTIFICATION_PILL_WIDTH_PX = 340;
export const NOTIFICATION_PILL_HEIGHT_PX = 76;

export interface NotificationPillProps {
	/** The notification showing, or null. */
	notification: PillNotification | null;
	/** The view the notch is showing; the pill is only drawn while this is "notification". */
	zaraMode: ZaraMode;
	/** The user clicked the pill. */
	onDismiss: () => void;
	/** The pill has finished fading out. */
	onExited: () => void;
}

/** A Windows notification, shown briefly in the pill: the app's icon and name, the title and the text. */
export function NotificationPill({
	notification,
	zaraMode,
	onDismiss,
	onExited
}: NotificationPillProps) {
	return (
		<AnimatePresence
			// A pill arriving while the last one fades out keeps the clock row hidden.
			onExitComplete={onExited}
		>
			{zaraMode === "notification" && notification && (
				<motion.div
					key={notification.id}
					className="notif-pill"
					role="status"
					onClick={(event) => {
						event.stopPropagation();
						onDismiss();
					}}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.12 } }}
					transition={{ duration: 0.2 }}
				>
					<span className="notif-pill-icon">
						{notification.appIcon ? (
							<img src={notification.appIcon} alt="" draggable={false} />
						) : (
							<BellRing size={20} />
						)}
					</span>
					<span className="notif-pill-text">
						<span className="notif-pill-app">{notification.appName}</span>
						<span className="notif-pill-title">{notification.title}</span>
						{notification.body && <span className="notif-pill-body">{notification.body}</span>}
					</span>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
