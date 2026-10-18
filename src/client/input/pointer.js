// @ts-check
/**
 * One pointer stream for the game canvas: a drag pans the camera and a short
 * press without movement is a tap (GDD 11.1). The drag holds the ground point
 * under the finger still, so it follows the camera tilt. M8 adds pinch zoom and
 * path mode on top of the same stream.
 */

/** Pixels the pointer may move before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 8;
/** A press longer than this is not a tap. */
const TAP_MAX_MS = 500;

/**
 * @param {HTMLElement} el
 * @param {{
 *   groundAt: (clientX: number, clientY: number) => { x: number, z: number } | null,  // ground point in tiles under a screen point
 *   pan: (dxTiles: number, dzTiles: number) => void,
 *   onTap: (ground: { x: number, z: number }) => void,
 * }} hooks
 */
export function attachPointer(el, { groundAt, pan, onTap }) {
  /** @type {{ id: number, x: number, y: number, at: number, anchor: { x: number, z: number } | null, dragging: boolean } | null} */
  let press = null;

  el.addEventListener('pointerdown', (e) => {
    if (press) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, anchor: groundAt(e.clientX, e.clientY), dragging: false };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX) press.dragging = true;
    if (!press.dragging || !press.anchor) return;
    const now = groundAt(e.clientX, e.clientY);
    if (now) pan(press.anchor.x - now.x, press.anchor.z - now.z);
  });

  el.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    // The event time stamps, not the handler times: a busy frame can delay the handlers and turn a quick tap into a slow one.
    const tapped = !press.dragging && e.timeStamp - press.at <= TAP_MAX_MS;
    press = null;
    if (!tapped) return;
    const ground = groundAt(e.clientX, e.clientY);
    if (ground) onTap(ground);
  });

  el.addEventListener('pointercancel', (e) => {
    if (press && e.pointerId === press.id) press = null;
  });
}
