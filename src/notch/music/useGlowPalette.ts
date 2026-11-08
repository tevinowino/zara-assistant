import { useEffect, useState } from "react";
import { readArtPixels } from "./artPixels";
import { extractGlowPalette, NEUTRAL_GLOW, type GlowColor } from "./glowPalette";

/** How many covers' palettes are remembered, so going back to a track costs nothing. */
const REMEMBERED_COVERS = 12;

const rememberedPalettes = new Map<string, GlowColor[]>();

function remember(artUrl: string, palette: GlowColor[]) {
	rememberedPalettes.delete(artUrl);
	rememberedPalettes.set(artUrl, palette);
	if (rememberedPalettes.size > REMEMBERED_COVERS) {
		const oldest = rememberedPalettes.keys().next().value;
		if (oldest !== undefined) rememberedPalettes.delete(oldest);
	}
}

/**
 * The glow colors of the cover at `artUrl`, or null while there is no cover or it is still
 * being read. A cover that cannot be read glows neutral rather than not at all.
 */
export function useGlowPalette(artUrl: string | null): GlowColor[] | null {
	const [palette, setPalette] = useState<GlowColor[] | null>(() =>
		artUrl ? (rememberedPalettes.get(artUrl) ?? null) : null
	);

	useEffect(() => {
		if (!artUrl) {
			setPalette(null);
			return;
		}
		const known = rememberedPalettes.get(artUrl);
		if (known) {
			setPalette(known);
			return;
		}
		let cancelled = false;
		readArtPixels(artUrl)
			.then(extractGlowPalette)
			.catch(() => [...NEUTRAL_GLOW])
			.then((colors) => {
				remember(artUrl, colors);
				if (!cancelled) setPalette(colors);
			});
		return () => {
			cancelled = true;
		};
	}, [artUrl]);

	return palette;
}
