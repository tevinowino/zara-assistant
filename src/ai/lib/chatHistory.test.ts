import { describe, expect, it } from "vitest";
import { buildHistoryForRequest } from "./chatHistory";
import type { ChatMessage } from "../types";

function message(id: string, role: "user" | "assistant", text: string): ChatMessage {
	return { id, role, text, createdAt: 1 };
}

describe("buildHistoryForRequest", () => {
	it("maps the assistant role to the model role the API expects", () => {
		const history = buildHistoryForRequest([
			message("1", "user", "hi"),
			message("2", "assistant", "hello")
		]);

		expect(history).toEqual([
			{ role: "user", text: "hi" },
			{ role: "model", text: "hello" }
		]);
	});

	it("keeps only the most recent eight messages", () => {
		const many = Array.from({ length: 12 }, (_, i) =>
			message(String(i), i % 2 === 0 ? "user" : "assistant", `text ${i}`)
		);

		const history = buildHistoryForRequest(many);

		expect(history).toHaveLength(8);
		expect(history[0].text).toBe("text 4");
		expect(history[7].text).toBe("text 11");
	});

	it("replaces a widget in an earlier answer with a short placeholder instead of its JSON", () => {
		const answer =
			'Here is the data.\n\n```zara:table\n{"columns":["A","B"],"rows":[["1","2"]]}\n```\n\nAnything else?';

		const [turn] = buildHistoryForRequest([message("1", "assistant", answer)]);

		expect(turn.text).toBe("Here is the data.\n\n[table]\n\nAnything else?");
		expect(turn.text).not.toContain("columns");
	});

	it("leaves the user's own text untouched, even if it contains a fence", () => {
		const text = 'look at ```zara:table\n{"x":1}\n``` this';

		const [turn] = buildHistoryForRequest([message("1", "user", text)]);

		expect(turn.text).toBe(text);
	});

	it("returns nothing for an empty conversation", () => {
		expect(buildHistoryForRequest([])).toEqual([]);
	});

	it("replaces an a2ui surface in an earlier answer with a short placeholder", () => {
		const surface = [
			'{"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"zara:notch/v1"}}',
			'{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Divider"}]}}'
		].join("\n");
		const answer = "Here you go.\n\n```a2ui\n" + surface + "\n```";

		const [turn] = buildHistoryForRequest([message("1", "assistant", answer)]);

		expect(turn.text).toBe("Here you go.\n\n[a2ui]");
	});
});
