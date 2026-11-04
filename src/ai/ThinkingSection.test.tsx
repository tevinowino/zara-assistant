import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real orb draws on a canvas, which jsdom cannot. This stand-in records what
// it was asked to draw so the tests can read it back.
vi.mock("thinking-orbs", () => ({
	ThinkingOrb: ({ state, color }: { state: string; color?: string }) => (
		<canvas data-testid="orb" data-state={state} data-color={color} />
	)
}));

import { ThinkingSection } from "./ThinkingSection";
import type { ThinkingTrace } from "./types";

/** Keeps the open state the way the panel does, so a click really opens it. */
function Harness({
	trace,
	startOpen = false,
	onContentChange
}: {
	trace: ThinkingTrace;
	startOpen?: boolean;
	onContentChange?: () => void;
}) {
	const [open, setOpen] = useState(startOpen);
	return (
		<ThinkingSection
			trace={trace}
			open={open}
			onOpenChange={setOpen}
			onContentChange={onContentChange}
		/>
	);
}

const thinkingNow: ThinkingTrace = {
	startedAt: 1000,
	endedAt: null,
	steps: [{ kind: "understand", startedAt: 1000, endedAt: null }],
	reasoning: ""
};

const thoughtFor4Seconds: ThinkingTrace = {
	startedAt: 1000,
	endedAt: 5200,
	steps: [
		{ kind: "understand", startedAt: 1000, endedAt: 1800 },
		{ kind: "screen", startedAt: 1800, endedAt: 5200 }
	],
	reasoning: ""
};

describe("ThinkingSection header", () => {
	it("says Thinking with an orb while the answer is being worked out", () => {
		render(<Harness trace={thinkingNow} />);

		expect(screen.getByRole("button", { name: /Thinking…/ })).toBeInTheDocument();
		expect(screen.getByTestId("orb")).toHaveAttribute("data-state", "breathing");
	});

	it("tints the orb green while it is understanding the question", () => {
		render(<Harness trace={thinkingNow} />);

		expect(screen.getByTestId("orb")).toHaveAttribute("data-color", "#34c759");
	});

	it("changes the orb's colour with each stage, so the stages can be told apart", () => {
		const colourDuring = (status: "screen" | "notes" | "web") => {
			const trace: ThinkingTrace = {
				...thinkingNow,
				steps: [
					{ kind: "understand", startedAt: 1000, endedAt: 1400 },
					{ kind: status, startedAt: 1400, endedAt: null }
				]
			};
			const { unmount } = render(<Harness trace={trace} />);
			const colour = screen.getByTestId("orb").getAttribute("data-color");
			unmount();
			return colour;
		};

		expect(colourDuring("screen")).toBe("#ff9f0a");
		expect(colourDuring("notes")).toBe("#40c8e0");
		expect(colourDuring("web")).toBe("#bf5af2");
	});

	it("says what it is doing in the header while it looks at the screen", () => {
		const looking: ThinkingTrace = {
			...thinkingNow,
			steps: [
				{ kind: "understand", startedAt: 1000, endedAt: 1400 },
				{ kind: "screen", startedAt: 1400, endedAt: null }
			]
		};

		render(<Harness trace={looking} />);

		expect(screen.getByRole("button", { name: /Looking at your screen/ })).toBeInTheDocument();
		expect(screen.getByTestId("orb")).toHaveAttribute("data-state", "searching");
	});

	it("works while it reads the notes", () => {
		const reading: ThinkingTrace = {
			...thinkingNow,
			steps: [
				{ kind: "understand", startedAt: 1000, endedAt: 1400 },
				{ kind: "notes", startedAt: 1400, endedAt: null }
			]
		};

		render(<Harness trace={reading} />);

		expect(screen.getByTestId("orb")).toHaveAttribute("data-state", "working");
	});

	it("says how long it thought once it is done, and drops the orb", () => {
		render(<Harness trace={thoughtFor4Seconds} />);

		expect(screen.getByRole("button", { name: "Thought for 4.2 s" })).toBeInTheDocument();
		expect(screen.queryByTestId("orb")).not.toBeInTheDocument();
	});

	it("says it thought briefly when it took under a second", () => {
		const quick: ThinkingTrace = {
			...thoughtFor4Seconds,
			endedAt: 1400,
			steps: [{ kind: "understand", startedAt: 1000, endedAt: 1400 }]
		};

		render(<Harness trace={quick} />);

		expect(screen.getByRole("button", { name: "Thought for under a second" })).toBeInTheDocument();
	});
});

describe("ThinkingSection folding", () => {
	it("starts folded away, with its arrow pointing at the section", () => {
		render(<Harness trace={thoughtFor4Seconds} />);

		expect(screen.getByRole("button", { name: /Thought for/ })).toHaveAttribute(
			"aria-expanded",
			"false"
		);
		expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
	});

	it("opens to show the steps when the header is pressed, and folds again on a second press", async () => {
		render(<Harness trace={thoughtFor4Seconds} />);
		const user = userEvent.setup();
		const header = screen.getByRole("button", { name: /Thought for/ });

		await user.click(header);

		expect(header).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("list", { name: "Steps" })).toBeInTheDocument();
		await user.click(header);
		expect(header).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
	});

	it("tells the panel when its height changes, so the panel can make room", async () => {
		const onContentChange = vi.fn();
		render(<Harness trace={thoughtFor4Seconds} onContentChange={onContentChange} />);
		const user = userEvent.setup();
		onContentChange.mockClear();

		await user.click(screen.getByRole("button", { name: /Thought for/ }));

		expect(onContentChange).toHaveBeenCalled();
	});
});

