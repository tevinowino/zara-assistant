import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiServiceSection } from "./AiServiceSection";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { openedUrls } from "../test/shims/pluginOpener";
import { aiSettingsView } from "../test/shims/aiSettings";
import type { AiSettingsView } from "../ai/providers";

function backend(view: AiSettingsView) {
	setInvokeHandler("ai_get_settings", () => view);
	setInvokeHandler("save_setting", () => null);
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);
const savedSettings = () =>
	calls("save_setting").map((call) => [call.args?.key, call.args?.value] as const);

async function openModelList(user: ReturnType<typeof userEvent.setup>, name = "Model") {
	await user.click(await screen.findByRole("combobox", { name }));
	return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("the grid of services", () => {
	it("shows every service as a tile with its name", async () => {
		backend(aiSettingsView("openrouter"));

		render(<AiServiceSection />);

		expect(await screen.findAllByRole("radio")).toHaveLength(11);
		for (const name of [
			"OpenRouter",
			"OpenAI",
			"Anthropic",
			"Google",
			"NVIDIA",
			"Ollama",
			"Custom"
		]) {
			expect(screen.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
		}
	});

	it("marks the service in use", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));

		render(<AiServiceSection />);

		const tile = await screen.findByRole("radio", { name: /^Anthropic/ });
		expect(tile).toBeChecked();
		expect(tile).toHaveTextContent("In use");
	});

	it("says which other services are ready and which need a key", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: { hasKey: true },
				openai: { hasKey: true },
				anthropic: { hasKey: false }
			})
		);

		render(<AiServiceSection />);

		expect(await screen.findByRole("radio", { name: /^OpenAI/ })).toHaveTextContent("Ready");
		expect(screen.getByRole("radio", { name: /^Anthropic/ })).toHaveTextContent("Needs a key");
	});

	it("shows a service's details when its tile is chosen, without switching to it", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: true } }));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("radio", { name: /^Anthropic/ }));

		expect(screen.getByRole("radio", { name: /^Anthropic/ })).toBeChecked();
		expect(screen.getByText("Claude models")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /^OpenRouter/ })).toHaveTextContent("In use");
		expect(savedSettings()).toEqual([]);
	});

	it("offers to use a service that is ready, and switches to it when asked", async () => {
		backend(
			aiSettingsView("openrouter", { openrouter: { hasKey: true }, openai: { hasKey: true } })
		);
		const onServiceChange = vi.fn();
		render(<AiServiceSection onServiceChange={onServiceChange} />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("radio", { name: /^OpenAI/ }));

		await user.click(screen.getByRole("button", { name: "Use OpenAI" }));

		await waitFor(() => expect(savedSettings()).toContainEqual(["zara-ai-provider", "openai"]));
		expect(screen.getByRole("radio", { name: /^OpenAI/ })).toHaveTextContent("In use");
		expect(onServiceChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "openai" }));
	});

	it("does not offer to use a service that has no key yet, and says what is missing", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: true } }));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("radio", { name: /^Anthropic/ }));

		expect(screen.queryByRole("button", { name: "Use Anthropic" })).not.toBeInTheDocument();
		expect(screen.getByText("Add a key to use Anthropic.")).toBeInTheDocument();
	});

	it("tells the page which service is in use, so it can show what that service can do", async () => {
		backend(aiSettingsView("openai"));
		const onServiceChange = vi.fn();

		render(<AiServiceSection onServiceChange={onServiceChange} />);

		await waitFor(() =>
			expect(onServiceChange).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "openai", supportsWebSearch: false })
			)
		);
	});

	it("says so when the settings cannot be read", async () => {
		setInvokeHandler("ai_get_settings", () => {
			throw { kind: "other", message: "Windows Credential Manager is unavailable." };
		});

		render(<AiServiceSection />);

		expect(await screen.findByRole("alert")).toHaveTextContent("Credential Manager is unavailable");
	});
});

