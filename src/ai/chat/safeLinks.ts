// Links in an answer come from the model, and the answer may have been steered
// by text on a web page the user was looking at. Only web and mail links open,
// and only through the system browser; anything else (javascript:, file:, a
// custom protocol handler) is refused.
const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalUrl(href: string | undefined | null): href is string {
	if (!href) return false;
	try {
		return OPENABLE_PROTOCOLS.has(new URL(href).protocol);
	} catch {
		return false;
	}
}
