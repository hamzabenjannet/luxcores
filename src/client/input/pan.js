// @ts-check
/**
 * One-finger drag pans the camera (GDD 11.1). Placeholder for M8, which
 * adds tap selection, hero orders, path mode and pinch zoom on top of the
 * same pointer stream.
 */

/**
 * @param {HTMLElement} el
 * @param {(dxTiles: number, dzTiles: number) => void} pan
 * @param {() => number} tilesPerPixel
 */
export function attachPan(el, pan, tilesPerPixel) {
  /** @type {{ id: number, x: number, y: number } | null} */
  let drag = null;

  el.addEventListener('pointerdown', (e) => {
    if (drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = tilesPerPixel();
    // Dragging moves the world under the finger, so the camera goes the other way.
    // Screen y maps to world z through the camera tilt; 1.0 keeps it simple for now.
    pan(-(e.clientX - drag.x) * k, -(e.clientY - drag.y) * k);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });

  const end = (/** @type {PointerEvent} */ e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
