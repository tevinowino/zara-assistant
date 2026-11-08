import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetPanelShell } from "./WidgetPanelShell";

describe("WidgetPanelShell", () => {
	it("draws its content while the notch shows its widget", () => {
		render(
			<WidgetPanelShell panel="notes" zaraMode="notes" className="notes-panel">
				<p>Inside the widget</p>
			</WidgetPanelShell>
		);

		expect(screen.getByText("Inside the widget")).toBeInTheDocument();
	});

	it("draws nothing while the notch shows another view", () => {
		render(
			<WidgetPanelShell panel="notes" zaraMode="calendar" className="notes-panel">
				<p>Inside the widget</p>
			</WidgetPanelShell>
		);

		expect(screen.queryByText("Inside the widget")).not.toBeInTheDocument();
	});

	it("keeps a click inside the widget from reaching the notch, which would close it", async () => {
		const onNotchClick = vi.fn();
		render(
			<div onClick={onNotchClick}>
				<WidgetPanelShell panel="clipboard" zaraMode="clipboard" className="clipboard-panel">
					<button type="button">Copy again</button>
				</WidgetPanelShell>
			</div>
		);

		await userEvent.click(screen.getByRole("button", { name: "Copy again" }));

		expect(onNotchClick).not.toHaveBeenCalled();
	});

	it("marks a widget that scrolls itself so the wheel scrolls it instead of switching widgets", () => {
		const { container } = render(
			<WidgetPanelShell panel="notes" zaraMode="notes" className="notes-panel" ownsScroll>
				<p>Inside the widget</p>
			</WidgetPanelShell>
		);

		expect(container.querySelector(".notes-panel")).toHaveAttribute("data-owns-scroll", "true");
	});

	it("does not mark a widget that does not scroll itself", () => {
		const { container } = render(
			<WidgetPanelShell panel="weather" zaraMode="weather" className="weather-panel">
				<p>Inside the widget</p>
			</WidgetPanelShell>
		);

		expect(container.querySelector(".weather-panel")).not.toHaveAttribute("data-owns-scroll");
	});
});