describe("entering an API key", () => {
	it("saves a key and checks it works", async () => {
		backend(aiSettingsView("openai"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("OpenAI API key"), "sk-openai-secret");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByText(/Connected to OpenAI/)).toBeInTheDocument();
		expect(calls("ai_set_api_key")[0].args).toEqual({
			provider: "openai",
			key: "sk-openai-secret"
		});
	});

	it("saves a key the moment it is pasted, with no extra click", async () => {
		backend(aiSettingsView("openai"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByLabelText("OpenAI API key"));

		await user.paste("sk-pasted-secret-key-123");

		expect(await screen.findByText(/Connected to OpenAI/)).toBeInTheDocument();
		expect(calls("ai_set_api_key")[0].args).toEqual({
			provider: "openai",
			key: "sk-pasted-secret-key-123"
		});
	});

	it("does not save something pasted that cannot be a key", async () => {
		backend(aiSettingsView("openai"));
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByLabelText("OpenAI API key"));

		await user.paste("hello there");

		expect(calls("ai_set_api_key")).toHaveLength(0);
	});

	it("shows a saved key as saved, never as text, and offers to test, replace or remove it", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));

		render(<AiServiceSection />);

		expect(await screen.findByText("Saved in Windows Credential Manager")).toBeInTheDocument();
		expect(screen.queryByLabelText("Anthropic API key")).not.toBeInTheDocument();
		for (const name of ["Test", "Replace", "Remove"]) {
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
		}
	});

	it("replaces a saved key by showing the field again", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Replace" }));
		await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-new-key");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		await screen.findByText(/Connected to Anthropic/);
		expect(calls("ai_set_api_key")[0].args).toEqual({
			provider: "anthropic",
			key: "sk-ant-new-key"
		});
	});

	it("can back out of replacing a key", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Replace" }));

		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(screen.queryByLabelText("Anthropic API key")).not.toBeInTheDocument();
		expect(screen.getByText("Saved in Windows Credential Manager")).toBeInTheDocument();
	});

	it("keeps the key but explains the problem when the service rejects it", async () => {
		backend(aiSettingsView("openai"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => {
			throw {
				kind: "invalid-key",
				message: "The AI service rejected the API key. Check it in Settings."
			};
		});
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("OpenAI API key"), "wrong-key-value");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("rejected the API key");
	});

	it("does not save a blank key", async () => {
		backend(aiSettingsView("openai"));

		render(<AiServiceSection />);

		expect(await screen.findByRole("button", { name: "Save key" })).toBeDisabled();
	});

	it("tests a saved key on request", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Test" }));

		expect(await screen.findByText("Connected to Anthropic.")).toBeInTheDocument();
	});

	it("removes the key for that service only", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));
		setInvokeHandler("ai_clear_api_key", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Remove" }));

		expect(await screen.findByText("Key removed.")).toBeInTheDocument();
		expect(calls("ai_clear_api_key")[0].args).toEqual({ provider: "anthropic" });
		expect(screen.getByLabelText("Anthropic API key")).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /^Anthropic/ })).toHaveTextContent("Needs a key");
	});

	it("opens the page where a key is made", async () => {
		backend(aiSettingsView("openai"));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Get a key" }));

		expect(openedUrls).toEqual(["https://platform.openai.com/api-keys"]);
	});

	it("says no key is needed for a local server, and lets the user add one if theirs asks", async () => {
		backend(aiSettingsView("ollama"));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		expect(await screen.findByText("No key needed.")).toBeInTheDocument();
		expect(screen.queryByLabelText("Ollama (on this PC) API key")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Add a key" }));

		expect(screen.getByLabelText("Ollama (on this PC) API key")).toBeInTheDocument();
	});

	it("offers no key page for a service that has none", async () => {
		backend(aiSettingsView("custom"));

		render(<AiServiceSection />);
		await screen.findByLabelText("Server address");

		expect(screen.queryByRole("button", { name: "Get a key" })).not.toBeInTheDocument();
	});
});

describe("a key makes a service usable", () => {
	it("switches to the service when nothing usable is in use yet, and says so", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: false } }));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("radio", { name: /^OpenAI/ }));

		await user.type(screen.getByLabelText("OpenAI API key"), "sk-openai-secret");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByText("Key saved. Zara now uses OpenAI.")).toBeInTheDocument();
		expect(savedSettings()).toContainEqual(["zara-ai-provider", "openai"]);
		expect(screen.getByRole("radio", { name: /^OpenAI/ })).toHaveTextContent("In use");
	});

	it("keeps the service in use when it already works, and offers the new one", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: true } }));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("radio", { name: /^OpenAI/ }));

		await user.type(screen.getByLabelText("OpenAI API key"), "sk-openai-secret");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		expect(await screen.findByRole("button", { name: "Use OpenAI" })).toBeInTheDocument();
		expect(savedSettings()).toEqual([]);
		expect(screen.getByRole("radio", { name: /^OpenRouter/ })).toHaveTextContent("In use");
	});

	it("does not switch to a service whose key was rejected", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: false } }));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => {
			throw {
				kind: "invalid-key",
				message: "The AI service rejected the API key. Check it in Settings."
			};
		});
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("radio", { name: /^OpenAI/ }));

		await user.type(screen.getByLabelText("OpenAI API key"), "wrong-key-value");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		await screen.findByRole("alert");
		expect(savedSettings()).toEqual([]);
	});
});

