import { describe, expect, test } from "bun:test";
import { cardShape, cardShapeInGroup, groupDevices, urgentLevel, type DeviceEntry } from "../src/devices/connectedDevices";

const entry = (name: string, kind: string, level: number | null, rest: Partial<DeviceEntry> = {}): DeviceEntry => ({
	id: name,
	name,
	kind,
	wired: false,
	art: null,
	level,
	charging: false,
	buds: null,
	...rest
});

const titles = (entries: DeviceEntry[], threshold = 20) =>
	groupDevices(entries, threshold).map((g) => `${g.title}: ${g.entries.map((e) => e.name).join(", ")}`);

describe("Connected devices groups", () => {
	test("puts low devices first, then groups by type", () => {
		expect(
			titles([
				entry("Keyboard", "keyboard", 70),
				entry("iPhone", "phone", 80),
				entry("Laptop", "pc", 64, { charging: true }),
				entry("MX Anywhere", "mouse", 9),
				entry("AirPods Pro", "audio", 82),
				entry("Galaxy Watch6", "wearable", 55),
				entry("SanDisk Cruzer Blade", "usb", null, { wired: true }),
				entry("Gadget", "other", null)
			])
		).toEqual([
			"Needs charging: MX Anywhere",
			"This PC: Laptop",
			"Audio: AirPods Pro",
			"Phone & watch: Galaxy Watch6, iPhone",
			"Accessories: Keyboard",
			"Drives & cameras: SanDisk Cruzer Blade",
			"Other: Gadget"
		]);
	});

	test("lists wired audio with the wireless, after those with a battery", () => {
		expect(
			titles([
				entry("Wired earphones", "audio", null, { wired: true }),
				entry("AirPods Pro", "audio", 82),
				entry("Headphones (AB13X USB Audio)", "audio", null, { wired: true })
			])
		).toEqual(["Audio: AirPods Pro, Headphones (AB13X USB Audio), Wired earphones"]);
	});

	test("judges earbuds by their lowest part that isn't charging", () => {
		const buds = entry("Buds", "audio", 70, {
			buds: {
				left: { level: 12, charging: false },
				right: { level: 90, charging: false },
				case: { level: 40, charging: false }
			}
		});
		expect(urgentLevel(buds)).toBe(12);
		expect(titles([buds])).toEqual(["Needs charging: Buds"]);
		// The low bud is charging in the case: nothing is urgent.
		const charging = { ...buds, buds: { ...buds.buds!, left: { level: 12, charging: true } } };
		expect(urgentLevel(charging)).toBe(40);
		expect(titles([charging])).toEqual(["Audio: Buds"]);
	});

	test("a charging device is never urgent, and the threshold is the user's", () => {
		expect(titles([entry("Laptop", "pc", 5, { charging: true })])).toEqual(["This PC: Laptop"]);
		expect(titles([entry("Mouse", "mouse", 25)], 30)).toEqual(["Needs charging: Mouse"]);
		expect(titles([entry("Mouse", "mouse", 25)], 20)).toEqual(["Accessories: Mouse"]);
	});

	test("sorts lowest first and unknown levels last", () => {
		expect(
			titles([entry("B", "audio", null), entry("C", "audio", 60), entry("A", "audio", 30), entry("D", "audio", 30)])
		).toEqual(["Audio: A, D, C, B"]);
	});
});

describe("Connected devices card shapes", () => {
	test("a device with one battery level is a half-width tile", () => {
		expect(cardShape(entry("MX Anywhere", "mouse", 64))).toBe("tile");
	});

	test("earbuds with their own levels get the full width, even when the total is unknown", () => {
		const buds = { left: { level: 80, charging: false }, right: { level: 78, charging: false }, case: null };
		expect(cardShape(entry("AirPods Pro", "audio", null, { buds }))).toBe("wide");
	});

	test("this PC gets the full width for its time left", () => {
		expect(cardShape(entry("This PC", "pc", 64))).toBe("wide");
	});

	test("a device with no level is a slim row", () => {
		expect(cardShape(entry("SanDisk Cruzer Blade", "usb", null, { wired: true }))).toBe("row");
		expect(cardShape(entry("Gadget", "other", null))).toBe("row");
	});
});

describe("Connected devices card shapes within a group", () => {
	test("a lone tile takes the full width, so its row is not half empty", () => {
		const watch = entry("Galaxy Watch6", "wearable", 55);
		expect(cardShapeInGroup(watch, [watch])).toBe("wide");
	});

	test("two tiles share a row", () => {
		const watch = entry("Galaxy Watch6", "wearable", 55);
		const phone = entry("iPhone", "phone", 80);
		expect(cardShapeInGroup(watch, [watch, phone])).toBe("tile");
		expect(cardShapeInGroup(phone, [watch, phone])).toBe("tile");
	});

	test("a row beside a lone tile does not count as its neighbour", () => {
		const keyboard = entry("Keychron K3", "keyboard", 64);
		const gamepad = entry("Xbox Controller", "gamepad", null);
		expect(cardShapeInGroup(keyboard, [keyboard, gamepad])).toBe("wide");
		expect(cardShapeInGroup(gamepad, [keyboard, gamepad])).toBe("row");
	});
});
