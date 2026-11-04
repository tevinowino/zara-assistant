import { AnimatePresence, motion } from "framer-motion";
import { Type, X } from "lucide-react";
import { ShelfTypeIcon } from "../../components/ShelfTypeIcon";
import type { useShelf } from "../hooks/useShelf";
import type { ZaraMode } from "../types";

export interface ShelfPanelProps {
	/** Everything the shelf hook exposes: its items, previews and gesture handlers. */
	shelf: ReturnType<typeof useShelf>;
	/** The view the notch is showing; the panel is only drawn while this is "shelf". */
	zaraMode: ZaraMode;
}

/** The open shelf: a row of tiles for the files and text dropped on the notch. */
export function ShelfPanel({ shelf, zaraMode }: ShelfPanelProps) {
	const {
		shelfItems,
		shelfThumbs,
		handleShelfPointerDown,
		handleShelfPointerMove,
		handleShelfTileClick,
		shelfGridRef,
		shelfOverflowing,
		measureShelfOverflow,
		handleShelfWheel,
		removeShelfItem,
		shelfNewIdsRef,
		shelfNotice
	} = shelf;
	return (
		<AnimatePresence>
			{zaraMode === "shelf" && (
				<motion.div
					className="shelf-content"
					onClick={(e) => e.stopPropagation()}
					onWheel={handleShelfWheel}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
				>
					{shelfNotice && <div className="shelf-notice">{shelfNotice}</div>}
					{shelfItems.length === 0 ? (
						<div className="shelf-empty">
							<span>Drop files or selected text here</span>
						</div>
					) : (
						<div
							className={`shelf-items-grid ${shelfOverflowing ? "overflowing" : ""}`}
							ref={shelfGridRef}
						>
							<AnimatePresence mode="popLayout" onExitComplete={measureShelfOverflow}>
								{shelfItems.map((item) => {
									const preview = item.path ? shelfThumbs[item.path] : undefined;
									const thumb = preview?.thumb;
									return (
										<motion.div
											key={item.id}
											layout
											initial={
												shelfNewIdsRef.current.has(item.id) ? { opacity: 0, scale: 0.82 } : false
											}
											animate={{ opacity: 1, scale: 1 }}
											exit={{
												opacity: 0,
												scale: 0.82,
												transition: { duration: 0.16, ease: "easeOut" }
											}}
											transition={{
												type: "spring",
												stiffness: 520,
												damping: 38,
												mass: 0.7
											}}
											className={`shelf-tile ${item.type === "text" || (!thumb && preview?.text) ? "is-text" : ""}`}
											title={item.type === "text" ? item.text?.slice(0, 1000) : item.path}
											onPointerDown={(e) => handleShelfPointerDown(e, item)}
											onPointerMove={(e) => handleShelfPointerMove(e, item)}
											onClick={(e) => handleShelfTileClick(e, item)}
										>
											<div className="shelf-tile-preview">
												{item.type === "text" ? (
													<div className="shelf-tile-text">
														<Type size={11} strokeWidth={2} className="shelf-tile-text-icon" />
														<span className="shelf-tile-text-body">{item.text}</span>
													</div>
												) : !thumb && preview?.text ? (
													// A document or text file: its opening text,
													// marked with its type's icon.
													<div className="shelf-tile-text">
														<ShelfTypeIcon
															name={item.name}
															folder={false}
															size={11}
															className="shelf-tile-text-icon"
														/>
														<span className="shelf-tile-text-body">{preview.text}</span>
													</div>
												) : (
													<>
														<div className="shelf-tile-placeholder">
															{preview && !thumb ? (
																<ShelfTypeIcon name={item.name} folder={preview.folder} />
															) : null}
														</div>
														{thumb ? <img src={thumb} alt="" draggable={false} /> : null}
													</>
												)}
											</div>
											<span className="shelf-tile-name">
												{item.type === "text"
													? `Text · ${item.text?.length ?? 0} chars`
													: item.name}
											</span>
											<button
												className="shelf-tile-remove"
												title="Remove from shelf"
												onClick={(e) => {
													e.stopPropagation();
													removeShelfItem(item.id);
												}}
											>
												<X size={11} strokeWidth={2.5} />
											</button>
										</motion.div>
									);
								})}
							</AnimatePresence>
						</div>
					)}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
