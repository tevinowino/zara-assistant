// What a button on a surface is allowed to do.
//
// A surface comes from a language model, and the model can be steered by text
// the user was looking at when they asked. So a surface never runs anything
// itself: a button names a function, and only the functions listed here exist.
// Each one validates its arguments and says whether it needs a second click.
// A function only runs on a user click, never on its own.
//
// The notch supplies what only it can do (start a timer, switch panel) through
// ActionHost; a function the host lacks is refused, so the same surface works
// in a context that cannot, say, start a timer.

import { z } from "zod";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { noteAdd } from "../api";
import { isSafeExternalUrl } from "../chat/safeLinks";

export const PANEL_NAMES = ["calendar", "command-center", "devices"] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

/** The capabilities behind the functions. The notch fills in the two optional ones. */
export interface ActionHost {
	copyText(text: string): Promise<void>;
	openUrl(url: string): Promise<void>;
	saveNote(text: string): Promise<void>;
	startTimer?: (seconds: number) => void;
	openPanel?: (panel: PanelName) => void;
}

export type PreparedAction =
	| {
			kind: "ready";
			/** True for anything that writes data: the user must click twice. */
			requiresConfirmation: boolean;
			/** Short note shown with the button, such as where a link goes. */
			hint?: string;
			run: () => Promise<void>;
	  }
	| { kind: "refused"; reason: string };

const REFUSED: PreparedAction = {
	kind: "refused",
	reason: "This can't be done from here."
};

const text = z.string().min(1).max(2000);

type FunctionDefinition = (args: unknown, host: ActionHost) => PreparedAction;

function define<S extends z.ZodTypeAny>(
	schema: S,
	prepare: (args: z.infer<S>, host: ActionHost) => PreparedAction
): FunctionDefinition {
	return (args, host) => {
		const parsed = schema.safeParse(args);
		return parsed.success ? prepare(parsed.data, host) : REFUSED;
	};
}

const FUNCTIONS: Record<string, FunctionDefinition> = {
	copyText: define(z.object({ text }), ({ text: value }, host) => ({
		kind: "ready",
		requiresConfirmation: false,
		run: () => host.copyText(value)
	})),

	openUrl: define(z.object({ url: z.string().max(2000) }), ({ url }, host) => {
		if (!isSafeExternalUrl(url)) return REFUSED;
		const site = new URL(url).hostname || url;
		return {
			kind: "ready",
			requiresConfirmation: false,
			hint: `Opens ${site}`,
			run: () => host.openUrl(url)
		};
	}),

	saveNote: define(z.object({ text }), ({ text: value }, host) => ({
		kind: "ready",
		requiresConfirmation: true,
		run: () => host.saveNote(value)
	})),

	startTimer: define(
		z.object({ minutes: z.number().int().min(1).max(180) }),
		({ minutes }, host) => {
			const { startTimer } = host;
			if (!startTimer) return REFUSED;
			return {
				kind: "ready",
				requiresConfirmation: false,
				run: async () => startTimer(minutes * 60)
			};
		}
	),

	openPanel: define(z.object({ panel: z.enum(PANEL_NAMES) }), ({ panel }, host) => {
		const { openPanel } = host;
		if (!openPanel) return REFUSED;
		return {
			kind: "ready",
			requiresConfirmation: false,
			run: async () => openPanel(panel)
		};
	})
};

/** The names a surface's `functionCall` action may use. */
export const FUNCTION_ACTION_NAMES = Object.keys(FUNCTIONS);

/**
 * Checks a function call from a surface against the list, its argument rules
 * and what the host can do. Nothing runs until the user clicks and the caller
 * calls `run` on a "ready" result.
 */
export function prepareFunctionAction(
	name: string,
	args: unknown,
	host: ActionHost
): PreparedAction {
	if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) return REFUSED;
	return FUNCTIONS[name](args, host);
}

/** The functions every context has: clipboard, web links and notes. */
export function createDefaultHost(
	notch: Pick<ActionHost, "startTimer" | "openPanel"> = {}
): ActionHost {
	return {
		copyText: (value) => writeText(value),
		openUrl: (url) => openUrl(url),
		saveNote: async (value) => {
			await noteAdd(value);
		},
		...notch
	};
}
