import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelTuning } from "./ModelTuning";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import type { ControlInfo, TuningValues } from "../ai/providers";

const groqQwenControls: ControlInfo[] = [
	{
		id: "effort",
		label: "Reasoning effort",
		help: "How hard the model thinks before it answers.",
		group: "reasoning",
		fallback: null,
		fast: "none",
		type: "choice",
		choices: [
			{ value: "none", label: "Off" },
			{ value: "low", label: "Low" },
			{ value: "high", label: "High" }
		]
	},
	{
		id: "reasoning_format",
		label: "Where reasoning goes",
		help: "Separate keeps thinking out of the answer.",
		group: "reasoning",
		fallback: "parsed",
		fast: null,
		type: "choice",
		choices: [
			{ value: "parsed", label: "Separate" },
			{ value: "hidden", label: "Hidden" }
		]
	},
	{
		id: "include_reasoning",
		label: "Send reasoning back",
		help: "Off still thinks.",
		group: "reasoning",
		fallback: null,
		fast: null,
		type: "toggle"
	},
	{
		id: "temperature",
		label: "Temperature",
		help: "Lower is more focused.",
		group: "sampling",
		fallback: null,
		fast: null,
		type: "number",
		min: 0,
		max: 2,
		step: 0.05,
		whole: false
	},
	{
		id: "max_tokens",
		label: "Longest answer",
		help: "The most tokens a reply may use.",
		group: "output",
		fallback: null,
		fast: null,
		type: "number",
		min: 16,
		max: 200000,
		step: 1,
		whole: true
	},
	{
		id: "extra",
		label: "Extra request fields",
		help: "Anything else, as JSON.",
		group: "advanced",
		fallback: null,
		fast: null,
		type: "json"
	}
];

function renderTuning(saved: TuningValues = {}, controls: ControlInfo[] = groqQwenControls) {
	const onSaved = vi.fn();
	setInvokeHandler("ai_get_model_controls", () => controls);
	setInvokeHandler("ai_set_model_tuning", () => null);
	render(
		<ModelTuning
			label="Model settings"
			provider="groq"
			model="qwen/qwen3.8-27b"
			saved={saved}
			onSaved={onSaved}
		/>
	);
	return { onSaved };
}

const savedCalls = () => invokeCalls.filter((call) => call.command === "ai_set_model_tuning");

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Show model settings" }));
	await screen.findByRole("group", { name: "Model settings" });
}

describe("ModelTuning folding", () => {
	it("starts folded and says nothing has been changed", () => {
		renderTuning();

		expect(screen.getByRole("button", { name: "Show model settings" })).toHaveAttribute(
			"aria-expanded",
			"false"
		);
		expect(screen.getByText(/Nothing changed from the defaults/)).toBeInTheDocument();
		expect(screen.queryByRole("group", { name: "Model settings" })).not.toBeInTheDocument();
	});

	it("counts the settings that were changed", () => {
		renderTuning({ effort: "high", temperature: 0.4 });

		expect(screen.getByText("2 settings changed for qwen/qwen3.8-27b.")).toBeInTheDocument();
	});

	it("shows nothing at all when no model is chosen", () => {
		const { container } = render(
			<ModelTuning label="Model settings" provider="groq" model="" saved={{}} onSaved={vi.fn()} />
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("asks the backend for the settings of the model when opened, not before", async () => {
		renderTuning();
		const user = userEvent.setup();
		expect(invokeCalls.some((call) => call.command === "ai_get_model_controls")).toBe(false);

		await openPanel(user);

		const asked = invokeCalls.find((call) => call.command === "ai_get_model_controls");
		expect(asked?.args).toEqual({ provider: "groq", model: "qwen/qwen3.8-27b" });
	});

	it("says so when the model has no settings", async () => {
		renderTuning({}, []);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Show model settings" }));

		expect(await screen.findByText("This model has no settings to change.")).toBeInTheDocument();
	});
});

describe("ModelTuning choices", () => {
	it("offers each value the model takes, with Default first and chosen", async () => {
		renderTuning();
		const user = userEvent.setup();

		await openPanel(user);

		const effort = screen.getByRole("radiogroup", { name: "Reasoning effort" });
		const labels = within(effort)
			.getAllByRole("radio")
			.map((option) => option.textContent);
		expect(labels).toEqual(["Default", "Off", "Low", "High"]);
		expect(within(effort).getByRole("radio", { name: "Default" })).toBeChecked();
	});

	it("shows what Default means when the app needs a value", async () => {
		renderTuning();
		const user = userEvent.setup();

		await openPanel(user);

		const format = screen.getByRole("radiogroup", { name: "Where reasoning goes" });
		expect(within(format).getByRole("radio", { name: "Default (Separate)" })).toBeChecked();
	});

	it("saves a chosen value for this model at once", async () => {
		const { onSaved } = renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(
			within(screen.getByRole("radiogroup", { name: "Reasoning effort" })).getByRole("radio", {
				name: "High"
			})
		);

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args).toEqual({
			provider: "groq",
			model: "qwen/qwen3.8-27b",
			values: { effort: "high" }
		});
		expect(onSaved).toHaveBeenCalledWith({ effort: "high" });
	});

	it("takes a setting back to its default by choosing Default", async () => {
		renderTuning({ effort: "high", temperature: 0.4 });
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(
			within(screen.getByRole("radiogroup", { name: "Reasoning effort" })).getByRole("radio", {
				name: "Default"
			})
		);

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ temperature: 0.4 });
	});

	it("saves an on or off setting as a true or false", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(
			within(screen.getByRole("radiogroup", { name: "Send reasoning back" })).getByRole("radio", {
				name: "Off"
			})
		);

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ include_reasoning: false });
	});
});

