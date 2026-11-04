import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

type Props = Partial<Parameters<typeof ModelPicker>[0]>;

function renderPicker(props: Props = {}) {
	const onChange = vi.fn();
	const onReload = vi.fn();
	render(
		<ModelPicker
			label="Model"
			value="gemini-3.8-flash"
			suggested={["gemini-3.8-flash", "gemini-4-argon", "gemma-4-31b-it"]}
			available={[]}
			status="ready"
			placeholder="Choose a model"
			onChange={onChange}
			onReload={onReload}
			{...props}
		/>
	);
	return { onChange, onReload };
}

const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent);
// The models alone: typing also offers to use the typed text as it is.
const modelNames = () => optionNames().filter((name) => !name?.startsWith("Use “"));

describe("ModelPicker", () => {
	it("shows the model in use on its button", () => {
		renderPicker({ value: "gemma-4-31b-it" });

		expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("gemma-4-31b-it");
	});

	it("lists every model when opened, even though one is already chosen", async () => {
		renderPicker({ value: "gemini-3.8-flash" });
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(optionNames()).toEqual(
			expect.arrayContaining(["gemini-3.8-flash", "gemini-4-argon", "gemma-4-31b-it"])
		);
		expect(screen.getAllByRole("option")).toHaveLength(3);
	});

	it("adds the models the service reports to the suggestions, without repeating any", async () => {
		renderPicker({
			suggested: ["gemini-3.8-flash", "gemma-4-31b-it"],
			available: ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(optionNames()).toEqual([
			"gemini-3.8-flash",
			"gemma-4-31b-it",
			"gemini-3.1-flash-lite",
			"gemini-3.5-flash-lite"
		]);
	});

	it("groups the suggestions apart from the rest of the list", async () => {
		renderPicker({
			suggested: ["gemini-3.8-flash"],
			available: ["gemini-3.8-flash", "gemini-3.1-flash-lite"]
		});
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		const suggested = screen.getByRole("group", { name: "Suggested" });
		const all = screen.getByRole("group", { name: "All models" });
		expect(within(suggested).getByRole("option", { name: "gemini-3.8-flash" })).toBeInTheDocument();
		expect(within(all).getByRole("option", { name: "gemini-3.1-flash-lite" })).toBeInTheDocument();
	});

	it("marks the model in use", async () => {
		renderPicker({ value: "gemini-4-argon" });
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByRole("option", { name: "gemini-4-argon" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByRole("option", { name: "gemma-4-31b-it" })).toHaveAttribute(
			"aria-selected",
			"false"
		);
	});

	it("chooses a model with one click and closes", async () => {
		const { onChange } = renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.click(screen.getByRole("option", { name: "gemma-4-31b-it" }));

		expect(onChange).toHaveBeenCalledWith("gemma-4-31b-it");
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});

	it("narrows the list as the user types, ignoring case", async () => {
		renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "GEM");

		expect(modelNames()).toEqual(["gemini-3.8-flash", "gemini-4-argon", "gemma-4-31b-it"]);
		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "ma");
		expect(modelNames()).toEqual(["gemma-4-31b-it"]);
	});

	it("starts every opening with an empty search, so nothing is hidden", async () => {
		renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));
		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "gemma");
		await user.keyboard("{Escape}");

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByRole("searchbox", { name: "Search models" })).toHaveValue("");
		expect(screen.getAllByRole("option")).toHaveLength(3);
	});

	it("lets the user use a model name that is not in the list", async () => {
		const { onChange } = renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "my-private-model");
		await user.click(screen.getByRole("option", { name: "Use “my-private-model”" }));

		expect(onChange).toHaveBeenCalledWith("my-private-model");
	});

	it("does not offer to use a name that is already in the list", async () => {
		renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "gemma-4-31b-it");

		expect(screen.queryByRole("option", { name: /^Use “/ })).not.toBeInTheDocument();
	});

	it("works from the keyboard: open, move, choose", async () => {
		const { onChange } = renderPicker({ value: "gemini-3.8-flash" });
		const user = userEvent.setup();
		screen.getByRole("combobox", { name: "Model" }).focus();

		await user.keyboard("{ArrowDown}");
		await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

		expect(onChange).toHaveBeenCalledWith("gemma-4-31b-it");
	});

	it("closes on Escape and leaves the choice alone", async () => {
		const { onChange } = renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.keyboard("{Escape}");

		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.getByRole("combobox", { name: "Model" })).toHaveFocus();
	});

	it("closes when the user clicks elsewhere", async () => {
		renderPicker();
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.click(document.body);

		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});

	it("says it is loading while the service's list is on its way, and still shows the suggestions", async () => {
		renderPicker({ status: "loading" });
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByText("Loading models…")).toBeInTheDocument();
		expect(screen.getAllByRole("option")).toHaveLength(3);
	});

	it("says how many models there are once the list has loaded", async () => {
		renderPicker({ available: ["a-model", "b-model", "c-model", "gemini-3.8-flash"] });
		const user = userEvent.setup();

		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByText("6 models")).toBeInTheDocument();
	});

	it("explains a failed load, keeps the suggestions, and offers to try again", async () => {
		const { onReload } = renderPicker({ status: "error" });
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByText(/Couldn't load the full list/)).toBeInTheDocument();
		expect(screen.getAllByRole("option")).toHaveLength(3);
		await user.click(screen.getByRole("button", { name: "Try again" }));

		expect(onReload).toHaveBeenCalledTimes(1);
	});

	it("offers a way to choose no model when that is allowed", async () => {
		const { onChange } = renderPicker({ value: "gemma-4-31b-it", noneLabel: "None" });
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		await user.click(screen.getByRole("option", { name: "None" }));

		expect(onChange).toHaveBeenCalledWith("");
	});

	it("shows the word for no choice, or the prompt, when nothing is chosen", () => {
		const { unmount } = render(
			<ModelPicker
				label="Backup model"
				value=""
				suggested={[]}
				available={[]}
				status="idle"
				noneLabel="None"
				placeholder="Choose a model"
				onChange={() => {}}
			/>
		);
		expect(screen.getByRole("combobox", { name: "Backup model" })).toHaveTextContent("None");
		unmount();

		render(
			<ModelPicker
				label="Model"
				value=""
				suggested={[]}
				available={[]}
				status="idle"
				placeholder="Choose a model"
				onChange={() => {}}
			/>
		);
		expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Choose a model");
	});

	it("says so, and still lets the user type a name, when there are no models at all", async () => {
		renderPicker({ value: "", suggested: [], available: [], status: "ready" });
		const user = userEvent.setup();
		await user.click(screen.getByRole("combobox", { name: "Model" }));

		expect(screen.getByText("No models listed. Type a model name.")).toBeInTheDocument();
		await user.type(screen.getByRole("searchbox", { name: "Search models" }), "llama3");
		expect(screen.getByRole("option", { name: "Use “llama3”" })).toBeInTheDocument();
	});
});
