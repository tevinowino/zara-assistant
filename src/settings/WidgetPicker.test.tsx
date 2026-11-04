import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetPicker } from "./WidgetPicker";

describe("WidgetPicker", () => {
	it("lists every widget, on or off, by name with its description", () => {
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar"] }}
				onToggle={() => {}}
				onMove={() => {}}
			/>
		);

		for (const name of [
			"Assistant",
			"Calendar & Timer",
			"Command Center",
			"Connected Devices",
			"Notes",
			"Clipboard History",
			"Weather"
		]) {
			expect(screen.getByRole("switch", { name })).toBeInTheDocument();
		}
		expect(screen.getByText("Jot something down and see your latest notes.")).toBeInTheDocument();
	});

	it("shows which widgets are on", () => {
		render(
			<WidgetPicker
				preferences={{ enabled: ["notes", "ai"] }}
				onToggle={() => {}}
				onMove={() => {}}
			/>
		);

		expect(screen.getByRole("switch", { name: "Notes" })).toBeChecked();
		expect(screen.getByRole("switch", { name: "Assistant" })).toBeChecked();
		expect(screen.getByRole("switch", { name: "Weather" })).not.toBeChecked();
	});

	it("lists the widgets that are on first, in the order the notch cycles through them", () => {
		render(
			<WidgetPicker
				preferences={{ enabled: ["weather", "ai", "notes"] }}
				onToggle={() => {}}
				onMove={() => {}}
			/>
		);

		const order = screen.getAllByRole("switch").map((toggle) => toggle.getAttribute("aria-label"));

		expect(order.slice(0, 3)).toEqual(["Weather", "Assistant", "Notes"]);
	});

	it("turns a widget on", async () => {
		const onToggle = vi.fn();
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar"] }}
				onToggle={onToggle}
				onMove={() => {}}
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Notes" }));

		expect(onToggle).toHaveBeenCalledWith("notes", true);
	});

	it("turns a widget off", async () => {
		const onToggle = vi.fn();
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar"] }}
				onToggle={onToggle}
				onMove={() => {}}
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Calendar & Timer" }));

		expect(onToggle).toHaveBeenCalledWith("calendar", false);
	});

	it("keeps the last widget on, and says why", async () => {
		const onToggle = vi.fn();
		render(
			<WidgetPicker preferences={{ enabled: ["ai"] }} onToggle={onToggle} onMove={() => {}} />
		);
		const user = userEvent.setup();

		const only = screen.getByRole("switch", { name: "Assistant" });
		await user.click(only);

		expect(only).toBeDisabled();
		expect(only).toHaveAttribute("title", "The notch needs at least one widget");
		expect(onToggle).not.toHaveBeenCalled();
	});

	it("moves a widget earlier and later", async () => {
		const onMove = vi.fn();
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar", "notes"] }}
				onToggle={() => {}}
				onMove={onMove}
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Move Calendar & Timer earlier" }));
		await user.click(screen.getByRole("button", { name: "Move Calendar & Timer later" }));

		expect(onMove).toHaveBeenNthCalledWith(1, "calendar", -1);
		expect(onMove).toHaveBeenNthCalledWith(2, "calendar", 1);
	});

	it("will not offer to move the first widget earlier or the last later", () => {
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar", "notes"] }}
				onToggle={() => {}}
				onMove={() => {}}
			/>
		);

		expect(screen.getByRole("button", { name: "Move Assistant earlier" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Move Notes later" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Move Calendar & Timer earlier" })).toBeEnabled();
	});

	it("has no move buttons for a widget that is off", () => {
		render(
			<WidgetPicker
				preferences={{ enabled: ["ai", "calendar"] }}
				onToggle={() => {}}
				onMove={() => {}}
			/>
		);

		expect(screen.queryByRole("button", { name: /Move Notes/ })).not.toBeInTheDocument();
	});
});
