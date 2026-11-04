// One declaration for every single-icon module reached through the "iconoir-icons/" alias
// (see iconoirAlias.ts); the package ships these files without type declarations.
declare module "iconoir-icons/*" {
	import type { ComponentType, SVGProps } from "react";
	const Icon: ComponentType<SVGProps<SVGSVGElement>>;
	export default Icon;
}
