import { useEffect, useId, useState } from "react";
import { ChevronRight, SlidersHorizontal, Zap } from "../icons/glyphs";
import { aiGetModelControls, aiSetModelTuning, toAiError } from "../ai/api";
import type { ControlInfo, ProviderId, TuningValue, TuningValues } from "../ai/providers";
import { fastSettings, isFast, withFast } from "../ai/lib/fastPreset";
import { SettingRow } from "./SettingRow";

const GROUP_TITLES: Record<ControlInfo["group"], string> = {
	reasoning: "Thinking",
	sampling: "Creativity",
	output: "Length",
	advanced: "Advanced"
};
const GROUP_ORDER: ControlInfo["group"][] = ["reasoning", "sampling", "output", "advanced"];

interface ModelTuningProps {
	/** What this is for, such as "Model settings" or "Backup model settings". */
	label: string;
	provider: ProviderId;
	/** The model whose settings these are; empty when none is chosen, and nothing is shown. */
	model: string;
	/** What is saved for the model now. */
	saved: TuningValues;
	/** Told the model's settings after they are saved. */
	onSaved: (values: TuningValues) => void;
	/** This is the last row of its group, so no line is drawn under it. */
	last?: boolean;
}

/**
 * The settings a model accepts: how hard it thinks, how random it is, how long
 * it may talk and anything else its service takes. The service says which apply
 * to the model, and what each can be set to; nothing is sent to the service
 * unless it was changed here, so "Default" always means the service's own choice.
 * Remembered per model.
 */
