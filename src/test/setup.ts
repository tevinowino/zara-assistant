// Shared test environment: technical boilerplate only. Domain values stay inside
// each test so a reader never has to leave the test to understand it.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetInvokeHandlers } from "./shims/tauriCore";
import { resetTauriEvents } from "./shims/tauriEvent";
import { resetOpenedUrls } from "./shims/pluginOpener";

// Recent Node versions (25 and later) ship their own `localStorage`, which does not work
// without a storage file and hides the one jsdom provides. Put jsdom's back, so the tests
// behave the same on every Node version.
if (typeof globalThis.localStorage?.setItem !== "function") {
	const jsdomWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: jsdomWindow.localStorage
	});
}

// jsdom lacks these browser APIs that the notch UI and chart libraries touch.
class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}) as MediaQueryList;
}

// jsdom cannot draw on a canvas; saying there is no drawing context lets code that
// checks for one (the thinking orb) skip drawing without jsdom logging an error.
window.HTMLCanvasElement.prototype.getContext = () => null;

// jsdom does not measure SVG paths; the device drawings that animate a stroke ask for a length.
if (!("getTotalLength" in SVGElement.prototype)) {
	Object.defineProperty(SVGElement.prototype, "getTotalLength", { value: () => 0 });
}

// jsdom has no pointer capture; Glisse (switches, sliders) captures the pointer on press.
const capturedPointerIds = new WeakMap<Element, Set<number>>();
Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number) {
	capturedPointerIds.set(this, (capturedPointerIds.get(this) ?? new Set()).add(pointerId));
};
Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number) {
	return capturedPointerIds.get(this)?.has(pointerId) ?? false;
};
Element.prototype.releasePointerCapture = function releasePointerCapture(pointerId: number) {
	capturedPointerIds.get(this)?.delete(pointerId);
};

window.HTMLElement.prototype.scrollTo = function scrollTo() {};
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

afterEach(() => {
	cleanup();
	resetInvokeHandlers();
	resetTauriEvents();
	resetOpenedUrls();
	localStorage.clear();
});
