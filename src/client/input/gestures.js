// @ts-check
/**
 * The decisions behind the touch gestures that GDD 11 describes, as pure functions: pinch zoom and the
 * press, drag and release of an ability button. The DOM code in `pointer.js` and `ui/controls.js` only
 * measures the fingers and applies the answers, and the Godot client answers the same cases in
 * `vone/scripts/game_logic.gd` (test/fixtures/client-parity.json).
 */

/** Zoom 1 shows 32 tiles across (GDD 10.1). 0.6 shows the whole width of the map and more, 2.2 about 15 tiles. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;

/** Pixels a pressed ability button may move before the press becomes an aim drag. */
export const HOLD_AIM_PX = 14;

/**
 * @param {number} zoom
 * @returns {number} the zoom limited to ZOOM_MIN..ZOOM_MAX
 */
export function clampZoom(zoom) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * The zoom after a pinch: the zoom when the two fingers touched, scaled by how far they moved apart.
 * Fingers farther apart zoom in. A start distance of 0 leaves the zoom alone.
 * @param {number} startZoom
 * @param {number} startDistance  pixels between the fingers when the pinch began
 * @param {number} distance  pixels between them now
 */
export function pinchZoom(startZoom, startDistance, distance) {
  if (startDistance <= 0) return clampZoom(startZoom);
  return clampZoom((startZoom * distance) / startDistance);
}

/**
 * Whether a pressed ability button is now an aim drag (the player drags the finger toward the target) or
 * still a press that a release turns into a click.
 * @param {number} movedPx  distance of the finger from where it went down
 * @returns {'aiming' | 'pending'}
 */
export function holdAimPhase(movedPx) {
  return movedPx >= HOLD_AIM_PX ? 'aiming' : 'pending';
}

/**
 * What lifting the finger does after a press on an ability button. Without an aim drag it is a click
 * (the tap-then-tap way of GDD 11.2). After an aim drag, lifting over the map casts at that point and
 * lifting back over the button cancels.
 * @param {boolean} aiming  whether the press became an aim drag
 * @param {boolean} overButton  whether the finger lifts over the button it pressed
 * @returns {'click' | 'cast' | 'cancel'}
 */
export function holdAimRelease(aiming, overButton) {
  if (!aiming) return 'click';
  return overButton ? 'cancel' : 'cast';
}
