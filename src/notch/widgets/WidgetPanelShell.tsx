import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { NotchPanel } from "../panels/notchPanels";
import type { ZaraMode } from "../types";

export interface WidgetPanelShellProps {
	/** The widget this shell belongs to; its content is drawn only while the notch shows it. */
	panel: NotchPanel;
	/** The view the notch is showing. */
	zaraMode: ZaraMode;
	/** The widget's CSS class, which sizes and styles its content. */
	className: string;
	/**
	 * The content scrolls by itself, so the wheel must scroll it instead of switching to the
	 * next widget.
	 */
	ownsScroll?: boolean;
	children: ReactNode;
}

/** The attribute the notch's wheel handler looks for to leave a scrolling widget alone. */
export const OWNS_SCROLL_SELECTOR = "[data-owns-scroll='true']";

/**
 * The frame every widget shares: it fades the content in and out as the notch switches to
 * and from the widget, and keeps clicks inside it from reaching the notch (which would
 * close it).
 */
export function WidgetPanelShell({
	panel,
	zaraMode,
	className,
	ownsScroll = false,
	children
}: WidgetPanelShellProps) {
	return (
		<AnimatePresence>
			{zaraMode === panel && (
				<motion.div
					className={className}
					data-owns-scroll={ownsScroll ? "true" : undefined}
					onClick={(event) => event.stopPropagation()}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
