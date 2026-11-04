import type { ThinkingStepKind, ThinkingTrace } from "../types";

/**
 * How an answer is worked out, step by step. Every function returns a new trace
 * and takes the time as an argument, so the session's reducer stays pure.
 */

const STEP_FOR_STATUS: Record<string, ThinkingStepKind> = {
	"looking-at-screen": "screen",
	"reading-notes": "notes",
	"searching-web": "web"
};

/** A trace that has just begun: Zara is reading the question. */
export function startTrace(at: number): ThinkingTrace {
	return {
		startedAt: at,
		endedAt: null,
		steps: [{ kind: "understand", startedAt: at, endedAt: null }],
		reasoning: ""
	};
}

/**
 * Moves on to what the backend says it is doing now ("looking-at-screen",
 * "reading-notes", "searching-web"). A status that is not known, or a trace that
 * has already ended, changes nothing.
 */
export function advanceTrace(trace: ThinkingTrace, status: string, at: number): ThinkingTrace {
	const kind = STEP_FOR_STATUS[status];
	if (!kind || trace.endedAt !== null) return trace;
	const steps = trace.steps.map((step) =>
		step.endedAt === null ? { ...step, endedAt: at } : step
	);
	return { ...trace, steps: [...steps, { kind, startedAt: at, endedAt: null }] };
}

/** The model's reasoning so far, which replaces what was there (the backend sends it whole). */
export function withReasoning(trace: ThinkingTrace, reasoning: string): ThinkingTrace {
	return trace.endedAt === null ? { ...trace, reasoning } : trace;
}

/** Thinking is over: the answer is being written, or has arrived. Ending twice changes nothing. */
export function endTrace(trace: ThinkingTrace, at: number): ThinkingTrace {
	if (trace.endedAt !== null) return trace;
	const steps = trace.steps.map((step) =>
		step.endedAt === null ? { ...step, endedAt: at } : step
	);
	return { ...trace, steps, endedAt: at };
}

/** The stage in progress, or null once thinking is over. */
export function currentStepKind(trace: ThinkingTrace): ThinkingStepKind | null {
	return trace.steps.find((step) => step.endedAt === null)?.kind ?? null;
}

/** How long a stage took, in milliseconds, or null while it is going on. */
export function durationOf(span: { startedAt: number; endedAt: number | null }): number | null {
	return span.endedAt === null ? null : Math.max(0, span.endedAt - span.startedAt);
}

/** "0.4 s", "12 s", "1 min 5 s": short enough for a line of the panel. */
export function formatDuration(milliseconds: number): string {
	if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)} s`;
	const seconds = Math.round(milliseconds / 1000);
	if (seconds < 60) return `${seconds} s`;
	const rest = seconds % 60;
	return rest === 0
		? `${Math.floor(seconds / 60)} min`
		: `${Math.floor(seconds / 60)} min ${rest} s`;
}

/**
 * What each stage is called, what it means for the user, and its colour. The
 * colours tell the stages apart at a glance and are Apple's system colours, which
 * read on a dark or a light notch; blue is left to the answer being written.
 */
export const STEP_DESCRIPTION: Record<
	ThinkingStepKind,
	{ label: string; detail: string; color: string }
> = {
	understand: {
		color: "#34c759",
		label: "Understanding your question",
		detail: "Reading it with the conversation and what Zara remembers about you."
	},
	screen: {
		color: "#ff9f0a",
		label: "Looking at your screen",
		detail: "Took a picture of the screen to answer from what is on it."
	},
	notes: {
		color: "#40c8e0",
		label: "Reading your notes",
		detail: "Looked through your saved notes for what is relevant."
	},
	web: {
		color: "#bf5af2",
		label: "Searching the web",
		detail: "Searched for up-to-date information and checked what came back."
	}
};
