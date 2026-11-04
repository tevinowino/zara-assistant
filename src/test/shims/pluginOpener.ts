// Test replacement for @tauri-apps/plugin-opener (see vitest.config.ts).
// Opening is recorded instead of performed.

export const openedUrls: string[] = [];

export function resetOpenedUrls(): void {
	openedUrls.length = 0;
}

export async function openUrl(url: string): Promise<void> {
	openedUrls.push(url);
}
