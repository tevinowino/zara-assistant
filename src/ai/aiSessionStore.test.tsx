import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setInvokeHandler } from "../test/shims/tauriCore";
import {
	AiSessionHost,
	createAiSessionStore,
	useAiSessionSelector,
	type AiSessionStore
} from "./aiSessionStore";
import type { AiSession } from "./useAiSession";

/** A conversation with only the parts these tests look at. */
function fakeSession(parts: Partial<AiSession>): AiSession {
	return { phase: "idle", streamingText: null, ...parts } as AiSession;
}

describe("the assistant conversation store", () => {
	it("has no conversation before the host publishes one", () => {
		const store = createAiSessionStore();

		expect(store.current()).toBeNull();
		expect(() => store.require()).toThrow();
	});

	it("hands event handlers the latest published conversation", () => {
		const store = createAiSessionStore();
		const first = fakeSession({ phase: "idle" });
		const second = fakeSession({ phase: "sending" });

		store.publish(first);
		store.publish(second);

		expect(store.require()).toBe(second);
	});

	it("stops telling a reader about changes once it has unsubscribed", () => {
		const store = createAiSessionStore();
		let heard = 0;
		const unsubscribe = store.subscribe(() => (heard += 1));

		store.publish(fakeSession({}));
		unsubscribe();
		store.publish(fakeSession({}));

		expect(heard).toBe(1);
	});
});

describe("reading part of the conversation", () => {
	function BusyLabel({ store, onRender }: { store: AiSessionStore; onRender: () => void }) {
		const busy = useAiSessionSelector(store, (session) => session.phase === "sending", false);
		onRender();
		return <p>{busy ? "busy" : "free"}</p>;
	}

	it("shows the fallback until a conversation is published", () => {
		const store = createAiSessionStore();

		render(<BusyLabel store={store} onRender={() => {}} />);

		expect(screen.getByText("free")).toBeInTheDocument();
	});

	it("re-renders when the part it reads changes", () => {
		const store = createAiSessionStore();
		store.publish(fakeSession({ phase: "idle" }));
		render(<BusyLabel store={store} onRender={() => {}} />);

		act(() => store.publish(fakeSession({ phase: "sending" })));

		expect(screen.getByText("busy")).toBeInTheDocument();
	});

	it("does not re-render when only other parts of the conversation change", () => {
		const store = createAiSessionStore();
		store.publish(fakeSession({ phase: "sending", streamingText: "Hel" }));
		let renders = 0;
		render(<BusyLabel store={store} onRender={() => (renders += 1)} />);
		const rendersBeforeStreaming = renders;

		act(() => store.publish(fakeSession({ phase: "sending", streamingText: "Hello" })));
		act(() => store.publish(fakeSession({ phase: "sending", streamingText: "Hello, wor" })));

		expect(renders).toBe(rendersBeforeStreaming);
	});
});

describe("the conversation host", () => {
	it("publishes the conversation it runs, and each change to it", async () => {
		setInvokeHandler("conv_load", () => null);
		const store = createAiSessionStore();
		render(<AiSessionHost store={store} />);
		expect(store.require().draft).toBe("");

		act(() => store.require().setDraft("what is the weather"));

		await waitFor(() => expect(store.require().draft).toBe("what is the weather"));
	});
});
