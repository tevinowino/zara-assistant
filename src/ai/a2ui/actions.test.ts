import { describe, expect, it, vi } from "vitest";
import { FUNCTION_ACTION_NAMES, prepareFunctionAction, type ActionHost } from "./actions";

function fakeHost(overrides: Partial<ActionHost> = {}): ActionHost {
	return {
		copyText: vi.fn(async () => {}),
		openUrl: vi.fn(async () => {}),
		saveNote: vi.fn(async () => {}),
		...overrides
	};
}

describe("prepareFunctionAction", () => {
	it("copies text through the host without asking first", async () => {
		const host = fakeHost();

		const action = prepareFunctionAction("copyText", { text: "hello" }, host);

		expect(action).toMatchObject({
			kind: "ready",
			requiresConfirmation: false
		});
		if (action.kind === "ready") await action.run();
		expect(host.copyText).toHaveBeenCalledWith("hello");
	});

	it("starts a timer in seconds when the notch can do it", async () => {
		const startTimer = vi.fn();
		const host = fakeHost({ startTimer });

		const action = prepareFunctionAction("startTimer", { minutes: 25 }, host);

		expect(action).toMatchObject({
			kind: "ready",
			requiresConfirmation: false
		});
		if (action.kind === "ready") await action.run();
		expect(startTimer).toHaveBeenCalledWith(1500);
	});

	it("refuses a timer the notch cannot start", () => {
		const host = fakeHost();

		const action = prepareFunctionAction("startTimer", { minutes: 25 }, host);

		expect(action).toEqual({
			kind: "refused",
			reason: "This can't be done from here."
		});
	});

	it("refuses a timer outside one to one hundred eighty minutes", () => {
		const host = fakeHost({ startTimer: vi.fn() });

		expect(prepareFunctionAction("startTimer", { minutes: 0 }, host).kind).toBe("refused");
		expect(prepareFunctionAction("startTimer", { minutes: 181 }, host).kind).toBe("refused");
		expect(prepareFunctionAction("startTimer", { minutes: 2.5 }, host).kind).toBe("refused");
		expect(prepareFunctionAction("startTimer", { minutes: "25" }, host).kind).toBe("refused");
	});

	it("opens a panel only from the allowed list", async () => {
		const openPanel = vi.fn();
		const host = fakeHost({ openPanel });

		const calendar = prepareFunctionAction("openPanel", { panel: "calendar" }, host);
		const settings = prepareFunctionAction("openPanel", { panel: "settings" }, host);

		if (calendar.kind === "ready") await calendar.run();
		expect(openPanel).toHaveBeenCalledWith("calendar");
		expect(settings.kind).toBe("refused");
	});

	it("opens a web link and tells the user which site it is going to", async () => {
		const host = fakeHost();

		const action = prepareFunctionAction("openUrl", { url: "https://example.com/docs" }, host);

		expect(action).toMatchObject({
			kind: "ready",
			requiresConfirmation: false,
			hint: "Opens example.com"
		});
		if (action.kind === "ready") await action.run();
		expect(host.openUrl).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("refuses links that are not web or mail links", () => {
		const host = fakeHost();

		expect(prepareFunctionAction("openUrl", { url: "javascript:alert(1)" }, host).kind).toBe(
			"refused"
		);
		expect(
			prepareFunctionAction("openUrl", { url: "file:///C:/Windows/System32" }, host).kind
		).toBe("refused");
		expect(prepareFunctionAction("openUrl", { url: "not a url" }, host).kind).toBe("refused");
		expect(host.openUrl).not.toHaveBeenCalled();
	});

	it("asks for a second click before saving a note", async () => {
		const host = fakeHost();

		const action = prepareFunctionAction("saveNote", { text: "Buy milk" }, host);

		expect(action).toMatchObject({ kind: "ready", requiresConfirmation: true });
		expect(host.saveNote).not.toHaveBeenCalled();
		if (action.kind === "ready") await action.run();
		expect(host.saveNote).toHaveBeenCalledWith("Buy milk");
	});

	it("refuses empty or oversized text", () => {
		const host = fakeHost();

		expect(prepareFunctionAction("copyText", { text: "" }, host).kind).toBe("refused");
		expect(prepareFunctionAction("saveNote", { text: "x".repeat(2001) }, host).kind).toBe(
			"refused"
		);
	});

	it("refuses a function that is not on the list", () => {
		const host = fakeHost();

		expect(prepareFunctionAction("runShell", { cmd: "dir" }, host)).toEqual({
			kind: "refused",
			reason: "This can't be done from here."
		});
		expect(prepareFunctionAction("constructor", {}, host).kind).toBe("refused");
	});

	it("lists exactly the functions a surface may name", () => {
		expect([...FUNCTION_ACTION_NAMES].sort()).toEqual(
			["copyText", "openPanel", "openUrl", "saveNote", "startTimer"].sort()
		);
	});
});