describe("ThinkingSection steps", () => {
	it("lists each stage in order, with how long each took", () => {
		render(<Harness trace={thoughtFor4Seconds} startOpen />);

		const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

		expect(steps).toHaveLength(2);
		expect(steps[0]).toHaveTextContent("Understanding your question");
		expect(steps[0]).toHaveTextContent("0.8 s");
		expect(steps[1]).toHaveTextContent("Looking at your screen");
		expect(steps[1]).toHaveTextContent("3.4 s");
	});

	it("gives each stage's dot the colour of that stage", () => {
		const searched: ThinkingTrace = {
			...thoughtFor4Seconds,
			steps: [
				{ kind: "understand", startedAt: 1000, endedAt: 1500 },
				{ kind: "web", startedAt: 1500, endedAt: 5200 }
			]
		};

		render(<Harness trace={searched} startOpen />);

		const [understanding, searching] = within(
			screen.getByRole("list", { name: "Steps" })
		).getAllByRole("listitem");
		expect(understanding.style.getPropertyValue("--step-color")).toBe("#34c759");
		expect(searching.style.getPropertyValue("--step-color")).toBe("#bf5af2");
	});

	it("marks the stage in progress and gives it no time yet", () => {
		render(<Harness trace={thinkingNow} startOpen />);

		const [step] = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

		expect(step).toHaveAttribute("data-state", "active");
		expect(step).not.toHaveTextContent(/\d s/);
	});

	it("explains what a web search stage did", () => {
		const searched: ThinkingTrace = {
			...thoughtFor4Seconds,
			steps: [
				{ kind: "understand", startedAt: 1000, endedAt: 1500 },
				{ kind: "web", startedAt: 1500, endedAt: 5200 }
			]
		};

		render(<Harness trace={searched} startOpen />);

		expect(screen.getByText("Searching the web")).toBeInTheDocument();
		expect(screen.getByText(/Searched for up-to-date information/)).toBeInTheDocument();
	});
});

describe("ThinkingSection reasoning", () => {
	it("shows no reasoning area when the model sent none", () => {
		render(<Harness trace={thoughtFor4Seconds} startOpen />);

		expect(screen.queryByRole("group", { name: "The model's reasoning" })).not.toBeInTheDocument();
	});

	it("lays the model's reasoning out as titled thoughts instead of raw markdown", () => {
		const reasoned: ThinkingTrace = {
			...thoughtFor4Seconds,
			reasoning:
				"**Planning the answer**\n\nKeep it short, with a `start_timer` button.\n\n**Checking units**\n\n- minutes, not seconds\n- three of them"
		};

		render(<Harness trace={reasoned} startOpen />);

		const reasoning = screen.getByRole("group", { name: "The model's reasoning" });
		expect(within(reasoning).getByText("Planning the answer")).toBeInTheDocument();
		expect(within(reasoning).getByText("Checking units")).toBeInTheDocument();
		expect(within(reasoning).getByText("start_timer").tagName).toBe("CODE");
		expect(within(reasoning).getAllByRole("listitem")).toHaveLength(2);
		expect(reasoning).not.toHaveTextContent("**");
		expect(reasoning).not.toHaveTextContent("`");
	});

	it("shows reasoning that came with no titles as plain paragraphs", () => {
		const plain: ThinkingTrace = {
			...thoughtFor4Seconds,
			reasoning: "The user wants a timer.\n\nThree minutes is a good default."
		};

		render(<Harness trace={plain} startOpen />);

		const reasoning = screen.getByRole("group", { name: "The model's reasoning" });
		expect(within(reasoning).getByText("The user wants a timer.")).toBeInTheDocument();
		expect(within(reasoning).getByText("Three minutes is a good default.")).toBeInTheDocument();
	});

	it("never turns reasoning text into a link, an image or markup", () => {
		const hostile: ThinkingTrace = {
			...thoughtFor4Seconds,
			reasoning: "[click me](https://evil.example) <img src=x onerror=alert(1)>"
		};

		const { container } = render(<Harness trace={hostile} startOpen />);

		expect(container.querySelector("a, img")).toBeNull();
		expect(screen.getByText(/\[click me\]\(https:\/\/evil\.example\)/)).toBeInTheDocument();
	});
});

describe("ThinkingSection waiting time", () => {
	afterEach(() => vi.useRealTimers());

	it("shows no clock for a short wait", () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		render(<Harness trace={{ ...thinkingNow, startedAt: 7_000 }} />);

		expect(screen.queryByText(/^\d+ s$/)).not.toBeInTheDocument();
	});

	it("shows how long a long wait has gone on, so it can be told from a stuck one", () => {
		vi.useFakeTimers();
		vi.setSystemTime(20_000);

		render(<Harness trace={{ ...thinkingNow, startedAt: 8_000 }} />);

		expect(screen.getByText("12 s")).toBeInTheDocument();
	});

	it("counts up while it waits", () => {
		vi.useFakeTimers();
		vi.setSystemTime(20_000);
		render(<Harness trace={{ ...thinkingNow, startedAt: 8_000 }} />);

		act(() => vi.advanceTimersByTime(3_000));

		expect(screen.getByText("15 s")).toBeInTheDocument();
	});

	it("drops the clock once thinking is over", () => {
		vi.useFakeTimers();
		vi.setSystemTime(40_000);

		render(<Harness trace={{ ...thoughtFor4Seconds, startedAt: 1_000, endedAt: 31_000 }} />);

		expect(screen.queryByText(/^\d+ s$/)).not.toBeInTheDocument();
	});
});
