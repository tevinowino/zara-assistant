import React, { useEffect, useState } from "react";
import { loadSyntaxHighlighter } from "./blocks/loaders";

const LANGUAGE_CLASS_PATTERN = /language-([\w-]+)/;

type LoadedHighlighter = Awaited<ReturnType<typeof loadSyntaxHighlighter>>;

interface LazyCodeHighlightProps {
	language: string;
	children: string;
	compact?: boolean;
}

// The syntax highlighter is large, so it is loaded the first time a code block
// appears. Until then (and if loading fails) the code shows as plain text.
export function LazyCodeHighlight({ language, children, compact }: LazyCodeHighlightProps) {
	const [highlighter, setHighlighter] = useState<LoadedHighlighter | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadSyntaxHighlighter()
			.then((loaded) => {
				if (!cancelled) setHighlighter(loaded);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const className = compact ? "zai-code zai-code-compact" : "zai-code";
	if (!highlighter) {
		return (
			<pre data-testid="lazy-code-highlight-loading" className={className}>
				{children}
			</pre>
		);
	}

	const { SyntaxHighlighter, style } = highlighter;
	return (
		<SyntaxHighlighter
			language={language}
			style={style}
			wrapLongLines
			customStyle={{
				margin: "6px 0",
				padding: "10px",
				background: "color-mix(in srgb, var(--zara-text) 8%, transparent)",
				borderRadius: "10px",
				fontSize: compact ? "10px" : "11px"
			}}
		>
			{children}
		</SyntaxHighlighter>
	);
}

interface ChatCodeBlockProps {
	className?: string;
	children?: React.ReactNode;
}

// react-markdown passes a fenced block's language as a "language-xxx" className on
// the inner <code> element.
export function ChatCodeBlock({ className, children }: ChatCodeBlockProps) {
	const language = className?.match(LANGUAGE_CLASS_PATTERN)?.[1] ?? "text";
	const code = String(children).replace(/\n$/, "");

	return <LazyCodeHighlight language={language}>{code}</LazyCodeHighlight>;
}
