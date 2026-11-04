import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronsUpDown, RotateCw, Search } from "../icons/glyphs";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ModelPickerProps {
	/** The accessible name of the picker, such as "Model" or "Backup model". */
	label: string;
	/** The model chosen; empty for no choice. */
	value: string;
	/** Models the app suggests for this service. Always listed. */
	suggested: string[];
	/** Models the service itself reports, added after the suggestions. */
	available: string[];
	/** Whether the service's own list is still loading, loaded, or could not be loaded. */
	status: LoadStatus;
	/** Shown on the button when nothing is chosen and no "none" choice exists. */
	placeholder: string;
	/** When given, a first choice with this name that clears the model (for an optional model). */
	noneLabel?: string;
	onChange: (model: string) => void;
	/** Asked to load the service's list again after a failure. */
	onReload?: () => void;
}

type Choice =
	| { kind: "none"; key: string }
	| { kind: "model"; key: string; model: string }
	| { kind: "custom"; key: string; model: string };

/**
 * A dropdown of every model, with a search box. It lists the suggestions and
 * whatever the service reports, always in full when opened: nothing is filtered
 * until the user types. A name that is in neither list can still be used.
 */
export function ModelPicker({
	label,
	value,
	suggested,
	available,
	status,
	placeholder,
	noneLabel,
	onChange,
	onReload
}: ModelPickerProps) {
	const id = useId();
	const listId = `${id}-list`;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	const suggestedModels = useMemo(() => Array.from(new Set(suggested)), [suggested]);
	const otherModels = useMemo(
		() => Array.from(new Set(available)).filter((model) => !suggestedModels.includes(model)),
		[available, suggestedModels]
	);
	const totalModels = suggestedModels.length + otherModels.length;

	const needle = query.trim().toLowerCase();
	const matches = (model: string) => needle === "" || model.toLowerCase().includes(needle);
	const shownSuggested = suggestedModels.filter(matches);
	const shownOthers = otherModels.filter(matches);
	const typed = query.trim();
	const offersCustom = typed !== "" && ![...suggestedModels, ...otherModels].includes(typed);

	// Every choice in the order it is shown, so the arrow keys can walk them.
	const choices: Choice[] = [
		...(noneLabel && needle === "" ? [{ kind: "none", key: "none" } as Choice] : []),
		...shownSuggested.map((model): Choice => ({ kind: "model", key: `s:${model}`, model })),
		...shownOthers.map((model): Choice => ({ kind: "model", key: `a:${model}`, model })),
		...(offersCustom ? [{ kind: "custom", key: "custom", model: typed } as Choice] : [])
	];
	const optionId = (choice: Choice) => `${id}-${choice.key}`;
	const active = choices[Math.min(activeIndex, choices.length - 1)];

	const openList = () => {
		const chosen = choices.findIndex((choice) => choice.kind === "model" && choice.model === value);
		setActiveIndex(Math.max(0, chosen));
		setQuery("");
		setOpen(true);
	};

	const close = (returnFocus: boolean) => {
		setOpen(false);
		setQuery("");
		if (returnFocus) triggerRef.current?.focus();
	};

	const choose = (choice: Choice) => {
		onChange(choice.kind === "none" ? "" : choice.model);
		close(true);
	};

	useEffect(() => {
		if (open) searchRef.current?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const closeOnOutsidePress = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) close(false);
		};
		document.addEventListener("mousedown", closeOnOutsidePress);
		return () => document.removeEventListener("mousedown", closeOnOutsidePress);
	}, [open]);

	useEffect(() => {
		if (!open || !active) return;
		document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
		// optionId is derived from the active choice and the component id only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, active?.key]);

	const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) openList();
		}
	};

	const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) => Math.min(index + 1, choices.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) => Math.max(index - 1, 0));
		} else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
			event.preventDefault();
			if (active) choose(active);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		}
	};

	const buttonText = value !== "" ? value : (noneLabel ?? placeholder);

	const renderChoice = (choice: Choice) => {
		const isActive = choice === active;
		const selected =
			choice.kind === "none" ? value === "" : choice.kind === "model" && choice.model === value;
		const text =
			choice.kind === "none"
				? (noneLabel ?? "")
				: choice.kind === "custom"
					? `Use “${choice.model}”`
					: choice.model;
		return (
			<div
				key={choice.key}
				id={optionId(choice)}
				role="option"
				aria-selected={selected}
				className={`model-option${isActive ? " is-active" : ""}${choice.kind === "custom" ? " is-custom" : ""}`}
				onMouseMove={() => setActiveIndex(choices.indexOf(choice))}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => choose(choice)}
			>
				<span className="model-option-text">{text}</span>
				{selected && <Check size={13} aria-hidden="true" className="model-option-check" />}
			</div>
		);
	};

	const noneChoice = choices.find((choice) => choice.kind === "none");
	const customChoice = choices.find((choice) => choice.kind === "custom");
	const suggestedHeading =
		otherModels.length > 0 || status === "loading" ? "Suggested" : "Suggested";

	return (
		<div className="model-picker" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className={`model-trigger${value === "" && !noneLabel ? " is-empty" : ""}`}
				role="combobox"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				onClick={() => (open ? close(false) : openList())}
				onKeyDown={handleTriggerKeyDown}
			>
				<span className="model-trigger-text">{buttonText}</span>
				<ChevronsUpDown size={13} aria-hidden="true" className="model-trigger-icon" />
			</button>

			{open && (
				<div className="model-popover">
					<div className="model-search">
						<Search size={13} aria-hidden="true" />
						<input
							ref={searchRef}
							type="text"
							role="searchbox"
							aria-label="Search models"
							aria-controls={listId}
							aria-activedescendant={active ? optionId(active) : undefined}
							value={query}
							placeholder="Search models"
							onChange={(event) => {
								setQuery(event.target.value);
								setActiveIndex(0);
							}}
							onKeyDown={handleSearchKeyDown}
							autoComplete="off"
							spellCheck={false}
						/>
					</div>

					<div id={listId} role="listbox" aria-label={label} className="model-list">
						{noneChoice && renderChoice(noneChoice)}
						{shownSuggested.length > 0 && (
							<div role="group" aria-label={suggestedHeading} className="model-group">
								<div className="model-group-title" aria-hidden="true">
									{suggestedHeading}
								</div>
								{choices
									.filter((choice) => choice.kind === "model" && choice.key.startsWith("s:"))
									.map(renderChoice)}
							</div>
						)}
						{shownOthers.length > 0 && (
							<div role="group" aria-label="All models" className="model-group">
								<div className="model-group-title" aria-hidden="true">
									All models
								</div>
								{choices
									.filter((choice) => choice.kind === "model" && choice.key.startsWith("a:"))
									.map(renderChoice)}
							</div>
						)}
						{customChoice && renderChoice(customChoice)}
						{totalModels === 0 && typed === "" && (
							<p className="model-empty">No models listed. Type a model name.</p>
						)}
					</div>

					<div className="model-footer">
						{status === "loading" && <span>Loading models…</span>}
						{status === "ready" && totalModels > 0 && <span>{`${totalModels} models`}</span>}
						{status === "error" && (
							<>
								<span>Couldn't load the full list.</span>
								{onReload && (
									<button type="button" className="model-retry" onClick={onReload}>
										<RotateCw size={11} aria-hidden="true" />
										Try again
									</button>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
