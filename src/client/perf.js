// @ts-check
/**
 * The frame meter behind `?perf=1`, for the performance pass of M10. It shows what a phone does with the
 * game: frames per second, the time between frames (the average, the 95th percentile and the worst of the
 * last 120), the JavaScript time of the page's own work per frame, and what the renderer drew.
 */

/** Frames the meter remembers. */
export const WINDOW = 120;

/**
 * @param {readonly number[]} frameMs  time between frames, in milliseconds
 * @param {readonly number[]} jsMs  JavaScript time per frame, in milliseconds
 * @returns {{ fps: number, avgMs: number, p95Ms: number, maxMs: number, jsAvgMs: number }}
 */
export function summarize(frameMs, jsMs) {
  if (frameMs.length === 0) return { fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0, jsAvgMs: 0 };
  const sorted = [...frameMs].sort((a, b) => a - b);
  const avg = frameMs.reduce((sum, v) => sum + v, 0) / frameMs.length;
  return {
    fps: avg > 0 ? 1000 / avg : 0,
    avgMs: avg,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted[sorted.length - 1],
    jsAvgMs: jsMs.length === 0 ? 0 : jsMs.reduce((sum, v) => sum + v, 0) / jsMs.length,
  };
}

/**
 * @param {HTMLElement} box  where the numbers show
 * @param {() => string} [extra]  a line of page facts (entities, pixel ratio, canvas size), asked twice a second
 */
export function createPerfMeter(box, extra = () => '') {
  /** @type {number[]} */
  const frames = [];
  /** @type {number[]} */
  const js = [];
  let last = 0;
  let shownAt = 0;
  /** @type {ReturnType<typeof summarize>} */
  let latest = summarize([], []);
  /** @type {{ calls: number, triangles: number }} */
  let drawn = { calls: 0, triangles: 0 };
  box.hidden = false;

  return {
    /**
     * Call once per frame.
     * @param {number} nowMs  the frame time stamp
     * @param {number} jsTimeMs  how long the page's work took this frame
     * @param {{ calls: number, triangles: number }} renderInfo  what the renderer drew
     */
    frame(nowMs, jsTimeMs, renderInfo) {
      if (last > 0) {
        frames.push(nowMs - last);
        js.push(jsTimeMs);
        if (frames.length > WINDOW) {
          frames.shift();
          js.shift();
        }
      }
      last = nowMs;
      drawn = renderInfo;
      if (nowMs - shownAt < 500) return;
      shownAt = nowMs;
      latest = summarize(frames, js);
      box.textContent = `${latest.fps.toFixed(0)} fps  frame ${latest.avgMs.toFixed(1)} ms (p95 ${latest.p95Ms.toFixed(1)}, max ${latest.maxMs.toFixed(1)})  js ${latest.jsAvgMs.toFixed(1)} ms\ndraws ${drawn.calls}  triangles ${drawn.triangles}  ${extra()}`;
    },
    /** The latest numbers, for the tests. */
    read: () => ({ ...latest, ...drawn }),
  };
}
