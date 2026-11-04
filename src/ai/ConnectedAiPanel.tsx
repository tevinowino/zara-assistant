import { AiPanel } from "./AiPanel";
import { useAiSessionSelector, type AiSessionStore } from "./aiSessionStore";

type AiPanelProps = Parameters<typeof AiPanel>[0];

/**
 * The assistant panel, reading its conversation from the notch's session
 * store. This is the module the notch loads lazily: it keeps the panel's
 * heavy libraries out of the entry bundle, and it is the one place that
 * re-renders while an answer streams in.
 */
export function ConnectedAiPanel({
	store,
	...panelProps
}: Omit<AiPanelProps, "session"> & { store: AiSessionStore }) {
	const session = useAiSessionSelector(store, (current) => current, null);
	return session ? <AiPanel session={session} {...panelProps} /> : null;
}
