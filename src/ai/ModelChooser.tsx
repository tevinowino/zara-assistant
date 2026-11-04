import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Search, Zap } from "lucide-react";
import {
	aiGetModelControls,
	aiGetSettings,
	aiListModels,
	aiSetModelTuning,
	saveAiSetting
} from "./api";
import { fastSettings, isFast, withFast } from "./lib/fastPreset";
import {
	AI_PROVIDER_SETTING,
	aiSettingKeys,
	readinessOf,
	shortName,
	type AiSettingsView,
	type ControlInfo,
	type ProviderId,
	type ProviderInfo,
	type TuningValues
} from "./providers";
import { ProviderLogo } from "../settings/ProviderLogo";

/** How many of a service's models are drawn at once; the rest are reached by searching. */
const MODELS_SHOWN_PER_SERVICE = 60;

/** "google/gemma-4-31b-it" reads as "gemma-4-31b-it": the service is named beside it. */
function modelLabel(model: string): string {
	return model.split("/").pop() || model;
}

// ---- a chip that opens a menu upward ---------------------------------------

interface ChipMenuProps {
	/** What the chip is, for assistive technology. */
	label: string;
	/** What the chip shows. */
	chip: ReactNode;
	width: number;
	/** Called when the menu is about to open. */
	onOpen?: () => void;
	children: (close: () => void) => ReactNode;
}

/**
 * A small button in the composer that opens a menu above it (the composer sits at
 * the bottom of the panel). The menu never grows taller than the room above the
 * chip, so it cannot run off the top of the notch.
 */
function ChipMenu({ label, chip, width, onOpen, children }: ChipMenuProps) {
	const menuId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [room, setRoom] = useState(260);

	useEffect(() => {
		if (!open) return;
		const closeOnOutsidePress = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", closeOnOutsidePress);
		return () => document.removeEventListener("mousedown", closeOnOutsidePress);
	}, [open]);

	const close = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);

	const toggle = () => {
		if (!open) {
			const top = triggerRef.current?.getBoundingClientRect().top ?? 300;
			setRoom(Math.max(120, Math.min(320, top - 12)));
			onOpen?.();
		}
		setOpen(!open);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const items = Array.from(
			event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')
		);
		if (items.length === 0) return;
		event.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const step = event.key === "ArrowDown" ? 1 : -1;
		items[(at + step + items.length) % items.length].focus();
	};

	return (
		<div className="zai-chip-wrap" ref={rootRef} onKeyDown={handleKeyDown}>
			<button
				ref={triggerRef}
				type="button"
				className="zai-chip"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={label}
				onClick={toggle}
			>
				{chip}
			</button>
			{open && (
				<div
					id={menuId}
					className="zai-chip-menu"
					role="menu"
					aria-label={label}
					style={{ width, maxHeight: room }}
				>
					{children(close)}
				</div>
			)}
		</div>
	);
}

// ---- the chooser -------------------------------------------------------------

type ModelList = { status: "loading" | "ready" | "error"; ids: string[] };

interface ModelChooserProps {
	/** Told after another service or model was chosen, so the panel can check that it can answer. */
	onChanged: () => void;
}

/**
 * The two controls that sit by the send button: which model answers (from any
 * service that is ready, searchable) and how hard it thinks. Both change the
 * same settings as the Settings screen, so there is no need to go there to switch.
 * Nothing shows until the settings have been read, or if they cannot be.
 */
export function ModelChooser({ onChanged }: ModelChooserProps) {
	const [view, setView] = useState<AiSettingsView | null>(null);
	const [controls, setControls] = useState<ControlInfo[]>([]);

	const load = useCallback(() => {
		aiGetSettings()
			.then(setView)
			.catch(() => setView(null));
	}, []);
	useEffect(load, [load]);

	const current = view?.providers.find((service) => service.id === view.provider);
	const currentId = current?.id;
	const currentModel = current?.model;

	// What the model in use accepts, asked for as soon as it is known and whenever it changes.
	useEffect(() => {
		if (!currentId || !currentModel) return;
		let cancelled = false;
		aiGetModelControls(currentId, currentModel)
			.then((list) => !cancelled && setControls(list))
			.catch(() => !cancelled && setControls([]));
		return () => {
			cancelled = true;
		};
	}, [currentId, currentModel]);

	if (!view || !current) return null;

	const choose = async (service: ProviderInfo, model: string) => {
		try {
			if (service.id !== view.provider) await saveAiSetting(AI_PROVIDER_SETTING, service.id);
			if (model !== service.model) await saveAiSetting(aiSettingKeys(service.id).model, model);
		} catch {
			return;
		}
		setView({
			...view,
			provider: service.id,
			providers: view.providers.map((other) =>
				other.id === service.id ? { ...other, model } : other
			)
		});
		onChanged();
	};

	const saveValues = async (next: TuningValues) => {
		try {
			await aiSetModelTuning(current.id, current.model, next);
		} catch {
			return;
		}
		setView({
			...view,
			providers: view.providers.map((other) =>
				other.id === current.id
					? { ...other, tuning: { ...other.tuning, [current.model]: next } }
					: other
			)
		});
	};

	return (
		<>
			<ModelMenu view={view} current={current} onOpen={load} onChoose={choose} />
			<ThinkingMenu
				controls={controls}
				values={current.tuning[current.model] ?? {}}
				onChange={saveValues}
			/>
		</>
	);
}

