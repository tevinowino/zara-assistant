import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState
} from "react";
import { ArrowUp, ChevronDown, History, Plus, Square, X } from "lucide-react";
import {
	aiGetSettings,
	aiHasApiKey,
	aiSetApiKey,
	aiTestConnection,
	shortcutActive,
	toAiError
} from "./api";
import type { ProviderInfo } from "./providers";
import type { ThinkingTrace } from "./types";
import { keyboardEventToAccelerator } from "./lib/accelerator";
import { AssistantMessage } from "./chat/AssistantMessage";
import { shouldAutoScroll } from "./lib/scroll";
import type { AiSession } from "./useAiSession";
import { answerIdFor } from "./sessionReducer";
import { AI_PANEL_HEIGHT, NOTCH_TOP_ROW_HEIGHT } from "./panelSize";
import { messageDissolveLength } from "./readability";
import { createDefaultHost, type ActionHost } from "./a2ui/actions";
import { SurfaceInteractionContext } from "./a2ui/interaction";
import { HistoryView } from "./history/HistoryView";
import { ModelChooser } from "./ModelChooser";
import { ThinkingSection } from "./ThinkingSection";
import { WritingIndicator } from "./ThinkingStatus";
import { WelcomeView } from "./history/WelcomeView";
import "./ai.css";

/** How much taller the notch grows at a time while an answer is being written, in pixels. */
const GROWTH_STEP = 24;

/** Errors that mean the API key needs attention rather than "try again". */
const KEY_ERROR_KINDS = new Set(["key-missing", "invalid-key"]);

interface AiPanelProps {
	session: AiSession;
	onClose: () => void;
	/** Tells the notch how tall the panel wants to be. */
	onDesiredHeight?: (height: number) => void;
	/** What buttons in answers may ask the notch to do; omitted ones stay disabled. */
	notchActions?: Pick<ActionHost, "startTimer" | "openPanel">;
}

/** The assistant panel, with the capabilities that buttons in its answers may use. */
export function AiPanel(props: AiPanelProps) {
	const { session, notchActions } = props;
	const { send } = session;
	const sending = session.phase === "sending";
	const startTimer = notchActions?.startTimer;
	const openPanel = notchActions?.openPanel;
	const interaction = useMemo(
		() => ({
			host: createDefaultHost({ startTimer, openPanel }),
			sendEvent: (message: string) => void send(message),
			busy: sending
		}),
		[startTimer, openPanel, send, sending]
	);

	return (
		<SurfaceInteractionContext.Provider value={interaction}>
			<AiPanelContent {...props} />
		</SurfaceInteractionContext.Provider>
	);
}

