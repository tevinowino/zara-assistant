/**
 * Loading of the assistant panel's code, kept out of the notch's entry bundle
 * (it is large: the markdown, math and A2UI libraries).
 *
 * Opening the panel used to be the moment its code was first downloaded,
 * parsed and run, on the same thread that animates the notch growing, which
 * made the opening animation stutter. `loadAiPanel` is the single place that
 * starts the load, and starting it early is safe because the load happens at
 * most once.
 */

type AiPanelModule = typeof import("./ConnectedAiPanel");

/** How long after start-up the panel's code is fetched in the background, in milliseconds. */
const BACKGROUND_PRELOAD_DELAY_MS = 3000;

let loading: Promise<AiPanelModule> | null = null;

/** The panel's module. The first call starts the load; later calls share it. */
export function loadAiPanel(): Promise<AiPanelModule> {
	loading ??= import("./ConnectedAiPanel").catch((error) => {
		// A failed load (a dropped read of the bundle) must be retried by the next call.
		loading = null;
		throw error;
	});
	return loading;
}

/**
 * Starts loading the panel once the notch has settled and the browser is idle,
 * so by the time anyone opens it nothing is left to load. Returns a function
 * that cancels the wait if the load has not started.
 */
export function preloadAiPanelWhenIdle(): () => void {
	let cancelIdle: () => void = () => {};
	const timer = setTimeout(() => {
		const start = () => void loadAiPanel().catch(() => {});
		if (typeof requestIdleCallback === "function") {
			const handle = requestIdleCallback(start, { timeout: 5000 });
			cancelIdle = () => cancelIdleCallback(handle);
		} else {
			start();
		}
	}, BACKGROUND_PRELOAD_DELAY_MS);
	return () => {
		clearTimeout(timer);
		cancelIdle();
	};
}
