// Converts a 6-digit hex color to an rgba() string at the given alpha. No
// input validation — by the time a color reaches this function it has
// already passed the block schema (hexColorSchema) at the protocol
// boundary, so a malformed hex can't actually arrive here.
export function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
