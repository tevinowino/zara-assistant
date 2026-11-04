import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickAppsSection } from "./QuickAppsSection";
import { setInvokeHandler } from "../test/shims/tauriCore";
import type { QuickApp } from "../notch/apps/quickApps";

const openDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));

const app = (name: string): QuickApp => ({ name, target: `C:\\Apps\\${name}.lnk` });

const installed = [
	{ name: "Calculator", path: "C:\\Apps\\Calculator.lnk" },
	{ name: "Notepad", path: "C:\\Apps\\Notepad.lnk" },
	{ name: "Spotify", path: "C:\\Apps\\Spotify.lnk" }
];

function renderSection(
	apps: QuickApp[],
	handlers: Partial<Parameters<typeof QuickAppsSection>[0]> = {}
) {
	return render(
		<QuickAppsSection
			apps={apps}
			onAdd={() => {}}
			onRemove={() => {}}
			onMove={() => {}}
			{...handlers}
		/>
	);
}

describe("QuickAppsSection", () => {
	beforeEach(() => {
		openDialog.mockReset();
		setInvokeHandler("get_app_icon", () => null);
		setInvokeHandler("apps_list_installed", () => installed);
	});

	it("shows the chosen apps by name", () => {
		renderSection([app("Spotify"), app("Notepad")]);

		expect(screen.getByText("Spotify")).toBeInTheDocument();
		expect(screen.getByText("Notepad")).toBeInTheDocument();
	});

	it("says how many of the four places are taken", () => {
		renderSection([app("Spotify")]);

		expect(screen.getByText(/1 of 4 chosen/)).toBeInTheDocument();
	});

	it("offers to choose an app when there is room", () => {
		renderSection([]);

		expect(screen.getByRole("button", { name: "Choose…" })).toBeEnabled();
	});

	it("will not offer another app once four are chosen, and says why", () => {
		renderSection(["a", "b", "c", "d"].map(app));

		expect(screen.getByRole("button", { name: "Choose…" })).toBeDisabled();
		expect(
			screen.getByText("You can pin up to 4 apps. Remove one to add another.")
		).toBeInTheDocument();
	});

	it("opens a searchable list of the installed apps", async () => {
		renderSection([]);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Choose…" }));

		const list = await screen.findByRole("list", { name: "Installed apps" });
		expect(list).toHaveTextContent("Calculator");
		expect(list).toHaveTextContent("Notepad");
		expect(list).toHaveTextContent("Spotify");
		expect(screen.getByRole("searchbox", { name: "Search apps" })).toBeInTheDocument();
	});

	it("narrows the list as the user types", async () => {
		renderSection([]);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));
		await screen.findByRole("list", { name: "Installed apps" });

		await user.type(screen.getByRole("searchbox", { name: "Search apps" }), "note");

		const list = screen.getByRole("list", { name: "Installed apps" });
		expect(list).toHaveTextContent("Notepad");
		expect(list).not.toHaveTextContent("Spotify");
	});

	it("says when nothing matches the search", async () => {
		renderSection([]);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));
		await screen.findByRole("list", { name: "Installed apps" });

		await user.type(screen.getByRole("searchbox", { name: "Search apps" }), "zzz");

		expect(screen.getByText("No app matches “zzz”.")).toBeInTheDocument();
	});

	it("says when the list of apps cannot be read", async () => {
		setInvokeHandler("apps_list_installed", () => {
			throw new Error("unreadable");
		});
		renderSection([]);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Choose…" }));

		expect(await screen.findByText("The list of apps could not be read.")).toBeInTheDocument();
	});

	it("adds an installed app when it is clicked", async () => {
		const onAdd = vi.fn();
		renderSection([], { onAdd });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		await user.click(await screen.findByRole("button", { name: "Add Spotify" }));

		expect(onAdd).toHaveBeenCalledWith({ name: "Spotify", target: "C:\\Apps\\Spotify.lnk" });
	});

	it("shows an app that is already pinned as pinned, and cannot be added again", async () => {
		const onAdd = vi.fn();
		renderSection([app("Spotify")], { onAdd });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		const pinned = await screen.findByRole("button", { name: "Spotify, already pinned" });
		await user.click(pinned);

		expect(pinned).toBeDisabled();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("closes the picker once the last free place is taken", async () => {
		renderSection(["a", "b", "c"].map(app), { onAdd: () => {} });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		await user.click(await screen.findByRole("button", { name: "Add Spotify" }));

		expect(screen.queryByRole("list", { name: "Installed apps" })).not.toBeInTheDocument();
	});

	it("closes the picker with Done", async () => {
		renderSection([]);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));
		await screen.findByRole("list", { name: "Installed apps" });

		await user.click(screen.getByRole("button", { name: "Done" }));

		expect(screen.queryByRole("list", { name: "Installed apps" })).not.toBeInTheDocument();
	});

	it("adds a program picked from disk, named after its file", async () => {
		openDialog.mockResolvedValue("C:\\Tools\\Everything.exe");
		const onAdd = vi.fn();
		renderSection([], { onAdd });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		await user.click(await screen.findByRole("button", { name: /Browse/ }));

		await waitFor(() =>
			expect(onAdd).toHaveBeenCalledWith({
				name: "Everything",
				target: "C:\\Tools\\Everything.exe"
			})
		);
		expect(openDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				multiple: false,
				filters: [{ name: "Programs and shortcuts", extensions: ["exe", "lnk"] }]
			})
		);
	});

	it("adds nothing when the file dialog is cancelled", async () => {
		openDialog.mockResolvedValue(null);
		const onAdd = vi.fn();
		renderSection([], { onAdd });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		await user.click(await screen.findByRole("button", { name: /Browse/ }));

		await waitFor(() => expect(openDialog).toHaveBeenCalled());
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("copes with a file dialog that fails", async () => {
		openDialog.mockRejectedValue(new Error("no dialog"));
		const onAdd = vi.fn();
		renderSection([], { onAdd });
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Choose…" }));

		await user.click(await screen.findByRole("button", { name: /Browse/ }));

		await waitFor(() => expect(openDialog).toHaveBeenCalled());
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("removes an app", async () => {
		const onRemove = vi.fn();
		renderSection([app("Spotify"), app("Notepad")], { onRemove });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Remove Spotify" }));

		expect(onRemove).toHaveBeenCalledWith("C:\\Apps\\Spotify.lnk");
	});

	it("moves an app earlier and later", async () => {
		const onMove = vi.fn();
		renderSection([app("A"), app("B"), app("C")], { onMove });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Move B earlier" }));
		await user.click(screen.getByRole("button", { name: "Move B later" }));

		expect(onMove).toHaveBeenNthCalledWith(1, "C:\\Apps\\B.lnk", -1);
		expect(onMove).toHaveBeenNthCalledWith(2, "C:\\Apps\\B.lnk", 1);
	});

	it("will not offer to move the first app earlier or the last later", () => {
		renderSection([app("A"), app("B")]);

		expect(screen.getByRole("button", { name: "Move A earlier" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Move B later" })).toBeDisabled();
	});
});
