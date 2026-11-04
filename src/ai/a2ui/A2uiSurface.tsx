import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { z } from "zod";
import {
	AlertTriangle,
	Calendar,
	Check,
	Clock,
	Copy,
	Info,
	Link,
	Mail,
	Star,
	StickyNote,
	Timer
} from "lucide-react";
import { BLOCK_CONTRACTS } from "../protocol";
import { BLOCK_REGISTRY, type BlockRenderProps } from "../chat/blocks/registry";
import { BlockErrorBoundary } from "../chat/blocks/BlockErrorBoundary";
import {
	getAtPointer,
	resolveDynamic,
	setAtPointer,
	type BindingScope,
	type Json
} from "./binding";
import { ActionButton, CheckField, ChoiceField, TextInputField } from "./A2uiControls";
import {
	Badge,
	Callout,
	Checklist,
	KeyValue,
	Progress,
	Ring,
	Timeline,
	accentStyle,
	clampPercent
} from "./A2uiVisuals";
import { CATALOG, type CatalogComponentName, type ValidSurface } from "./catalog";

type PropsOf<K extends CatalogComponentName> = z.infer<(typeof CATALOG)[K]["schema"]>;

/** What a component renderer is given besides its own properties. */
interface Helpers {
	scope: BindingScope;
	/** Writes a value into the surface's data model, as an input does when edited. */
	setValue: (pointer: string, value: Json) => void;
	/** The text a Text component shows, for components labelled by a child. */
	labelOf: (id: string) => string;
	renderChild: (id: string, scope?: BindingScope) => ReactNode;
	renderChildren: (children: unknown) => ReactNode;
}

// A total mapped type over the catalog: adding a catalog component without a
// renderer here, or the reverse, is a compile error.
type Renderers = {
	[K in CatalogComponentName]: (props: PropsOf<K>, helpers: Helpers) => ReactNode;
};

/** The most items a list template draws, so a long data list cannot flood the panel. */
const MAX_TEMPLATE_ITEMS = 30;

const ICONS = {
	check: Check,
	clock: Clock,
	calendar: Calendar,
	mail: Mail,
	info: Info,
	warning: AlertTriangle,
	star: Star,
	timer: Timer,
	copy: Copy,
	link: Link,
	note: StickyNote
} as const;

