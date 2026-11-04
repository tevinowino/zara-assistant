import { invoke } from "@tauri-apps/api/core";

// Which conversation the assistant was last showing, so the next launch can
// pick it up again. Stored like every other setting: in localStorage for an
// instant read, and in settings.json through the backend so it survives a restart.
const LAST_CONVERSATION_KEY = "zara-ai-last-conversation";

/** The id of the conversation the assistant was last showing, if any. */
export function readLastConversationId(): string | null {
	return localStorage.getItem(LAST_CONVERSATION_KEY);
}

/** Remembers `conversationId` as the one to resume. A failed write only loses the resume. */
export function rememberLastConversationId(conversationId: string): void {
	localStorage.setItem(LAST_CONVERSATION_KEY, conversationId);
	invoke("save_setting", { key: LAST_CONVERSATION_KEY, value: conversationId }).catch(() => {});
}
