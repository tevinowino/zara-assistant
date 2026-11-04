import { useEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invokeCalls, setInvokeHandler } from "./shims/tauriCore";
import { emitTauriEvent } from "./shims/tauriEvent";

// A throwaway component that does what real notch components do: read a value
// from the backend on mount, then follow backend events.
function VolumeReadout() {
	const [volume, setVolume] = useState<number | null>(null);

	useEffect(() => {
		invoke<{ volume: number }>("get_volume_state").then((state) => setVolume(state.volume));
		const unlisten = listen<{ volume: number }>("volume-change", (event) =>
			setVolume(event.payload.volume)
		);
		return () => {
			unlisten.then((stop) => stop());
		};
	}, []);

	return <p>{volume === null ? "loading" : `volume ${Math.round(volume * 100)}%`}</p>;
}

describe("Tauri test shims", () => {
	test("a component reads its initial state from a registered command", async () => {
		setInvokeHandler("get_volume_state", () => ({ volume: 0.4 }));

		render(<VolumeReadout />);

		expect(await screen.findByText("volume 40%")).toBeInTheDocument();
		expect(invokeCalls).toEqual([{ command: "get_volume_state", args: undefined }]);
	});

	test("a component follows events emitted by the backend", async () => {
		setInvokeHandler("get_volume_state", () => ({ volume: 0.4 }));
		render(<VolumeReadout />);
		await screen.findByText("volume 40%");

		emitTauriEvent("volume-change", { volume: 0.75 });

		expect(await screen.findByText("volume 75%")).toBeInTheDocument();
	});

	test("an unregistered command rejects so a typo cannot pass silently", async () => {
		await expect(invoke("not_a_command")).rejects.toThrow(
			'No test handler registered for command "not_a_command"'
		);
	});

	test("shim state does not leak between tests", async () => {
		await expect(invoke("get_volume_state")).rejects.toThrow("No test handler registered");
	});
});
