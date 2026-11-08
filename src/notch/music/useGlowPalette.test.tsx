import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const readArtPixels = vi.hoisted(() => vi.fn());
vi.mock("./artPixels", () => ({ readArtPixels }));

import { NEUTRAL_GLOW } from "./glowPalette";
import { useGlowPalette } from "./useGlowPalette";

/** RGBA bytes for `count` pixels of one color. */
const pixels = (r: number, g: number, b: number, count: number) =>
	new Uint8ClampedArray(Array.from({ length: count }, () => [r, g, b, 255]).flat());

describe("useGlowPalette", () => {
	beforeEach(() => {
		readArtPixels.mockReset();
	});

	it("has no palette while there is no cover", () => {
		const { result } = renderHook(() => useGlowPalette(null));

		expect(result.current).toBeNull();
		expect(readArtPixels).not.toHaveBeenCalled();
	});

	it("gives the palette of the cover once it has been read", async () => {
		readArtPixels.mockResolvedValue(pixels(40, 90, 220, 400));

		const { result } = renderHook(() => useGlowPalette("data:image/png;base64,blue-cover"));

		await waitFor(() => expect(result.current).not.toBeNull());
		expect(result.current).toHaveLength(1);
		expect(result.current?.[0].b).toBeGreaterThan(result.current?.[0].r ?? 255);
	});

	it("glows neutral when the cover cannot be read", async () => {
		readArtPixels.mockRejectedValue(new Error("no canvas"));

		const { result } = renderHook(() => useGlowPalette("data:image/png;base64,unreadable-cover"));

		await waitFor(() => expect(result.current).toEqual([...NEUTRAL_GLOW]));
	});

	it("does not read the same cover twice", async () => {
		readArtPixels.mockResolvedValue(pixels(220, 30, 40, 400));
		const first = renderHook(() => useGlowPalette("data:image/png;base64,red-cover"));
		await waitFor(() => expect(first.result.current).not.toBeNull());

		const second = renderHook(() => useGlowPalette("data:image/png;base64,red-cover"));

		expect(second.result.current).toEqual(first.result.current);
		expect(readArtPixels).toHaveBeenCalledTimes(1);
	});

	it("follows the cover when the track changes", async () => {
		readArtPixels.mockImplementation(async (url: string) =>
			url.endsWith("green") ? pixels(30, 190, 80, 400) : pixels(40, 90, 220, 400)
		);
		const { result, rerender } = renderHook(({ url }) => useGlowPalette(url), {
			initialProps: { url: "data:image/png;base64,first-blue" }
		});
		await waitFor(() => expect(result.current).not.toBeNull());

		rerender({ url: "data:image/png;base64,second-green" });

		await waitFor(() => {
			const color = result.current?.[0];
			expect(color && color.g > color.b).toBe(true);
		});
	});
});
