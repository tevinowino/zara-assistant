import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiPanel } from "./AiPanel";
import { AI_PANEL_HEIGHT } from "./panelSize";
import { useAiSession } from "./useAiSession";
import { setInvokeHandler } from "../test/shims/tauriCore";

function Harness({ onDesiredHeight }: { onDesiredHeight: (height: number) => void }) {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} onDesiredHeight={onDesiredHeight} />;
}

function registerBackend(answer: string, pastChats: object[] = []) {
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
	setInvokeHandler("conv_list", () => pastChats);
	setInvokeHandler("ai_chat", () => ({
		text: answer,
		usedScreen: false,
		usedNotes: false,
		savedMemories: [],
		noteChanges: []
	}));
	setInvokeHandler("conv_save", () => ({}));
	setInvokeHandler("conv_generate_title", () => ({ title: null }));
}

// jsdom has no layout, so give the panel and its message area the sizes a real
// browser would measure: a 344 px panel (the notch minus its 36 px top row)
// whose 200 px message area holds `contentHeight` px of answers, or, before the
// first question, `welcomeHeight` px of greeting, suggestions and recent chats
// (90 px fits the 270 px welcome panel without growing it).
function pretendLayout(contentHeight: number, welcomeHeight = 90) {
	const proto = HTMLElement.prototype;
	const originals = {
		offsetTop: Object.getOwnPropertyDescriptor(proto, "offsetTop"),
		offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
		clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
		scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight")
	};
	const isMessages = (element: HTMLElement) => element.classList.contains("zai-messages");
	Object.defineProperty(proto, "offsetHeight", {
		configurable: true,
		get(this: HTMLElement) {
			if (this.classList.contains("zai-panel")) return 344;
			return isMessages(this) ? 200 : 0;
		}
	});
	// The message area starts 40 px down the panel (its header), so 104 px is left
	// below it for the input and the panel padding.
	Object.defineProperty(proto, "offsetTop", {
		configurable: true,
		get(this: HTMLElement) {
			return isMessages(this) ? 40 : 0;
		}
	});
	Object.defineProperty(proto, "clientHeight", {
		configurable: true,
		get(this: HTMLElement) {
			return isMessages(this) ? 200 : 0;
		}
	});
	Object.defineProperty(proto, "scrollHeight", {
		configurable: true,
		get(this: HTMLElement) {
			if (!isMessages(this)) return 0;
			return this.querySelector(".zai-welcome") ? welcomeHeight : Math.max(contentHeight, 200);
		}
	});
	return () => {
		for (const [name, descriptor] of Object.entries(originals)) {
			if (descriptor) Object.defineProperty(proto, name, descriptor);
			else delete (proto as unknown as Record<string, unknown>)[name];
		}
	};
}

let restoreLayout: (() => void) | null = null;
afterEach(() => restoreLayout?.());

describe("the assistant panel growing to fit an answer", () => {
	it("asks the notch for more height when the answer is taller than the panel", async () => {
		registerBackend("A long answer.");
		restoreLayout = pretendLayout(330);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "tell me everything{Enter}");
		await screen.findByText("A long answer.");

		// 344 panel - 200 message area + 330 content + 36 top row = 510, grown in
		// steps of 24 px, so 528.
		expect(onDesiredHeight).toHaveBeenLastCalledWith(528);
	});

	it("stops growing at the tallest the panel may be", async () => {
		registerBackend("A very long answer.");
		restoreLayout = pretendLayout(5000);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "tell me everything{Enter}");
		await screen.findByText("A very long answer.");

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.max);
	});

	it("keeps the conversation height for a short answer", async () => {
		registerBackend("Short.");
		restoreLayout = pretendLayout(100);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "hi{Enter}");
		await screen.findByText("Short.");

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.conversation);
	});

	it("keeps the welcome height when the greeting fits", async () => {
		registerBackend("unused");
		restoreLayout = pretendLayout(0, 90);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);

		await screen.findByLabelText("Message Zara");

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.welcome);
	});

	it("grows the welcome panel to show the recent chats once they arrive", async () => {
		const pastChat = (id: string, title: string) => ({
			id,
			title,
			createdAt: 1,
			updatedAt: 2,
			messageCount: 2
		});
		registerBackend("unused", [
			pastChat("chat-1", "Introduction to Big O Notation"),
			pastChat("chat-2", "Start a 25 minute focus timer"),
			pastChat("chat-3", "Plan the week")
		]);
		restoreLayout = pretendLayout(0, 190);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);

		await screen.findByText("Introduction to Big O Notation");

		// 344 panel - 200 message area + 190 welcome + 36 top row = 370, in steps of 24, so 384.
		expect(onDesiredHeight).toHaveBeenLastCalledWith(384);
	});

	it("goes back to the welcome height when a new chat is started", async () => {
		registerBackend("A long answer.");
		restoreLayout = pretendLayout(330);
		const onDesiredHeight = vi.fn();
		render(<Harness onDesiredHeight={onDesiredHeight} />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "tell me everything{Enter}");
		await screen.findByText("A long answer.");

		await user.click(screen.getByRole("button", { name: "New conversation" }));

		expect(onDesiredHeight).toHaveBeenLastCalledWith(AI_PANEL_HEIGHT.welcome);
	});

	it("makes the message list dissolve over a soft edge when its end is above the readable limit", async () => {
		registerBackend("A long answer.");
		restoreLayout = pretendLayout(330);
		const { container } = render(<Harness onDesiredHeight={vi.fn()} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "tell me everything{Enter}");
		await screen.findByText("A long answer.");

		// 510 px notch, list ends at 406 px, readable limit about 418 px.
		const panel = container.querySelector(".zai-panel") as HTMLElement;
		expect(panel.style.getPropertyValue("--zai-dissolve")).toBe("24px");
	});

	it("makes the message list dissolve over a longer edge when it reaches past the readable limit", async () => {
		registerBackend("A very long answer.");
		restoreLayout = pretendLayout(5000);
		const { container } = render(<Harness onDesiredHeight={vi.fn()} />);
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText("Message Zara"), "tell me everything{Enter}");
		await screen.findByText("A very long answer.");

		// 600 px notch, list ends at 496 px, readable limit about 492 px.
		const panel = container.querySelector(".zai-panel") as HTMLElement;
		const length = Number.parseFloat(panel.style.getPropertyValue("--zai-dissolve"));
		expect(length).toBeGreaterThan(24);
	});
});
