import type { Dispatch, RefObject, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox } from "../../icons/glyphs";
import type { NotchPanel, ShelfItem } from "../types";

export interface ShelfBubbleProps {
	/** Whether the bubble is drawn: the shelf holds items and the notch is collapsed. */
	showShelfBubble: boolean;
	shelfItems: ShelfItem[];
	shelfBubbleRef: RefObject<HTMLButtonElement | null>;
	isHovered: boolean;
	setIsHovered: Dispatch<SetStateAction<boolean>>;
	/** Re-measures the notch's click-through region after the bubble animates away. */
	reportNotchRect: RefObject<() => void>;
	openNotch: (view: NotchPanel | "music" | "shelf") => void;
	/** Width of the collapsed pill; the bubble sits beside it. */
	getDynamicWidth: () => number;
}

/** The shelf's items as a bubble on the left of the collapsed pill; a click opens the shelf. */
export function ShelfBubble({
	showShelfBubble,
	shelfItems,
	shelfBubbleRef,
	isHovered,
	setIsHovered,
	reportNotchRect,
	openNotch,
	getDynamicWidth
}: ShelfBubbleProps) {
	return (
		<AnimatePresence onExitComplete={() => reportNotchRect.current()}>
			{showShelfBubble && (
				<motion.button
					key="shelf-bubble"
					ref={shelfBubbleRef}
					type="button"
					className={`activity-bubble shelf-bubble ${isHovered ? "expanded" : ""}`}
					aria-label={`Open shelf: ${shelfItems.length} item${shelfItems.length === 1 ? "" : "s"}`}
					// Anchored at the pill's centre, offset past its left edge.
					style={{ right: "50%" }}
					initial={{ opacity: 0, scale: 0.4, x: 28, marginRight: getDynamicWidth() / 2 + 8 }}
					animate={{ opacity: 1, scale: 1, x: 0, marginRight: getDynamicWidth() / 2 + 8 }}
					exit={{ opacity: 0, scale: 0.4, x: 28 }}
					transition={{
						type: "spring",
						stiffness: 400,
						damping: 31,
						opacity: { duration: 0.15 }
					}}
					onAnimationComplete={() => reportNotchRect.current()}
					onClick={(e) => {
						e.stopPropagation();
						setIsHovered(true);
						openNotch("shelf");
					}}
				>
					<Inbox size={12} strokeWidth={2.4} />
					<span>{shelfItems.length}</span>
				</motion.button>
			)}
		</AnimatePresence>
	);
}
