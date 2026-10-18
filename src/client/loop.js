// @ts-check
/**
 * Render loop. The server owns the simulation (docs/TECH_ARCHITECTURE.md
 * section 13.1), so the page only draws the latest snapshot on every frame.
 * M7 adds interpolation between two snapshots here.
 */

/**
 * @param {(timeSec: number) => void} render  called once per animation frame
 * @returns {{ stop: () => void }}
 */
export function startLoop(render) {
  let running = true;
  function frame(/** @type {number} */ now) {
    if (!running) return;
    render(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { stop: () => { running = false; } };
}
