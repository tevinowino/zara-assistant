import { createContext } from "react";
import type { ActionHost } from "./actions";

/**
 * What a surface needs from the place it is shown in order to be interactive.
 * Without one (for example a surface drawn in a preview) buttons render
 * disabled instead of doing nothing silently.
 */
export interface SurfaceInteraction {
	/** The functions a button may call; see actions.ts. */
	host: ActionHost;
	/** Sends text to the assistant as the user's next message (an `event` button). */
	sendEvent: (message: string) => void;
	/** The assistant is already answering, so a new message would be dropped. */
	busy: boolean;
}

export const SurfaceInteractionContext = createContext<SurfaceInteraction | null>(null);
