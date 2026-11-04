import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandTile } from "./CommandTile";

describe("CommandTile", () => {
	it("shows its title and one line of status", () => {
		render(<CommandTile icon={null} title="Wi-Fi" status="Home" onPress={() => {}} />);

		expect(screen.getByRole("button", { name: /Wi-Fi/ })).toHaveTextContent("Wi-Fi");
		expect(screen.getByText("Home")).toBeInTheDocument();
	});

	it("draws its icon", () => {
		render(
			<CommandTile
				icon={<svg data-testid="icon" />}
				title="Wi-Fi"
				status="Off"
				onPress={() => {}}
			/>
		);

		expect(screen.getByTestId("icon")).toBeInTheDocument();
	});

	it("is a toggle button, pressed when the thing is on", () => {
		render(<CommandTile icon={null} title="Bluetooth" status="On" pressed onPress={() => {}} />);

		expect(screen.getByRole("button", { name: /Bluetooth/ })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("is a toggle button, not pressed when the thing is off", () => {
		render(
			<CommandTile icon={null} title="Bluetooth" status="Off" pressed={false} onPress={() => {}} />
		);

		expect(screen.getByRole("button", { name: /Bluetooth/ })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
	});

	it("is not a toggle when it only opens something", () => {
		render(<CommandTile icon={null} title="Energy Saver" status="Off" onPress={() => {}} />);

		expect(screen.getByRole("button", { name: /Energy Saver/ })).not.toHaveAttribute(
			"aria-pressed"
		);
	});

	it("lights up when on", () => {
		const { container } = render(
			<CommandTile icon={null} title="Wi-Fi" status="Home" pressed onPress={() => {}} />
		);

		expect(container.querySelector(".cc-tile")).toHaveClass("lit");
	});

	it("is not lit when off", () => {
		const { container } = render(
			<CommandTile icon={null} title="Wi-Fi" status="Off" pressed={false} onPress={() => {}} />
		);

		expect(container.querySelector(".cc-tile")).not.toHaveClass("lit");
	});

	it("can be lit without being a toggle", () => {
		const { container } = render(
			<CommandTile icon={null} title="Notch" status="Fixed" lit onPress={() => {}} />
		);

		expect(container.querySelector(".cc-tile")).toHaveClass("lit");
	});

	it("takes the green tone for power saving", () => {
		const { container } = render(
			<CommandTile icon={null} title="Energy Saver" status="On" tone="green" onPress={() => {}} />
		);

		expect(container.querySelector(".cc-tile")).toHaveClass("cc-tile--green");
	});

	it("takes the accent tone by default", () => {
		const { container } = render(
			<CommandTile icon={null} title="Wi-Fi" status="On" onPress={() => {}} />
		);

		expect(container.querySelector(".cc-tile")).toHaveClass("cc-tile--accent");
	});

	it("presses when clicked", async () => {
		const onPress = vi.fn();
		render(<CommandTile icon={null} title="Wi-Fi" status="Off" onPress={onPress} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Wi-Fi/ }));

		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("keeps the click from reaching the notch around it", async () => {
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<CommandTile icon={null} title="Wi-Fi" status="Off" onPress={() => {}} />
			</div>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Wi-Fi/ }));

		expect(notchClick).not.toHaveBeenCalled();
	});

	it("passes a right-click on to the secondary action", () => {
		const onSecondaryPress = vi.fn();
		render(
			<CommandTile
				icon={null}
				title="Wi-Fi"
				status="Off"
				onPress={() => {}}
				onSecondaryPress={onSecondaryPress}
			/>
		);

		fireEvent.contextMenu(screen.getByRole("button", { name: /Wi-Fi/ }));

		expect(onSecondaryPress).toHaveBeenCalledTimes(1);
	});

	it("has no more button unless it was given one", () => {
		render(<CommandTile icon={null} title="Wi-Fi" status="Off" onPress={() => {}} />);

		expect(screen.getAllByRole("button")).toHaveLength(1);
	});

	it("opens what is behind it from a separate button, without pressing the tile", async () => {
		const onPress = vi.fn();
		const onMore = vi.fn();
		render(
			<CommandTile
				icon={null}
				title="Wi-Fi"
				status="Off"
				onPress={onPress}
				more={{ label: "Wi-Fi networks", onPress: onMore }}
			/>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Wi-Fi networks" }));

		expect(onMore).toHaveBeenCalledTimes(1);
		expect(onPress).not.toHaveBeenCalled();
	});

	it("shows its hint as the tooltip", () => {
		render(
			<CommandTile
				icon={null}
				title="Wi-Fi"
				status="Off"
				hint="Click to toggle"
				onPress={() => {}}
			/>
		);

		expect(screen.getByRole("button", { name: /Wi-Fi/ })).toHaveAttribute(
			"title",
			"Click to toggle"
		);
	});
	it("is named by its title and status for assistive technology", () => {
		render(<CommandTile icon={null} title="Wi-Fi" status="Home" onPress={() => {}} />);

		expect(screen.getByRole("button", { name: "Wi-Fi, Home" })).toBeInTheDocument();
	});

	it("uses the label it is given instead of the title and status", () => {
		render(
			<CommandTile
				icon={null}
				title="Energy"
				status="Saver On"
				label="Energy Saver, On"
				onPress={() => {}}
			/>
		);

		expect(screen.getByRole("button", { name: "Energy Saver, On" })).toBeInTheDocument();
	});
});