describe("choosing a model", () => {
	it("lists the suggestions even before a key is saved", async () => {
		backend(aiSettingsView("google"));
		const user = userEvent.setup();
		render(<AiServiceSection />);

		const names = await openModelList(user);

		expect(names).toEqual(expect.arrayContaining(["gemini-3.8-flash", "gemma-4-31b-it"]));
		expect(calls("ai_list_models")).toHaveLength(0);
	});

	it("loads everything the service offers as soon as a key is there, with no button to press", async () => {
		backend(aiSettingsView("google", { google: { hasKey: true } }));
		setInvokeHandler("ai_list_models", () => [
			"gemini-4-argon",
			"gemini-3.8-flash",
			"gemini-3.6-flash",
			"gemma-4-31b-it"
		]);
		render(<AiServiceSection />);

		await waitFor(() => expect(calls("ai_list_models")).toHaveLength(1));

		expect(calls("ai_list_models")[0].args).toEqual({ provider: "google" });
	});

	it("shows all of Google's models in the dropdown, including Gemma and Gemini 4 Argon", async () => {
		backend(aiSettingsView("google", { google: { hasKey: true, model: "gemini-3.8-flash" } }));
		setInvokeHandler("ai_list_models", () => [
			"gemini-3.1-flash-lite",
			"gemini-3.5-flash-lite",
			"gemini-3.6-flash",
			"gemini-3.8-flash",
			"gemini-4-argon",
			"gemma-4-31b-it"
		]);
		const user = userEvent.setup();
		render(<AiServiceSection />);
		await waitFor(() => expect(calls("ai_list_models")).toHaveLength(1));

		await user.click(await screen.findByRole("combobox", { name: "Model" }));

		await waitFor(() => {
			const names = screen.getAllByRole("option").map((option) => option.textContent);
			expect(names).toContain("gemma-4-31b-it");
			expect(names).toContain("gemini-4-argon");
			expect(names).toContain("gemini-3.1-flash-lite");
		});
	});

	it("does not ask for the list before a key is saved, and does once it is", async () => {
		backend(aiSettingsView("openai"));
		setInvokeHandler("ai_set_api_key", () => undefined);
		setInvokeHandler("ai_test_connection", () => undefined);
		setInvokeHandler("ai_list_models", () => ["gpt-4o", "gpt-4o-mini"]);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await screen.findByLabelText("OpenAI API key");
		expect(calls("ai_list_models")).toHaveLength(0);

		await user.type(screen.getByLabelText("OpenAI API key"), "sk-openai-secret");
		await user.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(calls("ai_list_models")).toHaveLength(1));
	});

	it("asks a local server for its models without any key", async () => {
		backend(aiSettingsView("ollama"));
		setInvokeHandler("ai_list_models", () => ["llama3.2", "gemma3"]);

		render(<AiServiceSection />);

		await waitFor(() => expect(calls("ai_list_models")).toHaveLength(1));
	});

	it("keeps the suggestions and offers another try when the list cannot be loaded", async () => {
		backend(aiSettingsView("openai", { openai: { hasKey: true } }));
		let attempts = 0;
		setInvokeHandler("ai_list_models", () => {
			attempts += 1;
			if (attempts === 1) throw { kind: "timeout", message: "The model took too long to respond." };
			return ["gpt-4o", "gpt-4o-mini", "o3-mini"];
		});
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await waitFor(() => expect(calls("ai_list_models")).toHaveLength(1));

		await user.click(await screen.findByRole("combobox", { name: "Model" }));
		expect(await screen.findByText(/Couldn't load the full list/)).toBeInTheDocument();
		expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.getByRole("option", { name: "o3-mini" })).toBeInTheDocument()
		);
	});

	it("saves the model picked, for the service it belongs to", async () => {
		backend(aiSettingsView("anthropic", { anthropic: { hasKey: true } }));
		setInvokeHandler("ai_list_models", () => ["claude-haiku-5-5", "claude-sonnet-5-5"]);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await openModelList(user);

		await user.click(screen.getByRole("option", { name: "claude-haiku-5-5" }));

		await waitFor(() =>
			expect(savedSettings()).toContainEqual(["zara-ai-model-anthropic", "claude-haiku-5-5"])
		);
		expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("claude-haiku-5-5");
	});

	it("saves a model name the user typed that is not in any list", async () => {
		backend(aiSettingsView("openrouter"));
		render(<AiServiceSection />);
		const user = userEvent.setup();
		await openModelList(user);

		await user.type(
			screen.getByRole("searchbox", { name: "Search models" }),
			"vendor/brand-new-model"
		);
		await user.click(screen.getByRole("option", { name: "Use “vendor/brand-new-model”" }));

		await waitFor(() =>
			expect(savedSettings()).toContainEqual(["zara-ai-model-openrouter", "vendor/brand-new-model"])
		);
	});

	it("shows each service's own model when another tile is chosen", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: { model: "google/gemma-4-31b-it" },
				openai: { model: "gpt-4o" }
			})
		);
		render(<AiServiceSection />);
		const user = userEvent.setup();
		expect(await screen.findByRole("combobox", { name: "Model" })).toHaveTextContent(
			"google/gemma-4-31b-it"
		);

		await user.click(screen.getByRole("radio", { name: /^OpenAI/ }));

		expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("gpt-4o");
	});
});

