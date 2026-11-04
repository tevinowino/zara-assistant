import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelSwitcher } from "./PanelSwitcher";

describe("PanelSwitcher", () => {
	it("lists its views as tabs and marks the selected one", () => {
		render(
			<PanelSwitcher
				aria-label="Calendar or timer"
				value="calendar"
				onValueChange={() => {}}
				items={[
					{ value: "calendar", label: "Calendar" },
					{ value: "timer", label: "Timer" }
				]}
			/>
		);

		expect(screen.getByRole("tablist", { name: "Calendar or timer" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "Timer" })).toHaveAttribute("aria-selected", "false");
	});

	it("asks to switch to the view that was clicked", async () => {
		const onValueChange = vi.fn();
		render(
			<PanelSwitcher
				aria-label="Calendar or timer"
				value="calendar"
				onValueChange={onValueChange}
				items={[
					{ value: "calendar", label: "Calendar" },
					{ value: "timer", label: "Timer" }
				]}
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: "Timer" }));

		expect(onValueChange).toHaveBeenCalledWith("timer");
	});

	it("shows a badge beside a label", () => {
		render(
			<PanelSwitcher
				aria-label="Calendar or timer"
				value="calendar"
				onValueChange={() => {}}
				items={[
					{ value: "calendar", label: "Calendar" },
					{ value: "timer", label: "Timer", badge: "12:30" }
				]}
			/>
		);

		expect(screen.getByRole("tab", { name: "Timer 12:30" })).toBeInTheDocument();
	});

	it("marks a badge that needs attention", () => {
		render(
			<PanelSwitcher
				aria-label="Calendar or timer"
				value="calendar"
				onValueChange={() => {}}
				items={[
					{ value: "calendar", label: "Calendar" },
					{ value: "timer", label: "Timer", badge: "Ended", alert: true }
				]}
			/>
		);

		expect(screen.getByText("Ended")).toHaveClass("alert");
	});
});
