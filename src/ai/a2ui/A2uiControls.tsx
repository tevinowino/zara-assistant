import { useContext, useEffect, useRef, useState } from "react";
import { getAtPointer, resolveDynamic, type BindingScope } from "./binding";
import { prepareFunctionAction } from "./actions";
import { SurfaceInteractionContext } from "./interaction";

/** How long a button that needs confirming stays armed after the first click. */
const CONFIRM_WINDOW_MS = 4000;
/** How long a finished button keeps showing its result. */
const RESULT_WINDOW_MS = 1800;

interface Check {
	call: string;
	args?: Record<string, unknown>;
	message: string;
}

type ButtonAction =
	| { event: { name: string; context?: Record<string, unknown> } }
	| { functionCall: { call: string; args?: Record<string, unknown> } };

interface ActionButtonProps {
	label: string;
	action: ButtonAction;
	variant?: "primary" | "borderless";
	checks?: Check[];
	scope: BindingScope;
}

function resolveRecord(record: Record<string, unknown> | undefined, scope: BindingScope) {
	return Object.fromEntries(
		Object.entries(record ?? {}).map(([key, value]) => [key, resolveDynamic(value, scope)])
	);
}

/** The first failing check's message, or null when the button may be used. */
function failedCheckMessage(checks: Check[] | undefined, scope: BindingScope): string | null {
	for (const check of checks ?? []) {
		const passed = resolveDynamic({ call: check.call, args: check.args }, scope) === true;
		if (!passed) return check.message || "Not ready yet.";
	}
	return null;
}

type ButtonPhase = "idle" | "armed" | "done" | "failed";

/**
 * A button on a surface. It does what its action says, but only on a click:
 * an `event` becomes the user's next message, a `functionCall` goes through the
 * allow-list in actions.ts, and anything that writes data asks for a second
 * click first.
 */
export function ActionButton({ label, action, variant, checks, scope }: ActionButtonProps) {
	const interaction = useContext(SurfaceInteractionContext);
	const [phase, setPhase] = useState<ButtonPhase>("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

	const settleAfter = (ms: number) => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setPhase("idle"), ms);
	};

	const checkMessage = failedCheckMessage(checks, scope);
	const prepared =
		interaction && "functionCall" in action
			? prepareFunctionAction(
					action.functionCall.call,
					resolveRecord(action.functionCall.args, scope),
					interaction.host
				)
			: null;

	let unavailable: string | null = null;
	if (!interaction) unavailable = "This isn't available here.";
	else if ("event" in action && interaction.busy) unavailable = "Zara is still answering.";
	else if (prepared?.kind === "refused") unavailable = prepared.reason;

	const disabled = checkMessage !== null || unavailable !== null;
	const hint =
		checkMessage ?? unavailable ?? (prepared?.kind === "ready" ? prepared.hint : undefined);

	const click = async () => {
		if (disabled || !interaction) return;
		if ("event" in action) {
			const context = resolveRecord(action.event.context, scope);
			const detail = Object.keys(context).length
				? `\n(${action.event.name}: ${JSON.stringify(context)})`
				: "";
			interaction.sendEvent(`${label}${detail}`);
			return;
		}
		if (prepared?.kind !== "ready") return;
		if (prepared.requiresConfirmation && phase !== "armed") {
			setPhase("armed");
			settleAfter(CONFIRM_WINDOW_MS);
			return;
		}
		try {
			await prepared.run();
			setPhase("done");
		} catch {
			setPhase("failed");
		}
		settleAfter(RESULT_WINDOW_MS);
	};

	const shownLabel = phase === "armed" ? "Click again to confirm" : label;
	return (
		<span className="zai-s-button-wrap">
			<button
				type="button"
				className={`zai-s-button zai-s-button-${variant ?? "primary"}`}
				disabled={disabled}
				title={hint}
				onClick={() => void click()}
			>
				{shownLabel}
			</button>
			<span className="zai-s-button-result" role="status">
				{phase === "done" ? "Done" : phase === "failed" ? "That didn't work" : ""}
			</span>
		</span>
	);
}

interface FieldBase {
	label: string;
	pointer: string;
	scope: BindingScope;
	onChange: (value: string | boolean | string[]) => void;
}

function asText(value: unknown): string {
	return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function TextInputField({
	label,
	pointer,
	scope,
	onChange,
	multiline
}: FieldBase & { multiline: boolean }) {
	const value = asText(getAtPointer(scope.model, pointer));
	return (
		<label className="zai-s-field">
			<span className="zai-s-field-label">{label}</span>
			{multiline ? (
				<textarea
					className="zai-s-input"
					rows={3}
					value={value}
					maxLength={2000}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : (
				<input
					className="zai-s-input"
					type="text"
					value={value}
					maxLength={500}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</label>
	);
}

export function CheckField({ label, pointer, scope, onChange }: FieldBase) {
	const checked = getAtPointer(scope.model, pointer) === true;
	return (
		<label className="zai-s-check">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>{label}</span>
		</label>
	);
}

interface ChoiceFieldProps extends Omit<FieldBase, "label"> {
	options: { label: string; value: string }[];
	multiple: boolean;
}

export function ChoiceField({ options, pointer, scope, onChange, multiple }: ChoiceFieldProps) {
	const current = getAtPointer(scope.model, pointer);
	const chosen = Array.isArray(current)
		? current.map(String)
		: current === undefined
			? []
			: [String(current)];

	const toggle = (value: string) => {
		if (!multiple) return onChange(value);
		onChange(
			chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value]
		);
	};

	return (
		<div className="zai-s-choices" role="group">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					className="zai-s-choice"
					aria-pressed={chosen.includes(option.value)}
					onClick={() => toggle(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
