import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type MutableRefObject,
	type SetStateAction
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { NotchPanel, ShelfItem, ShelfPreview, ZaraMode } from "../types";

// The shelf is a short-lived stash: one row, newest first, oldest evicted.
const SHELF_MAX_ITEMS = 10;

export interface UseShelfOptions {
	/** Keep the shelf's items across restarts (the zara-shelf-persist setting). */
	shelfPersist: boolean;
	/** The view the notch is showing. */
	zaraMode: ZaraMode;
	/** Whether the notch is expanded into a panel. */
	isOpen: boolean;
	/** Mirrors isOpen for listeners that are mounted once. */
	isOpenRef: MutableRefObject<boolean>;
	/** Mirrors zaraMode for listeners that are mounted once. */
	zaraModeRef: MutableRefObject<ZaraMode>;
	/** The view the collapsed notch returns to. */
	restingModeRef: MutableRefObject<ZaraMode>;
	setIsOpen: Dispatch<SetStateAction<boolean>>;
	setZaraMode: Dispatch<SetStateAction<ZaraMode>>;
	/** The panel an open notch moves to when the shelf empties. */
	openingPanelRef: MutableRefObject<() => NotchPanel>;
	/** Lets go of the notch's hover state; used when a drag out of the shelf ends elsewhere. */
	releaseNotchHover: () => void;
}

/**
 * The shelf: files and selected text dropped on the notch. Owns the items and their
 * previews, saving across restarts when allowed, the drag-in and drag-out gestures,
 * and the timer that closes the shelf shortly after a drop.
 */
