import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import {
	AUTO_UPDATE_SETTING,
	SKIPPED_UPDATE_SETTING,
	describeUpdateError,
	findUpdate,
	offerUpdateAtStartup,
	type AvailableUpdate,
	type StartupOfferDeps
} from "./updates";

const checkMock = vi.mocked(check);

beforeEach(() => checkMock.mockReset());

describe("findUpdate", () => {
	it("is null when this is already the newest version", async () => {
		checkMock.mockResolvedValue(null);

		expect(await findUpdate()).toBeNull();
	});

	it("names the new version and carries its release notes", async () => {
		checkMock.mockResolvedValue({
			version: "0.2.0",
			body: "  Faster answers.  ",
			downloadAndInstall: vi.fn()
		} as never);

		const update = await findUpdate();

		expect(update?.version).toBe("0.2.0");
		expect(update?.notes).toBe("Faster answers.");
	});

	it("has no notes when the release has none", async () => {
		checkMock.mockResolvedValue({
			version: "0.2.0",
			body: "  ",
			downloadAndInstall: vi.fn()
		} as never);

		expect((await findUpdate())?.notes).toBeNull();
	});

	it("reports how much has downloaded as a share, then done", async () => {
		const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
			onEvent({ event: "Started", data: { contentLength: 200 } });
			onEvent({ event: "Progress", data: { chunkLength: 50 } });
			onEvent({ event: "Progress", data: { chunkLength: 150 } });
			onEvent({ event: "Finished" });
		});
		checkMock.mockResolvedValue({ version: "0.2.0", downloadAndInstall } as never);
		const shares: Array<number | null> = [];

		await (await findUpdate())!.install((share) => shares.push(share));

		expect(shares).toEqual([0, 0.25, 1, 1]);
	});

	it("reports an unknown share when the size is not given", async () => {
		const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
			onEvent({ event: "Started", data: {} });
			onEvent({ event: "Progress", data: { chunkLength: 50 } });
		});
		checkMock.mockResolvedValue({ version: "0.2.0", downloadAndInstall } as never);
		const shares: Array<number | null> = [];

		await (await findUpdate())!.install((share) => shares.push(share));

		expect(shares).toEqual([null, null]);
	});
});

describe("describeUpdateError", () => {
	it("says an update that could not be verified was not installed", () => {
		expect(describeUpdateError(new Error("The signature could not be verified"))).toMatch(
			/could not be verified/
		);
	});

	it("says nothing has been published when the update file is missing", () => {
		expect(describeUpdateError("request failed: 404 Not Found")).toMatch(/No update information/);
	});

	it("suggests checking the connection for anything else", () => {
		expect(describeUpdateError(new Error("network down"))).toMatch(/internet connection/);
	});
});

function offer(overrides: Partial<StartupOfferDeps> = {}, update: AvailableUpdate | null = null) {
	const saved: Array<[string, string]> = [];
	const asked: Array<{ message: string; title: string }> = [];
	const deps: StartupOfferDeps = {
		find: async () => update,
		readSettings: async () => ({}),
		saveSetting: async (key, value) => void saved.push([key, value]),
		ask: async (message, title) => {
			asked.push({ message, title });
			return false;
		},
		...overrides
	};
	return { run: () => offerUpdateAtStartup(deps), saved, asked };
}

const newer = (install = vi.fn(async () => {}), notes: string | null = null): AvailableUpdate => ({
	version: "0.2.0",
	notes,
	install
});

describe("the check at startup", () => {
	it("does nothing when the user turned it off", async () => {
		const find = vi.fn(async () => newer());
		const { run } = offer({ find, readSettings: async () => ({ [AUTO_UPDATE_SETTING]: "false" }) });

		expect(await run()).toBe("disabled");
		expect(find).not.toHaveBeenCalled();
	});

	it("checks when nothing is saved, since checking is on by default", async () => {
		const find = vi.fn(async () => null);
		const { run } = offer({ find });

		expect(await run()).toBe("up-to-date");
		expect(find).toHaveBeenCalledTimes(1);
	});

	it("asks nothing when Zara is up to date", async () => {
		const { run, asked } = offer({}, null);

		await run();

		expect(asked).toEqual([]);
	});

	it("asks whether to update, naming the version and the notes", async () => {
		const { run, asked } = offer({}, newer(undefined, "Faster answers."));

		await run();

		expect(asked).toHaveLength(1);
		expect(asked[0].title).toBe("Update Zara");
		expect(asked[0].message).toContain("Zara 0.2.0 is available");
		expect(asked[0].message).toContain("Faster answers.");
	});

	it("installs when the user says yes", async () => {
		const install = vi.fn(async () => {});
		const { run } = offer({ ask: async () => true }, newer(install));

		expect(await run()).toBe("installing");
		expect(install).toHaveBeenCalledTimes(1);
	});

	it("remembers a no for that version and does not install", async () => {
		const install = vi.fn(async () => {});
		const { run, saved } = offer({}, newer(install));

		expect(await run()).toBe("declined");
		expect(install).not.toHaveBeenCalled();
		expect(saved).toEqual([[SKIPPED_UPDATE_SETTING, "0.2.0"]]);
	});

	it("does not ask again about a version the user already put off", async () => {
		const { run, asked } = offer(
			{ readSettings: async () => ({ [SKIPPED_UPDATE_SETTING]: "0.2.0" }) },
			newer()
		);

		expect(await run()).toBe("skipped");
		expect(asked).toEqual([]);
	});

	it("asks again when a newer version than the one put off comes out", async () => {
		const { run, asked } = offer(
			{ readSettings: async () => ({ [SKIPPED_UPDATE_SETTING]: "0.1.5" }) },
			newer()
		);

		await run();

		expect(asked).toHaveLength(1);
	});

	it("stays quiet when the check fails, as when offline", async () => {
		const { run, asked } = offer({
			find: async () => {
				throw new Error("offline");
			}
		});

		expect(await run()).toBe("failed");
		expect(asked).toEqual([]);
	});

	it("stays quiet when the install fails", async () => {
		const install = vi.fn(async () => {
			throw new Error("bad signature");
		});
		const { run } = offer({ ask: async () => true }, newer(install));

		expect(await run()).toBe("failed");
	});
});
