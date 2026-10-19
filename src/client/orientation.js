// @ts-check
/**
 * The game is played upright (GDD 11). Where the browser allows it, in an installed page or in full
 * screen, this locks the screen to portrait. Everywhere else the lock is refused, and the page shows
 * a "turn your phone upright" prompt in landscape instead (`#rotate` in hud.css).
 * @param {{ orientation?: { lock?: (type: string) => Promise<void> } }} [screenLike]  the `screen` object, replaceable for tests
 * @returns {Promise<boolean>} whether the lock took
 */
export async function lockPortrait(screenLike = typeof screen === 'undefined' ? {} : /** @type {any} */ (screen)) {
  try {
    if (!screenLike.orientation?.lock) return false;
    await screenLike.orientation.lock('portrait');
    return true;
  } catch {
    return false; // refused outside full screen, and not supported on iOS Safari
  }
}
