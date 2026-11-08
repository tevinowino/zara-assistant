import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationPill } from "./NotificationPill";
import type { PillNotification } from "../notifications/notificationPolicy";

const messageFromMaria: PillNotification = {
	id: 41,
	appId: "Chat.App",
	appName: "Chat",
	appIcon: null,
	title: "Maria",
	body: "Are you free at 3?"
};

describe("NotificationPill", () => {
	it("shows the app, the title and the text of the notification", () => {
		render(
			<NotificationPill
				notification={messageFromMaria}
				zaraMode="notification"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(screen.getByText("Chat")).toBeInTheDocument();
		expect(screen.getByText("Maria")).toBeInTheDocument();
		expect(screen.getByText("Are you free at 3?")).toBeInTheDocument();
	});

	it("shows the app's icon when Windows gave one", () => {
		const { container } = render(
			<NotificationPill
				notification={{ ...messageFromMaria, appIcon: "data:image/png;base64,icon" }}
				zaraMode="notification"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,icon");
	});

	it("shows a bell when there is no icon", () => {
		const { container } = render(
			<NotificationPill
				notification={messageFromMaria}
				zaraMode="notification"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(container.querySelector("img")).not.toBeInTheDocument();
		expect(container.querySelector(".notif-pill-icon svg")).toBeInTheDocument();
	});

	it("leaves out the text line when the notification has none", () => {
		const { container } = render(
			<NotificationPill
				notification={{ ...messageFromMaria, body: "" }}
				zaraMode="notification"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(container.querySelector(".notif-pill-body")).not.toBeInTheDocument();
	});

	it("is not drawn while the notch shows another view", () => {
		render(
			<NotificationPill
				notification={messageFromMaria}
				zaraMode="calendar"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(screen.queryByText("Maria")).not.toBeInTheDocument();
	});

	it("is not drawn when there is no notification", () => {
		const { container } = render(
			<NotificationPill
				notification={null}
				zaraMode="notification"
				onDismiss={vi.fn()}
				onExited={vi.fn()}
			/>
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("is dismissed by a click, which does not reach the notch", async () => {
		const onDismiss = vi.fn();
		const onNotchClick = vi.fn();
		render(
			<div onClick={onNotchClick}>
				<NotificationPill
					notification={messageFromMaria}
					zaraMode="notification"
					onDismiss={onDismiss}
					onExited={vi.fn()}
				/>
			</div>
		);

		await userEvent.click(screen.getByRole("status"));

		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onNotchClick).not.toHaveBeenCalled();
	});
});