// ---- which model ---------------------------------------------------------------

interface ModelMenuProps {
	view: AiSettingsView;
	current: ProviderInfo;
	onOpen: () => void;
	onChoose: (service: ProviderInfo, model: string) => Promise<void>;
}

function ModelMenu({ view, current, onOpen, onChoose }: ModelMenuProps) {
	return (
		<ChipMenu
			label={`Model: ${modelLabel(current.model)}, ${shortName(current)}`}
			width={300}
			onOpen={onOpen}
			chip={
				<>
					<ProviderLogo provider={current.id} size={13} />
					<span className="zai-chip-text">
						{modelLabel(current.model)}
						<span className="zai-chip-quiet">{` · ${shortName(current)}`}</span>
					</span>
					<ChevronDown size={12} aria-hidden="true" />
				</>
			}
		>
			{(close) => (
				<ModelMenuBody
					view={view}
					current={current}
					onChoose={async (service, model) => {
						await onChoose(service, model);
						close();
					}}
				/>
			)}
		</ChipMenu>
	);
}

interface ModelMenuBodyProps {
	view: AiSettingsView;
	current: ProviderInfo;
	onChoose: (service: ProviderInfo, model: string) => Promise<void>;
}

/** A search box, then each ready service as a fold-out list of its models. */
function ModelMenuBody({ view, current, onChoose }: ModelMenuBodyProps) {
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<ProviderId>>(new Set([current.id]));
	const [lists, setLists] = useState<Partial<Record<ProviderId, ModelList>>>({});
	const searchRef = useRef<HTMLInputElement>(null);
	const requested = useRef(new Set<ProviderId>());

	const ready = useMemo(
		() => view.providers.filter((service) => readinessOf(service) === "ready"),
		[view.providers]
	);
	const needle = query.trim().toLowerCase();
	const searching = needle !== "";

	useEffect(() => searchRef.current?.focus(), []);

	const loadList = useCallback((id: ProviderId) => {
		if (requested.current.has(id)) return;
		requested.current.add(id);
		setLists((previous) => ({ ...previous, [id]: { status: "loading", ids: [] } }));
		aiListModels(id)
			.then((ids) => setLists((previous) => ({ ...previous, [id]: { status: "ready", ids } })))
			.catch(() => setLists((previous) => ({ ...previous, [id]: { status: "error", ids: [] } })));
	}, []);

	// The full list of a service is fetched when it is opened, or for every service when searching.
	useEffect(() => {
		const wanted = searching ? ready.map((service) => service.id) : [...expanded];
		for (const id of wanted) loadList(id);
	}, [searching, expanded, ready, loadList]);

	const modelsOf = (service: ProviderInfo): string[] => {
		const loaded = lists[service.id]?.ids ?? [];
		const all = [service.model, ...service.suggestedModels, ...loaded];
		return Array.from(new Set(all.filter((model) => model.trim() !== "")));
	};

	const toggle = (id: ProviderId) =>
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const groups = ready
		.map((service) => {
			const all = modelsOf(service);
			const matching = searching
				? all.filter((model) => model.toLowerCase().includes(needle))
				: all;
			return { service, all, matching };
		})
		.filter((group) => !searching || group.matching.length > 0);

	return (
		<>
			<div className="zai-chip-search">
				<Search size={13} aria-hidden="true" />
				<input
					ref={searchRef}
					type="text"
					role="searchbox"
					aria-label="Search models"
					placeholder="Search models"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					autoComplete="off"
					spellCheck={false}
				/>
			</div>
			<div className="zai-chip-list">
				{groups.map(({ service, all, matching }) => {
					const open = searching || expanded.has(service.id);
					const shown = matching.slice(0, MODELS_SHOWN_PER_SERVICE);
					return (
						<div key={service.id} className="zai-chip-group">
							<button
								type="button"
								className="zai-chip-group-head"
								aria-expanded={open}
								onClick={() => toggle(service.id)}
							>
								<ProviderLogo provider={service.id} size={14} />
								<span className="zai-chip-group-name">{shortName(service)}</span>
								<span className="zai-chip-count">{all.length}</span>
								<ChevronRight size={12} aria-hidden="true" className="zai-chip-fold" />
							</button>
							{open && (
								<div role="group" aria-label={`${shortName(service)} models`}>
									{shown.map((model) => {
										const selected = service.id === current.id && model === current.model;
										return (
											<button
												key={model}
												type="button"
												role="menuitemradio"
												aria-checked={selected}
												className="zai-chip-item"
												onClick={() => void onChoose(service, model)}
											>
												<span className="zai-chip-item-name">{model}</span>
												{selected && <Check size={13} aria-hidden="true" />}
											</button>
										);
									})}
									{matching.length > shown.length && (
										<p className="zai-chip-note">
											{`Showing ${shown.length} of ${matching.length}. Search to find the rest.`}
										</p>
									)}
									{lists[service.id]?.status === "loading" && (
										<p className="zai-chip-note">Loading models…</p>
									)}
								</div>
							)}
						</div>
					);
				})}
				{searching && groups.length === 0 && <p className="zai-chip-note">No models match.</p>}
				<p className="zai-chip-note">Add more services in Settings.</p>
			</div>
		</>
	);
}

