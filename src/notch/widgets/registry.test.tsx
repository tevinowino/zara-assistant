import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NOTCH_PANELS } from "../panels/notchPanels";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { WIDGET_VIEWS, WidgetBackgrounds, WidgetPanels, widgetViewSize } from "./registry";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

describe("WIDGET_VIEWS", () => {
	it("has a view for every widget except the four the notch draws itself", () => {
		const drawnByTheNotch = ["ai", "calendar", "command-center", "devices"];

		const withoutView = NOTCH_PANELS.filter((panel) => !(panel in WIDGET_VIEWS));

		expect(withoutView).toEqual(drawnByTheNotch);
	});

	it("gives every view a positive size", () => {
		for (const view of Object.values(WIDGET_VIEWS)) {
			expect(view.widthPx).toBeGreaterThan(0);
			expect(view.heightPx).toBeGreaterThan(0);
		}
	});
});

describe("widgetViewSize", () => {
	it("gives the size the notch takes while it shows the notes", () => {
		expect(widgetViewSize("notes")).toEqual({ widthPx: 380, heightPx: 300 });
	});

	it("gives the size the notch takes while it shows the clipboard", () => {
		expect(widgetViewSize("clipboard")).toEqual({ widthPx: 380, heightPx: 300 });
	});

	it("gives the size the notch takes while it shows the weather", () => {
		expect(widgetViewSize("weather")).toEqual({ widthPx: 380, heightPx: 356 });
	});

	it("has no size for a view the notch draws itself", () => {
		expect(widgetViewSize("calendar")).toBeNull();
	});

	it("has no size for a live activity", () => {
		expect(widgetViewSize("music")).toBeNull();
	});
});

describe("WidgetPanels", () => {
	it("draws nothing while the notch shows a view that is not one of its widgets", () => {
		const { container } = render(
			<WidgetPanels zaraMode="calendar" onFieldFocusChange={() => {}} timeFormat24h={false} />
		);

		expect(container).toBeEmptyDOMElement();
	});
});

describe("WidgetBackgrounds", () => {
	it("tells the backend to watch the clipboard while its widget is on in the notch", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(<WidgetBackgrounds preferences={{ enabled: ["ai", "clipboard"] }} active />);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: true });
	});

	it("tells the backend not to watch the clipboard while its widget is off", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(<WidgetBackgrounds preferences={{ enabled: ["ai", "notes"] }} active />);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("never watches the clipboard in a window that is not the notch", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(<WidgetBackgrounds preferences={{ enabled: ["clipboard"] }} active={false} />);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: false });
	});
});
