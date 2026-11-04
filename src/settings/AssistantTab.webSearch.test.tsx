import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssistantTab } from "./AssistantTab";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";
import type { ProviderId } from "../ai/providers";

function backend(savedSettings: Record<string, string> = {}, provider: ProviderId = "openrouter") {
	setInvokeHandler("ai_get_settings", () => aiSettingsView(provider));
	setInvokeHandler("stealth_status", () => ({
		requested: false,
		supported: true,
		active: false,
		problem: null,
		windows: []
	}));
	setInvokeHandler("shortcut_list", () => []);
	setInvokeHandler("load_settings", () => savedSettings);
	setInvokeHandler("save_setting", () => null);
}

const savedWebSearchValues = () =>
	invokeCalls
		.filter((call) => call.command === "save_setting" && call.args?.key === "zara-ai-web-search")
		.map((call) => call.args?.value);

describe("web search setting", () => {
	it("is on by default, so Zara can look things up", async () => {
		backend();

		render(<AssistantTab />);

		expect(await screen.findByLabelText("Let Zara search the web")).toBeChecked();
	});

	it("shows it as off when the user turned it off before", async () => {
		backend({ "zara-ai-web-search": "false" });

		render(<AssistantTab />);

		const toggle = await screen.findByLabelText("Let Zara search the web");
		await waitFor(() => expect(toggle).not.toBeChecked());
	});

	it("saves the choice when it is turned off", async () => {
		backend();
		render(<AssistantTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByLabelText("Let Zara search the web"));

		await waitFor(() => expect(savedWebSearchValues()).toEqual(["false"]));
		expect(screen.getByLabelText("Let Zara search the web")).not.toBeChecked();
	});

	it("saves the choice when it is turned back on", async () => {
		backend({ "zara-ai-web-search": "false" });
		render(<AssistantTab />);
		const user = userEvent.setup();
		const toggle = await screen.findByLabelText("Let Zara search the web");
		await waitFor(() => expect(toggle).not.toBeChecked());

		await user.click(toggle);

		await waitFor(() => expect(savedWebSearchValues()).toEqual(["true"]));
		expect(toggle).toBeChecked();
	});

	it("puts the toggle back when saving fails", async () => {
		backend();
		setInvokeHandler("save_setting", () => {
			throw new Error("disk full");
		});
		render(<AssistantTab />);
		const user = userEvent.setup();
		const toggle = await screen.findByLabelText("Let Zara search the web");

		await user.click(toggle);

		await waitFor(() => expect(toggle).toBeChecked());
	});

	it("tells the user where their question goes and what it costs", async () => {
		backend();

		render(<AssistantTab />);

		expect(await screen.findByText(/sent to a search provider/)).toBeInTheDocument();
		expect(screen.getByText(/small extra charge/)).toBeInTheDocument();
	});

	it("still shows the toggle, on, when the saved settings cannot be read", async () => {
		backend();
		setInvokeHandler("load_settings", () => {
			throw new Error("unreadable");
		});

		render(<AssistantTab />);

		expect(await screen.findByLabelText("Let Zara search the web")).toBeChecked();
	});

	it("is switched off, with the reason, for a service that cannot search the web", async () => {
		backend({}, "openai");

		render(<AssistantTab />);

		const toggle = await screen.findByLabelText("Let Zara search the web");
		await waitFor(() => expect(toggle).toBeDisabled());
		expect(toggle).not.toBeChecked();
		expect(screen.getByText(/Not available with OpenAI/)).toBeInTheDocument();
	});

	it("keeps the user's own choice for later, even while it is unavailable", async () => {
		backend({}, "anthropic");
		render(<AssistantTab />);
		await waitFor(() => expect(screen.getByLabelText("Let Zara search the web")).toBeDisabled());

		expect(savedWebSearchValues()).toEqual([]);
	});

	it("can be used with OpenRouter", async () => {
		backend({}, "openrouter");

		render(<AssistantTab />);

		expect(await screen.findByLabelText("Let Zara search the web")).toBeEnabled();
	});
});
