import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Counts how many times the panel's module is evaluated, which is what the
// loader exists to keep to one.
const evaluations = vi.hoisted(() => ({ count: 0 }));
describe("loading the assistant panel", () => {
	beforeEach(() => {
		vi.resetModules();
		evaluations.count = 0;
		// Registered per test: a module registry reset does not re-run a hoisted mock factory.
		vi.doMock("./ConnectedAiPanel", () => {
			evaluations.count += 1;
			return { ConnectedAiPanel: () => null };
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("loads the panel's code once however many times it is asked for", async () => {
		const { loadAiPanel } = await import("./loadAiPanel");

		const first = await loadAiPanel();
		const second = await loadAiPanel();

		expect(second).toBe(first);
		expect(evaluations.count).toBe(1);
	});

	it("does not load the panel before the start-up delay has passed", async () => {
		vi.stubGlobal("requestIdleCallback", undefined);
		const { preloadAiPanelWhenIdle } = await import("./loadAiPanel");

		preloadAiPanelWhenIdle();
		await vi.advanceTimersByTimeAsync(2900);

		expect(evaluations.count).toBe(0);
	});

	it("loads the panel in the background once the delay has passed", async () => {
		vi.stubGlobal("requestIdleCallback", undefined);
		const { preloadAiPanelWhenIdle } = await import("./loadAiPanel");

		preloadAiPanelWhenIdle();
		await vi.advanceTimersByTimeAsync(3100);

		await vi.waitFor(() => expect(evaluations.count).toBe(1));
	});

	it("waits for an idle moment when the browser reports them", async () => {
		const idleCallbacks: Array<() => void> = [];
		vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
			idleCallbacks.push(callback);
			return idleCallbacks.length;
		});
		vi.stubGlobal("cancelIdleCallback", () => {});
		const { preloadAiPanelWhenIdle } = await import("./loadAiPanel");

		preloadAiPanelWhenIdle();
		await vi.advanceTimersByTimeAsync(3100);
		expect(evaluations.count).toBe(0);

		idleCallbacks[0]();

		await vi.waitFor(() => expect(evaluations.count).toBe(1));
	});

	it("does not load the panel when the preload is cancelled first", async () => {
		vi.stubGlobal("requestIdleCallback", undefined);
		const { preloadAiPanelWhenIdle } = await import("./loadAiPanel");

		const cancel = preloadAiPanelWhenIdle();
		cancel();
		await vi.advanceTimersByTimeAsync(10000);

		expect(evaluations.count).toBe(0);
	});
});
