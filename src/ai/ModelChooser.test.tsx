import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelChooser } from "./ModelChooser";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";
import type { AiSettingsView, ControlInfo } from "./providers";

const effortControls: ControlInfo[] = [
	{
		id: "effort",
		label: "Reasoning effort",
		help: "",
		group: "reasoning",
		fallback: null,
		fast: "low",
		type: "choice",
		choices: [
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" }
		]
	},
	{
		id: "temperature",
		label: "Temperature",
		help: "",
		group: "sampling",
		fallback: null,
		fast: null,
		type: "number",
		min: 0,
		max: 2,
		step: 0.05,
		whole: false
	}
];

function backend(
	view: AiSettingsView,
	options: { controls?: ControlInfo[]; lists?: Record<string, string[]> } = {}
) {
	setInvokeHandler("ai_get_settings", () => view);
	setInvokeHandler("ai_get_model_controls", () => options.controls ?? []);
	setInvokeHandler(
		"ai_list_models",
		(args) => options.lists?.[(args as { provider: string }).provider] ?? []
	);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("ai_set_model_tuning", () => null);
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);
const savedSettings = () =>
	calls("save_setting").map((call) => [call.args?.key, call.args?.value] as const);

/** OpenRouter in use, with Google and Groq ready, and Anthropic without a key. */
const READY_VIEW = aiSettingsView("openrouter", {
	openrouter: { hasKey: true, model: "google/gemma-4-31b-it" },
	google: { hasKey: true, model: "gemini-3.8-flash" },
	groq: { hasKey: true, model: "llama-3.3-70b-versatile" },
	anthropic: { hasKey: false }
});

async function openModelMenu(user: ReturnType<typeof userEvent.setup>) {
	await user.click(await screen.findByRole("button", { name: /^Model:/ }));
	return screen.getByRole("menu", { name: /^Model:/ });
}

describe("the model chip", () => {
	it("says which model answers and on which service", async () => {
		backend(READY_VIEW);

		render(<ModelChooser onChanged={vi.fn()} />);

		const chip = await screen.findByRole("button", { name: /^Model:/ });
		expect(chip).toHaveTextContent("gemma-4-31b-it");
		expect(chip).toHaveTextContent("OpenRouter");
	});

	it("shows nothing when the settings cannot be read", async () => {
		setInvokeHandler("ai_get_settings", () => {
			throw { kind: "other", message: "no" };
		});

		const { container } = render(<ModelChooser onChanged={vi.fn()} />);

		await waitFor(() => expect(calls("ai_get_settings")).toHaveLength(1));
		expect(container).toBeEmptyDOMElement();
	});
});

describe("the model menu", () => {
	it("lists the services that are ready, each with how many models it has", async () => {
		backend(READY_VIEW);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();

		const menu = await openModelMenu(user);

		for (const name of [/^OpenRouter/, /^Google/, /^Groq/]) {
			expect(within(menu).getByRole("button", { name })).toHaveTextContent(/\d+/);
		}
		expect(within(menu).queryByRole("button", { name: /^Anthropic/ })).not.toBeInTheDocument();
	});

	it("opens the service in use and marks the model in use", async () => {
		backend(READY_VIEW);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();

		const menu = await openModelMenu(user);

		const openRouterModels = within(menu).getByRole("group", { name: "OpenRouter models" });
		expect(
			within(openRouterModels).getByRole("menuitemradio", { name: "google/gemma-4-31b-it" })
		).toBeChecked();
		expect(within(menu).queryByRole("group", { name: "Google models" })).not.toBeInTheDocument();
	});

	it("folds a service open to show its models, loading the whole list", async () => {
		backend(READY_VIEW, {
			lists: { google: ["gemini-3.8-flash", "gemini-4-argon", "gemma-4-31b-it"] }
		});
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		const menu = await openModelMenu(user);

		await user.click(within(menu).getByRole("button", { name: /^Google/ }));

		const google = await within(menu).findByRole("group", { name: "Google models" });
		await waitFor(() =>
			expect(
				within(google)
					.getAllByRole("menuitemradio")
					.map((item) => item.textContent)
			).toEqual(expect.arrayContaining(["gemini-3.8-flash", "gemini-4-argon", "gemma-4-31b-it"]))
		);
		expect(calls("ai_list_models").some((call) => call.args?.provider === "google")).toBe(true);
	});

	it("switches to another service's model with one click, saving both choices", async () => {
		backend(READY_VIEW, { lists: { google: ["gemini-3.8-flash", "gemini-4-argon"] } });
		const onChanged = vi.fn();
		render(<ModelChooser onChanged={onChanged} />);
		const user = userEvent.setup();
		const menu = await openModelMenu(user);
		await user.click(within(menu).getByRole("button", { name: /^Google/ }));

		await user.click(await within(menu).findByRole("menuitemradio", { name: "gemini-4-argon" }));

		await waitFor(() =>
			expect(savedSettings()).toEqual([
				["zara-ai-provider", "google"],
				["zara-ai-model-google", "gemini-4-argon"]
			])
		);
		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu", { name: /^Model:/ })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^Model:/ })).toHaveTextContent("gemini-4-argon");
		expect(screen.getByRole("button", { name: /^Model:/ })).toHaveTextContent("Google");
	});

	it("changes only the model when one on the same service is chosen", async () => {
		backend(READY_VIEW, { lists: { openrouter: ["google/gemma-4-31b-it", "openai/gpt-4o-mini"] } });
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		const menu = await openModelMenu(user);

		await user.click(
			await within(menu).findByRole("menuitemradio", { name: "openai/gpt-4o-mini" })
		);

		await waitFor(() =>
			expect(savedSettings()).toEqual([["zara-ai-model-openrouter", "openai/gpt-4o-mini"]])
		);
	});

	it("searches the models of every ready service at once", async () => {
		backend(READY_VIEW, {
			lists: {
				openrouter: ["google/gemma-4-31b-it", "openai/gpt-4o-mini"],
				google: ["gemini-3.8-flash", "gemma-4-31b-it"],
				groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"]
			}
		});
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		const menu = await openModelMenu(user);

		await user.type(within(menu).getByRole("searchbox", { name: "Search models" }), "gemma");

		await waitFor(() => {
			expect(within(menu).getByRole("group", { name: "OpenRouter models" })).toBeInTheDocument();
			expect(within(menu).getByRole("group", { name: "Google models" })).toBeInTheDocument();
		});
		expect(within(menu).queryByRole("group", { name: "Groq models" })).not.toBeInTheDocument();
		const google = within(menu).getByRole("group", { name: "Google models" });
		expect(
			within(google)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent)
		).toEqual(["gemma-4-31b-it"]);
	});

	it("says so when nothing matches", async () => {
		backend(READY_VIEW);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		const menu = await openModelMenu(user);

		await user.type(within(menu).getByRole("searchbox", { name: "Search models" }), "zzzz");

		expect(await within(menu).findByText("No models match.")).toBeInTheDocument();
	});

	it("closes on Escape without changing anything", async () => {
		backend(READY_VIEW);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		await openModelMenu(user);

		await user.keyboard("{Escape}");

		expect(screen.queryByRole("menu", { name: /^Model:/ })).not.toBeInTheDocument();
		expect(savedSettings()).toEqual([]);
		expect(screen.getByRole("button", { name: /^Model:/ })).toHaveFocus();
	});

	it("reads the settings again when opened, in case a key was added meanwhile", async () => {
		backend(READY_VIEW);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		await screen.findByRole("button", { name: /^Model:/ });
		const before = calls("ai_get_settings").length;

		await openModelMenu(user);

		await waitFor(() => expect(calls("ai_get_settings").length).toBe(before + 1));
	});
});

