import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "./safeLinks";

describe("isSafeExternalUrl", () => {
	it("allows web and mail links", () => {
		expect(isSafeExternalUrl("https://example.com/a?b=1")).toBe(true);
		expect(isSafeExternalUrl("http://example.com")).toBe(true);
		expect(isSafeExternalUrl("mailto:someone@example.com")).toBe(true);
	});

	it("refuses scripts, local files and custom protocol handlers", () => {
		expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeExternalUrl("file:///C:/Windows/System32/cmd.exe")).toBe(false);
		expect(isSafeExternalUrl("ms-settings:privacy")).toBe(false);
		expect(isSafeExternalUrl("data:text/html,<script>1</script>")).toBe(false);
	});

	it("refuses anything that is not a complete URL", () => {
		expect(isSafeExternalUrl("/relative/path")).toBe(false);
		expect(isSafeExternalUrl("example.com")).toBe(false);
		expect(isSafeExternalUrl("")).toBe(false);
		expect(isSafeExternalUrl(undefined)).toBe(false);
		expect(isSafeExternalUrl(null)).toBe(false);
	});
});
