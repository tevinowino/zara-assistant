import { describe, expect, it } from "vitest";
import { formatRelativeTime, groupConversations } from "./groupConversations";

// Local times, so the day boundaries match what the user sees on their clock.
const now = new Date(2026, 10, 1, 12, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
	new Date(2026, 10, day, hour, minute, 0).getTime();
const chat = (id: string, updatedAt: number) => ({ id, title: `Chat ${id}`, updatedAt });

describe("groupConversations", () => {
	it("puts chats from the same calendar day under Today and the day before under Yesterday", () => {
		const groups = groupConversations(
			[chat("a", at(1, 9)), chat("b", at(1, 0, 5)), chat("c", at(0, 23, 55))],
			now
		);

		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["Today", ["a", "b"]],
			["Yesterday", ["c"]]
		]);
	});

	it("puts chats from the last week under Last 7 days and older ones under Earlier", () => {
		const groups = groupConversations(
			[
				chat("week", new Date(2026, 9, 28, 10, 0).getTime()),
				chat("old", new Date(2026, 9, 3, 10, 0).getTime())
			],
			now
		);

		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["Last 7 days", ["week"]],
			["Earlier", ["old"]]
		]);
	});

	it("leaves out groups with no chats and keeps the given order inside a group", () => {
		const groups = groupConversations([chat("new", at(1, 11)), chat("older", at(1, 8))], now);

		expect(groups).toHaveLength(1);
		expect(groups[0].items.map((item) => item.id)).toEqual(["new", "older"]);
	});

	it("returns no groups for no chats", () => {
		expect(groupConversations([], now)).toEqual([]);
	});
});

describe("formatRelativeTime", () => {
	it("says Just now for under a minute", () => {
		expect(formatRelativeTime(now - 20_000, now)).toBe("Just now");
	});

	it("counts minutes within the hour", () => {
		expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
	});

	it("counts hours within the same day", () => {
		expect(formatRelativeTime(at(1, 9), now)).toBe("3 h ago");
	});

	it("says Yesterday for the previous calendar day", () => {
		expect(formatRelativeTime(at(0, 23, 0), now)).toBe("Yesterday");
	});

	it("names the weekday within the last week", () => {
		// 29 October 2026 was a Thursday.
		expect(formatRelativeTime(new Date(2026, 9, 29, 10, 0).getTime(), now)).toBe("Thu");
	});

	it("gives the date for anything older", () => {
		expect(formatRelativeTime(new Date(2026, 9, 3, 10, 0).getTime(), now)).toBe("Oct 3");
	});

	it("never claims a time in the future", () => {
		expect(formatRelativeTime(now + 60_000, now)).toBe("Just now");
	});
});
