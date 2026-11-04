import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";
import "./AskBar.css";

/**
 * Vertical space the bar takes in the calendar panel: its 30px row plus the
 * 12px gap below it (`gap` on `.calendar-timer-content` in App.css). The notch adds this to
 * the panel's height.
 */
export const ASK_BAR_ROW_HEIGHT = 42;

interface AskBarProps {
	/** An answer is still pending: the bar shows "Thinking…" and refuses input. */
	busy: boolean;
	/** Called with the trimmed, non-empty question when the user sends it. */
	onSubmit: (text: string) => void;
	/**
	 * Called when the text caret enters or leaves the bar, including when the
	 * bar is removed while focused, so the notch can take and give back keyboard
	 * focus (see wantsKeyboardFocus).
	 */
	onFocusChange: (focused: boolean) => void;
}

/**
 * A one-line way to ask Zara something from the notch's home panel without
 * first opening the assistant. It only collects the question; the notch decides
 * what sending means. Enter or the arrow sends, Escape leaves the field.
 */
export function AskBar({ busy, onSubmit, onFocusChange }: AskBarProps) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const focusedRef = useRef(false);
	const onFocusChangeRef = useRef(onFocusChange);
	onFocusChangeRef.current = onFocusChange;

	useEffect(
		() => () => {
			if (focusedRef.current) onFocusChangeRef.current(false);
		},
		[]
	);

	const trimmed = draft.trim();
	const canSend = !busy && trimmed !== "";

	const submit = () => {
		if (!canSend) return;
		setDraft("");
		onSubmit(trimmed);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		} else if (event.key === "Escape") {
			event.stopPropagation();
			inputRef.current?.blur();
		}
	};

	return (
		<div className="ask-bar">
			<input
				ref={inputRef}
				className="ask-bar-field"
				type="text"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={handleKeyDown}
				onFocus={() => {
					focusedRef.current = true;
					onFocusChange(true);
				}}
				onBlur={() => {
					focusedRef.current = false;
					onFocusChange(false);
				}}
				placeholder={busy ? "Thinking…" : "Ask Zara"}
				aria-label="Ask Zara"
				disabled={busy}
				autoComplete="off"
				spellCheck={false}
			/>
			<button
				type="button"
				className="ask-bar-send"
				onClick={submit}
				disabled={!canSend}
				aria-label="Send"
			>
				<ArrowRight size={14} />
			</button>
		</div>
	);
}
