import { useMemo } from "react";
import { parseMessageContent } from "../protocol/parse";
import { ChatMarkdown } from "./ChatMarkdown";
import { BlockHost } from "./blocks/BlockHost";
import type { ChatMessage } from "../types";

interface AssistantMessageProps {
	message: ChatMessage;
	/** The reply is still being written, so a widget that has not finished arriving is a placeholder. */
	streaming?: boolean;
}

// A reply is a vertical stack, not one bubble, because widgets need the full panel
// width: prose segments sit in a speech bubble and blocks take the whole row.
export function AssistantMessage({ message, streaming = false }: AssistantMessageProps) {
	const segments = useMemo(
		() => parseMessageContent(message.text, { streaming }),
		[message.text, streaming]
	);
	const firstMarkdownIndex = segments.find((segment) => segment.kind === "markdown")?.index;

	return (
		<div className="zai-assistant">
			{segments.map((segment) => {
				const key = `${message.id}:${segment.index}`;

				if (segment.kind === "markdown") {
					// Only the first bubble gets the speech-tail corner; consecutive
					// bubbles split by a widget would otherwise read as two replies.
					const isFirst = segment.index === firstMarkdownIndex;
					return (
						<div key={key} className={isFirst ? "zai-bubble zai-bubble-first" : "zai-bubble"}>
							<ChatMarkdown text={segment.text} />
						</div>
					);
				}

				return (
					<div key={key} className="zai-block-row">
						<BlockHost segment={segment} />
					</div>
				);
			})}
		</div>
	);
}