describe("the backup model", () => {
	it("is none by default and says what it is for", async () => {
		backend(aiSettingsView("openrouter"));

		render(<AiServiceSection />);

		expect(await screen.findByRole("combobox", { name: "Backup model" })).toHaveTextContent("None");
		expect(screen.getByText(/Tried if the main model is busy or fails/)).toBeInTheDocument();
	});

	it("saves a backup model picked from the list", async () => {
		backend(aiSettingsView("openrouter"));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("combobox", { name: "Backup model" }));
		await user.click(screen.getByRole("option", { name: "openai/gpt-4o-mini" }));

		await waitFor(() =>
			expect(savedSettings()).toContainEqual([
				"zara-ai-fallback-model-openrouter",
				"openai/gpt-4o-mini"
			])
		);
	});

	it("clears the backup model when None is chosen", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { fallbackModel: "openai/gpt-4o-mini" } }));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("combobox", { name: "Backup model" }));
		await user.click(screen.getByRole("option", { name: "None" }));

		await waitFor(() =>
			expect(savedSettings()).toContainEqual(["zara-ai-fallback-model-openrouter", ""])
		);
		expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveTextContent("None");
	});
});

describe("a backup on another service", () => {
	it("offers every other service to run the backup on, and starts on the same one", async () => {
		backend(aiSettingsView("openrouter", { google: { hasKey: true } }));

		render(<AiServiceSection />);

		const select = await screen.findByRole("combobox", { name: "Backup service" });
		expect(select).toHaveValue("");
		const labels = within(select)
			.getAllByRole("option")
			.map((option) => option.textContent);
		expect(labels[0]).toBe("Same service (OpenRouter)");
		expect(labels).toContain("Google");
		expect(labels).toContain("Anthropic (needs a key)");
		expect(labels).not.toContain("OpenRouter");
	});

	it("saves the service and picks that service's own model for the backup", async () => {
		backend(
			aiSettingsView("openrouter", {
				google: { hasKey: true, model: "gemini-3.8-flash" },
				openrouter: { fallbackModel: "openai/gpt-4o-mini" }
			})
		);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.selectOptions(
			await screen.findByRole("combobox", { name: "Backup service" }),
			"google"
		);

		await waitFor(() =>
			expect(savedSettings()).toEqual([
				["zara-ai-fallback-provider-openrouter", "google"],
				["zara-ai-fallback-model-openrouter", "gemini-3.8-flash"]
			])
		);
		expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveTextContent(
			"gemini-3.8-flash"
		);
	});

	it("lists the other service's models for the backup, not this service's", async () => {
		backend(
			aiSettingsView("openrouter", {
				google: { hasKey: true, model: "gemini-3.8-flash" },
				openrouter: { fallbackProvider: "google", fallbackModel: "gemini-3.8-flash" }
			})
		);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		const names = await openModelList(user, "Backup model");

		expect(names).toEqual(expect.arrayContaining(["gemini-3.8-flash", "gemma-4-31b-it"]));
		expect(names).not.toContain("openai/gpt-4o-mini");
	});

	it("says a key is needed when the backup service has none", async () => {
		backend(
			aiSettingsView("openrouter", {
				openrouter: { fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-5-5" }
			})
		);

		render(<AiServiceSection />);

		expect(
			await screen.findByText("Add a key for Anthropic to use it as the backup.")
		).toBeInTheDocument();
	});

	it("goes back to the same service and clears the backup model", async () => {
		backend(
			aiSettingsView("openrouter", {
				google: { hasKey: true },
				openrouter: { fallbackProvider: "google", fallbackModel: "gemini-3.8-flash" }
			})
		);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.selectOptions(await screen.findByRole("combobox", { name: "Backup service" }), "");

		await waitFor(() =>
			expect(savedSettings()).toEqual([
				["zara-ai-fallback-provider-openrouter", ""],
				["zara-ai-fallback-model-openrouter", ""]
			])
		);
		expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveTextContent("None");
	});

	it("shows the backup model's own settings, on the backup's service", async () => {
		backend(
			aiSettingsView("openrouter", {
				google: { hasKey: true, tuning: { "gemini-3.8-flash": { thinking_level: "low" } } },
				openrouter: { fallbackProvider: "google", fallbackModel: "gemini-3.8-flash" }
			})
		);

		render(<AiServiceSection />);

		expect(await screen.findByText("1 setting changed for gemini-3.8-flash.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Show backup model settings" })).toBeInTheDocument();
	});
});

