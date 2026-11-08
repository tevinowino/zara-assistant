import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invokeCalls, setInvokeHandler } from "../test/shims/tauriCore";
import { NotificationsSection } from "./NotificationsSection";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);
const savedValue = (key: string) =>
	callsTo("save_setting")
		.map((call) => call.args as { key: string; value: string })
		.filter((args) => args.key === key)
		.map((args) => args.value)
		.at(-1);

describe("NotificationsSection", () => {
	beforeEach(() => {
		localStorage.clear();
		setInvokeHandler("load_settings", () => ({}));
		setInvokeHandler("save_setting", () => undefined);
		setInvokeHandler("notifications_enable", () => "allowed");
		setInvokeHandler("open_notification_privacy_settings", () => undefined);
	});

	it("starts off, with nothing else to choose", () => {
		render(<NotificationsSection />);

		expect(screen.getByRole("switch", { name: "Notification Pill" })).not.toBeChecked();
		expect(screen.queryByText("Show Message Text")).not.toBeInTheDocument();
	});

	it("turns on and saves it once Windows allows it", async () => {
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Notification Pill" }));

		await waitFor(() => expect(savedValue("zara-notifications-enabled")).toBe("true"));
		expect(callsTo("notifications_enable").at(-1)?.args).toEqual({ enabled: true });
	});

	it("stays off and says so when Windows does not allow it", async () => {
		setInvokeHandler("notifications_enable", () => "denied");
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Notification Pill" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Windows is not letting Zara read notifications."
		);
		expect(savedValue("zara-notifications-enabled")).toBeUndefined();
		expect(screen.getByRole("switch", { name: "Notification Pill" })).not.toBeChecked();
	});

	it("opens Windows' own notification settings from the problem message", async () => {
		setInvokeHandler("notifications_enable", () => "denied");
		render(<NotificationsSection />);
		await userEvent.click(screen.getByRole("switch", { name: "Notification Pill" }));

		await userEvent.click(
			await screen.findByRole("button", { name: "Open Windows notification settings" })
		);

		expect(callsTo("open_notification_privacy_settings")).toHaveLength(1);
	});

	it("turns off and tells the backend to stop reading", async () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Notification Pill" }));

		await waitFor(() => expect(savedValue("zara-notifications-enabled")).toBe("false"));
		expect(callsTo("notifications_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("explains that apps appear once they have sent a notification", () => {
		localStorage.setItem("zara-notifications-enabled", "true");

		render(<NotificationsSection />);

		expect(
			screen.getByText(/Apps show up here the first time they send a notification/)
		).toBeInTheDocument();
	});

	it("lists the apps that have sent a notification, none of them allowed yet", () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		localStorage.setItem(
			"zara-notifications-seen-apps",
			JSON.stringify([
				{ id: "Chat.App", name: "Chat" },
				{ id: "Mail.App", name: "Mail" }
			])
		);

		render(<NotificationsSection />);

		expect(screen.getByRole("switch", { name: "Chat" })).not.toBeChecked();
		expect(screen.getByRole("switch", { name: "Mail" })).not.toBeChecked();
	});

	it("allows an app and saves the list", async () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		localStorage.setItem(
			"zara-notifications-seen-apps",
			JSON.stringify([{ id: "Chat.App", name: "Chat" }])
		);
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Chat" }));

		await waitFor(() =>
			expect(JSON.parse(savedValue("zara-notifications-apps") ?? "null")).toEqual(["Chat.App"])
		);
	});

	it("stops allowing an app that was allowed", async () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		localStorage.setItem("zara-notifications-apps", JSON.stringify(["Chat.App", "Mail.App"]));
		localStorage.setItem(
			"zara-notifications-seen-apps",
			JSON.stringify([{ id: "Chat.App", name: "Chat" }])
		);
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Chat" }));

		await waitFor(() =>
			expect(JSON.parse(savedValue("zara-notifications-apps") ?? "null")).toEqual(["Mail.App"])
		);
	});

	it("saves the choice to hide the message text", async () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		render(<NotificationsSection />);

		await userEvent.click(screen.getByRole("switch", { name: "Show Message Text" }));

		await waitFor(() => expect(savedValue("zara-notifications-show-text")).toBe("false"));
	});

	it("saves how long a notification stays", async () => {
		localStorage.setItem("zara-notifications-enabled", "true");
		render(<NotificationsSection />);

		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Time shown" }), "8000");

		await waitFor(() => expect(savedValue("zara-notifications-duration-ms")).toBe("8000"));
	});
});