export function useShelf({
	shelfPersist,
	zaraMode,
	isOpen,
	isOpenRef,
	zaraModeRef,
	restingModeRef,
	setIsOpen,
	setZaraMode,
	openingPanelRef,
	releaseNotchHover
}: UseShelfOptions) {
	// Shelf: files and selected text stashed in the notch via drag-and-drop.
	// Files are stored as plain paths (references, never copies). Session-scoped
	// by default; the zara-shelf-persist setting keeps items across restarts.
	const [shelfItems, setShelfItems] = useState<ShelfItem[]>(() => {
		if (localStorage.getItem("zara-shelf-persist") !== "true") return [];
		try {
			const saved = localStorage.getItem("zara-shelf-items");
			const parsed = saved ? JSON.parse(saved) : [];
			if (!Array.isArray(parsed)) return [];
			return parsed
				.filter((i): i is ShelfItem => {
					if (typeof i?.id !== "string" || typeof i?.name !== "string") return false;
					// Items stored before text support have no `type`; treat as files.
					if (i.type === "text") return typeof i.text === "string";
					return typeof i.path === "string";
				})
				.map((i) => ({ ...i, type: i.type === "text" ? "text" : "file" }));
		} catch {
			return [];
		}
	});
	useEffect(() => {
		try {
			if (shelfPersist) {
				localStorage.setItem("zara-shelf-items", JSON.stringify(shelfItems));
			} else {
				localStorage.removeItem("zara-shelf-items");
			}
		} catch {
			/* storage full or unavailable — shelf just won't persist */
		}
	}, [shelfItems, shelfPersist]);

	// Drop file references whose files are gone (moved/deleted/drive unplugged)
	// once at startup, so a persisted shelf does not accumulate dead entries.
	// Text items are always kept.
	const shelfPrunedRef = useRef(false);
	useEffect(() => {
		if (shelfPrunedRef.current) return;
		shelfPrunedRef.current = true;
		const filePaths = shelfItems
			.filter((i) => i.type === "file" && i.path)
			.map((i) => i.path as string);
		if (filePaths.length === 0) return;
		invoke<string[]>("shelf_prune", { paths: filePaths })
			.then((existing) => {
				const alive = new Set(existing);
				setShelfItems((prev) => {
					const kept = prev.filter(
						(i) => i.type !== "file" || (i.path !== undefined && alive.has(i.path))
					);
					return kept.length === prev.length ? prev : kept;
				});
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Previews are generated lazily per path and cached. Images, PDFs, Office
	// files with a saved thumbnail, and anything Windows can thumbnail (videos,
	// folders...) show a picture; documents and text files show their opening
	// text; the rest fall back to an icon for their type. Text items render
	// their content.
	const [shelfThumbs, setShelfThumbs] = useState<Record<string, ShelfPreview>>({});
	const shelfThumbPending = useRef<Set<string>>(new Set());
	useEffect(() => {
		for (const item of shelfItems) {
			if (item.type !== "file" || !item.path) continue;
			const path = item.path;
			if (shelfThumbs[path] !== undefined || shelfThumbPending.current.has(path)) continue;
			shelfThumbPending.current.add(path);
			// The item may be removed while this is in flight; don't resurrect
			// a stale cache entry.
			const storeThumb = (preview: ShelfPreview) =>
				setShelfThumbs((prev) => {
					if (!shelfItemsRef.current.some((i) => i.path === path)) return prev;
					return { ...prev, [path]: preview };
				});
			invoke<ShelfPreview>("shelf_thumbnail", { path })
				.then(storeThumb)
				.catch(() => storeThumb({ thumb: null, text: null, folder: false }))
				.finally(() => shelfThumbPending.current.delete(path));
		}
	}, [shelfItems, shelfThumbs]);

	// Drop cached thumbnails for items that left the shelf so the cache cannot
	// grow without bound over a long session (each entry is a data URI).
	useEffect(() => {
		const current = new Set(shelfItems.filter((i) => i.path).map((i) => i.path as string));
		setShelfThumbs((prev) => {
			const keys = Object.keys(prev);
			if (keys.every((k) => current.has(k))) return prev;
			const next: Record<string, ShelfPreview> = {};
			for (const k of keys) {
				if (current.has(k)) next[k] = prev[k];
			}
			return next;
		});
	}, [shelfItems]);

	// Native drag preview for items without a thumbnail.
	const [shelfDragIcon, setShelfDragIcon] = useState<string | null>(null);
	useEffect(() => {
		invoke<string | null>("shelf_drag_icon")
			.then(setShelfDragIcon)
			.catch(() => {});
	}, []);

	// Picking a file back up is a drag-out gesture: press, move past a small
	// threshold, and the OS takes over the drag. A press without movement is a
	// plain click that opens the file (or copies text items).
	const shelfPointerRef = useRef<{ id: string; x: number; y: number; dragging: boolean } | null>(
		null
	);
	// Timestamp of the last drop onto the notch. A drop recorded during our
	// own drag-out means the item came back to the notch (pointer still over
	// it), which decides whether the drag cleanup clears the hover flags.
	const shelfSelfDropAtRef = useRef(0);
	// True while our own drag-out is running, so the drag-enter we receive when
	// it starts over the notch does not flash the hover outline or re-open it.
	const shelfSelfDragRef = useRef(false);
	const handleShelfPointerDown = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		if (e.button !== 0) return;
		// Text items have no native drag-out; a click copies them.
		if (item.type !== "file" || !item.path) return;
		// The remove button must keep receiving its own click; capturing the
		// pointer on the tile would retarget it.
		if ((e.target as HTMLElement).closest(".shelf-tile-remove")) return;
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		shelfPointerRef.current = { id: item.id, x: e.clientX, y: e.clientY, dragging: false };
	};
	const handleShelfPointerMove = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		const st = shelfPointerRef.current;
		if (!st || st.id !== item.id || st.dragging) return;
		if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
		if (!item.path) return;
		const path = item.path;
		const icon = shelfThumbs[path]?.thumb ?? shelfDragIcon;
		if (!icon) return;
		st.dragging = true;
		// Picking an item up is a deliberate act; don't let the post-drop
		// auto-close fire mid-drag.
		clearShelfCollapse();
		shelfSelfDragRef.current = true;
		const dragStartedAt = Date.now();
		startDrag({ item: [path], icon })
			.catch((err) => console.error("[shelf] drag out failed:", path, err))
			.finally(() => {
				shelfSelfDragRef.current = false;
				// A drop recorded during this drag means it landed back on the
				// notch, so the pointer is still over it. Otherwise the native
				// drag owned the pointer and the webview never saw it leave —
				// release the hover state (flags AND the resting mode) or the
				// shelf panel stays expanded. The command also makes the
				// backend re-evaluate its edge-hover state immediately.
				const droppedOnSelf = shelfSelfDropAtRef.current >= dragStartedAt;
				if (!droppedOnSelf) {
					releaseNotchHover();
					invoke("set_notch_hovered", { hovered: false }).catch(() => {});
				}
			});
	};
	const handleShelfTileClick = (e: React.MouseEvent<HTMLDivElement>, item: ShelfItem) => {
		e.stopPropagation();
		const st = shelfPointerRef.current;
		shelfPointerRef.current = null;
		// Only this tile's own drag suppresses the click; a stale flag from a
		// previous tile's drag-out must not swallow it.
		if (st && st.id === item.id && st.dragging) return;
		openShelfItem(item);
	};

	// Wheel scrolling for the shelf strip: ease towards a target instead of
	// jumping, so wheel and trackpad input both feel fluid.
	const shelfScrollTargetRef = useRef<number | null>(null);
	const shelfGridRef = useRef<HTMLDivElement>(null);
	// Whether the shelf row overflows, so it gets room for its scrollbar.
	const [shelfOverflowing, setShelfOverflowing] = useState(false);
	// Measured against the open shelf's width (380px minus its 14px side
	// padding) rather than the live one, which is still growing while the
	// notch animates open. A removed tile stays in the row until its exit
	// animation ends, so the row is measured again then.
	const measureShelfOverflow = useCallback(() => {
		const el = shelfGridRef.current;
		setShelfOverflowing(!!el && el.scrollWidth > 380 - 28 + 1);
	}, []);
	useLayoutEffect(measureShelfOverflow, [shelfItems, zaraMode, measureShelfOverflow]);
	const shelfScrollRafRef = useRef<number | null>(null);
	// The wheel scrolls the row from anywhere over the shelf view, not just
	// over the tiles. Mice that report lines instead of pixels are scaled up.
	const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		const el = shelfGridRef.current;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		if (max <= 0) return;
		const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
		const base = shelfScrollTargetRef.current ?? el.scrollLeft;
		shelfScrollTargetRef.current = Math.max(0, Math.min(max, base + (e.deltaY + e.deltaX) * unit));
		if (shelfScrollRafRef.current !== null) return;
		const step = () => {
			const target = shelfScrollTargetRef.current;
			if (target === null) {
				shelfScrollRafRef.current = null;
				return;
			}
			const diff = target - el.scrollLeft;
			if (Math.abs(diff) < 0.5) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			const before = el.scrollLeft;
			el.scrollLeft += diff * 0.22;
			// At fractional display scales a small step can round back to the
			// same position; finish the move instead of stalling short of it.
			if (el.scrollLeft === before) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			shelfScrollRafRef.current = requestAnimationFrame(step);
		};
		shelfScrollRafRef.current = requestAnimationFrame(step);
	};

	// The shelf closes itself shortly after a drop so the notch does not stay
	// expanded. Hovering it cancels the timer; leaving collapses it.
	const shelfCollapseTimer = useRef<number | null>(null);

	const clearShelfCollapse = () => {
		if (shelfCollapseTimer.current !== null) {
			window.clearTimeout(shelfCollapseTimer.current);
			shelfCollapseTimer.current = null;
		}
	};

	const collapseShelfSoon = (delay = 1800) => {
		clearShelfCollapse();
		shelfCollapseTimer.current = window.setTimeout(() => {
			shelfCollapseTimer.current = null;
			if (zaraModeRef.current !== "shelf") return;
			setIsOpen(false);
			setZaraMode(restingModeRef.current);
		}, delay);
	};

	const removeShelfItem = (id: string) => {
		const next = shelfItems.filter((i) => i.id !== id);
		setShelfItems(next);
		if (next.length === 0 && zaraMode === "shelf") {
			// Nothing left to show: an open notch moves to the remembered panel,
			// a closed one to its resting mode, instead of an empty shelf.
			clearShelfCollapse();
			setZaraMode(isOpen ? openingPanelRef.current() : restingModeRef.current);
		}
	};

	// A full shelf never evicts silently: whatever fits is added and the rest
	// is reported. Reads through a ref so the drop listener (mounted once) sees
	// the current list.
	const shelfItemsRef = useRef<ShelfItem[]>(shelfItems);
	shelfItemsRef.current = shelfItems;
	// Tiles that were just added get an entrance animation; ones restored when
	// the panel reopens do not (the panel itself already fades in).
	const shelfNewIdsRef = useRef<Set<string>>(new Set());
	const markShelfNew = (ids: string[]) => {
		for (const id of ids) shelfNewIdsRef.current.add(id);
		window.setTimeout(() => {
			for (const id of ids) shelfNewIdsRef.current.delete(id);
		}, 900);
	};
	const [shelfNotice, setShelfNotice] = useState<string | null>(null);
	const shelfNoticeTimer = useRef<number | null>(null);
	const showShelfNotice = (message: string) => {
		setShelfNotice(message);
		if (shelfNoticeTimer.current !== null) window.clearTimeout(shelfNoticeTimer.current);
		shelfNoticeTimer.current = window.setTimeout(() => {
			shelfNoticeTimer.current = null;
			setShelfNotice(null);
		}, 2600);
	};

	const addShelfItems = (paths: string[]) => {
		if (paths.length === 0) return;
		const prev = shelfItemsRef.current;
		const existing = new Set(prev.filter((i) => i.path).map((i) => i.path));
		const fresh: ShelfItem[] = [];
		for (const p of paths) {
			if (existing.has(p)) continue;
			existing.add(p);
			fresh.push({
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				type: "file",
				name: p.split("\\").pop()?.split("/").pop() || p,
				path: p,
				timestamp: Date.now()
			});
		}
		if (fresh.length === 0) return;

		const room = Math.max(0, SHELF_MAX_ITEMS - prev.length);
		if (room === 0) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		if (fresh.length > room) {
			showShelfNotice(`Shelf is full — added ${room} of ${fresh.length} items`);
		}
		const added = fresh.slice(0, room);
		markShelfNew(added.map((i) => i.id));
		setShelfItems([...added, ...prev]);
	};

	const addShelfText = (text: string) => {
		const prev = shelfItemsRef.current;
		if (prev.some((i) => i.type === "text" && i.text === text)) return;
		if (prev.length >= SHELF_MAX_ITEMS) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		const item: ShelfItem = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			type: "text",
			name: text.trim().replace(/\s+/g, " ").slice(0, 48),
			text,
			timestamp: Date.now()
		};
		markShelfNew([item.id]);
		setShelfItems([item, ...prev]);
	};

	// Files open in their default app; text items are copied to the clipboard
	// so they can be pasted anywhere. A file that no longer exists is reported
	// and dropped from the shelf.
	const openShelfItem = (item: ShelfItem) => {
		if (item.type === "text") {
			if (!item.text) return;
			writeText(item.text)
				.then(() => showShelfNotice("Copied to clipboard"))
				.catch((e) => console.error("[shelf] copy failed:", e));
			return;
		}
		if (item.path) {
			const path = item.path;
			invoke("shelf_open", { path }).catch(async (e) => {
				console.error("[shelf] open failed:", path, e);
				// Only a confirmed-missing file leaves the shelf; a transient
				// failure (e.g. no association) must not remove it.
				const alive = await invoke<string[]>("shelf_prune", { paths: [path] }).catch(() => null);
				if (alive && alive.length === 0) {
					showShelfNotice("File no longer exists — removed from shelf");
					removeShelfItem(item.id);
				} else {
					showShelfNotice("Couldn't open the file");
				}
			});
		}
	};

	// Shelf drag-and-drop plumbing. The backend registers its own OLE drop
	// target (src-tauri/src/shelf.rs) because wry's target can go stale when
	// WebView2 recreates its render child; it emits the shelf-drag-* events
	// below. Drag-enter switches to the shelf panel (restoring the previous
	// mode on cancel); drop stashes the real file paths.
	const [isDragHovering, setIsDragHovering] = useState(false);
	const shelfPrevModeRef = useRef<ZaraMode>("status");
	const shelfPrevOpenRef = useRef(false);
	const shelfDragActiveRef = useRef(false);
	useEffect(() => {
		let unlisteners: (() => void)[] = [];
		let cancelled = false;

		const enter = (event: { payload: { paths?: string[]; text?: string } }) => {
			// Our own drag-out starts with the cursor over the notch; ignore
			// the enter it causes instead of flashing the hover state.
			if (shelfSelfDragRef.current) return;
			console.info("[shelf] drag-enter:", event.payload.paths ?? event.payload.text);
			setIsDragHovering(true);
			const prev = zaraModeRef.current;
			if (prev === "shelf") return;
			shelfPrevModeRef.current = prev;
			shelfPrevOpenRef.current = isOpenRef.current;
			shelfDragActiveRef.current = true;
			setIsOpen(true);
			setZaraMode("shelf");
		};
		const leave = () => {
			setIsDragHovering(false);
			if (shelfDragActiveRef.current) {
				shelfDragActiveRef.current = false;
				if (zaraModeRef.current === "shelf") {
					setIsOpen(shelfPrevOpenRef.current);
					setZaraMode(shelfPrevModeRef.current);
				}
			}
		};
		const drop = (event: { payload: { paths?: string[]; text?: string } }) => {
			setIsDragHovering(false);
			shelfDragActiveRef.current = false;
			shelfSelfDropAtRef.current = Date.now();
			const paths = event.payload.paths ?? [];
			const text = event.payload.text;
			console.info("[shelf] drop:", paths.length > 0 ? paths : text);
			if (paths.length === 0 && !text) return;
			if (paths.length > 0) addShelfItems(paths);
			if (text) addShelfText(text);
			setIsOpen(true);
			setZaraMode("shelf");
			collapseShelfSoon();
		};

		Promise.all([
			listen<{ paths?: string[]; text?: string }>("shelf-drag-enter", enter),
			listen("shelf-drag-leave", leave),
			listen<{ paths?: string[]; text?: string }>("shelf-drag-drop", drop)
		])
			.then((fns) => {
				if (cancelled) {
					fns.forEach((fn) => fn());
				} else {
					unlisteners = fns;
				}
			})
			.catch((e) => console.error("[shelf] drag-drop listener failed:", e));

		invoke("setup_shelf_drop").catch((e) => console.error("[shelf] drop target setup failed:", e));

		return () => {
			cancelled = true;
			unlisteners.forEach((fn) => fn());
		};
	}, []);

	return {
		shelfItems,
		shelfThumbs,
		handleShelfPointerDown,
		handleShelfPointerMove,
		handleShelfTileClick,
		shelfGridRef,
		shelfOverflowing,
		measureShelfOverflow,
		handleShelfWheel,
		clearShelfCollapse,
		removeShelfItem,
		shelfNewIdsRef,
		shelfNotice,
		isDragHovering
	};
}
