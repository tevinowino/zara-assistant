import { AlertTriangle } from "../../../icons/glyphs";
import { LazyCodeHighlight } from "../ChatCodeBlock";

interface BlockFallbackProps {
	type: string;
	detail: string;
	raw: string;
}

// A block that fails never shows raw JSON up front, which is a worse result than
// the literal "**bold**" markdown it was meant to fix. It shows a small themed
// card, with the raw fence behind a disclosure for debugging.
export function BlockFallback({ type, detail, raw }: BlockFallbackProps) {
	return (
		<div
			className="zai-block zai-fallback"
			role="group"
			aria-label={`${type} block could not be shown`}
		>
			<div className="zai-eyebrow zai-fallback-title">
				<AlertTriangle size={12} aria-hidden="true" />
				<span>{type} · couldn't render</span>
			</div>
			<p className="zai-fallback-detail">{detail}</p>
			<details>
				<summary>Show raw block</summary>
				<LazyCodeHighlight language="json" compact>
					{raw}
				</LazyCodeHighlight>
			</details>
		</div>
	);
}
