import { describe, expect, it } from "vitest";
import { fastSettings, isFast, withFast } from "./fastPreset";
import type { ControlInfo } from "../providers";

const effort: ControlInfo = {
	id: "effort",
	label: "Reasoning effort",
	help: "",
	group: "reasoning",
	fallback: null,
	fast: "low",
	type: "choice",
	choices: [
		{ value: "low", label: "Low" },
		{ value: "high", label: "High" }
	]
};

const thinking: ControlInfo = {
	id: "thinking",
	label: "Thinking",
	help: "",
	group: "reasoning",
	fallback: null,
	fast: "disabled",
	type: "choice",
	choices: [
		{ value: "adaptive", label: "Adaptive" },
		{ value: "disabled", label: "Off" }
	]
};

const temperature: ControlInfo = {
	id: "temperature",
	label: "Temperature",
	help: "",
	group: "sampling",
	fallback: null,
	fast: null,
	type: "number",
	min: 0,
	max: 2,
	step: 0.05,
	whole: false
};

describe("fastSettings", () => {
	it("collects the fast value of each setting that has one", () => {
		expect(fastSettings([effort, temperature, thinking])).toEqual({
			effort: "low",
			thinking: "disabled"
		});
	});

	it("is empty for a model with nothing to turn down", () => {
		expect(fastSettings([temperature])).toEqual({});
	});
});

describe("isFast", () => {
	it("is true when every fast setting is at its fast value", () => {
		expect(isFast([effort, thinking], { effort: "low", thinking: "disabled" })).toBe(true);
	});

	it("is false when one fast setting is missing or different", () => {
		expect(isFast([effort, thinking], { effort: "low" })).toBe(false);
		expect(isFast([effort, thinking], { effort: "high", thinking: "disabled" })).toBe(false);
	});

	it("is false when the model has no preset, even with nothing set", () => {
		expect(isFast([temperature], {})).toBe(false);
	});
});

describe("withFast", () => {
	it("turns the preset on and keeps what else the user set", () => {
		const values = withFast([effort, temperature], { temperature: 0.4, effort: "high" }, true);

		expect(values).toEqual({ temperature: 0.4, effort: "low" });
	});

	it("turns the preset off by taking its settings back to default, and keeps the rest", () => {
		const values = withFast(
			[effort, thinking, temperature],
			{ effort: "low", thinking: "disabled", temperature: 0.4 },
			false
		);

		expect(values).toEqual({ temperature: 0.4 });
	});

	it("does not change the values it was given", () => {
		const before = { effort: "high" };

		withFast([effort], before, true);

		expect(before).toEqual({ effort: "high" });
	});
});
