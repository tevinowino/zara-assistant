import type { BlockDataMap } from "../../protocol";
import type { BlockRenderProps } from "./registry";
import { hexToRgba } from "../../lib/color";
import { resolveColor } from "../../protocol/accent";

type CarouselData = BlockDataMap["carousel"];

export function CarouselBlock({ data, height }: BlockRenderProps<CarouselData>) {
	return (
		<div className="zai-carousel" style={{ height }}>
			{data.items.map((item, i) => {
				const accent = resolveColor(item.color);
				return (
					<div
						key={i}
						className="zai-block zai-carousel-card"
						// A low-alpha tint and border only; the title and description colours
						// are never overridden, so an unusual hue cannot make a card unreadable.
						style={
							accent
								? { background: hexToRgba(accent, 0.14), borderColor: hexToRgba(accent, 0.4) }
								: undefined
						}
					>
						<span className="zai-carousel-title zai-truncate">{item.title}</span>
						{item.description && <span className="zai-carousel-text">{item.description}</span>}
					</div>
				);
			})}
		</div>
	);
}
