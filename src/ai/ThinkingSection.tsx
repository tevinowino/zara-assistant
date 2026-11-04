import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties
} from "react";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { parseReasoning, splitInline, type Thought } from "./lib/reasoning";
import { STEP_DESCRIPTION, currentStepKind, durationOf, formatDuration } from "./lib/thinkingTrace";
import { useOrbTheme } from "./ThinkingStatus";
import type { ThinkingStepKind, ThinkingTrace } from "./types";

const ORB_STATE: Record<ThinkingStepKind, OrbState> = {
	understand: "breathing",
	screen: "searching",
	notes: "working",
	web: "searching"
};

/** Short waits need no clock; a long one does, so it can be told from a stuck one. */
const SHOW_ELAPSED_AFTER_SECONDS = 5;

/** Whole seconds since `startedAt`, counting up once a second while `running`. */
function useElapsedSeconds(startedAt: number, running: boolean): number {
	const secondsSince = () => Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	const [seconds, setSeconds] = useState(secondsSince);
	useEffect(() => {
		if (!running) return;
		setSeconds(secondsSince());
		const tick = setInterval(() => setSeconds(secondsSince()), 1000);
		return () => clearInterval(tick);
		// secondsSince only reads startedAt.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [startedAt, running]);
	return seconds;
}

interface ThinkingSectionProps {
	trace: ThinkingTrace;
	/** Whether the steps and reasoning are showing. The caller keeps this, so it survives the section moving. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after the section's height changed, so the panel can make room for it. */
	onContentChange?: () => void;
}

/** "Thought for 4.2 s", or "Thinking…" while it is going on. */
function headline(trace: ThinkingTrace): string {
	const elapsed = durationOf(trace);
	if (elapsed === null) return "Thinking…";
	return elapsed < 1000 ? "Thought for under a second" : `Thought for ${formatDuration(elapsed)}`;
}

/** Plain text with `**bold**` and `code` set in type; anything else is shown as written. */
function Inline({ text }: { text: string }) {
	return (
		<>
			{splitInline(text).map((token, index) =>
				token.kind === "strong" ? (
					<strong key={index}>{token.text}</strong>
				) : token.kind === "code" ? (
					<code key={index}>{token.text}</code>
				) : (
					<span key={index}>{token.text}</span>
				)
			)}
		</>
	);
}

function ThoughtView({ thought }: { thought: Thought }) {
	return (
		<div className="zai-thought">
			{thought.title && <div className="zai-thought-title">{thought.title}</div>}
			{thought.blocks.map((block, index) =>
				block.kind === "list" ? (
					<ul key={index} className="zai-thought-list">
						{block.items.map((item, itemIndex) => (
							<li key={itemIndex}>
								<Inline text={item} />
							</li>
						))}
					</ul>
				) : (
					<p key={index} className="zai-thought-text">
						<Inline text={block.text} />
					</p>
				)
			)}
		</div>
	);
}

/**
 * How an answer is being, or was, reached, folded away under a "Thinking" line
 * with an arrow. Opened, it lays out the stages Zara went through (each with the
 * time it took) and, when the model's service sends its reasoning, that reasoning
 * as titled thoughts. It shows only what really happened: nothing is invented to
 * fill the space, so an answer with no reasoning shows the stages alone.
 */
export function ThinkingSection({
	trace,
	open,
	onOpenChange,
	onContentChange
}: ThinkingSectionProps) {
	const bodyId = useId();
	const theme = useOrbTheme();
	const thoughtsRef = useRef<HTMLDivElement>(null);
	const thinking = trace.endedAt === null;
	const activeKind = currentStepKind(trace);
	// Reasoning is laid out only while it can be seen: a folded section costs nothing as it grows.
	const shownReasoning = open ? trace.reasoning : "";
	const thoughts = useMemo(() => parseReasoning(shownReasoning), [shownReasoning]);
	const elapsedSeconds = useElapsedSeconds(trace.startedAt, thinking);

	useLayoutEffect(() => {
		onContentChange?.();
	}, [open, trace.steps.length, shownReasoning, onContentChange]);

	// While the model is still reasoning, follow the newest words.
	useEffect(() => {
		const list = thoughtsRef.current;
		if (open && thinking && list) list.scrollTop = list.scrollHeight;
	}, [open, thinking, trace.reasoning]);

	return (
		<div className="zai-thinking" data-state={thinking ? "thinking" : "done"}>
			<button
				type="button"
				className="zai-thinking-head"
				aria-expanded={open}
				aria-controls={open ? bodyId : undefined}
				onClick={() => onOpenChange(!open)}
			>
				{thinking ? (
					<ThinkingOrb
						state={ORB_STATE[activeKind ?? "understand"]}
						size={20}
						theme={theme}
						color={STEP_DESCRIPTION[activeKind ?? "understand"].color}
						aria-hidden="true"
					/>
				) : (
					<Sparkles size={14} aria-hidden="true" className="zai-thinking-mark" />
				)}
				<span className="zai-thinking-label">{headline(trace)}</span>
				{thinking && elapsedSeconds >= SHOW_ELAPSED_AFTER_SECONDS && (
					<span className="zai-thinking-elapsed">{`${elapsedSeconds} s`}</span>
				)}
				{thinking && activeKind && activeKind !== "understand" && (
					<span className="zai-thinking-now">{`${STEP_DESCRIPTION[activeKind].label}…`}</span>
				)}
				<ChevronRight size={14} aria-hidden="true" className="zai-thinking-arrow" />
			</button>

			{open && (
				<div id={bodyId} className="zai-thinking-body">
					<ol className="zai-steps" aria-label="Steps">
						{trace.steps.map((step, index) => {
							const took = durationOf(step);
							return (
								<li
									key={index}
									className="zai-step"
									data-state={took === null ? "active" : "done"}
									style={{ "--step-color": STEP_DESCRIPTION[step.kind].color } as CSSProperties}
								>
									<span className="zai-step-node" aria-hidden="true">
										{took === null ? <span className="zai-step-pulse" /> : <Check size={10} />}
									</span>
									<span className="zai-step-text">
										<span className="zai-step-label">{STEP_DESCRIPTION[step.kind].label}</span>
										<span className="zai-step-detail">{STEP_DESCRIPTION[step.kind].detail}</span>
									</span>
									{took !== null && <span className="zai-step-time">{formatDuration(took)}</span>}
								</li>
							);
						})}
					</ol>

					{thoughts.length > 0 && (
						<div
							className="zai-thoughts"
							ref={thoughtsRef}
							role="group"
							aria-label="The model's reasoning"
						>
							{thoughts.map((thought, index) => (
								<ThoughtView key={index} thought={thought} />
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
