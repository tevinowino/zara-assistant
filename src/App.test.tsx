// Characterisation tests for the notch screen. They pin behaviour that must not
// change while App.tsx is split into smaller files: what the notch shows at
// start-up and which requests it sends the backend.
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCalls, setInvokeHandler } from "./test/shims/tauriCore";
import { emitTauriEvent } from "./test/shims/tauriEvent";

// The notch asks its own webview window for its label and visibility. Any other
// window method it calls resolves to nothing.
vi.mock("@tauri-apps/api/webviewWindow", () => {
	const window = new Proxy(
		{ label: "main", isVisible: async () => true },
		{ get: (target, key) => (key in target ? target[key as keyof typeof target] : async () => {}) }
	);
	return { getCurrentWebviewWindow: () => window };
});
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => {} }));
vi.mock("@crabnebula/tauri-plugin-drag", () => ({ startDrag: async () => {} }));

import App from "./App";

function registerQuietBackend(settings: Record<string, string> = {}) {
	setInvokeHandler("load_settings", () => settings);
	for (const command of [
		"set_notch_hovered",
		"set_notch_visible",
		"setup_shelf_drop",
		"update_notch_rect",
		"set_window_region",
		"change_notch_mode",
		"set_ignore_cursor_events",
		"set_window_height",
		"sync_appbar",
		"save_setting",
		"shelf_prune",
		"shelf_drag_icon"
	]) {
		setInvokeHandler(command, () => null);
	}
}

const calls = (command: string) => invokeCalls.filter((call) => call.command === command);

// Clicking the time opens the notch on the assistant; the next-panel arrow then
// steps to the calendar and timer panel.
async function openCalendarAndTimerPanel(user: ReturnType<typeof userEvent.setup>) {
	await user.click(await screen.findByText(/\d:\d\d/));
	await user.click(await screen.findByRole("button", { name: "Next panel" }));
	await screen.findByRole("tab", { name: "Calendar" });
}

// The panel opens on the calendar unless a timer is counting; the timer is one tab away.
async function openTimerView(user: ReturnType<typeof userEvent.setup>) {
	await user.click(await screen.findByRole("tab", { name: "Timer" }));
	await screen.findByRole("spinbutton", { name: "minutes" });
}

describe("the notch at start-up", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the time in the 24-hour format when that setting is on", async () => {
		localStorage.setItem("zara-time-format-24h", "true");
		registerQuietBackend();

		render(<App />);

		expect(await screen.findByText("13:07")).toBeInTheDocument();
	});

	it("tells the backend the notch is visible once its window is shown", async () => {
		registerQuietBackend();

		render(<App />);

		await waitFor(() => {
			expect(calls("set_notch_visible").some((call) => call.args?.visible === true)).toBe(true);
		});
	});

	it("re-registers the drop target for the shelf once the window is shown", async () => {
		registerQuietBackend();

		render(<App />);

		await waitFor(() => expect(calls("setup_shelf_drop").length).toBeGreaterThan(0));
	});

	it("hides the notch from the backend's point of view when the window is hidden", async () => {
		registerQuietBackend();
		render(<App />);
		await waitFor(() => expect(calls("set_notch_visible").length).toBeGreaterThan(0));

		await act(async () => {
			emitTauriEvent("visibility-change", false);
		});

		await waitFor(() => {
			const last = calls("set_notch_visible").at(-1);
			expect(last?.args?.visible).toBe(false);
		});
	});
});

describe("the calendar and timer panel", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		localStorage.setItem("zara-time-format-24h", "true");
		registerQuietBackend();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the current month", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);

		await openCalendarAndTimerPanel(user);

		expect(screen.getByRole("heading", { name: /January\s+2026/ })).toBeInTheDocument();
	});

	it("starts a 25 minute countdown in the notch and remembers the duration", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openCalendarAndTimerPanel(user);
		await openTimerView(user);

		await user.click(screen.getByRole("button", { name: "Start 25 min" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		// The time left is on the Timer tab as well as in the ring.
		expect(await screen.findByRole("tab", { name: "Timer 24:57" })).toBeInTheDocument();
		expect(localStorage.getItem("zara-timer-last-duration")).toBe("1500");
	});

	it("starts the countdown as soon as a preset is chosen", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openCalendarAndTimerPanel(user);
		await openTimerView(user);

		await user.click(screen.getByRole("button", { name: "5 min" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(await screen.findByRole("tab", { name: "Timer 4:58" })).toBeInTheDocument();
	});
});

function registerAssistantBackend(reply: string) {
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("ai_take_focus", () => null);
	setInvokeHandler("ai_release_focus", () => null);
	setInvokeHandler("ai_chat", () => ({
		text: reply,
		usedScreen: false,
		usedNotes: false,
		savedMemories: [],
		noteChanges: []
	}));
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
}

describe("the Ask Zara bar in the calendar panel", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		localStorage.setItem("zara-time-format-24h", "true");
		registerQuietBackend();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens the assistant and sends the question when Enter is pressed", async () => {
		registerAssistantBackend("You have no events today.");
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openCalendarAndTimerPanel(user);

		await user.type(screen.getByLabelText("Ask Zara"), "What is on my calendar?{Enter}");

		// The assistant, its settings lookups and the answer all start up here, which is slow when
		// many test files run at once.
		expect(
			await screen.findByText("You have no events today.", {}, { timeout: 8000 })
		).toBeInTheDocument();
		expect(calls("ai_chat")).toHaveLength(1);
		expect(calls("ai_chat")[0].args).toMatchObject({ message: "What is on my calendar?" });
		expect(screen.getByLabelText("Message Zara")).toBeInTheDocument();
	});

	it("takes keyboard focus while the bar is being typed in and gives it back after", async () => {
		registerAssistantBackend("ok");
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openCalendarAndTimerPanel(user);
		const takesBefore = calls("ai_take_focus").length;

		await user.click(screen.getByLabelText("Ask Zara"));
		await waitFor(() => expect(calls("ai_take_focus").length).toBe(takesBefore + 1));

		await user.keyboard("{Escape}");
		await waitFor(() => expect(calls("ai_release_focus").length).toBeGreaterThan(0));
	});

	it("starts a timer in the notch when an answer's button asks for one", async () => {
		const surface = [
			{
				version: "v0.9",
				createSurface: { surfaceId: "s1", catalogId: "zara:notch/v1" }
			},
			{
				version: "v0.9",
				updateComponents: {
					surfaceId: "s1",
					components: [
						{
							id: "root",
							component: "Button",
							child: "label",
							action: { functionCall: { call: "startTimer", args: { minutes: 25 } } }
						},
						{ id: "label", component: "Text", text: "Start 25 minute timer" }
					]
				}
			}
		]
			.map((message) => JSON.stringify(message))
			.join("\n");
		registerAssistantBackend("Here you go.\n\n```a2ui\n" + surface + "\n```");
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openCalendarAndTimerPanel(user);
		await user.type(screen.getByLabelText("Ask Zara"), "Time a focus block{Enter}");

		await user.click(await screen.findByRole("button", { name: "Start 25 minute timer" }));
		await user.click(screen.getByRole("button", { name: "Next panel" }));

		// The panel opens on the timer, which is counting, with 25:00 on its tab.
		expect(await screen.findByRole("tab", { name: "Timer 25:00" })).toBeInTheDocument();
	});
});

