import { useCallback, useEffect, useRef, useState } from "react";
import { convDelete, convList } from "../api";
import type { ConversationSummary } from "../types";

export interface ConversationList {
	status: "loading" | "ready" | "error";
	/** Newest first, as the backend returns them. */
	conversations: ConversationSummary[];
	/** Reads the list again, for a retry after an error. */
	reload: () => void;
	/** Deletes a saved chat and drops it from the list. A failed delete re-reads the list. */
	remove: (id: string) => Promise<void>;
}

/** The saved chats, loaded when the view that shows them appears. */
export function useConversationList(): ConversationList {
	const [status, setStatus] = useState<ConversationList["status"]>("loading");
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const mounted = useRef(true);

	const load = useCallback(() => {
		setStatus("loading");
		convList()
			.then((list) => {
				if (!mounted.current) return;
				setConversations(list);
				setStatus("ready");
			})
			.catch(() => {
				if (!mounted.current) return;
				setConversations([]);
				setStatus("error");
			});
	}, []);

	useEffect(() => {
		mounted.current = true;
		load();
		return () => {
			mounted.current = false;
		};
	}, [load]);

	const remove = useCallback(
		async (id: string) => {
			try {
				await convDelete(id);
				if (mounted.current) setConversations((list) => list.filter((item) => item.id !== id));
			} catch {
				load();
			}
		},
		[load]
	);

	return { status, conversations, reload: load, remove };
}
