import { TrendingUp, TrendingDown, Minus } from "../../../icons/glyphs";
import type { BlockDataMap } from "../../protocol";
import type { BlockRenderProps } from "./registry";

type StatData = BlockDataMap["stat"];

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function StatBlock({ data, height }: BlockRenderProps<StatData>) {
	return (
		<div
			className="zai-stat-grid"
			style={{ height, gridTemplateColumns: `repeat(${data.items.length}, minmax(0, 1fr))` }}
		>
			{data.items.map((item, i) => {
				const TrendIcon = item.trend ? TREND_ICON[item.trend] : null;
				return (
					<div key={i} className="zai-block zai-stat">
						<span className="zai-eyebrow zai-truncate">{item.label}</span>
						<span className="zai-stat-value zai-truncate">{item.value}</span>
						{item.delta && (
							<span className={`zai-stat-delta zai-trend-${item.trend ?? "flat"}`}>
								{TrendIcon && <TrendIcon size={10} aria-hidden="true" />}
								{item.delta}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
