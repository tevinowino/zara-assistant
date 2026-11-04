import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Power } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

describe("SettingSwitch", () => {
	it("is named after the setting row it sits in", () => {
		render(
			<SettingRow icon={Power} label="Launch at Login">
				<SettingSwitch checked={false} onToggle={() => {}} />
			</SettingRow>
		);

		expect(screen.getByRole("switch", { name: "Launch at Login" })).toBeInTheDocument();
	});

	it("prefers an explicit name over the row label", () => {
		render(
			<SettingRow icon={Power} label="Web search">
				<SettingSwitch checked={false} onToggle={() => {}} aria-label="Let Zara search the web" />
			</SettingRow>
		);

		expect(screen.getByRole("switch", { name: "Let Zara search the web" })).toBeInTheDocument();
	});

	it("reports whether the setting is on", () => {
		render(
			<SettingRow icon={Power} label="24-Hour Time">
				<SettingSwitch checked={true} onToggle={() => {}} />
			</SettingRow>
		);

		expect(screen.getByRole("switch", { name: "24-Hour Time" })).toBeChecked();
	});

	it("asks to toggle once when clicked", async () => {
		const onToggle = vi.fn();
		render(
			<SettingRow icon={Power} label="Launch at Login">
				<SettingSwitch checked={false} onToggle={onToggle} />
			</SettingRow>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Launch at Login" }));

		expect(onToggle).toHaveBeenCalledTimes(1);
		expect(onToggle).toHaveBeenCalledWith();
	});

	it("does nothing when disabled", async () => {
		const onToggle = vi.fn();
		render(
			<SettingRow icon={Power} label="Calendar panel">
				<SettingSwitch checked={true} onToggle={onToggle} disabled />
			</SettingRow>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Calendar panel" }));

		expect(onToggle).not.toHaveBeenCalled();
	});
});