// ---- how hard it thinks ---------------------------------------------------------

interface ThinkingMenuProps {
	controls: ControlInfo[];
	values: TuningValues;
	onChange: (values: TuningValues) => Promise<void>;
}

/**
 * How hard the model thinks, as one dropdown. It is the model's main thinking
 * setting (its effort or level), whatever its service calls it, plus the Fast
 * preset. A model with no thinking setting has no chip.
 */
function ThinkingMenu({ controls, values, onChange }: ThinkingMenuProps) {
	const primary = controls.find(
		(control): control is Extract<ControlInfo, { type: "choice" }> =>
			control.group === "reasoning" && control.type === "choice"
	);
	if (!primary) return null;

	const canGoFast = Object.keys(fastSettings(controls)).length > 0;
	const fastIsOn = canGoFast && isFast(controls, values);
	const chosen = values[primary.id];
	const chosenLabel = primary.choices.find((choice) => choice.value === chosen)?.label;
	const defaultLabel = primary.choices.find((choice) => choice.value === primary.fallback)?.label;
	const chipLabel = fastIsOn ? "Fast" : (chosenLabel ?? defaultLabel ?? "Auto");

	const set = (value: string | undefined) => {
		const next = { ...values };
		if (value === undefined) delete next[primary.id];
		else next[primary.id] = value;
		return onChange(next);
	};

	return (
		<ChipMenu
			label={`${primary.label}: ${chipLabel}`}
			width={230}
			chip={
				<>
					<Zap size={13} aria-hidden="true" className="zai-chip-bolt" />
					<span className="zai-chip-text">{chipLabel}</span>
					<ChevronDown size={12} aria-hidden="true" />
				</>
			}
		>
			{(close) => (
				<div className="zai-chip-list">
					<p className="zai-chip-title">{primary.label}</p>
					{[{ value: undefined, label: "Default" }, ...primary.choices].map((choice) => (
						<button
							key={choice.value ?? "default"}
							type="button"
							role="menuitemradio"
							aria-checked={!fastIsOn && choice.value === chosen}
							className="zai-chip-item"
							onClick={() => void set(choice.value).then(close)}
						>
							<span className="zai-chip-item-name">{choice.label}</span>
							{!fastIsOn && choice.value === chosen && <Check size={13} aria-hidden="true" />}
						</button>
					))}
					{canGoFast && (
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={fastIsOn}
							className="zai-chip-item zai-chip-fast"
							onClick={() => void onChange(withFast(controls, values, !fastIsOn)).then(close)}
						>
							<span className="zai-chip-item-text">
								<span className="zai-chip-item-name">Fast</span>
								<span className="zai-chip-item-sub">Thinks as little as the model allows</span>
							</span>
							{fastIsOn && <Check size={13} aria-hidden="true" />}
						</button>
					)}
				</div>
			)}
		</ChipMenu>
	);
}
