import { useEffect, useState } from "react";
import type * as Recharts from "recharts";
import { loadRecharts } from "./loaders";
import { currentChartPalette, type ChartPalette } from "./chartPalette";
import type { BlockDataMap } from "../../protocol";
import type { BlockRenderProps } from "./registry";

type ChartData = BlockDataMap["chart"];

const tooltipStyle = (palette: ChartPalette) => ({
	background: palette.tooltipBackground,
	border: `1px solid ${palette.tooltipBorder}`,
	borderRadius: 8,
	fontSize: 10
});

const axisProps = (palette: ChartPalette) => ({
	tick: { fill: palette.tick, fontSize: 9 },
	tickLine: false,
	axisLine: { stroke: palette.axisLine }
});

// isAnimationActive={false} on every primitive is deliberate: Recharts' default
// enter animation rewrites SVG attributes every frame for about 1.5 seconds,
// which is pointless layout churn for a widget this small.
//
// Takes the already-loaded recharts module rather than importing it at the top of
// the file; ChartBlock below only calls this once the dependency has loaded.
function renderChart(
	recharts: typeof Recharts,
	kind: ChartData["kind"],
	points: ChartData["data"],
	series: string[],
	palette: ChartPalette
) {
	const {
		PieChart,
		Pie,
		Cell,
		BarChart,
		Bar,
		AreaChart,
		Area,
		LineChart,
		Line,
		XAxis,
		YAxis,
		CartesianGrid,
		Tooltip
	} = recharts;
	const colorAt = (i: number) => palette.series[i % palette.series.length];
	const TOOLTIP_STYLE = tooltipStyle(palette);
	const AXIS_PROPS = axisProps(palette);

	if (kind === "pie") {
		return (
			<PieChart>
				<Tooltip contentStyle={TOOLTIP_STYLE} />
				<Pie
					data={points}
					dataKey={series[0]}
					nameKey="x"
					outerRadius="80%"
					isAnimationActive={false}
				>
					{points.map((_, i) => (
						<Cell key={i} fill={colorAt(i)} />
					))}
				</Pie>
			</PieChart>
		);
	}

	if (kind === "bar") {
		return (
			<BarChart data={points}>
				<CartesianGrid stroke={palette.grid} vertical={false} />
				<XAxis dataKey="x" {...AXIS_PROPS} />
				<YAxis {...AXIS_PROPS} width={28} />
				<Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: palette.cursorFill }} />
				{series.map((key, i) => (
					<Bar
						key={key}
						dataKey={key}
						fill={colorAt(i)}
						isAnimationActive={false}
						radius={[3, 3, 0, 0]}
					/>
				))}
			</BarChart>
		);
	}

	if (kind === "area") {
		return (
			<AreaChart data={points}>
				<CartesianGrid stroke={palette.grid} vertical={false} />
				<XAxis dataKey="x" {...AXIS_PROPS} />
				<YAxis {...AXIS_PROPS} width={28} />
				<Tooltip contentStyle={TOOLTIP_STYLE} />
				{series.map((key, i) => (
					<Area
						key={key}
						type="monotone"
						dataKey={key}
						stroke={colorAt(i)}
						fill={colorAt(i)}
						fillOpacity={0.15}
						isAnimationActive={false}
					/>
				))}
			</AreaChart>
		);
	}

	return (
		<LineChart data={points}>
			<CartesianGrid stroke={palette.grid} vertical={false} />
			<XAxis dataKey="x" {...AXIS_PROPS} />
			<YAxis {...AXIS_PROPS} width={28} />
			<Tooltip contentStyle={TOOLTIP_STYLE} />
			{series.map((key, i) => (
				<Line
					key={key}
					type="monotone"
					dataKey={key}
					stroke={colorAt(i)}
					strokeWidth={2}
					dot={false}
					isAnimationActive={false}
				/>
			))}
		</LineChart>
	);
}

export function ChartBlock({ data, height }: BlockRenderProps<ChartData>) {
	const [recharts, setRecharts] = useState<typeof Recharts | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadRecharts().then((module) => {
			if (!cancelled) setRecharts(module);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const chartAreaHeight = data.title ? height - 24 : height - 8;
	// Series use the accent palette, or the colours the model chose; labels and
	// grid lines are tints of the notch's own text colour.
	const palette = currentChartPalette(data.colors);

	if (!recharts) {
		return (
			<div className="zai-block zai-shimmer" style={{ height }}>
				<span className="zai-eyebrow">chart · loading…</span>
			</div>
		);
	}

	return (
		<div className="zai-block zai-chart">
			{data.title && <div className="zai-eyebrow zai-chart-title">{data.title}</div>}
			{/* A fixed pixel height, never a percentage: an auto-height parent measures a
			    percentage as zero and the chart never recovers. */}
			<recharts.ResponsiveContainer width="100%" height={chartAreaHeight}>
				{renderChart(recharts, data.kind, data.data, data.series, palette)}
			</recharts.ResponsiveContainer>
		</div>
	);
}
