// @ts-check
/**
 * Fixed-tick driver: steps the sim at 20 Hz from an accumulator and lets
 * the renderer interpolate between the last two ticks.
 */

import { TICK_HZ } from '../sim/index.js';

const TICK_MS = 1000 / TICK_HZ;
/** Cap catch-up after a stall (tab hidden, debugger) to avoid a spiral. */
const MAX_TICKS_PER_FRAME = 10;

/**
 * @param {{
 *   tick: () => void,                 // advance the sim one tick
 *   render: (alpha: number) => void,  // alpha in [0, 1): progress toward the next tick
 * }} hooks
 */
export function startLoop({ tick, render }) {
  let last = performance.now();
  let acc = 0;
  let running = true;

  function frame(/** @type {number} */ now) {
    if (!running) return;
    acc += now - last;
    last = now;
    let n = 0;
    while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
      tick();
      acc -= TICK_MS;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) acc = 0;
    render(acc / TICK_MS);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { stop: () => { running = false; } };
}
