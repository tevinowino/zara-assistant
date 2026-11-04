import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSidebar } from "./SettingsSidebar";
import { SETTINGS_TABS } from "./settingsTabs";

describe("SettingsSidebar", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("is a navigation landmark named for the settings sections", () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);

		expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
	});

	it("lists every section by name, never as an icon alone", () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);

		for (const label of [
			"General",
			"Appearance",
			"Notch",
			"Assistant",
			"Library",
			"Overlays",
			"About"
		]) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
		}
	});

	it("marks the current section for assistive technology", () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="notch" onSelect={() => {}} />);

		expect(screen.getByRole("button", { name: "Notch" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current");
	});

	it("highlights the current section", () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="library" onSelect={() => {}} />);

		expect(screen.getByRole("button", { name: "Library" })).toHaveClass("active");
		expect(screen.getByRole("button", { name: "About" })).not.toHaveClass("active");
	});

	it("asks to open the section that was clicked", async () => {
		const onSelect = vi.fn();
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={onSelect} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Assistant" }));

		expect(onSelect).toHaveBeenCalledWith("assistant");
	});

	it("opens a section from the keyboard", async () => {
		const onSelect = vi.fn();
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={onSelect} />);
		const user = userEvent.setup();

		screen.getByRole("button", { name: "Overlays" }).focus();
		await user.keyboard("{Enter}");

		expect(onSelect).toHaveBeenCalledWith("overlays");
	});

	it("hides the decorative icons from assistive technology", () => {
		const { container } = render(
			<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />
		);

		for (const icon of container.querySelectorAll(".sidebar-tab-icon")) {
			expect(icon).toHaveAttribute("aria-hidden", "true");
		}
	});
});

describe("SettingsSidebar search", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("narrows the sections to the ones matching what was typed", async () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();

		await user.type(screen.getByRole("searchbox", { name: "Search settings" }), "glow");

		expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "General" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Library" })).not.toBeInTheDocument();
	});

	it("says so when no section matches", async () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();

		await user.type(screen.getByRole("searchbox", { name: "Search settings" }), "zzzz");

		expect(screen.getByRole("status")).toHaveTextContent("No section matches");
		expect(screen.queryByRole("button", { name: "General" })).not.toBeInTheDocument();
	});

	it("opens the first match on Enter and clears the search", async () => {
		const onSelect = vi.fn();
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={onSelect} />);
		const user = userEvent.setup();
		const search = screen.getByRole("searchbox", { name: "Search settings" });

		await user.type(search, "weather{Enter}");

		expect(onSelect).toHaveBeenCalledWith("notch");
		expect(search).toHaveValue("");
	});

	it("clears the search on Escape", async () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();
		const search = screen.getByRole("searchbox", { name: "Search settings" });

		await user.type(search, "glow{Escape}");

		expect(search).toHaveValue("");
		expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
	});

	it("moves focus to the search on Ctrl+F", async () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();

		await user.keyboard("{Control>}f{/Control}");

		expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveFocus();
	});
});

describe("SettingsSidebar layout", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("lists About under its own Other heading, apart from the main sections", () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);

		const otherGroup = screen.getByText("Other").closest(".sidebar-group");
		expect(otherGroup).toContainElement(screen.getByRole("button", { name: "About" }));
		expect(otherGroup).not.toContainElement(screen.getByRole("button", { name: "General" }));
	});

	it("folds to icons when the collapse button is pressed, keeping every section's name", async () => {
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

		expect(screen.getByRole("navigation", { name: "Settings sections" })).toHaveAttribute(
			"data-collapsed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
			"aria-expanded",
			"false"
		);
		expect(screen.getByRole("button", { name: "Notch" })).toBeInTheDocument();
	});

	it("remembers that it was folded", async () => {
		const first = render(
			<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
		first.unmount();

		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);

		expect(screen.getByRole("navigation", { name: "Settings sections" })).toHaveAttribute(
			"data-collapsed",
			"true"
		);
	});

	it("unfolds again on Ctrl+F so the search can be seen", async () => {
		localStorage.setItem("zara-settings-sidebar-collapsed", "true");
		render(<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={() => {}} />);
		const user = userEvent.setup();

		await user.keyboard("{Control>}f{/Control}");

		expect(screen.getByRole("navigation", { name: "Settings sections" })).toHaveAttribute(
			"data-collapsed",
			"false"
		);
	});

	it("shows the version on the updates card and opens About to check for updates", async () => {
		const onSelect = vi.fn();
		render(
			<SettingsSidebar tabs={SETTINGS_TABS} active="general" onSelect={onSelect} appVersion="0.2.0" />
		);
		const user = userEvent.setup();

		expect(screen.getByText("Zara 0.2.0")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Check for updates" }));

		expect(onSelect).toHaveBeenCalledWith("about");
	});
});
