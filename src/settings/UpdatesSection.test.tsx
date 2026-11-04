import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { UpdatesSection } from "./UpdatesSection";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";

const checkMock = vi.mocked(check);

beforeEach(() => {
	checkMock.mockReset();
	setInvokeHandler("load_settings", () => ({}));
	setInvokeHandler("save_setting", () => null);
});

describe("UpdatesSection", () => {
	it("says which version is installed before anything is checked", () => {
		render(<UpdatesSection appVersion="0.1.0" />);

		expect(screen.getByText("You have version 0.1.0.")).toBeInTheDocument();
	});

	it("says when this is already the newest version", async () => {
		checkMock.mockResolvedValue(null);
		render(<UpdatesSection appVersion="0.1.0" />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Check now" }));

		expect(await screen.findByText("Zara 0.1.0 is the latest version.")).toBeInTheDocument();
	});

	it("offers to install a newer version", async () => {
		checkMock.mockResolvedValue({ version: "0.2.0", downloadAndInstall: vi.fn() } as never);
		render(<UpdatesSection appVersion="0.1.0" />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Check now" }));

		expect(await screen.findByText("Zara 0.2.0 is available.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Install 0.2.0" })).toBeInTheDocument();
	});

	it("shows the download as it goes when installing", async () => {
		let reportProgress: (event: unknown) => void = () => {};
		let finish: () => void = () => {};
		checkMock.mockResolvedValue({
			version: "0.2.0",
			downloadAndInstall: (onEvent: (event: unknown) => void) => {
				reportProgress = onEvent;
				return new Promise<void>((resolve) => (finish = resolve));
			}
		} as never);
		render(<UpdatesSection appVersion="0.1.0" />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Check now" }));
		await user.click(await screen.findByRole("button", { name: "Install 0.2.0" }));

		reportProgress({ event: "Started", data: { contentLength: 100 } });
		reportProgress({ event: "Progress", data: { chunkLength: 40 } });

		expect(await screen.findByText("Downloading the update… 40%")).toBeInTheDocument();
		finish();
	});

	it("explains a failed check without leaving the button stuck", async () => {
		checkMock.mockRejectedValue(new Error("network down"));
		render(<UpdatesSection appVersion="0.1.0" />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Check now" }));

		expect(await screen.findByText(/Check your internet connection/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
	});

	it("checks automatically unless the user turned it off", () => {
		render(<UpdatesSection appVersion="0.1.0" />);

		expect(screen.getByRole("switch", { name: "Check for updates automatically" })).toBeChecked();
	});

	it("shows the saved choice not to check", async () => {
		setInvokeHandler("load_settings", () => ({ "zara-auto-update-check": "false" }));
		render(<UpdatesSection appVersion="0.1.0" />);

		await waitFor(() =>
			expect(
				screen.getByRole("switch", { name: "Check for updates automatically" })
			).not.toBeChecked()
		);
	});

	it("saves the choice when the switch is flipped", async () => {
		render(<UpdatesSection appVersion="0.1.0" />);
		const user = userEvent.setup();

		await user.click(screen.getByRole("switch", { name: "Check for updates automatically" }));

		await waitFor(() =>
			expect(invokeCalls.find((call) => call.command === "save_setting")?.args).toEqual({
				key: "zara-auto-update-check",
				value: "false"
			})
		);
	});
});
