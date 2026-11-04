import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { setInvokeHandler } from "../test/shims/tauriCore";

// The notch owns the session and mounts the panel only while it is open, so the
// panel is closed and reopened here without losing the session.
function NotchThatClosesAndReopens() {
	const session = useAiSession();
	const [open, setOpen] = useState(true);
	return (
		<>
			<button type="button" onClick={() => setOpen((value) => !value)}>
				toggle
			</button>
			{open && <AiPanel session={session} onClose={() => {}} />}
		</>
	);
}

const storedTrip = {
	id: "trip-1",
	title: "Trip planning",
	createdAt: 1,
	updatedAt: 2,
	messages: [
		{ id: "m1", role: "user", text: "Plan three days in Lisbon", createdAt: 1 },
		{ id: "m2", role: "assistant", text: "Day one: Alfama.", createdAt: 2 }
	]
};

function registerQuietAssistantBackend() {
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("save_setting", () => null);
}

describe("the assistant panel when the notch closes and reopens", () => {
	it("keeps what the user had typed but not sent", async () => {
		registerQuietAssistantBackend();
		render(<NotchThatClosesAndReopens />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Message Zara"), "remind me to buy");

		await user.click(screen.getByRole("button", { name: "toggle" }));
		await user.click(screen.getByRole("button", { name: "toggle" }));

		expect(await screen.findByLabelText("Message Zara")).toHaveValue("remind me to buy");
	});

	it("returns to where the user was reading in a long answer", async () => {
		registerQuietAssistantBackend();
		localStorage.setItem("zara-ai-last-conversation", "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		function Host() {
			const session = useAiSession({ resumeLast: true });
			const [open, setOpen] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setOpen((value) => !value)}>
						toggle
					</button>
					{open && <AiPanel session={session} onClose={() => {}} />}
				</>
			);
		}
		const { container } = render(<Host />);
		const user = userEvent.setup();
		await screen.findByText("Day one: Alfama.");
		const messages = container.querySelector(".zai-messages") as HTMLElement;
		// jsdom has no layout, so give the answer a height to scroll within.
		Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
		Object.defineProperty(messages, "clientHeight", { value: 200, configurable: true });
		messages.scrollTop = 120;
		fireEvent.scroll(messages);

		await user.click(screen.getByRole("button", { name: "toggle" }));
		await user.click(screen.getByRole("button", { name: "toggle" }));

		const reopened = (await screen.findByLabelText("Zara assistant")).querySelector(
			".zai-messages"
		) as HTMLElement;
		expect(reopened.scrollTop).toBe(120);
	});

	it("tells the user which conversation it picked up", async () => {
		registerQuietAssistantBackend();
		localStorage.setItem("zara-ai-last-conversation", "trip-1");
		setInvokeHandler("conv_load", () => storedTrip);
		function Host() {
			const session = useAiSession({ resumeLast: true });
			return <AiPanel session={session} onClose={() => {}} />;
		}

		render(<Host />);

		expect(await screen.findByText("Continuing: Trip planning")).toBeInTheDocument();
		expect(screen.getByText("Day one: Alfama.")).toBeInTheDocument();
	});
});
