// The only place the frontend names backend commands for the assistant. The rest
// of the UI imports these typed functions and never calls invoke() directly, so
// a command rename is a one-file change.

import { invoke } from "@tauri-apps/api/core";
import type { AiSettingsView, ControlInfo, ProviderId, TuningValues } from "./providers";
import type {
	AiErrorInfo,
	ChatMessage,
	ChatOutcome,
	ConversationSummary,
	HistoryTurn,
	MemoryEntry,
	Note,
	NoteColor,
	StoredConversation
} from "./types";

/**
 * Normalises whatever a failed invoke rejects with. The backend rejects with
 * `{ kind, message }`; anything else (a string, an Error) becomes "other".
 */
export function toAiError(error: unknown): AiErrorInfo {
	if (error && typeof error === "object" && "kind" in error && "message" in error) {
		const { kind, message } = error as { kind: unknown; message: unknown };
		if (typeof kind === "string" && typeof message === "string") return { kind, message };
	}
	if (typeof error === "string" && error) return { kind: "other", message: error };
	if (error instanceof Error && error.message) return { kind: "other", message: error.message };
	return { kind: "other", message: "Something went wrong. Please try again." };
}

// ---- service, model and key ----------------------------------------------

/** The service in use, every service there is, and what is saved for each. */
export const aiGetSettings = () => invoke<AiSettingsView>("ai_get_settings");

/**
 * Whether the service has what it needs to be used: a saved key, or none to save
 * because it is a local server. With no `provider`, the one in use.
 */
export const aiHasApiKey = (provider?: ProviderId) =>
	invoke<boolean>("ai_has_api_key", provider ? { provider } : {});

export const aiSetApiKey = (key: string, provider?: ProviderId) =>
	invoke<void>("ai_set_api_key", provider ? { provider, key } : { key });

export const aiClearApiKey = (provider?: ProviderId) =>
	invoke<void>("ai_clear_api_key", provider ? { provider } : {});

/** Checks a service with a tiny request. With no `provider`, the one in use. */
export const aiTestConnection = (provider?: ProviderId) =>
	invoke<void>("ai_test_connection", provider ? { provider } : {});

/** The models a service says it offers; rejects when it will not say. */
/** The settings `model` of a service accepts, narrowed to that model. */
export const aiGetModelControls = (provider: ProviderId, model: string) =>
	invoke<ControlInfo[]>("ai_get_model_controls", { provider, model });

/** Saves the settings chosen for one model, replacing what was saved for it. */
export const aiSetModelTuning = (provider: ProviderId, model: string, values: TuningValues) =>
	invoke<void>("ai_set_model_tuning", { provider, model, values });

export const aiListModels = (provider: ProviderId) =>
	invoke<string[]>("ai_list_models", { provider });

/** Saves one of the assistant's settings (the service, a model, a server address). */
export const saveAiSetting = (key: string, value: string) =>
	invoke<void>("save_setting", { key, value });

// ---- chat ----------------------------------------------------------------

/** Stops the question being answered; its `aiChat` fails with kind "cancelled". */
export const aiCancelChat = () => invoke<void>("ai_cancel_chat");

export const aiChat = (message: string, history: HistoryTurn[]) =>
	invoke<ChatOutcome>("ai_chat", { message, history });

// ---- conversations -------------------------------------------------------

export const convList = () => invoke<ConversationSummary[]>("conv_list");
export const convLoad = (id: string) => invoke<StoredConversation | null>("conv_load", { id });
// How an answer was reached is shown for the chat on screen only, so it is left out of what is saved.
export const convSave = (id: string, messages: ChatMessage[]) =>
	invoke<StoredConversation>("conv_save", {
		id,
		messages: messages.map(({ thinking: _thinking, ...saved }) => saved)
	});
export const convDelete = (id: string) => invoke<{ success: boolean }>("conv_delete", { id });
export const convRename = (id: string, title: string) =>
	invoke<{ success: boolean }>("conv_rename", { id, title });
export const convGenerateTitle = (firstUserMessage: string, firstAssistantReply: string) =>
	invoke<{ title: string | null }>("conv_generate_title", {
		firstUserMessage,
		firstAssistantReply
	});

// ---- memories ------------------------------------------------------------

export const memoryList = () => invoke<MemoryEntry[]>("memory_list");
export const memoryAdd = (text: string) => invoke<MemoryEntry | null>("memory_add", { text });
export const memoryDelete = (id: string) => invoke<{ success: boolean }>("memory_delete", { id });

// ---- notes ---------------------------------------------------------------

export const noteList = () => invoke<Note[]>("note_list");
export const noteAdd = (text: string, title?: string, color?: NoteColor) =>
	invoke<Note | null>("note_add", { text, title: title ?? null, color: color ?? null });
export const noteUpdate = (id: string, text: string, title?: string, color?: NoteColor) =>
	invoke<{ success: boolean }>("note_update", {
		id,
		text,
		title: title ?? null,
		color: color ?? null
	});
export const noteDelete = (id: string) => invoke<{ success: boolean }>("note_delete", { id });

// ---- stealth -------------------------------------------------------------

/** One window's capture-exclusion state. */
export interface StealthWindowStatus {
	label: string;
	/** True when the window's flag matches what was asked for. */
	asRequested: boolean;
}

export interface StealthStatus {
	/** What the user asked for. */
	requested: boolean;
	/** Whether this version of Windows can hide windows from capture. */
	supported: boolean;
	/** True only when requested, supported and every window confirms it. */
	active: boolean;
	/** Why it is not active although requested, in plain words. */
	problem: string | null;
	windows: StealthWindowStatus[];
}

export const stealthStatus = () => invoke<StealthStatus>("stealth_status");
export const stealthSet = (enabled: boolean) => invoke<StealthStatus>("stealth_set", { enabled });
export const stealthVerify = () => invoke<StealthStatus>("stealth_verify");

// ---- shortcuts -----------------------------------------------------------

/** Where a shortcut works: in any app, or only while the Zara panel has focus. */
export type ShortcutScope = "global" | "panel";

export interface ShortcutRow {
	action: string;
	label: string;
	scope: ShortcutScope;
	default: string;
	/** What the user asked for, when they changed it. */
	preferred: string | null;
	/** What is in effect right now; null when nothing could be used. */
	active: string | null;
	/** Why the first choice was not used, in plain words. */
	message: string | null;
}

export const shortcutList = () => invoke<ShortcutRow[]>("shortcut_list");
export const shortcutActive = () => invoke<Record<string, string>>("shortcut_active");
export const shortcutSet = (action: string, accelerator: string) =>
	invoke<ShortcutRow>("shortcut_set", { action, accelerator });
export const shortcutReset = (action: string) => invoke<ShortcutRow>("shortcut_reset", { action });

// ---- importing data from the Electron version ----------------------------

export interface LegacyStatus {
	available: boolean;
	notes: number;
	conversations: number;
	memories: number;
}

export interface ImportSummary {
	notes: number;
	conversations: number;
	memories: number;
}

export const legacyImportStatus = () => invoke<LegacyStatus>("legacy_import_status");
export const legacyImportRun = () => invoke<ImportSummary>("legacy_import_run");
export const legacyImportDismiss = () => invoke<void>("legacy_import_dismiss");
