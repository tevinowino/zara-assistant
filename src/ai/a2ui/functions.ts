// The functions a surface may call inside a value or a validation check.
//
// They are the A2UI basic-catalog functions Zara supports, as pure code over
// already-resolved arguments. A surface can only name a function from this
// table; it can never supply code. `formatString` is not here because it needs
// the data model, so binding.ts handles it. `regex` is deliberately absent: a
// pattern written by a model is a denial-of-service risk for the notch.

type Args = Record<string, unknown>;
type CatalogFunction = (args: Args) => unknown;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function isWithin(value: number, min: unknown, max: unknown): boolean {
	const low = asNumber(min);
	const high = asNumber(max);
	return (low === undefined || value >= low) && (high === undefined || value <= high);
}

const FUNCTIONS: Record<string, CatalogFunction> = {
	formatNumber: ({ value, decimals }) => {
		const number = asNumber(value);
		if (number === undefined) return "";
		const places = Math.min(Math.max(Math.trunc(asNumber(decimals) ?? 0), 0), 6);
		return new Intl.NumberFormat("en-US", {
			minimumFractionDigits: places,
			maximumFractionDigits: places
		}).format(number);
	},

	pluralize: ({ value, zero, one, other }) => {
		const count = asNumber(value);
		if (count === 0 && typeof zero === "string") return zero;
		const form = count === 1 ? one : other;
		return typeof form === "string" ? form : "";
	},

	required: ({ value }) =>
		value !== undefined && value !== null && !(typeof value === "string" && value.trim() === ""),

	length: ({ value, min, max }) => {
		if (typeof value !== "string") return false;
		return isWithin(value.length, min, max);
	},

	numeric: ({ value, min, max }) => {
		const number = asNumber(value);
		return number !== undefined && isWithin(number, min, max);
	},

	email: ({ value }) => typeof value === "string" && EMAIL_SHAPE.test(value),

	and: ({ values }) => Array.isArray(values) && values.every(Boolean),
	or: ({ values }) => Array.isArray(values) && values.some(Boolean),
	not: ({ value }) => !value
};

/** Runs a catalog function on resolved arguments; undefined if it is not in the catalog. */
export function callFunction(name: string, args: Args): unknown {
	if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) return undefined;
	return FUNCTIONS[name](args);
}
