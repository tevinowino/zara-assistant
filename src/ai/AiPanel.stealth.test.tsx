import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiPanel } from "./AiPanel";
import { useAiSession } from "./useAiSession";
import { setInvokeHandler } from "../test/shims/tauriCore";
import type { StealthStatus } from "./api";

// The notch mounts the session once and hands it to the panel; this does the same.
function Harness({ stealth }: { stealth?: Parameters<typeof AiPanel>[0]["stealth"] }) {
	const session = useAiSession();
	return <AiPanel session={session} onClose={() => {}} stealth={stealth} />;
}

function backendWithKey() {
	setInvokeHandler("shortcut_active", () => ({}));
	setInvokeHandler("ai_has_api_key", () => true);
	setInvokeHandler("conv_save", () => ({}));
}

const supportedOff: StealthStatus = {
	requested: false,
	supported: true,
	active: false,
	problem: null,
	windows: []
};

describe("AiPanel stealth button", () => {
	it("is not shown when the panel is not given stealth", async () => {
		backendWithKey();

		render(<Harness />);
		await screen.findByLabelText("Message Zara");

		expect(screen.queryByRole("button", { name: "Stealth mode" })).not.toBeInTheDocument();
	});

	it("is not shown until the status is known", async () => {
		backendWithKey();

		render(<Harness stealth={{ status: null, busy: false, toggle: vi.fn() }} />);
		await screen.findByLabelText("Message Zara");

		expect(screen.queryByRole("button", { name: "Stealth mode" })).not.toBeInTheDocument();
	});

	it("is not shown where this Windows cannot hide windows from capture", async () => {
		backendWithKey();

		render(
			<Harness
				stealth={{
					status: { ...supportedOff, supported: false },
					busy: false,
					toggle: vi.fn()
				}}
			/>
		);
		await screen.findByLabelText("Message Zara");

		expect(screen.queryByRole("button", { name: "Stealth mode" })).not.toBeInTheDocument();
	});

	it("shows as off and offers to hide Zara from capture", async () => {
		backendWithKey();

		render(<Harness stealth={{ status: supportedOff, busy: false, toggle: vi.fn() }} />);

		const button = await screen.findByRole("button", { name: "Stealth mode" });
		expect(button).toHaveAttribute("aria-pressed", "false");
		expect(button).toHaveAttribute("title", "Stealth: hide Zara from screen capture and sharing.");
	});

	it("shows as on, and says how to turn it off", async () => {
		backendWithKey();

		render(
			<Harness
				stealth={{
					status: { ...supportedOff, requested: true, active: true },
					busy: false,
					toggle: vi.fn()
				}}
			/>
		);

		const button = await screen.findByRole("button", { name: "Stealth mode" });
		expect(button).toHaveAttribute("aria-pressed", "true");
		expect(button).toHaveClass("on");
		expect(button.getAttribute("title")).toMatch(/Stealth is on.*Click to turn it off/);
	});

	it("toggles stealth when clicked", async () => {
		backendWithKey();
		const toggle = vi.fn();
		render(<Harness stealth={{ status: supportedOff, busy: false, toggle }} />);
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: "Stealth mode" }));

		expect(toggle).toHaveBeenCalledTimes(1);
	});

	it("waits while a change is under way", async () => {
		backendWithKey();

		render(<Harness stealth={{ status: supportedOff, busy: true, toggle: vi.fn() }} />);

		expect(await screen.findByRole("button", { name: "Stealth mode" })).toBeDisabled();
	});
});
