import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	COMMAND_CENTER_APPS_ROW_PX,
	COMMAND_CENTER_PANEL_HEIGHT_PX,
	commandCenterPanelHeight,
	ControlsPanel,
	type ControlsPanelProps
} from "./ControlsPanel";
import type { QuickApp } from "../apps/quickApps";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";

type Quick = ControlsPanelProps["quick"];

// Technical boilerplate only: every control does nothing unless a test says otherwise, and
// the state a test cares about is passed in by the test.
function renderPanel(
	state: {
		quick?: Partial<Quick>;
		notchMode?: string;
		displayVolume?: number;
		zaraMode?: ControlsPanelProps["zaraMode"];
		quickApps?: readonly QuickApp[];
		openQuickApp?: (app: QuickApp) => void;
	} & Partial<
		Pick<
			ControlsPanelProps,
			| "handleVolumeChange"
			| "toggleNotchModeSetting"
			| "openSystemTray"
			| "openSettingsWindow"
			| "handleWifiRightClick"
			| "handleBluetoothRightClick"
			| "setZaraMode"
		>
	>
) {
	const quick = {
		wifiStatus: null,
		wifiEnabled: false,
		wifiConnected: false,
		bluetoothEnabled: false,
		btConnectedNames: [],
		batterySaverEnabled: false,
		currentBrightness: 50,
		toggleWifi: vi.fn(),
		toggleBluetooth: vi.fn(),
		openBatterySaverSettings: vi.fn(),
		handleBrightnessChange: vi.fn(),
		...state.quick
	} as unknown as Quick;

	render(
		<ControlsPanel
			quick={quick}
			displayVolume={state.displayVolume ?? 0.5}
			handleVolumeChange={state.handleVolumeChange ?? vi.fn()}
			notchMode={state.notchMode ?? "fixed"}
			quickApps={state.quickApps ?? []}
			openQuickApp={state.openQuickApp ?? vi.fn()}
			toggleNotchModeSetting={state.toggleNotchModeSetting ?? vi.fn(async () => {})}
			openSystemTray={state.openSystemTray ?? vi.fn(async () => {})}
			openSettingsWindow={state.openSettingsWindow ?? vi.fn(async () => {})}
			handleWifiRightClick={state.handleWifiRightClick ?? vi.fn()}
			handleBluetoothRightClick={state.handleBluetoothRightClick ?? vi.fn()}
			zaraMode={state.zaraMode ?? "command-center"}
			setZaraMode={state.setZaraMode ?? vi.fn()}
		/>
	);
	return quick;
}

describe("ControlsPanel visibility", () => {
	it("is drawn while the notch shows the command center", () => {
		renderPanel({ zaraMode: "command-center" });

		expect(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ })).toBeInTheDocument();
	});

	it("is not drawn on another panel", () => {
		renderPanel({ zaraMode: "calendar" });

		expect(screen.queryByRole("button", { name: /^Wi-Fi(?! networks)/ })).not.toBeInTheDocument();
	});
});

describe("ControlsPanel Wi-Fi tile", () => {
	it("says Off when Wi-Fi is off", () => {
		renderPanel({
			quick: { wifiEnabled: false, wifiStatus: { ssid: "Home" } as Quick["wifiStatus"] }
		});

		expect(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ })).toHaveTextContent("Off");
	});

	it("says the network name when connected", () => {
		renderPanel({
			quick: {
				wifiEnabled: true,
				wifiConnected: true,
				wifiStatus: { ssid: "Home" } as Quick["wifiStatus"]
			}
		});

		expect(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ })).toHaveTextContent("Home");
	});

	it("says Not connected when on but not joined", () => {
		renderPanel({
			quick: { wifiEnabled: true, wifiConnected: false, wifiStatus: {} as Quick["wifiStatus"] }
		});

		expect(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ })).toHaveTextContent(
			"Not connected"
		);
	});

	it("shows an ellipsis while the status is still loading", () => {
		renderPanel({ quick: { wifiStatus: null } });

		expect(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ })).toHaveTextContent("…");
	});

	it("toggles Wi-Fi when clicked", async () => {
		const quick = renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ }));

		expect(quick.toggleWifi).toHaveBeenCalledTimes(1);
	});

	it("opens the networks view from its chevron", async () => {
		const setZaraMode = vi.fn();
		renderPanel({ setZaraMode });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Wi-Fi networks" }));

		expect(setZaraMode).toHaveBeenCalledWith("wifi");
	});

	it("opens the networks view on right-click", () => {
		const handleWifiRightClick = vi.fn();
		renderPanel({ handleWifiRightClick });

		fireEvent.contextMenu(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ }));

		expect(handleWifiRightClick).toHaveBeenCalledTimes(1);
	});
});

