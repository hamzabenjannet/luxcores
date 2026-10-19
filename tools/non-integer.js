// Finds a value that breaks the integers-only rule of the sim state. Used by the bot soak.

/**
 * The path of the first value in `value` that is not a safe integer, or null. Every number in the sim
 * state is an integer (CLAUDE.md, Simulation Rules); the hash checks the hashed fields only, so this
 * walks the whole state.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string | null}
 */
export function firstNonInteger(value, path = 'state') {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? null : `${path} = ${value}`;
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = firstNonInteger(value[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const bad = firstNonInteger(/** @type {Record<string, unknown>} */ (value)[key], `${path}.${key}`);
    if (bad) return bad;
  }
  return null;
}
