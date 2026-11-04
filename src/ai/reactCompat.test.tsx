// The AI panel reuses libraries written for React 18. Each test renders one of
// them under React 19 so an incompatibility shows up here instead of in the
// middle of building the panel.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import DOMPurify from "dompurify";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { LineChart, Line, XAxis } from "recharts";

describe("React 19 compatibility of ported libraries", () => {
	test("react-markdown renders GitHub-flavoured tables", () => {
		const markdown = "| name | qty |\n| --- | --- |\n| tea | 2 |";

		render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>);

		expect(screen.getByRole("table")).toBeInTheDocument();
		expect(screen.getByRole("cell", { name: "tea" })).toBeInTheDocument();
	});

	test("remark-math and rehype-katex render an inline formula", () => {
		const { container } = render(
			<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
				{"The area is $\\pi r^2$."}
			</ReactMarkdown>
		);

		expect(container.querySelector(".katex")).not.toBeNull();
	});

	test("rehype-sanitize removes script tags that raw HTML smuggles in", () => {
		const { container } = render(
			<ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>
				{"hello <script>window.stolen = true</script> world"}
			</ReactMarkdown>
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container).toHaveTextContent("hello");
	});

	test("DOMPurify strips event handlers from untrusted markup", () => {
		const clean = DOMPurify.sanitize('<img src="x" onerror="alert(1)"><b>ok</b>');

		expect(clean).not.toContain("onerror");
		expect(clean).toContain("<b>ok</b>");
	});

	test("react-syntax-highlighter renders code", () => {
		const { container } = render(
			<SyntaxHighlighter language="typescript">{"const answer: number = 42;"}</SyntaxHighlighter>
		);

		expect(container.querySelector("pre")).not.toBeNull();
		expect(container).toHaveTextContent("const answer");
	});

	test("recharts renders a fixed-size line chart", () => {
		const data = [
			{ day: "Mon", value: 3 },
			{ day: "Tue", value: 5 }
		];

		const { container } = render(
			<LineChart width={200} height={100} data={data}>
				<XAxis dataKey="day" />
				<Line dataKey="value" />
			</LineChart>
		);

		expect(container.querySelector(".recharts-wrapper")).not.toBeNull();
	});

	// Mermaid is large; the first dynamic import is slow, which is exactly why the
	// panel loads it lazily.
	test("mermaid parses a flowchart definition", { timeout: 60_000 }, async () => {
		const { default: mermaid } = await import("mermaid");

		const parsed = await mermaid.parse("flowchart TD\n  A[Ask] --> B[Answer]");

		expect(parsed).toBeTruthy();
	});
});
