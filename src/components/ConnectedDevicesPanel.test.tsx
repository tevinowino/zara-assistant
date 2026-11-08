import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setInvokeHandler } from "../test/shims/tauriCore";
import type { ConnectedDevicesState } from "../hooks/useConnectedDevices";
import type { BudsBattery } from "../devices/connectedDevices";
import { ConnectedDevicesPanel } from "./ConnectedDevicesPanel";

const noPc = null;
const noBuds: Record<string, BudsBattery> = {};

function panelWith(data: ConnectedDevicesState, buds = noBuds, lowThreshold = 20) {
	return <ConnectedDevicesPanel data={data} height={400} buds={buds} lowThreshold={lowThreshold} />;
}

describe("the connected devices panel", () => {
	beforeEach(() => {
		setInvokeHandler("bluetooth_refresh_buds", () => null);
	});

	it("shows a spinner, and no empty message, while the devices are still being read", () => {
		render(panelWith({ devices: null, wired: [], pc: noPc }));

		expect(screen.queryByText("No devices connected")).not.toBeInTheDocument();
	});

	it("says so when nothing is connected", () => {
		render(panelWith({ devices: [], wired: [], pc: noPc }));

		expect(screen.getByText("No devices connected")).toBeInTheDocument();
	});

	it("shows each device with its name and battery level", () => {
		render(
			panelWith({
				devices: [
					{ id: "b1", name: "Keychron K3", kind: "keyboard", form: null, connected: true, battery: 64 },
					{ id: "b2", name: "Galaxy Watch6", kind: "wearable", form: null, connected: true, battery: 55 }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.getByText("Keychron K3")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "64%" })).toBeInTheDocument();
		expect(screen.getByText("Galaxy Watch6")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "55%" })).toBeInTheDocument();
	});

	it("leaves out a device that is paired but not connected", () => {
		render(
			panelWith({
				devices: [
					{ id: "b1", name: "Old Speaker", kind: "audio", form: null, connected: false, battery: 40 }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.queryByText("Old Speaker")).not.toBeInTheDocument();
		expect(screen.getByText("No devices connected")).toBeInTheDocument();
	});

	it("puts a device at or below the low threshold under a Needs charging heading and calls its level low", () => {
		render(
			panelWith(
				{
					devices: [
						{ id: "b1", name: "MX Anywhere 3", kind: "mouse", form: null, connected: true, battery: 9 }
					],
					wired: [],
					pc: noPc
				},
				noBuds,
				20
			)
		);

		expect(screen.getByRole("heading", { name: "Needs charging" })).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "9%, low" })).toBeInTheDocument();
	});

	it("tells the user how many devices are connected and the lowest level when it is low", () => {
		render(
			panelWith({
				devices: [
					{ id: "b1", name: "MX Anywhere 3", kind: "mouse", form: null, connected: true, battery: 9 },
					{ id: "b2", name: "Keychron K3", kind: "keyboard", form: null, connected: true, battery: 64 }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.getByText("2 connected · 9% low")).toBeInTheDocument();
	});

	it("does not call the summary low when every level is fine", () => {
		render(
			panelWith({
				devices: [
					{ id: "b2", name: "Keychron K3", kind: "keyboard", form: null, connected: true, battery: 64 }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.getByText("1 connected")).toBeInTheDocument();
	});

	it("shows this PC with its charging status and no repeated heading", () => {
		render(
			panelWith({
				devices: [],
				wired: [],
				pc: {
					present: true,
					percent: 64,
					plugged_in: true,
					charging: true,
					seconds_left: null,
					seconds_to_full: 2700
				}
			})
		);

		expect(screen.getByText("This PC")).toBeInTheDocument();
		expect(screen.getByText("Charging · 45 min to full")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "64%, charging" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "This PC" })).not.toBeInTheDocument();
	});

	it("shows each bud and the case of earbuds that report them", () => {
		render(
			panelWith(
				{
					devices: [
						{ id: "b1", name: "AirPods Pro", kind: "audio", form: "earbuds", connected: true, battery: null }
					],
					wired: [],
					pc: noPc
				},
				{
					b1: {
						left: { level: 80, charging: false },
						right: { level: 78, charging: false },
						case: { level: 95, charging: true }
					}
				}
			)
		);

		expect(screen.getByRole("img", { name: "L, 80%" })).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "R, 78%" })).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Case, 95%, charging" })).toBeInTheDocument();
	});

	it("shows a device without a battery reading as connected, with no level", () => {
		render(
			panelWith({
				devices: [
					{ id: "b5", name: "Xbox Controller", kind: "gamepad", form: null, connected: true, battery: null }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.getByText("Xbox Controller")).toBeInTheDocument();
		expect(screen.getByText("Connected · no battery info")).toBeInTheDocument();
		expect(screen.queryByRole("img", { name: /%/ })).not.toBeInTheDocument();
	});

	it("shows a USB drive as plugged in by cable", () => {
		render(
			panelWith({
				devices: [],
				wired: [{ id: "u1", name: "SanDisk Cruzer Blade", class: "disk" }],
				pc: noPc
			})
		);

		expect(screen.getByRole("heading", { name: "Drives & cameras" })).toBeInTheDocument();
		expect(screen.getByText("USB")).toBeInTheDocument();
	});

	it("opens the Looks like choice when an audio device is pressed, and closes it when pressed again", async () => {
		const user = userEvent.setup();
		render(
			panelWith({
				devices: [
					{ id: "b1", name: "AirPods Pro", kind: "audio", form: "earbuds", connected: true, battery: 82 }
				],
				wired: [],
				pc: noPc
			})
		);
		const row = screen.getByRole("button", { name: /AirPods Pro/ });
		expect(screen.queryByRole("radiogroup", { name: "Looks like" })).not.toBeInTheDocument();

		await user.click(row);
		const looks = screen.getByRole("radiogroup", { name: "Looks like" });
		expect(within(looks).getAllByRole("radio").length).toBeGreaterThan(1);
		expect(row).toHaveAttribute("aria-expanded", "true");

		await user.click(row);
		expect(screen.queryByRole("radiogroup", { name: "Looks like" })).not.toBeInTheDocument();
	});

	it("gives devices that are not audio no Looks like choice", () => {
		render(
			panelWith({
				devices: [
					{ id: "b2", name: "Keychron K3", kind: "keyboard", form: null, connected: true, battery: 64 }
				],
				wired: [],
				pc: noPc
			})
		);

		expect(screen.queryByRole("button", { name: /Keychron K3/ })).not.toBeInTheDocument();
	});
});
