import { describe, expect, it } from "vitest";
import { parseReasoning, splitInline } from "./reasoning";

describe("parseReasoning", () => {
	it("gives no thoughts for empty text", () => {
		expect(parseReasoning("")).toEqual([]);
		expect(parseReasoning("  \n\n  ")).toEqual([]);
	});

	it("keeps plain prose as one untitled thought, joining wrapped lines", () => {
		const thoughts = parseReasoning("The user wants a timer\nfor three minutes.");

		expect(thoughts).toEqual([
			{
				title: null,
				blocks: [{ kind: "paragraph", text: "The user wants a timer for three minutes." }]
			}
		]);
	});

	it("splits paragraphs at blank lines", () => {
		const thoughts = parseReasoning("First idea.\n\nSecond idea.");

		expect(thoughts[0].blocks).toEqual([
			{ kind: "paragraph", text: "First idea." },
			{ kind: "paragraph", text: "Second idea." }
		]);
	});

	it("starts a titled thought at a line that is only a bold title", () => {
		const thoughts = parseReasoning(
			"**Planning the answer**\n\nI will keep it short.\n\n**Checking the facts**\n\nThe screen shows a chart."
		);

		expect(thoughts).toEqual([
			{
				title: "Planning the answer",
				blocks: [{ kind: "paragraph", text: "I will keep it short." }]
			},
			{
				title: "Checking the facts",
				blocks: [{ kind: "paragraph", text: "The screen shows a chart." }]
			}
		]);
	});

	it("reads a markdown heading as a title too", () => {
		const thoughts = parseReasoning("## Weighing options\n\nTwo ways to do it.");

		expect(thoughts[0].title).toBe("Weighing options");
	});

	it("does not take a bold phrase inside a sentence for a title", () => {
		const thoughts = parseReasoning("**Note** that the timer is in minutes.");

		expect(thoughts).toEqual([
			{
				title: null,
				blocks: [{ kind: "paragraph", text: "**Note** that the timer is in minutes." }]
			}
		]);
	});

	it("reads dashes, stars, bullets and numbers as a list", () => {
		const thoughts = parseReasoning(
			"- open the app\n* pick a time\n• press start\n1. done\n2) really"
		);

		expect(thoughts[0].blocks).toEqual([
			{ kind: "list", items: ["open the app", "pick a time", "press start", "done", "really"] }
		]);
	});

	it("keeps a sentence before a list and the list after it as separate blocks", () => {
		const thoughts = parseReasoning("Steps to take:\n- one\n- two");

		expect(thoughts[0].blocks).toEqual([
			{ kind: "paragraph", text: "Steps to take:" },
			{ kind: "list", items: ["one", "two"] }
		]);
	});

	it("joins an indented line onto the bullet above it", () => {
		const thoughts = parseReasoning("- first item\n  continues here\n- second item");

		expect(thoughts[0].blocks).toEqual([
			{ kind: "list", items: ["first item continues here", "second item"] }
		]);
	});

	it("reads Windows line endings the same way", () => {
		const thoughts = parseReasoning("**Title**\r\n\r\nBody text.");

		expect(thoughts).toEqual([
			{ title: "Title", blocks: [{ kind: "paragraph", text: "Body text." }] }
		]);
	});

	it("keeps a title with nothing under it yet, as when the model is still writing", () => {
		expect(parseReasoning("**Planning**")).toEqual([{ title: "Planning", blocks: [] }]);
	});
});

describe("splitInline", () => {
	it("leaves plain text alone", () => {
		expect(splitInline("just words")).toEqual([{ kind: "text", text: "just words" }]);
	});

	it("marks bold and code runs and keeps the text around them", () => {
		expect(splitInline("use **timer** with `start_timer` now")).toEqual([
			{ kind: "text", text: "use " },
			{ kind: "strong", text: "timer" },
			{ kind: "text", text: " with " },
			{ kind: "code", text: "start_timer" },
			{ kind: "text", text: " now" }
		]);
	});

	it("leaves marks that do not pair up as they were written", () => {
		expect(splitInline("a ** b and ` c")).toEqual([{ kind: "text", text: "a ** b and ` c" }]);
	});

	it("never turns text into anything but text, bold or code", () => {
		const tokens = splitInline("[click](https://evil.example) <img src=x onerror=alert(1)>");

		expect(tokens).toEqual([
			{ kind: "text", text: "[click](https://evil.example) <img src=x onerror=alert(1)>" }
		]);
	});
});
