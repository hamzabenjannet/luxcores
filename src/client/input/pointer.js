// @ts-check
/**
 * One pointer stream for the game canvas: a drag pans the camera, a short press without movement is a
 * tap, and two fingers pinch to zoom (GDD 11.1). The drag holds the ground point under the finger
 * still, so it follows the camera tilt. The mouse wheel zooms too. The decisions for the zoom live in
 * `gestures.js`; this file only measures the pointers.
 */

import { pinchZoom } from './gestures.js';

/** Pixels the pointer may move before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 8;
/** A press longer than this is not a tap. */
const TAP_MAX_MS = 500;
/** How strongly one wheel notch zooms: the zoom is multiplied by exp(-deltaY * this). */
const WHEEL_ZOOM_RATE = 0.0015;

/**
 * @param {HTMLElement} el
 * @param {{
 *   groundAt: (clientX: number, clientY: number) => { x: number, z: number } | null,  // ground point in tiles under a screen point
 *   pan: (dxTiles: number, dzTiles: number) => void,
 *   onTap: (ground: { x: number, z: number }) => void,
 *   onCancel?: () => void,  // the right mouse button, which cancels the current action (GDD 11.1)
 *   getZoom?: () => number,
 *   setZoom?: (zoom: number) => void,
 * }} hooks
 */
export function attachPointer(el, { groundAt, pan, onTap, onCancel, getZoom, setZoom }) {
  /** @type {{ id: number, x: number, y: number, at: number, anchor: { x: number, z: number } | null, dragging: boolean } | null} */
  let press = null;
  /** Every finger or mouse button that is down, by pointer id, at its latest position. @type {Map<number, { x: number, y: number }>} */
  const down = new Map();
  /** The pinch in progress: the finger distance and the zoom when the second finger touched. @type {{ distance: number, zoom: number } | null} */
  let pinch = null;

  /** @returns {number} */
  function fingerDistance() {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // The right button never pans or taps: it cancels whatever the player picked.
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      onCancel?.();
      return;
    }
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; its events still reach the canvas while it is over it.
    }
    if (down.size === 2 && getZoom && setZoom) {
      // A second finger turns the press into a pinch: no tap and no pan from here on.
      press = null;
      pinch = { distance: fingerDistance(), zoom: getZoom() };
      return;
    }
    if (press || down.size > 1) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, anchor: groundAt(e.clientX, e.clientY), dragging: false };
  });

  el.addEventListener('pointermove', (e) => {
    if (down.has(e.pointerId)) down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && down.size >= 2 && setZoom) {
      setZoom(pinchZoom(pinch.zoom, pinch.distance, fingerDistance()));
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX) press.dragging = true;
    if (!press.dragging || !press.anchor) return;
    const now = groundAt(e.clientX, e.clientY);
    if (now) pan(press.anchor.x - now.x, press.anchor.z - now.z);
  });

  el.addEventListener('pointerup', (e) => {
    down.delete(e.pointerId);
    if (down.size < 2) pinch = null;
    if (!press || e.pointerId !== press.id) return;
    // The event time stamps, not the handler times: a busy frame can delay the handlers and turn a quick tap into a slow one.
    const tapped = !press.dragging && e.timeStamp - press.at <= TAP_MAX_MS;
    press = null;
    if (!tapped) return;
    const ground = groundAt(e.clientX, e.clientY);
    if (ground) onTap(ground);
  });

  el.addEventListener('pointercancel', (e) => {
    down.delete(e.pointerId);
    if (down.size < 2) pinch = null;
    if (press && e.pointerId === press.id) press = null;
  });

  // The wheel (a mouse or a trackpad pinch) zooms by the same rule: a notch scales the zoom smoothly.
  if (getZoom && setZoom) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      setZoom(pinchZoom(getZoom(), 1, Math.exp(-e.deltaY * WHEEL_ZOOM_RATE)));
    }, { passive: false });
  }
}