describe("settings for each model", () => {
	it("shows the main model's saved settings count and opens its settings", async () => {
		backend(
			aiSettingsView("groq", {
				groq: { model: "openai/gpt-oss-20b", tuning: { "openai/gpt-oss-20b": { effort: "high" } } }
			})
		);
		setInvokeHandler("ai_get_model_controls", () => [
			{
				id: "effort",
				label: "Reasoning effort",
				help: "How hard it thinks.",
				group: "reasoning",
				fallback: null,
				fast: null,
				type: "choice",
				choices: [
					{ value: "low", label: "Low" },
					{ value: "high", label: "High" }
				]
			}
		]);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Show model settings" }));

		const effort = await screen.findByRole("radiogroup", { name: "Reasoning effort" });
		expect(within(effort).getByRole("radio", { name: "High" })).toBeChecked();
		const asked = calls("ai_get_model_controls");
		expect(asked[0].args).toEqual({ provider: "groq", model: "openai/gpt-oss-20b" });
	});

	it("offers settings for the model that is chosen, so a new model is asked about again", async () => {
		backend(aiSettingsView("groq", { groq: { hasKey: true, model: "llama-3.3-70b-versatile" } }));
		setInvokeHandler("ai_get_model_controls", () => []);
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Show model settings" }));

		await waitFor(() => expect(calls("ai_get_model_controls")).toHaveLength(1));
		expect(calls("ai_get_model_controls")[0].args).toEqual({
			provider: "groq",
			model: "llama-3.3-70b-versatile"
		});
	});
});

describe("a custom or local server's address", () => {
	it("is asked for only by services that need it", async () => {
		backend(aiSettingsView("openai"));

		render(<AiServiceSection />);
		await screen.findByRole("combobox", { name: "Model" });

		expect(screen.queryByLabelText("Server address")).not.toBeInTheDocument();
	});

	it("is saved for a local server", async () => {
		backend(aiSettingsView("ollama"));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Server address"), "http://localhost:9999/v1");
		await user.tab();

		await waitFor(() =>
			expect(savedSettings()).toContainEqual([
				"zara-ai-base-url-ollama",
				"http://localhost:9999/v1"
			])
		);
	});

	it("shows the usual address as a hint for a local server", async () => {
		backend(aiSettingsView("ollama"));

		render(<AiServiceSection />);

		expect(await screen.findByLabelText("Server address")).toHaveAttribute(
			"placeholder",
			"http://localhost:11434/v1"
		);
	});

	it("says a custom server needs an address and a model before it can be used", async () => {
		backend(aiSettingsView("openrouter", { openrouter: { hasKey: true } }));
		render(<AiServiceSection />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("radio", { name: /^Custom/ }));

		expect(screen.getByRole("radio", { name: /^Custom/ })).toHaveTextContent("Needs setup");
		expect(screen.queryByRole("button", { name: "Use Custom" })).not.toBeInTheDocument();
		const details = screen.getByRole("region", { name: /Custom/ });
		expect(within(details).getByText(/Add the server address and a model/)).toBeInTheDocument();
	});
});
