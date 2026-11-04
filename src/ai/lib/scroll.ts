export interface ScrollMetrics {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}

const DEFAULT_THRESHOLD = 48;

// Pure so it's testable without a layout engine — jsdom has none. True when
// the container is at (or within `threshold`px of) the bottom, meaning an
// auto-scroll on new content wouldn't yank the view away from a user who
// has scrolled up to read history.
export function shouldAutoScroll(
	metrics: ScrollMetrics,
	threshold: number = DEFAULT_THRESHOLD
): boolean {
	const { scrollTop, scrollHeight, clientHeight } = metrics;
	const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
	return distanceFromBottom <= threshold;
}
