// Memoizes a dynamic import() (or any async load) so N call sites across a
// session share one network/parse cost instead of re-importing per call.
// Each call to createLazyModuleLoader returns its OWN independent cache —
// the memoization lives in the closure, not shared global state.
export function createLazyModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => (promise ??= load());
}
