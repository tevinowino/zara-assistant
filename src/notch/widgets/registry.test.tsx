import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NOTCH_PANELS } from "../panels/notchPanels";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import type { MediaSnapshot } from "../lyrics/lyricsTypes";
import { WIDGET_VIEWS, WidgetBackgrounds, WidgetPanels, widgetViewSize } from "./registry";

const callsTo = (command: string) => invokeCalls.filter((call) => call.command === command);

const nothingPlaying: MediaSnapshot = {
	mediaInfo: { title: "", artist: "", is_playing: false, has_media: false },
	isPlaying: false
};

const noticeMePlaying: MediaSnapshot = {
	mediaInfo: {
		title: "Notice Me",
		artist: "Migos",
		is_playing: true,
		has_media: true,
		duration_ms: 234_000
	},
	isPlaying: true
};

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

	it("gives the size the notch takes while it shows the lyrics", () => {
		expect(widgetViewSize("lyrics")).toEqual({ widthPx: 380, heightPx: 340 });
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
			<WidgetPanels
				zaraMode="calendar"
				onFieldFocusChange={() => {}}
				timeFormat24h={false}
				media={nothingPlaying}
				askZara={() => {}}
			/>
		);

		expect(container).toBeEmptyDOMElement();
	});
});

describe("WidgetBackgrounds", () => {
	it("tells the backend to watch the clipboard while its widget is on in the notch", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(
			<WidgetBackgrounds
				preferences={{ enabled: ["ai", "clipboard"] }}
				active
				media={nothingPlaying}
			/>
		);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: true });
	});

	it("tells the backend not to watch the clipboard while its widget is off", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(
			<WidgetBackgrounds preferences={{ enabled: ["ai", "notes"] }} active media={nothingPlaying} />
		);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("never watches the clipboard in a window that is not the notch", () => {
		setInvokeHandler("clipboard_history_enable", () => null);

		render(
			<WidgetBackgrounds
				preferences={{ enabled: ["clipboard"] }}
				active={false}
				media={nothingPlaying}
			/>
		);

		expect(callsTo("clipboard_history_enable").at(-1)?.args).toEqual({ enabled: false });
	});

	it("asks for the lyrics of the song that is playing while the Lyrics widget is on", () => {
		setInvokeHandler("clipboard_history_enable", () => null);
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));

		render(
			<WidgetBackgrounds
				preferences={{ enabled: ["ai", "lyrics"] }}
				active
				media={noticeMePlaying}
			/>
		);

		expect(callsTo("lyrics_for_track").at(-1)?.args).toMatchObject({
			title: "Notice Me",
			artist: "Migos"
		});
	});

	it("asks for no lyrics while the Lyrics widget is off, so no song name leaves the PC", () => {
		setInvokeHandler("clipboard_history_enable", () => null);
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));

		render(
			<WidgetBackgrounds
				preferences={{ enabled: ["ai", "notes"] }}
				active
				media={noticeMePlaying}
			/>
		);

		expect(callsTo("lyrics_for_track")).toHaveLength(0);
	});

	it("asks for no lyrics in a window that is not the notch", () => {
		setInvokeHandler("clipboard_history_enable", () => null);
		setInvokeHandler("lyrics_for_track", () => ({ status: "none" }));

		render(
			<WidgetBackgrounds
				preferences={{ enabled: ["lyrics"] }}
				active={false}
				media={noticeMePlaying}
			/>
		);

		expect(callsTo("lyrics_for_track")).toHaveLength(0);
	});
});