describe("ControlsPanel Bluetooth tile", () => {
	it("says Off when Bluetooth is off", () => {
		renderPanel({ quick: { bluetoothEnabled: false } });

		expect(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ })).toHaveTextContent("Off");
	});

	it("says On when on with nothing connected", () => {
		renderPanel({ quick: { bluetoothEnabled: true, btConnectedNames: [] } });

		expect(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ })).toHaveTextContent("On");
	});

	it("names the device when one is connected", () => {
		renderPanel({ quick: { bluetoothEnabled: true, btConnectedNames: ["AirPods Pro"] } });

		expect(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ })).toHaveTextContent(
			"AirPods Pro"
		);
	});

	it("counts the devices when several are connected", () => {
		renderPanel({ quick: { bluetoothEnabled: true, btConnectedNames: ["A", "B", "C"] } });

		expect(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ })).toHaveTextContent(
			"3 connected"
		);
	});

	it("toggles Bluetooth when clicked", async () => {
		const quick = renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ }));

		expect(quick.toggleBluetooth).toHaveBeenCalledTimes(1);
	});

	it("opens the devices view from its chevron", async () => {
		const setZaraMode = vi.fn();
		renderPanel({ setZaraMode });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Bluetooth devices" }));

		expect(setZaraMode).toHaveBeenCalledWith("bluetooth");
	});

	it("opens the devices view on right-click", () => {
		const handleBluetoothRightClick = vi.fn();
		renderPanel({ handleBluetoothRightClick });

		fireEvent.contextMenu(screen.getByRole("button", { name: /^Bluetooth(?! devices)/ }));

		expect(handleBluetoothRightClick).toHaveBeenCalledTimes(1);
	});
});

describe("ControlsPanel notch tile", () => {
	it.each([
		["fixed", "Fixed"],
		["smart", "Smart"],
		["peek", "Peek"]
	])("says %s mode as %s", (mode, label) => {
		renderPanel({ notchMode: mode });

		expect(screen.getByRole("button", { name: /^Notch/ })).toHaveTextContent(label);
	});

	it("cycles the mode when clicked", async () => {
		const toggleNotchModeSetting = vi.fn(async () => {});
		renderPanel({ toggleNotchModeSetting });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /^Notch/ }));

		expect(toggleNotchModeSetting).toHaveBeenCalledTimes(1);
	});
});

describe("ControlsPanel Energy Saver tile", () => {
	it("says On when Energy Saver is on", () => {
		renderPanel({ quick: { batterySaverEnabled: true } });

		expect(screen.getByRole("button", { name: /^Energy Saver/ })).toHaveTextContent("On");
	});

	it("says Off when Energy Saver is off", () => {
		renderPanel({ quick: { batterySaverEnabled: false } });

		expect(screen.getByRole("button", { name: /^Energy Saver/ })).toHaveTextContent("Off");
	});

	it("opens Windows' Energy Saver settings when clicked, since Windows will not let it be switched here", async () => {
		const quick = renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /^Energy Saver/ }));

		expect(quick.openBatterySaverSettings).toHaveBeenCalledTimes(1);
	});
});

describe("ControlsPanel level sliders", () => {
	it("shows the volume as a slider", () => {
		renderPanel({ displayVolume: 0.35 });

		expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "0.35");
	});

	it("shows the brightness as a slider", () => {
		renderPanel({ quick: { currentBrightness: 72 } });

		expect(screen.getByRole("slider", { name: "Brightness" })).toHaveAttribute(
			"aria-valuenow",
			"72"
		);
	});

	it("changes the volume from the keyboard", async () => {
		const handleVolumeChange = vi.fn();
		renderPanel({ displayVolume: 0.5, handleVolumeChange });
		const user = userEvent.setup();

		screen.getByRole("slider", { name: "Volume" }).focus();
		await user.keyboard("{ArrowUp}");

		expect(handleVolumeChange).toHaveBeenCalledWith(0.55);
	});

	it("changes the brightness from the keyboard", async () => {
		const quick = renderPanel({ quick: { currentBrightness: 50 } });
		const user = userEvent.setup();

		screen.getByRole("slider", { name: "Brightness" }).focus();
		await user.keyboard("{ArrowDown}");

		expect(quick.handleBrightnessChange).toHaveBeenCalledWith(45);
	});
});

describe("ControlsPanel shortcuts", () => {
	it("opens Windows notification settings from Do Not Disturb", async () => {
		setInvokeHandler("open_app", () => null);
		renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Do Not Disturb" }));

		expect(invokeCalls.find((call) => call.command === "open_app")?.args).toEqual({
			appName: "ms-settings:notifications"
		});
	});

	it("opens the system tray", async () => {
		const openSystemTray = vi.fn(async () => {});
		renderPanel({ openSystemTray });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "System tray" }));

		expect(openSystemTray).toHaveBeenCalledTimes(1);
	});

	it("opens the Windows notification center", async () => {
		setInvokeHandler("open_notification_center", () => null);
		renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Notification center" }));

		expect(invokeCalls.some((call) => call.command === "open_notification_center")).toBe(true);
	});

	it("opens Zara's settings", async () => {
		const openSettingsWindow = vi.fn(async () => {});
		renderPanel({ openSettingsWindow });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Zara settings" }));

		expect(openSettingsWindow).toHaveBeenCalledTimes(1);
	});

	it("restarts Zara", async () => {
		setInvokeHandler("restart_zara", () => null);
		renderPanel({});
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Restart Zara" }));

		expect(invokeCalls.some((call) => call.command === "restart_zara")).toBe(true);
	});
});