function textOf(value: unknown): string {
	return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function widgetRenderer<K extends keyof typeof BLOCK_CONTRACTS>(blockType: K) {
	return (props: Record<string, unknown>) => {
		const { id: _id, component: _component, ...data } = props;
		const contract = BLOCK_CONTRACTS[blockType];
		const height =
			typeof contract.height === "function"
				? (contract.height as (value: unknown) => number)(data)
				: contract.height;
		const Block = BLOCK_REGISTRY[blockType] as ComponentType<BlockRenderProps<unknown>>;
		return (
			<BlockErrorBoundary blockType={blockType} raw={JSON.stringify(data)}>
				<Block data={data} height={height} />
			</BlockErrorBoundary>
		);
	};
}

const RENDERERS: Renderers = {
	Text: ({ text, variant, color }, { scope }) => (
		<p
			className={`zai-s-text zai-s-text-${variant ?? "body"}${color ? " zai-s-text-accent" : ""}`}
			style={accentStyle(color)}
		>
			{textOf(resolveDynamic(text, scope))}
		</p>
	),
	Column: ({ children, align }, { renderChildren }) => (
		<div className="zai-s-column" data-align={align ?? "stretch"}>
			{renderChildren(children)}
		</div>
	),
	Row: ({ children, align }, { renderChildren }) => (
		<div className="zai-s-row" data-align={align ?? "center"}>
			{renderChildren(children)}
		</div>
	),
	Card: ({ child, color }, { renderChild }) => (
		<div
			className={`zai-block zai-s-card${color ? " zai-s-card-accent" : ""}`}
			style={accentStyle(color)}
		>
			{renderChild(child)}
		</div>
	),
	Badge: ({ label, color }) => <Badge label={label} color={color} />,
	Callout: ({ tone, title, text }, { scope }) => (
		<Callout tone={tone} title={title} text={textOf(resolveDynamic(text, scope))} />
	),
	Progress: ({ label, value, caption, color }, { scope }) => (
		<Progress
			label={label}
			caption={caption}
			color={color}
			percent={clampPercent(resolveDynamic(value, scope))}
		/>
	),
	Ring: ({ label, value, caption, color }, { scope }) => (
		<Ring
			label={label}
			caption={caption}
			color={color}
			percent={clampPercent(resolveDynamic(value, scope))}
		/>
	),
	KeyValue: ({ items }) => <KeyValue items={items} />,
	Timeline: ({ items }) => <Timeline items={items} />,
	Checklist: ({ items }) => <Checklist items={items} />,
	List: ({ children }, { renderChildren }) => (
		<div className="zai-s-list">{renderChildren(children)}</div>
	),
	Divider: () => <hr className="zai-s-divider" />,
	Button: ({ child, action, variant, checks }, { scope, labelOf }) => (
		<ActionButton
			label={labelOf(child)}
			action={action}
			variant={variant}
			checks={checks}
			scope={scope}
		/>
	),
	TextField: ({ label, value, variant }, { scope, setValue }) => (
		<TextInputField
			label={label}
			pointer={value.path}
			scope={scope}
			multiline={variant === "longText"}
			onChange={(next) => setValue(value.path, next)}
		/>
	),
	CheckBox: ({ label, value }, { scope, setValue }) => (
		<CheckField
			label={label}
			pointer={value.path}
			scope={scope}
			onChange={(next) => setValue(value.path, next)}
		/>
	),
	ChoicePicker: ({ options, value, variant }, { scope, setValue }) => (
		<ChoiceField
			options={options}
			pointer={value.path}
			scope={scope}
			multiple={variant === "multiple"}
			onChange={(next) => setValue(value.path, next)}
		/>
	),
	Icon: ({ name, color }) => {
		const Glyph = ICONS[name];
		return (
			<Glyph
				size={14}
				aria-hidden="true"
				className={`zai-s-icon${color ? " zai-s-icon-accent" : ""}`}
				style={accentStyle(color)}
			/>
		);
	},
	Stat: widgetRenderer("stat"),
	Chart: widgetRenderer("chart"),
	Table: widgetRenderer("table"),
	Carousel: widgetRenderer("carousel"),
	Diagram: widgetRenderer("mermaid")
};

interface A2uiSurfaceProps {
	surface: ValidSurface;
}

/**
 * Draws one surface: the component tree from `root`, bound to the surface's
 * data model. The tree was checked when it was read (see readSurfaces), so this
 * only draws; a component that still throws is caught by its block boundary.
 */
export function A2uiSurface({ surface }: A2uiSurfaceProps) {
	// Inputs edit a local copy of the data model; it reaches the assistant only
	// when a button's action reads it.
	const [model, setModel] = useState<Json>(surface.dataModel);
	const rootScope: BindingScope = { model };

	const labelOf = (id: string): string => {
		const component = surface.components[id];
		if (component?.component !== "Text") return "Button";
		return textOf(resolveDynamic(component.text, { model }));
	};

	const renderNode = (id: string, scope: BindingScope, key: string): ReactNode => {
		const component = surface.components[id];
		if (!component) return null;
		const render = RENDERERS[component.component] as (
			props: Record<string, unknown>,
			helpers: Helpers
		) => ReactNode;
		const helpers: Helpers = {
			scope,
			setValue: (pointer, value) => setModel((current) => setAtPointer(current, pointer, value)),
			labelOf,
			renderChild: (childId, childScope = scope) => renderNode(childId, childScope, childId),
			renderChildren: (children) => renderChildList(children, scope)
		};
		return (
			<div key={key} className="zai-s-node">
				{render(component, helpers)}
			</div>
		);
	};

	const renderChildList = (children: unknown, scope: BindingScope): ReactNode => {
		if (Array.isArray(children)) {
			return children.map((childId) => renderNode(String(childId), scope, String(childId)));
		}
		const { path, componentId } = (children ?? {}) as {
			path?: string;
			componentId?: string;
		};
		if (!path || !componentId || !path.startsWith("/")) return null;
		const items = getAtPointer(scope.model, path);
		if (!Array.isArray(items)) return null;
		return items
			.slice(0, MAX_TEMPLATE_ITEMS)
			.map((_item, index) =>
				renderNode(
					componentId,
					{ model: scope.model, itemPath: `${path}/${index}` },
					`${componentId}:${index}`
				)
			);
	};

	return <div className="zai-surface">{renderNode("root", rootScope, "root")}</div>;
}