export function ModelTuning({
	label,
	provider,
	model,
	saved,
	onSaved,
	last = false
}: ModelTuningProps) {
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const [controls, setControls] = useState<ControlInfo[] | null>(null);
	const [values, setValues] = useState<TuningValues>(saved);
	const [problem, setProblem] = useState<string | null>(null);

	// The list of settings is asked for when the panel is first opened, and again for another model.
	useEffect(() => {
		if (!open || model === "") return;
		let cancelled = false;
		setControls(null);
		aiGetModelControls(provider, model)
			.then((list) => !cancelled && setControls(list))
			.catch((error) => {
				if (cancelled) return;
				setControls([]);
				setProblem(toAiError(error).message);
			});
		return () => {
			cancelled = true;
		};
	}, [open, provider, model]);

	if (model === "") return null;

	const changedCount = Object.keys(values).length;

	const store = async (next: TuningValues) => {
		const before = values;
		setValues(next);
		setProblem(null);
		try {
			await aiSetModelTuning(provider, model, next);
			onSaved(next);
		} catch (error) {
			setValues(before);
			setProblem(toAiError(error).message);
		}
	};

	const set = (id: string, value: TuningValue | undefined) => {
		const next = { ...values };
		if (value === undefined) delete next[id];
		else next[id] = value;
		void store(next);
	};

	const summary =
		changedCount === 0
			? `Thinking, creativity and length for ${model}. Nothing changed from the defaults.`
			: `${changedCount} ${changedCount === 1 ? "setting" : "settings"} changed for ${model}.`;

	return (
		<>
			<SettingRow icon={SlidersHorizontal} label={label} desc={summary} divider={!open && !last}>
				<button
					type="button"
					className="settings-button quiet tuning-toggle"
					aria-expanded={open}
					aria-controls={open ? panelId : undefined}
					aria-label={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
					onClick={() => setOpen(!open)}
				>
					{open ? "Done" : "Customize"}
					<ChevronRight size={13} aria-hidden="true" className="tuning-arrow" />
				</button>
			</SettingRow>

			{open && (
				<>
					<div id={panelId} className="tuning-panel" role="group" aria-label={label}>
						{controls === null && <p className="tuning-note">Loading settings…</p>}
						{controls !== null && controls.length === 0 && (
							<p className="tuning-note">This model has no settings to change.</p>
						)}
						{controls !== null && Object.keys(fastSettings(controls)).length > 0 && (
							<div className="tuning-preset">
								<button
									type="button"
									className="tuning-choice tuning-preset-button"
									aria-pressed={isFast(controls, values)}
									onClick={() => void store(withFast(controls, values, !isFast(controls, values)))}
								>
									<Zap size={12} aria-hidden="true" />
									Fast
								</button>
								<span className="tuning-field-help">
									Turns thinking down so answers come sooner. Your other settings stay as they are.
								</span>
							</div>
						)}
						{controls !== null &&
							GROUP_ORDER.map((group) => {
								const inGroup = controls.filter((control) => control.group === group);
								if (inGroup.length === 0) return null;
								return (
									<div key={group} className="tuning-group">
										<h4 className="tuning-group-title">{GROUP_TITLES[group]}</h4>
										{inGroup.map((control) => (
											<ControlField
												key={control.id}
												control={control}
												value={values[control.id]}
												onChange={(value) => set(control.id, value)}
											/>
										))}
									</div>
								);
							})}
						{problem && (
							<p className="settings-note problem" role="alert">
								{problem}
							</p>
						)}
						{changedCount > 0 && (
							<button
								type="button"
								className="settings-button quiet tuning-reset"
								onClick={() => void store({})}
							>
								Reset to defaults
							</button>
						)}
					</div>
					{!last && <div className="setting-divider" />}
				</>
			)}
		</>
	);
}

interface ControlFieldProps {
	control: ControlInfo;
	value: TuningValue | undefined;
	onChange: (value: TuningValue | undefined) => void;
}

/** One setting: its name and help, and the control that suits what it takes. */
function ControlField({ control, value, onChange }: ControlFieldProps) {
	const helpId = useId();
	return (
		<div className="tuning-field">
			<div className="tuning-field-text">
				<span className="tuning-field-label">{control.label}</span>
				<span id={helpId} className="tuning-field-help">
					{control.help}
				</span>
			</div>
			<div className="tuning-field-input">
				{control.type === "choice" && (
					<Choices
						label={control.label}
						helpId={helpId}
						options={control.choices}
						fallbackValue={control.fallback}
						value={typeof value === "string" ? value : undefined}
						onChange={onChange}
					/>
				)}
				{control.type === "toggle" && (
					<Choices
						label={control.label}
						helpId={helpId}
						options={[
							{ value: "true", label: "On" },
							{ value: "false", label: "Off" }
						]}
						fallbackValue={null}
						value={typeof value === "boolean" ? String(value) : undefined}
						onChange={(chosen) => onChange(chosen === undefined ? undefined : chosen === "true")}
					/>
				)}
				{control.type === "number" && (
					<NumberInput
						label={control.label}
						helpId={helpId}
						min={control.min}
						max={control.max}
						step={control.step}
						whole={control.whole}
						value={typeof value === "number" ? value : undefined}
						onChange={onChange}
					/>
				)}
				{control.type === "json" && (
					<JsonInput
						label={control.label}
						helpId={helpId}
						value={typeof value === "string" ? value : ""}
						onChange={onChange}
					/>
				)}
			</div>
		</div>
	);
}

interface ChoicesProps {
	label: string;
	helpId: string;
	options: { value: string; label: string }[];
	/** The value used when nothing is chosen, shown on the Default choice. */
	fallbackValue: string | null;
	value: string | undefined;
	onChange: (value: string | undefined) => void;
}

/** The values to pick from, with "Default" first: picking it takes the setting back out. */
function Choices({ label, helpId, options, fallbackValue, value, onChange }: ChoicesProps) {
	const fallbackLabel = options.find((option) => option.value === fallbackValue)?.label;
	const defaultLabel = fallbackLabel ? `Default (${fallbackLabel})` : "Default";
	const all = [{ value: undefined, label: defaultLabel }, ...options];
	return (
		<div className="tuning-choices" role="radiogroup" aria-label={label} aria-describedby={helpId}>
			{all.map((option) => (
				<button
					key={option.value ?? "default"}
					type="button"
					role="radio"
					aria-checked={option.value === value}
					className="tuning-choice"
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

interface NumberInputProps {
	label: string;
	helpId: string;
	min: number;
	max: number;
	step: number;
	whole: boolean;
	value: number | undefined;
	onChange: (value: number | undefined) => void;
}

/** A number kept as typed until it is committed (on leaving the field or Enter); empty means the default. */
function NumberInput({ label, helpId, min, max, step, whole, value, onChange }: NumberInputProps) {
	const [draft, setDraft] = useState(value === undefined ? "" : String(value));

	const commit = () => {
		const text = draft.trim();
		if (text === "") {
			if (value !== undefined) onChange(undefined);
			return;
		}
		const parsed = Number(text);
		if (!Number.isFinite(parsed)) {
			setDraft(value === undefined ? "" : String(value));
			return;
		}
		const kept = Math.min(max, Math.max(min, whole ? Math.round(parsed) : parsed));
		setDraft(String(kept));
		if (kept !== value) onChange(kept);
	};

	return (
		<input
			type="number"
			className="settings-input tuning-number"
			value={draft}
			min={min}
			max={max}
			step={step}
			placeholder="Default"
			aria-label={label}
			aria-describedby={helpId}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
			}}
		/>
	);
}

interface JsonInputProps {
	label: string;
	helpId: string;
	value: string;
	onChange: (value: string | undefined) => void;
}

/** A JSON object, checked when the field is left; an empty field takes the setting back out. */
function JsonInput({ label, helpId, value, onChange }: JsonInputProps) {
	const [draft, setDraft] = useState(value);
	const [invalid, setInvalid] = useState(false);

	const commit = () => {
		const text = draft.trim();
		if (text === "") {
			setInvalid(false);
			if (value !== "") onChange(undefined);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
		const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
		if (!isObject || Object.keys(parsed as object).length === 0) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		if (text !== value) onChange(text);
	};

	return (
		<>
			<textarea
				className="settings-input tuning-json"
				value={draft}
				rows={3}
				placeholder={'{"chat_template_kwargs": {"enable_thinking": false}}'}
				aria-label={label}
				aria-describedby={helpId}
				aria-invalid={invalid}
				spellCheck={false}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
			/>
			{invalid && (
				<span className="tuning-invalid" role="alert">
					That is not a JSON object, such as {`{"key": "value"}`}. It was not saved.
				</span>
			)}
		</>
	);
}
