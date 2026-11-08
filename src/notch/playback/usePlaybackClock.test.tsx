import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlaybackClock } from "./usePlaybackClock";

const START_MS = 1_700_000_000_000;

describe("usePlaybackClock", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(START_MS);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts at the reported position", () => {
		const { result } = renderHook(() =>
			usePlaybackClock({
				positionMs: 52_000,
				positionUpdatedAt: START_MS,
				durationMs: 200_000,
				isPlaying: true
			})
		);

		expect(result.current.positionMs).toBe(52_000);
	});

	it("moves on with the time while the track plays", () => {
		const { result } = renderHook(() =>
			usePlaybackClock({
				positionMs: 52_000,
				positionUpdatedAt: START_MS,
				durationMs: 200_000,
				isPlaying: true
			})
		);

		act(() => {
			vi.advanceTimersByTime(3_000);
		});

		expect(result.current.positionMs).toBe(55_000);
	});

	it("stays put while the track is paused", () => {
		const { result } = renderHook(() =>
			usePlaybackClock({
				positionMs: 52_000,
				positionUpdatedAt: START_MS,
				durationMs: 200_000,
				isPlaying: false
			})
		);

		act(() => {
			vi.advanceTimersByTime(3_000);
		});

		expect(result.current.positionMs).toBe(52_000);
	});

	it("jumps to a new report from the player", () => {
		const { result, rerender } = renderHook(
			(props) => usePlaybackClock(props),
			{
				initialProps: {
					positionMs: 52_000,
					positionUpdatedAt: START_MS,
					durationMs: 200_000,
					isPlaying: true
				}
			}
		);

		rerender({
			positionMs: 120_000,
			positionUpdatedAt: START_MS,
			durationMs: 200_000,
			isPlaying: true
		});
		act(() => {
			vi.advanceTimersByTime(250);
		});

		expect(result.current.positionMs).toBe(120_250);
	});

	it("shows the position the user drags to, and ignores the player while they hold the bar", () => {
		const { result } = renderHook(() =>
			usePlaybackClock({
				positionMs: 52_000,
				positionUpdatedAt: START_MS,
				durationMs: 200_000,
				isPlaying: true
			})
		);

		act(() => {
			result.current.beginSeek();
			result.current.previewSeek(90_000);
			vi.advanceTimersByTime(2_000);
		});

		expect(result.current.positionMs).toBe(90_000);
	});

	it("carries on from the position the user let go at, and returns it", () => {
		const { result } = renderHook(() =>
			usePlaybackClock({
				positionMs: 52_000,
				positionUpdatedAt: START_MS,
				durationMs: 200_000,
				isPlaying: true
			})
		);
		act(() => {
			result.current.beginSeek();
			result.current.previewSeek(90_000);
		});

		let committed = 0;
		act(() => {
			committed = result.current.commitSeek();
			vi.advanceTimersByTime(1_000);
		});

		expect(committed).toBe(90_000);
		expect(result.current.positionMs).toBe(91_000);
	});
});
