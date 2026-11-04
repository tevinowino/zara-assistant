import { describe, expect, it } from "vitest";
import {
	advanceTrace,
	currentStepKind,
	durationOf,
	endTrace,
	formatDuration,
	STEP_DESCRIPTION,
	startTrace,
	withReasoning
} from "./thinkingTrace";

describe("startTrace", () => {
	it("begins by understanding the question, with nothing finished", () => {
		const trace = startTrace(1000);

		expect(trace).toEqual({
			startedAt: 1000,
			endedAt: null,
			steps: [{ kind: "understand", startedAt: 1000, endedAt: null }],
			reasoning: ""
		});
	});
});

describe("advanceTrace", () => {
	it("finishes the step in progress and starts the one the backend names", () => {
		const trace = advanceTrace(startTrace(1000), "looking-at-screen", 1600);

		expect(trace.steps).toEqual([
			{ kind: "understand", startedAt: 1000, endedAt: 1600 },
			{ kind: "screen", startedAt: 1600, endedAt: null }
		]);
	});

	it("knows the notes and the web search stages", () => {
		const notes = advanceTrace(startTrace(0), "reading-notes", 10);
		const web = advanceTrace(startTrace(0), "searching-web", 10);

		expect(currentStepKind(notes)).toBe("notes");
		expect(currentStepKind(web)).toBe("web");
	});

	it("ignores a status it does not know", () => {
		const trace = startTrace(1000);

		expect(advanceTrace(trace, "making-coffee", 2000)).toBe(trace);
	});

	it("ignores a status that arrives after thinking has ended", () => {
		const ended = endTrace(startTrace(1000), 1500);

		expect(advanceTrace(ended, "reading-notes", 2000)).toBe(ended);
	});
});

describe("withReasoning", () => {
	it("keeps the latest whole reasoning, replacing the earlier text", () => {
		let trace = withReasoning(startTrace(0), "Check the");
		trace = withReasoning(trace, "Check the timer length.");

		expect(trace.reasoning).toBe("Check the timer length.");
	});

	it("is ignored once thinking has ended", () => {
		const ended = endTrace(withReasoning(startTrace(0), "Done thinking."), 500);

		expect(withReasoning(ended, "Late words.").reasoning).toBe("Done thinking.");
	});
});

describe("endTrace", () => {
	it("closes the step in progress and records when thinking ended", () => {
		const trace = endTrace(advanceTrace(startTrace(1000), "reading-notes", 1200), 1900);

		expect(trace.endedAt).toBe(1900);
		expect(trace.steps).toEqual([
			{ kind: "understand", startedAt: 1000, endedAt: 1200 },
			{ kind: "notes", startedAt: 1200, endedAt: 1900 }
		]);
		expect(currentStepKind(trace)).toBeNull();
	});

	it("keeps the first end time when it is ended again", () => {
		const once = endTrace(startTrace(1000), 1500);

		expect(endTrace(once, 9000)).toBe(once);
	});
});

describe("durationOf", () => {
	it("is the time between start and end, or null while it is going on", () => {
		expect(durationOf({ startedAt: 1000, endedAt: 1450 })).toBe(450);
		expect(durationOf({ startedAt: 1000, endedAt: null })).toBeNull();
	});

	it("is never negative when clocks disagree", () => {
		expect(durationOf({ startedAt: 2000, endedAt: 1900 })).toBe(0);
	});
});

describe("formatDuration", () => {
	it("shows tenths of a second under ten seconds", () => {
		expect(formatDuration(0)).toBe("0.0 s");
		expect(formatDuration(450)).toBe("0.5 s");
		expect(formatDuration(4210)).toBe("4.2 s");
	});

	it("shows whole seconds from ten seconds", () => {
		expect(formatDuration(12_400)).toBe("12 s");
	});

	it("shows minutes from a minute", () => {
		expect(formatDuration(60_000)).toBe("1 min");
		expect(formatDuration(65_000)).toBe("1 min 5 s");
	});
});

describe("STEP_DESCRIPTION", () => {
	it("gives every stage its own colour, none of them the blue kept for writing", () => {
		const colours = Object.values(STEP_DESCRIPTION).map((step) => step.color);

		expect(new Set(colours).size).toBe(colours.length);
		expect(colours).not.toContain("#0a84ff");
	});
});
