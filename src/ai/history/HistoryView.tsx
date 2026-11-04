import { useState } from "react";
import { ArrowLeft, Plus } from "../../icons/glyphs";
import { ChatRow } from "./ChatRow";
import { groupConversations } from "./groupConversations";
import { useConversationList } from "./useConversationList";

interface HistoryViewProps {
	/** The chat the assistant is showing, marked in the list. */
	currentId: string;
	/** An answer is being written, so switching chats would lose it. */
	busy: boolean;
	onOpen: (id: string) => void;
	/** Called after a chat has been deleted, so the caller can drop it if it was open. */
	onDeleted: (id: string) => void;
	onBack: () => void;
	onNew: () => void;
}

/** Every saved chat, newest first and grouped by day. */
export function HistoryView({
	currentId,
	busy,
	onOpen,
	onDeleted,
	onBack,
	onNew
}: HistoryViewProps) {
	const { status, conversations, reload, remove } = useConversationList();
	// Fixed for this view's lifetime, so every row's "5 min ago" agrees.
	const [now] = useState(() => Date.now());

	const deleteChat = (id: string) => {
		void remove(id).then(() => onDeleted(id));
	};

	return (
		<section className="zai-history" aria-label="Past chats">
			<div className="zai-history-bar">
				<button
					type="button"
					className="zai-pill-button"
					aria-label="Back to chat"
					onClick={onBack}
				>
					<ArrowLeft size={13} aria-hidden="true" />
					<span>Chat</span>
				</button>
				<h2 className="zai-history-title">Past chats</h2>
				<button type="button" className="zai-pill-button" aria-label="New chat" onClick={onNew}>
					<Plus size={13} aria-hidden="true" />
					<span>New</span>
				</button>
			</div>

			<div className="zai-history-body">
				{status === "loading" && <p className="zai-history-note">Loading…</p>}

				{status === "error" && (
					<div className="zai-history-note" role="alert">
						<span>Couldn't load your chats.</span>
						<button type="button" className="zai-link-button" onClick={reload}>
							Try again
						</button>
					</div>
				)}

				{status === "ready" && conversations.length === 0 && (
					<p className="zai-history-note">No past chats yet.</p>
				)}

				{status === "ready" &&
					groupConversations(conversations, now).map((group) => (
						<div key={group.label} className="zai-history-group">
							<h3 className="zai-eyebrow">{group.label}</h3>
							<ul className="zai-chat-list">
								{group.items.map((item) => (
									<ChatRow
										key={item.id}
										id={item.id}
										title={item.title}
										updatedAt={item.updatedAt}
										now={now}
										current={item.id === currentId}
										disabled={busy}
										onOpen={onOpen}
										onDelete={deleteChat}
									/>
								))}
							</ul>
						</div>
					))}
			</div>
		</section>
	);
}
