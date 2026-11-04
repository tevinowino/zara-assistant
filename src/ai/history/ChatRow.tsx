import { useEffect, useRef, useState } from "react";
import { Trash2 } from "../../icons/glyphs";
import { formatRelativeTime } from "./groupConversations";

/** How long a delete button stays armed after the first click. */
const CONFIRM_WINDOW_MS = 3000;

interface ChatRowProps {
	id: string;
	/** The saved title; empty for a chat that never got one. */
	title: string;
	updatedAt: number;
	/** The time the list was drawn at, so every row's "5 min ago" agrees. */
	now: number;
	/** This is the chat the assistant is showing. */
	current?: boolean;
	/** Opening is unavailable, for example while an answer is being written. */
	disabled?: boolean;
	onOpen: (id: string) => void;
	/** When given, the row has a delete button that needs a second click. */
	onDelete?: (id: string) => void;
}

/** One saved chat: open it by clicking its title, or delete it with two clicks. */
export function ChatRow({
	id,
	title,
	updatedAt,
	now,
	current,
	disabled,
	onOpen,
	onDelete
}: ChatRowProps) {
	const name = title.trim() || "Untitled chat";
	const [confirming, setConfirming] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

	const disarm = () => {
		if (timer.current) clearTimeout(timer.current);
		setConfirming(false);
	};

	const pressDelete = () => {
		if (!confirming) {
			setConfirming(true);
			timer.current = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS);
			return;
		}
		disarm();
		onDelete?.(id);
	};

	return (
		<li className="zai-chat-row">
			<button
				type="button"
				className="zai-chat-open"
				aria-label={`Open ${name}`}
				aria-current={current ? "true" : undefined}
				disabled={disabled}
				onClick={() => onOpen(id)}
			>
				<span className="zai-chat-title">{name}</span>
				<span className="zai-chat-time">
					{current ? "Open now" : formatRelativeTime(updatedAt, now)}
				</span>
			</button>
			{onDelete && (
				<button
					type="button"
					className={`zai-chat-delete${confirming ? " zai-chat-delete-armed" : ""}`}
					aria-label={confirming ? `Confirm delete ${name}` : `Delete ${name}`}
					onClick={pressDelete}
					onBlur={disarm}
				>
					{confirming ? "Delete?" : <Trash2 size={13} aria-hidden="true" />}
				</button>
			)}
		</li>
	);
}