describe("the thinking chip", () => {
	it("is not shown for a model with no thinking setting", async () => {
		backend(READY_VIEW, { controls: [effortControls[1]] });

		render(<ModelChooser onChanged={vi.fn()} />);
		await screen.findByRole("button", { name: /^Model:/ });

		await waitFor(() => expect(calls("ai_get_model_controls")).toHaveLength(1));
		expect(screen.queryByRole("button", { name: /^Reasoning effort:/ })).not.toBeInTheDocument();
	});

	it("asks about the model in use and shows Auto while nothing is chosen", async () => {
		backend(READY_VIEW, { controls: effortControls });

		render(<ModelChooser onChanged={vi.fn()} />);

		const chip = await screen.findByRole("button", { name: "Reasoning effort: Auto" });
		expect(chip).toHaveTextContent("Auto");
		expect(calls("ai_get_model_controls")[0].args).toEqual({
			provider: "openrouter",
			model: "google/gemma-4-31b-it"
		});
	});

	it("shows the effort that is saved for the model", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: {
					hasKey: true,
					model: "google/gemma-4-31b-it",
					tuning: { "google/gemma-4-31b-it": { effort: "high" } }
				}
			}),
			{ controls: effortControls }
		);

		render(<ModelChooser onChanged={vi.fn()} />);

		expect(
			await screen.findByRole("button", { name: "Reasoning effort: High" })
		).toBeInTheDocument();
	});

	it("saves the effort chosen from its menu, keeping the model's other settings", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: {
					hasKey: true,
					model: "google/gemma-4-31b-it",
					tuning: { "google/gemma-4-31b-it": { temperature: 0.4 } }
				}
			}),
			{ controls: effortControls }
		);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Reasoning effort: Auto" }));

		await user.click(screen.getByRole("menuitemradio", { name: "Medium" }));

		await waitFor(() => expect(calls("ai_set_model_tuning")).toHaveLength(1));
		expect(calls("ai_set_model_tuning")[0].args).toEqual({
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
			values: { temperature: 0.4, effort: "medium" }
		});
		expect(
			await screen.findByRole("button", { name: "Reasoning effort: Medium" })
		).toBeInTheDocument();
	});

	it("takes the effort back to the default", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: {
					hasKey: true,
					model: "google/gemma-4-31b-it",
					tuning: { "google/gemma-4-31b-it": { effort: "high" } }
				}
			}),
			{ controls: effortControls }
		);
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Reasoning effort: High" }));

		await user.click(screen.getByRole("menuitemradio", { name: "Default" }));

		await waitFor(() => expect(calls("ai_set_model_tuning")).toHaveLength(1));
		expect(calls("ai_set_model_tuning")[0].args?.values).toEqual({});
	});

	it("turns the Fast preset on from the menu and says Fast on the chip", async () => {
		backend(READY_VIEW, { controls: effortControls });
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Reasoning effort: Auto" }));

		await user.click(screen.getByRole("menuitemcheckbox", { name: /^Fast/ }));

		await waitFor(() => expect(calls("ai_set_model_tuning")).toHaveLength(1));
		expect(calls("ai_set_model_tuning")[0].args?.values).toEqual({ effort: "low" });
		expect(
			await screen.findByRole("button", { name: "Reasoning effort: Fast" })
		).toBeInTheDocument();
	});

	it("does not offer the service's models in its menu, only how hard to think", async () => {
		backend(READY_VIEW, { controls: effortControls });
		render(<ModelChooser onChanged={vi.fn()} />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Reasoning effort: Auto" }));

		const menu = screen.getByRole("menu", { name: "Reasoning effort: Auto" });
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.textContent)
		).toEqual(["Default", "Low", "Medium", "High"]);
	});
});