function AiPanelContent({ session, onClose, onDesiredHeight }: AiPanelProps) {
	const { draft, setDraft, scrollMemory } = session;
	// Either the conversation, or the list of past chats in its place.
	const [view, setView] = useState<"chat" | "history">("chat");
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	// Bumped when another service is chosen from the menu, so its key is checked again.
	const [serviceRevision, setServiceRevision] = useState(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	// The tallest the notch has needed to be for this conversation. It only grows,
	// so the panel does not jump back and forth while the user reads, and it is
	// tied to the conversation so a new chat starts from the base height again.
	const [grown, setGrown] = useState({ conversationId: "", height: 0 });
	const [pinnedToBottom, setPinnedToBottom] = useState(
		scrollMemory.current?.pinnedToBottom ?? true
	);
	// The user-chosen panel shortcut for starting a new conversation, if any.
	const [resetShortcut, setResetShortcut] = useState<string | null>(null);
	// Which answers have their Thinking section opened. Kept here, by the id the
	// answer will keep, so a section stays open when the answer starts to be written.
	const [openThinking, setOpenThinking] = useState<ReadonlySet<string>>(new Set());

	const sending = session.phase === "sending";
	const lastUserMessage = [...session.messages]
		.reverse()
		.find((message) => message.role === "user");
	const pendingAnswerId = lastUserMessage ? answerIdFor(lastUserMessage) : null;
	const keyProblem =
		hasKey === false || (session.error !== null && KEY_ERROR_KINDS.has(session.error.kind));
	const hasConversation = session.messages.length > 0;
	// The reply being written is shown as the last message, with the id it will
	// keep once it is finished, so nothing is replaced when the last words land.
	const shownMessages = session.streamingMessage
		? [...session.messages, session.streamingMessage]
		: session.messages;
	// Says where the user is: the chat they are in, or that it is one they came back to.
	const crumb =
		session.resumedTitle !== null
			? `Continuing: ${session.resumedTitle || "your last conversation"}`
			: session.title;

	useEffect(() => {
		let cancelled = false;
		aiHasApiKey()
			.then((present) => {
				if (!cancelled) setHasKey(present);
			})
			.catch(() => {
				// If the check itself fails, let the user try; a real problem will surface as an error.
				if (!cancelled) setHasKey(true);
			});
		return () => {
			cancelled = true;
		};
	}, [serviceRevision]);

	useEffect(() => {
		shortcutActive()
			.then((active) => setResetShortcut(active["ai.reset"] ?? null))
			.catch(() => setResetShortcut(null));
	}, []);

	const needsRoom = hasConversation || keyProblem || view === "history";
	const baseHeight = needsRoom ? AI_PANEL_HEIGHT.conversation : AI_PANEL_HEIGHT.welcome;
	const grownForThisChat = grown.conversationId === session.conversationId ? grown.height : 0;
	const desiredHeight = Math.min(AI_PANEL_HEIGHT.max, Math.max(baseHeight, grownForThisChat));

	useEffect(() => {
		onDesiredHeight?.(desiredHeight);
	}, [desiredHeight, onDesiredHeight]);

	// The bottom of the notch fades to transparent, so text must not run into the
	// part where the wallpaper would make it unreadable (see readability.ts). The
	// scrolling lists dissolve over a length worked out from the notch's height and
	// how much room the input takes below them, and read it from this variable.
	useLayoutEffect(() => {
		const panel = panelRef.current;
		const list = panel?.querySelector<HTMLElement>(".zai-messages, .zai-history-body");
		if (!panel || !list) return;
		const belowList = panel.offsetHeight - (list.offsetTop + list.offsetHeight);
		const length = messageDissolveLength({
			notchHeight: desiredHeight,
			belowMessagesHeight: belowList
		});
		panel.style.setProperty("--zai-dissolve", `${Math.round(length)}px`);
	}, [desiredHeight, view, hasConversation, hasKey, session.messages]);

	// Measure how tall the chat wants the notch to be: everything around the
	// message area (header, composer, padding), plus everything inside it (the
	// messages, or the welcome view with its recent chats), plus the notch's own
	// top row. Anything beyond the tallest allowed scrolls.
	const growToFitContent = useCallback(() => {
		const panel = panelRef.current;
		const messages = scrollRef.current;
		if (view !== "chat" || !panel || !messages) return;
		const measured =
			panel.offsetHeight - messages.clientHeight + messages.scrollHeight + NOTCH_TOP_ROW_HEIGHT;
		// In steps, so a reply being written grows the notch a few times a second
		// instead of asking it to move for every word.
		if (measured <= baseHeight) return;
		const needed = Math.ceil(measured / GROWTH_STEP) * GROWTH_STEP;
		setGrown((current) => {
			const before = current.conversationId === session.conversationId ? current.height : 0;
			return needed > before ? { conversationId: session.conversationId, height: needed } : current;
		});
	}, [view, baseHeight, session.conversationId]);

	useLayoutEffect(() => {
		growToFitContent();
	}, [
		growToFitContent,
		session.messages,
		session.phase,
		session.notices,
		session.error,
		session.streamingMessage?.text
	]);

	// Typing starts immediately when the panel opens, and again after each answer.
	useEffect(() => {
		if (!sending && !keyProblem) inputRef.current?.focus();
	}, [sending, keyProblem]);

	// Follow new content, but never yank the view away from someone reading history.
	useLayoutEffect(() => {
		const container = scrollRef.current;
		if (container && pinnedToBottom) container.scrollTop = container.scrollHeight;
	}, [
		session.messages,
		session.phase,
		session.notices,
		session.streamingMessage?.text,
		pinnedToBottom
	]);

	// Back to where the user was reading when the notch was last open. It runs
	// once, when the messages first exist, and only for a reader of history: someone
	// following the newest message is taken to the bottom by the effect above.
	const restoredScrollRef = useRef(false);
	useLayoutEffect(() => {
		const container = scrollRef.current;
		if (!container || restoredScrollRef.current) return;
		restoredScrollRef.current = true;
		const remembered = scrollMemory.current;
		if (remembered && !remembered.pinnedToBottom) container.scrollTop = remembered.top;
	}, [hasKey, scrollMemory]);

	const renderThinking = (answerId: string, trace: ThinkingTrace) => (
		<ThinkingSection
			key={`${answerId}:thinking`}
			trace={trace}
			open={openThinking.has(answerId)}
			onOpenChange={(open) =>
				setOpenThinking((current) => {
					const next = new Set(current);
					if (open) next.add(answerId);
					else next.delete(answerId);
					return next;
				})
			}
			onContentChange={growToFitContent}
		/>
	);

	// A question that failed is asked again of the service just chosen, which is
	// usually why it was chosen.
	const changeService = () => {
		setServiceRevision((revision) => revision + 1);
		if (session.error && session.failedText) void session.retry();
	};

	const handleScroll = useCallback(() => {
		const container = scrollRef.current;
		if (!container) return;
		const pinned = shouldAutoScroll(container);
		scrollMemory.current = { top: container.scrollTop, pinnedToBottom: pinned };
		setPinnedToBottom(pinned);
	}, [scrollMemory]);

	const jumpToLatest = () => {
		const container = scrollRef.current;
		if (container) container.scrollTop = container.scrollHeight;
		setPinnedToBottom(true);
	};

	const openPastChat = async (id: string) => {
		await session.load(id);
		setView("chat");
	};

	const startNewChat = () => {
		session.reset();
		setView("chat");
	};

	const ask = (question: string) => {
		setPinnedToBottom(true);
		void session.send(question);
	};

	const submit = () => {
		const text = draft.trim();
		if (!text || sending) return;
		setDraft("");
		setPinnedToBottom(true);
		void session.send(text);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (resetShortcut && keyboardEventToAccelerator(event.nativeEvent) === resetShortcut) {
			event.preventDefault();
			session.reset();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return;
		}
		// Enter sends; Shift+Enter makes a new line. While an input method editor is
		// composing (Chinese, Japanese, Korean and others), Enter confirms the
		// composition and must not send.
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<section className="zai-panel" aria-label="Zara assistant" ref={panelRef}>
			<header className="zai-header">
				<span className="zai-title">Zara</span>
				{crumb && <span className="zai-resumed">{crumb}</span>}
				<span className="zai-spacer" />
				<button
					type="button"
					className="zai-icon-button"
					onClick={() => setView(view === "history" ? "chat" : "history")}
					aria-label="Past chats"
					aria-pressed={view === "history"}
				>
					<History size={14} />
				</button>
				{hasConversation && (
					<button
						type="button"
						className="zai-icon-button"
						onClick={startNewChat}
						aria-label="New conversation"
					>
						<Plus size={14} />
					</button>
				)}
				<button
					type="button"
					className="zai-icon-button"
					onClick={onClose}
					aria-label="Close assistant"
				>
					<X size={14} />
				</button>
			</header>

			{view === "history" ? (
				<HistoryView
					currentId={session.conversationId}
					busy={sending}
					onOpen={(id) => void openPastChat(id)}
					onDeleted={(id) => {
						if (id === session.conversationId) session.reset();
					}}
					onBack={() => setView("chat")}
					onNew={startNewChat}
				/>
			) : hasKey === null && session.error === null ? null : keyProblem ? (
				<ApiKeyCard
					message={
						session.error && KEY_ERROR_KINDS.has(session.error.kind) ? session.error.message : null
					}
					onSaved={() => {
						setHasKey(true);
						if (session.error) void session.retry();
					}}
				/>
			) : (
				<>
					<div className="zai-messages" ref={scrollRef} onScroll={handleScroll} aria-live="polite">
						{!hasConversation && !sending && (
							<WelcomeView
								busy={sending}
								onContentChange={growToFitContent}
								onAsk={ask}
								onOpenChat={(id) => void openPastChat(id)}
								onSeeAll={() => setView("history")}
							/>
						)}
						{shownMessages.map((message) =>
							message.role === "user" ? (
								<div key={message.id} className="zai-user">
									{message.text}
								</div>
							) : (
								<Fragment key={message.id}>
									{message.thinking && renderThinking(message.id, message.thinking)}
									<AssistantMessage
										message={message}
										streaming={message.id === session.streamingMessage?.id}
									/>
								</Fragment>
							)
						)}
						{sending &&
							!session.streamingMessage &&
							session.thinking &&
							pendingAnswerId &&
							renderThinking(pendingAnswerId, session.thinking)}
						{session.streamingMessage && <WritingIndicator />}
						{session.error && !KEY_ERROR_KINDS.has(session.error.kind) && (
							<div className="zai-error" role="alert">
								<span>{session.error.message}</span>
								{session.failedText && (
									<button type="button" onClick={() => void session.retry()}>
										Retry
									</button>
								)}
							</div>
						)}
						{session.notices.map((notice) => (
							<div key={`${notice.kind}:${notice.text}`} className="zai-notice">
								<span>
									{notice.kind === "memory" ? "Saved to memory: " : "Notes: "}
									{notice.text}
								</span>
								{notice.kind === "memory" && (
									<button type="button" onClick={() => void session.undoMemory(notice.text)}>
										Undo
									</button>
								)}
							</div>
						))}
					</div>
					{!pinnedToBottom && hasConversation && (
						<button type="button" className="zai-jump" onClick={jumpToLatest}>
							<ChevronDown size={12} /> Latest
						</button>
					)}
					<div className="zai-compose zai-compose-chat">
						<textarea
							ref={inputRef}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask Zara anything"
							aria-label="Message Zara"
							rows={1}
							disabled={sending}
						/>
						<div className="zai-compose-bar">
							<ModelChooser onChanged={changeService} />
							{sending ? (
								<button
									type="button"
									className="zai-send"
									onClick={session.cancel}
									aria-label="Stop"
								>
									<Square size={10} fill="currentColor" />
								</button>
							) : (
								<button
									type="button"
									className="zai-send"
									onClick={submit}
									disabled={draft.trim() === ""}
									aria-label="Send"
								>
									<ArrowUp size={14} />
								</button>
							)}
						</div>
					</div>
				</>
			)}
		</section>
	);
}

interface ApiKeyCardProps {
	/** Why the card is showing, when a request was rejected; otherwise null for first-time setup. */
	message: string | null;
	onSaved: () => void;
}

// Shown on first use and whenever the key is missing or rejected. The key goes
// straight to the backend, which keeps it in Windows Credential Manager; it is
// never kept in the page.
function ApiKeyCard({ message, onSaved }: ApiKeyCardProps) {
	// The service in use, so the card asks for the right key. Until it is known the
	// card asks for "your API key", which is true whichever service it turns out to be.
	const [service, setService] = useState<ProviderInfo | null>(null);
	useEffect(() => {
		let cancelled = false;
		aiGetSettings()
			.then((view) => {
				if (!cancelled)
					setService(view.providers.find((item) => item.id === view.provider) ?? null);
			})
			.catch(() => {
				// The card still works without knowing the service's name.
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const keyName = service ? `${service.label} API key` : "API key";

	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const save = async () => {
		const trimmed = key.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setProblem(null);
		try {
			await aiSetApiKey(trimmed);
			await aiTestConnection();
			setKey("");
			onSaved();
		} catch (error) {
			setProblem(toAiError(error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="zai-card">
			<p className="zai-card-title">{message ?? `Add your ${keyName}`}</p>
			<p className="zai-card-text">
				Your key is stored in Windows Credential Manager on this PC.
				{service?.keyHelpUrl && ` You can get one at ${new URL(service.keyHelpUrl).host}.`} To use a
				different service or model, open Settings and choose Assistant.
			</p>
			<div className="zai-compose">
				<input
					type="password"
					value={key}
					onChange={(event) => setKey(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) void save();
					}}
					placeholder="Paste API key"
					aria-label={keyName}
					autoComplete="off"
					spellCheck={false}
				/>
				<button
					type="button"
					className="zai-send"
					onClick={() => void save()}
					disabled={busy || key.trim() === ""}
					aria-label="Save key"
				>
					<ArrowUp size={14} />
				</button>
			</div>
			{busy && <p className="zai-card-text">Checking the key…</p>}
			{problem && (
				<p className="zai-error" role="alert">
					{problem}
				</p>
			)}
		</div>
	);
}
