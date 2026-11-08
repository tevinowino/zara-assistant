/**
 * The pixels of an album cover, shrunk so reading them is cheap.
 *
 * The cover arrives from the backend as a data URL, so the canvas is never tainted and its
 * pixels can be read.
 */

/** The side of the square the cover is shrunk to, in pixels. */
export const ART_SAMPLE_SIZE = 32;

/** The RGBA bytes of the cover at `ART_SAMPLE_SIZE` x `ART_SAMPLE_SIZE`. Rejects if it cannot be read. */
export function readArtPixels(artUrl: string): Promise<Uint8ClampedArray> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = ART_SAMPLE_SIZE;
			canvas.height = ART_SAMPLE_SIZE;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) {
				reject(new Error("No 2d canvas to read the cover with"));
				return;
			}
			context.drawImage(image, 0, 0, ART_SAMPLE_SIZE, ART_SAMPLE_SIZE);
			try {
				resolve(context.getImageData(0, 0, ART_SAMPLE_SIZE, ART_SAMPLE_SIZE).data);
			} catch (error) {
				reject(error);
			}
		};
		image.onerror = () => reject(new Error("The cover could not be loaded"));
		image.src = artUrl;
	});
}