describe("ModelTuning numbers", () => {
	it("saves a number when the field is left", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		await user.type(screen.getByRole("spinbutton", { name: "Temperature" }), "0.7");
		expect(savedCalls()).toHaveLength(0);
		await user.tab();

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ temperature: 0.7 });
	});

	it("holds a number to its range", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		await user.type(screen.getByRole("spinbutton", { name: "Temperature" }), "9");
		await user.tab();

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ temperature: 2 });
		expect(screen.getByRole("spinbutton", { name: "Temperature" })).toHaveValue(2);
	});

	it("rounds a count to a whole number", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		await user.type(screen.getByRole("spinbutton", { name: "Longest answer" }), "800.6{Enter}");

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ max_tokens: 801 });
	});

	it("takes the setting back to its default when the field is emptied", async () => {
		renderTuning({ temperature: 0.4 });
		const user = userEvent.setup();
		await openPanel(user);

		await user.clear(screen.getByRole("spinbutton", { name: "Temperature" }));
		await user.tab();

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({});
	});
});

describe("ModelTuning extra fields", () => {
	it("saves a JSON object when the field is left", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		const box = screen.getByRole("textbox", { name: "Extra request fields" });
		await user.click(box);
		await user.paste('{"chat_template_kwargs":{"enable_thinking":false}}');
		await user.tab();

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({
			extra: '{"chat_template_kwargs":{"enable_thinking":false}}'
		});
	});

	it("does not save text that is not a JSON object, and says so", async () => {
		renderTuning();
		const user = userEvent.setup();
		await openPanel(user);

		const box = screen.getByRole("textbox", { name: "Extra request fields" });
		await user.click(box);
		await user.paste("not json");
		await user.tab();

		expect(await screen.findByText(/That is not a JSON object/)).toBeInTheDocument();
		expect(savedCalls()).toHaveLength(0);
		expect(box).toHaveAttribute("aria-invalid", "true");
	});
});

describe("ModelTuning reset", () => {
	it("offers to reset only when something was changed, and clears everything", async () => {
		renderTuning({ effort: "low", temperature: 0.2 });
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({});
	});

	it("has no reset when nothing was changed", async () => {
		renderTuning();
		const user = userEvent.setup();

		await openPanel(user);

		expect(screen.queryByRole("button", { name: "Reset to defaults" })).not.toBeInTheDocument();
	});
});

describe("ModelTuning when saving fails", () => {
	it("keeps the old value and says what went wrong", async () => {
		renderTuning();
		setInvokeHandler("ai_set_model_tuning", () => {
			throw { kind: "other", message: "Could not save." };
		});
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(
			within(screen.getByRole("radiogroup", { name: "Reasoning effort" })).getByRole("radio", {
				name: "High"
			})
		);

		expect(await screen.findByRole("alert")).toHaveTextContent("Could not save.");
		expect(
			within(screen.getByRole("radiogroup", { name: "Reasoning effort" })).getByRole("radio", {
				name: "Default"
			})
		).toBeChecked();
	});
});

describe("ModelTuning Fast preset", () => {
	it("offers Fast when the model has a setting to turn down", async () => {
		renderTuning();
		const user = userEvent.setup();

		await openPanel(user);

		expect(screen.getByRole("button", { name: "Fast" })).toHaveAttribute("aria-pressed", "false");
	});

	it("turns thinking down in one press and keeps the other settings", async () => {
		const { onSaved } = renderTuning({ temperature: 0.4 });
		const user = userEvent.setup();
		await openPanel(user);

		await user.click(screen.getByRole("button", { name: "Fast" }));

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ temperature: 0.4, effort: "none" });
		expect(onSaved).toHaveBeenCalledWith({ temperature: 0.4, effort: "none" });
		expect(screen.getByRole("button", { name: "Fast" })).toHaveAttribute("aria-pressed", "true");
	});

	it("shows Fast as on when the settings already match it, and turns it off with a second press", async () => {
		renderTuning({ effort: "none", temperature: 0.4 });
		const user = userEvent.setup();
		await openPanel(user);
		const fast = screen.getByRole("button", { name: "Fast" });
		expect(fast).toHaveAttribute("aria-pressed", "true");

		await user.click(fast);

		await waitFor(() => expect(savedCalls()).toHaveLength(1));
		expect(savedCalls()[0].args?.values).toEqual({ temperature: 0.4 });
	});

	it("is not offered when the model has nothing to turn down", async () => {
		renderTuning(
			{},
			groqQwenControls.map((control) => ({ ...control, fast: null }))
		);
		const user = userEvent.setup();

		await openPanel(user);

		expect(screen.queryByRole("button", { name: "Fast" })).not.toBeInTheDocument();
	});
});
