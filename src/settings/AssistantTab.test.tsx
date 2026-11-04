import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssistantTab, describeStealth } from "./AssistantTab";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { aiSettingsView } from "../test/shims/aiSettings";
import type { StealthStatus } from "../ai/api";

const status = (overrides: Partial<StealthStatus> = {}): StealthStatus => ({
	requested: false,
	supported: true,
	active: false,
	problem: null,
	windows: [{ label: "main", asRequested: true }],
	...overrides
});

function backend({
	hasKey = true,
	stealth = status()
}: { hasKey?: boolean; stealth?: StealthStatus } = {}) {
	setInvokeHandler("ai_get_settings", () =>
		aiSettingsView("openrouter", { openrouter: { hasKey } })
	);
	setInvokeHandler("stealth_status", () => stealth);
	setInvokeHandler("shortcut_list", () => []);
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("stealth section", () => {
	it("turns stealth on and shows that it is active", async () => {
		backend();
		setInvokeHandler("stealth_set", () => status({ requested: true, active: true }));
		render(<AssistantTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByLabelText("Hide Zara from screen sharing"));

		expect(await screen.findByText(/Active\. Zara's windows are hidden/)).toBeInTheDocument();
		expect(calls("stealth_set")[0].args).toEqual({ enabled: true });
		expect(screen.getByLabelText("Hide Zara from screen sharing")).toBeChecked();
	});

	it("turns stealth off again", async () => {
		backend({ stealth: status({ requested: true, active: true }) });
		setInvokeHandler("stealth_set", () => status({ requested: false }));
		render(<AssistantTab />);
		const user = userEvent.setup();
		const toggle = await screen.findByLabelText("Hide Zara from screen sharing");
		await waitFor(() => expect(toggle).toBeChecked());

		await user.click(toggle);

		await waitFor(() => expect(toggle).not.toBeChecked());
		expect(calls("stealth_set")[0].args).toEqual({ enabled: false });
	});

	it("is disabled, with an explanation, on a Windows version that cannot do it", async () => {
		backend({ stealth: status({ supported: false }) });

		render(<AssistantTab />);

		expect(await screen.findByLabelText("Hide Zara from screen sharing")).toBeDisabled();
		expect(await screen.findByRole("alert")).toHaveTextContent("Windows 10 version 2004 or newer");
	});

	it("reports honestly when a window would not take the setting", async () => {
		backend({
			stealth: status({
				requested: true,
				active: false,
				problem: "Windows did not accept the setting for: overlay."
			})
		});

		render(<AssistantTab />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Windows did not accept the setting for: overlay."
		);
	});

	it("verifies on request and shows the new result", async () => {
		backend({
			stealth: status({
				requested: true,
				active: false,
				problem: "Windows did not accept the setting for: main."
			})
		});
		setInvokeHandler("stealth_verify", () => status({ requested: true, active: true }));
		render(<AssistantTab />);
		const user = userEvent.setup();

		await user.click(await screen.findByText("Verify now"));

		expect(await screen.findByText(/Active\. Zara's windows are hidden/)).toBeInTheDocument();
	});

	it("always states what stealth does not do", async () => {
		backend();

		render(<AssistantTab />);

		expect(
			await screen.findByText(/Zara still shows in Task Manager and in the tray menu/)
		).toBeInTheDocument();
		expect(screen.getByText(/a camera pointed at the screen sees everything/)).toBeInTheDocument();
	});
});

describe("describeStealth", () => {
	it("says nothing while stealth is off and supported", () => {
		expect(describeStealth(status())).toBeNull();
		expect(describeStealth(null)).toBeNull();
	});
});
