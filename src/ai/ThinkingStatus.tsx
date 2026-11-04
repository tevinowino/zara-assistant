import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { parseCssColorToHex } from "./chat/blocks/mermaidStyle";

// The orb helpers shared by the assistant's "working" indicators, drawn with the
// Thinking orbs library (libraries.dev). The orb says what is going on through its
// state; words next to it say it too, so the orb itself is hidden from screen readers.

type OrbTheme = "dark" | "light";

// The writing orb's tint: the same blue as --zai-blue in ai.css (the orb draws on a
// canvas, so it takes a colour value, not a CSS variable). While Zara thinks, the
// orb takes the colour of the stage it is in (see STEP_DESCRIPTION); blue means it
// has moved on to writing.
export const WRITING_ORB_COLOR = "#0a84ff";

/**
 * Which ink the orb should use, from the notch's text colour: a light text colour
 * means a dark notch, which wants light dots ("dark"), and the reverse. The orb's
 * own `auto` looks for `.dark` and `data-theme`, which this app does not set, so
 * the theme is chosen here. An unreadable colour means the usual dark notch.
 */
export function orbThemeForInk(ink: string): OrbTheme {
	const hex = parseCssColorToHex(ink, "#ffffff");
	const [red, green, blue] = [1, 3, 5].map((start) =>
		Number.parseInt(hex.slice(start, start + 2), 16)
	);
	const brightness = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
	return brightness > 0.5 ? "dark" : "light";
}

function readOrbTheme(): OrbTheme {
	return orbThemeForInk(getComputedStyle(document.documentElement).getPropertyValue("--zara-text"));
}

/** The orb theme for the notch as it is now, updated when the user changes theme. */
export function useOrbTheme(): OrbTheme {
	const [theme, setTheme] = useState<OrbTheme>(readOrbTheme);
	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setTheme(readOrbTheme()));
		observer.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
		setTheme(readOrbTheme());
		return () => observer.disconnect();
	}, []);
	return theme;
}

/** A small orb after an answer that is still being written. */
export function WritingIndicator() {
	const theme = useOrbTheme();
	return (
		<div className="zai-writing" role="status">
			<ThinkingOrb
				state="composing"
				size={20}
				theme={theme}
				color={WRITING_ORB_COLOR}
				aria-hidden="true"
			/>
			<span className="zai-s-visually-hidden">Zara is writing</span>
		</div>
	);
}
