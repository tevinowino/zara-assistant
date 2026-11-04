import { defaultSchema, type Schema } from "hast-util-sanitize";

// hast-util-sanitize's default schema is GitHub's markdown allowlist. It already
// excludes <script>, <style>, <iframe>, <object>, <form> and every `style`
// attribute, so this starts from it and only changes where our threat model
// differs:
//
//  - No <img>, <picture> or <source>. A model-authored image tag is an
//    outbound-request (tracking pixel) primitive with no upside in the notch.
//  - <u> and <mark> are added. Markdown has no underline or highlight syntax, so a
//    model can only produce them with raw HTML, and the sanitizer is what makes
//    allowing that safe.
//  - href protocols are limited to http, https and mailto.
//  - clobberPrefix is changed so a stray `id="root"` cannot clobber the app's
//    own DOM globals.
const EXCLUDED_TAGS = new Set(["img", "picture", "source"]);
const ADDED_TAGS = ["u", "mark"];

export const zaraSanitizeSchema: Schema = {
	...defaultSchema,
	tagNames: [
		...(defaultSchema.tagNames ?? []).filter((tag) => !EXCLUDED_TAGS.has(tag)),
		...ADDED_TAGS
	],
	protocols: {
		...defaultSchema.protocols,
		href: ["http", "https", "mailto"]
	},
	clobberPrefix: "zara-"
};
