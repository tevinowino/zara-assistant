import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown } from "../../../icons/glyphs";
import type { BlockDataMap } from "../../protocol";
import type { BlockRenderProps } from "./registry";
import { tableRowKeys } from "./tableRowKey";

type TableData = BlockDataMap["table"];
type SortDirection = "asc" | "desc";

export function TableBlock({ data, height }: BlockRenderProps<TableData>) {
	const [sortColumn, setSortColumn] = useState<number | null>(null);
	const [sortDirection, setSortDirection] = useState<SortDirection | null>(null);

	// Clicking a header cycles ascending, descending, unsorted.
	const handleHeaderClick = (columnIndex: number) => {
		if (sortColumn !== columnIndex) {
			setSortColumn(columnIndex);
			setSortDirection("asc");
		} else if (sortDirection === "asc") {
			setSortDirection("desc");
		} else {
			setSortColumn(null);
			setSortDirection(null);
		}
	};

	const rows =
		sortColumn === null || sortDirection === null
			? data.rows
			: [...data.rows].sort((a, b) => {
					const [left, right] = [a[sortColumn], b[sortColumn]];
					const comparison =
						typeof left === "number" && typeof right === "number"
							? left - right
							: String(left).localeCompare(String(right));
					return sortDirection === "asc" ? comparison : -comparison;
				});
	const rowKeys = tableRowKeys(rows);

	return (
		<div className="zai-block zai-data-table" style={{ height }}>
			<div className="zai-data-table-scroll">
				<table>
					<thead>
						<tr>
							{data.columns.map((column, i) => {
								const sorted = sortColumn === i ? sortDirection : null;
								return (
									<th
										key={i}
										scope="col"
										aria-sort={
											sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
										}
									>
										<button type="button" onClick={() => handleHeaderClick(i)}>
											{column}
											{sorted === "asc" && <ChevronUp size={10} aria-hidden="true" />}
											{sorted === "desc" && <ChevronDown size={10} aria-hidden="true" />}
										</button>
									</th>
								);
							})}
						</tr>
					</thead>
					{/* Re-keyed on the sort state: a brief fade says "this changed" without
					    animating rows swapping position inside a fixed-height scroll pane. */}
					<AnimatePresence mode="wait" initial={false}>
						<motion.tbody
							key={`${sortColumn}:${sortDirection}`}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.16 }}
						>
							{rows.map((row, rowIndex) => (
								<tr key={rowKeys[rowIndex]}>
									{row.map((cell, cellIndex) => (
										<td key={cellIndex}>{cell}</td>
									))}
								</tr>
							))}
						</motion.tbody>
					</AnimatePresence>
				</table>
			</div>
		</div>
	);
}