describe("the open notch on the assistant", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date(2026, 0, 2, 13, 7, 0));
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		localStorage.setItem("zara-time-format-24h", "true");
		registerQuietBackend();
		registerAssistantBackend("ok");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function openAssistant(user: ReturnType<typeof userEvent.setup>) {
		await user.click(await screen.findByText(/\d:\d\d/));
		await screen.findByLabelText("Message Zara", {}, { timeout: 5000 });
	}

	it("fades the bottom of the notch into the screen while it shows the assistant", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const { container } = render(<App />);

		await openAssistant(user);

		expect(container.querySelector(".zara")).toHaveClass("fade-bottom");
	});

	it("does not fade the notch on its other panels", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const { container } = render(<App />);
		await openAssistant(user);

		await user.click(screen.getByRole("button", { name: "Next panel" }));
		await screen.findByRole("tab", { name: "Calendar" });

		expect(container.querySelector(".zara")).not.toHaveClass("fade-bottom");
	});

	it("stays on the assistant when its answers are scrolled with the wheel", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openAssistant(user);

		fireEvent.wheel(screen.getByLabelText("Zara assistant"), { deltaY: 120 });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});

		expect(screen.getByLabelText("Message Zara")).toBeInTheDocument();
	});

	it("closes only after the pointer has been away for over a second", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openAssistant(user);
		const rememberedPanels = () =>
			calls("save_setting").filter((call) => call.args?.key === "zara-notch-last-panel");

		// The user clicked into another app, so the notch is no longer held open for typing.
		fireEvent.blur(window);
		emitTauriEvent("notch-pointer-left");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(rememberedPanels()).toHaveLength(0);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(400);
		});
		expect(rememberedPanels().map((call) => call.args?.value)).toEqual(["ai"]);
	});

	it("stays open when the pointer comes back before the delay is up", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(<App />);
		await openAssistant(user);

		fireEvent.blur(window);
		emitTauriEvent("notch-pointer-left");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(600);
		});
		fireEvent.mouseMove(screen.getByLabelText("Zara assistant"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(screen.getByLabelText("Message Zara")).toBeInTheDocument();
	});
});

describe("the shelf", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.setItem("zara-first-run", "done");
		localStorage.setItem("zara-app-version", "0.1.0");
		registerQuietBackend();
		setInvokeHandler("shelf_thumbnail", () => ({ thumb: null, text: null, folder: false }));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows dropped text as a shelf item", async () => {
		render(<App />);
		await waitFor(() => expect(calls("setup_shelf_drop").length).toBeGreaterThan(0));

		await act(async () => {
			emitTauriEvent("shelf-drag-drop", { text: "remember the milk" });
		});

		expect(await screen.findByText("remember the milk")).toBeInTheDocument();
	});

	it("shows a dropped file under its file name and asks the backend for a preview", async () => {
		render(<App />);
		await waitFor(() => expect(calls("setup_shelf_drop").length).toBeGreaterThan(0));

		await act(async () => {
			emitTauriEvent("shelf-drag-drop", { paths: ["C:\\Users\\sam\\Documents\\report.pdf"] });
		});

		expect((await screen.findAllByText("report.pdf")).length).toBeGreaterThan(0);
		await waitFor(() => {
			expect(calls("shelf_thumbnail").map((call) => call.args?.path)).toContain(
				"C:\\Users\\sam\\Documents\\report.pdf"
			);
		});
	});

	it("keeps one item when the same text is dropped twice", async () => {
		render(<App />);
		await waitFor(() => expect(calls("setup_shelf_drop").length).toBeGreaterThan(0));

		await act(async () => {
			emitTauriEvent("shelf-drag-drop", { text: "same note" });
		});
		await act(async () => {
			emitTauriEvent("shelf-drag-drop", { text: "same note" });
		});

		expect(await screen.findAllByText("same note")).toHaveLength(1);
	});
});
