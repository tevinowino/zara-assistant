import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AskBar } from "./AskBar";

describe("AskBar", () => {
	it("sends the trimmed question on Enter and clears the field", async () => {
		const onSubmit = vi.fn();
		render(<AskBar busy={false} onSubmit={onSubmit} onFocusChange={() => {}} />);
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Ask Zara"), "  what is on my calendar?  {Enter}");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("what is on my calendar?");
		expect(screen.getByLabelText("Ask Zara")).toHaveValue("");
	});

	it("sends the question when the send button is clicked", async () => {
		const onSubmit = vi.fn();
		render(<AskBar busy={false} onSubmit={onSubmit} onFocusChange={() => {}} />);
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Ask Zara"), "set a timer");
		await user.click(screen.getByRole("button", { name: "Send" }));

		expect(onSubmit).toHaveBeenCalledWith("set a timer");
	});

	it("does nothing on Enter when the field is empty or only spaces", async () => {
		const onSubmit = vi.fn();
		render(<AskBar busy={false} onSubmit={onSubmit} onFocusChange={() => {}} />);
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Ask Zara"), "   {Enter}");

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("disables the send button until there is something to send", async () => {
		render(<AskBar busy={false} onSubmit={() => {}} onFocusChange={() => {}} />);
		const user = userEvent.setup();

		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
		await user.type(screen.getByLabelText("Ask Zara"), "hi");
		expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
	});

	it("does not send on the Enter that confirms an input-method composition", async () => {
		const onSubmit = vi.fn();
		render(<AskBar busy={false} onSubmit={onSubmit} onFocusChange={() => {}} />);
		const field = screen.getByLabelText("Ask Zara");
		const user = userEvent.setup();
		await user.type(field, "nihao");

		// jsdom has no composition support, so mark the event the way a browser does.
		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true
		});
		Object.defineProperty(enter, "isComposing", { value: true });
		field.dispatchEvent(enter);

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("shows Thinking and refuses input while an answer is pending", async () => {
		const onSubmit = vi.fn();
		render(<AskBar busy={true} onSubmit={onSubmit} onFocusChange={() => {}} />);

		expect(screen.getByLabelText("Ask Zara")).toBeDisabled();
		expect(screen.getByPlaceholderText("Thinking…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
	});

	it("reports focus and blur, and leaves the field on Escape", async () => {
		const onFocusChange = vi.fn();
		render(<AskBar busy={false} onSubmit={() => {}} onFocusChange={onFocusChange} />);
		const user = userEvent.setup();

		await user.click(screen.getByLabelText("Ask Zara"));
		expect(onFocusChange).toHaveBeenLastCalledWith(true);

		await user.keyboard("{Escape}");
		expect(screen.getByLabelText("Ask Zara")).not.toHaveFocus();
		expect(onFocusChange).toHaveBeenLastCalledWith(false);
	});

	it("reports that focus ended when it is removed while focused", async () => {
		const onFocusChange = vi.fn();
		const { unmount } = render(
			<AskBar busy={false} onSubmit={() => {}} onFocusChange={onFocusChange} />
		);
		const user = userEvent.setup();
		await user.click(screen.getByLabelText("Ask Zara"));

		unmount();

		expect(onFocusChange).toHaveBeenLastCalledWith(false);
	});
});
