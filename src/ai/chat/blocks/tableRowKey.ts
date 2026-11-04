type Cell = string | number;

// A stable key per row, so React reuses DOM nodes by row identity rather than
// array position. The block schema has no row id, and a row's content is its
// identity here. Legitimate duplicate rows get an occurrence suffix so keys stay
// unique.
export function tableRowKeys(rows: Cell[][]): string[] {
	const occurrences = new Map<string, number>();
	return rows.map((row) => {
		const base = row.join(" ");
		const occurrence = occurrences.get(base) ?? 0;
		occurrences.set(base, occurrence + 1);
		return occurrence === 0 ? base : `${base}#${occurrence}`;
	});
}
