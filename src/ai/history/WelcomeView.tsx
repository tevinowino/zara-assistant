import { useLayoutEffect, useState } from "react";
import { ChatRow } from "./ChatRow";
import { useConversationList } from "./useConversationList";

/** Things worth trying, each a whole question that is sent as it stands. */
const SUGGESTIONS = [
	"What's on my screen?",
	"Summarize my notes",
	"Start a 25 minute focus timer"
] as const;

/** How many recent chats the welcome view lists before "See all chats". */
const RECENT_LIMIT = 3;

interface WelcomeViewProps {
	/** An answer is being written, so a new question would be dropped. */
	busy: boolean;
	/** The view's height changed (its recent chats arrived), so the panel may need to resize. */
	onContentChange?: () => void;
	onAsk: (question: string) => void;
	onOpenChat: (id: string) => void;
	onSeeAll: () => void;
}

/** What a new chat shows before the first message: suggestions, and the latest past chats. */
export function WelcomeView({
	busy,
	onContentChange,
	onAsk,
	onOpenChat,
	onSeeAll
}: WelcomeViewProps) {
	const { status, conversations } = useConversationList();
	const [now] = useState(() => Date.now());
	const recent = status === "ready" ? conversations.slice(0, RECENT_LIMIT) : [];

	useLayoutEffect(() => {
		onContentChange?.();
	}, [recent.length, onContentChange]);

	return (
		<section className="zai-welcome" aria-label="Start a chat">
			<h2 className="zai-welcome-title">How can I help?</h2>

			<div className="zai-suggestions">
				{SUGGESTIONS.map((suggestion) => (
					<button
						key={suggestion}
						type="button"
						className="zai-suggestion"
						disabled={busy}
						onClick={() => onAsk(suggestion)}
					>
						{suggestion}
					</button>
				))}
			</div>

			{recent.length > 0 && (
				<div className="zai-recent">
					<div className="zai-recent-head">
						<h3 className="zai-eyebrow">Recent</h3>
						<button type="button" className="zai-link-button" onClick={onSeeAll}>
							See all chats
						</button>
					</div>
					<ul className="zai-chat-list">
						{recent.map((item) => (
							<ChatRow
								key={item.id}
								id={item.id}
								title={item.title}
								updatedAt={item.updatedAt}
								now={now}
								disabled={busy}
								onOpen={onOpenChat}
							/>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
