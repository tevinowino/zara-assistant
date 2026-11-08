import { describe, expect, it } from "vitest";
import { MEDIA_LAYOUTS, mediaLayoutSize, parseMediaLayout } from "./mediaLayouts";

describe("parseMediaLayout", () => {
	it("reads each layout by name", () => {
		expect(parseMediaLayout("classic")).toBe("classic");
		expect(parseMediaLayout("compact")).toBe("compact");
		expect(parseMediaLayout("card")).toBe("card");
	});

	it("falls back to classic for a missing value", () => {
		expect(parseMediaLayout(null)).toBe("classic");
		expect(parseMediaLayout(undefined)).toBe("classic");
	});

	it("falls back to classic for a layout from a newer version", () => {
		expect(parseMediaLayout("poster")).toBe("classic");
	});

	it("knows the three layouts", () => {
		expect(MEDIA_LAYOUTS).toEqual(["classic", "compact", "card"]);
	});
});

describe("mediaLayoutSize", () => {
	it("keeps the classic layout at the size it always had", () => {
		const size = mediaLayoutSize({
			layout: "classic",
			hasProgressBar: true,
			volumeExpanded: true
		});

		expect(size).toEqual({ widthPx: 340, heightPx: 120 });
	});

	it("keeps the compact layout's size when the track has a length", () => {
		const size = mediaLayoutSize({
			layout: "compact",
			hasProgressBar: true,
			volumeExpanded: false
		});

		expect(size).toEqual({ widthPx: 300, heightPx: 132 });
	});

	it("makes the compact layout shorter when there is no progress bar", () => {
		const size = mediaLayoutSize({
			layout: "compact",
			hasProgressBar: false,
			volumeExpanded: false
		});

		expect(size).toEqual({ widthPx: 300, heightPx: 116 });
	});

	it("makes the compact layout taller by 36 pixels when its volume slider is open", () => {
		const size = mediaLayoutSize({
			layout: "compact",
			hasProgressBar: true,
			volumeExpanded: true
		});

		expect(size).toEqual({ widthPx: 300, heightPx: 168 });
	});

	it("gives the card one size, whatever the track and volume slider do", () => {
		const closed = mediaLayoutSize({
			layout: "card",
			hasProgressBar: false,
			volumeExpanded: false
		});
		const open = mediaLayoutSize({
			layout: "card",
			hasProgressBar: true,
			volumeExpanded: true
		});

		expect(closed).toEqual({ widthPx: 316, heightPx: 336 });
		expect(open).toEqual(closed);
	});
});
