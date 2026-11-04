import { describe, it, expect, vi } from "vitest";
import { createLazyModuleLoader } from "./lazyModule";

describe("createLazyModuleLoader", () => {
	it("only invokes the loader once across multiple calls", async () => {
		const load = vi.fn().mockResolvedValue({ value: 42 });
		const loader = createLazyModuleLoader(load);

		await loader();
		await loader();
		await loader();

		expect(load).toHaveBeenCalledTimes(1);
	});

	it("returns the same resolved value on every call", async () => {
		const loader = createLazyModuleLoader(() => Promise.resolve({ value: 42 }));

		const first = await loader();
		const second = await loader();

		expect(first).toBe(second);
	});

	it("gives independent caches to two separately-created loaders", async () => {
		const loadA = vi.fn().mockResolvedValue("a");
		const loadB = vi.fn().mockResolvedValue("b");
		const loaderA = createLazyModuleLoader(loadA);
		const loaderB = createLazyModuleLoader(loadB);

		await loaderA();
		await loaderB();

		expect(loadA).toHaveBeenCalledTimes(1);
		expect(loadB).toHaveBeenCalledTimes(1);
	});

	it("shares the in-flight promise across concurrent calls before it resolves", async () => {
		const load = vi.fn().mockResolvedValue("done");
		const loader = createLazyModuleLoader(load);

		const [first, second] = await Promise.all([loader(), loader()]);

		expect(first).toBe("done");
		expect(second).toBe("done");
		expect(load).toHaveBeenCalledTimes(1);
	});
});