describe("ControlsPanel clicks", () => {
	it("do not reach the notch around it, which would switch its mode", async () => {
		const notchClick = vi.fn();
		render(
			<div onClick={notchClick}>
				<ControlsPanel
					quick={
						{
							wifiStatus: null,
							wifiEnabled: false,
							wifiConnected: false,
							bluetoothEnabled: false,
							btConnectedNames: [],
							batterySaverEnabled: false,
							currentBrightness: 50,
							toggleWifi: vi.fn(),
							toggleBluetooth: vi.fn(),
							openBatterySaverSettings: vi.fn(),
							handleBrightnessChange: vi.fn()
						} as unknown as Quick
					}
					displayVolume={0.5}
					handleVolumeChange={vi.fn()}
					notchMode="fixed"
					quickApps={[]}
					openQuickApp={vi.fn()}
					toggleNotchModeSetting={vi.fn(async () => {})}
					openSystemTray={vi.fn(async () => {})}
					openSettingsWindow={vi.fn(async () => {})}
					handleWifiRightClick={vi.fn()}
					handleBluetoothRightClick={vi.fn()}
					zaraMode="command-center"
					setZaraMode={vi.fn()}
				/>
			</div>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /^Wi-Fi(?! networks)/ }));
		await user.click(screen.getByRole("button", { name: "Zara settings" }));

		expect(notchClick).not.toHaveBeenCalled();
	});
});

describe("ControlsPanel pinned apps", () => {
	const spotify: QuickApp = { name: "Spotify", target: "C:\Apps\Spotify.lnk" };
	const notepad: QuickApp = { name: "Notepad", target: "C:\Apps\Notepad.lnk" };

	it("shows no apps row when none are pinned", () => {
		setInvokeHandler("get_app_icon", () => null);

		renderPanel({ quickApps: [] });

		expect(screen.queryByRole("group", { name: "Your apps" })).not.toBeInTheDocument();
	});

	it("shows a button for each pinned app, named for it", () => {
		setInvokeHandler("get_app_icon", () => null);

		renderPanel({ quickApps: [spotify, notepad] });

		const row = screen.getByRole("group", { name: "Your apps" });
		expect(row).toContainElement(screen.getByRole("button", { name: "Open Spotify" }));
		expect(row).toContainElement(screen.getByRole("button", { name: "Open Notepad" }));
	});

	it("opens the app that was clicked", async () => {
		setInvokeHandler("get_app_icon", () => null);
		const openQuickApp = vi.fn();
		renderPanel({ quickApps: [spotify, notepad], openQuickApp });
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Open Notepad" }));

		expect(openQuickApp).toHaveBeenCalledWith(notepad);
	});

	it("keeps the click from reaching the notch around it", async () => {
		setInvokeHandler("get_app_icon", () => null);
		const notchClick = vi.fn();
		const quick = {
			wifiStatus: null,
			wifiEnabled: false,
			wifiConnected: false,
			bluetoothEnabled: false,
			btConnectedNames: [],
			batterySaverEnabled: false,
			currentBrightness: 50,
			toggleWifi: vi.fn(),
			toggleBluetooth: vi.fn(),
			openBatterySaverSettings: vi.fn(),
			handleBrightnessChange: vi.fn()
		} as unknown as Quick;
		render(
			<div onClick={notchClick}>
				<ControlsPanel
					quick={quick}
					displayVolume={0.5}
					handleVolumeChange={vi.fn()}
					notchMode="fixed"
					quickApps={[spotify]}
					openQuickApp={vi.fn()}
					toggleNotchModeSetting={vi.fn(async () => {})}
					openSystemTray={vi.fn(async () => {})}
					openSettingsWindow={vi.fn(async () => {})}
					handleWifiRightClick={vi.fn()}
					handleBluetoothRightClick={vi.fn()}
					zaraMode="command-center"
					setZaraMode={vi.fn()}
				/>
			</div>
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Open Spotify" }));

		expect(notchClick).not.toHaveBeenCalled();
	});
});

describe("commandCenterPanelHeight", () => {
	it("is the base height when no apps are pinned", () => {
		expect(commandCenterPanelHeight(0)).toBe(COMMAND_CENTER_PANEL_HEIGHT_PX);
	});

	it("adds one row for the apps, however many are pinned", () => {
		for (const count of [1, 2, 3, 4]) {
			expect(commandCenterPanelHeight(count)).toBe(
				COMMAND_CENTER_PANEL_HEIGHT_PX + COMMAND_CENTER_APPS_ROW_PX
			);
		}
	});
});
