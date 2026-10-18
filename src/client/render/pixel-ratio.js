// @ts-check
/**
 * How many device pixels the renderer draws per CSS pixel. A desktop or laptop screen renders at its
 * full pixel ratio, so the picture is as sharp as the screen allows. A touch device keeps a cap of 2,
 * because the bloom pass and the 60 fps target cost too much battery on a phone at 3 pixels per pixel.
 */

/** The cap for a device whose main pointer is a finger. */
export const TOUCH_PIXEL_RATIO_CAP = 2;

/**
 * @param {number} devicePixelRatio `window.devicePixelRatio`
 * @param {boolean} coarsePointer whether the main pointer is coarse, as on a phone or a tablet
 * @returns {number} at least 1
 */
export function pixelRatioFor(devicePixelRatio, coarsePointer) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1 ? devicePixelRatio : 1;
  return coarsePointer ? Math.min(ratio, TOUCH_PIXEL_RATIO_CAP) : ratio;
}
