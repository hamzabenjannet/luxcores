// @ts-check

/** @typedef {{ abilities: string[], items: string[] }} KeyBindings */

export const KEY_BINDINGS_STORAGE_KEY = 'luxcores.key-bindings.v1';
export const DEFAULT_KEY_BINDINGS = Object.freeze({
  abilities: Object.freeze(['KeyQ', 'KeyW', 'KeyE', 'KeyR']),
  items: Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4']),
});

/**
 * Returns safe, unique physical key codes, or the defaults when the saved map is invalid.
 * @param {unknown} value
 * @returns {KeyBindings}
 */
export function normalizeKeyBindings(value) {
  if (!value || typeof value !== 'object') return defaultKeyBindings();
  const candidate = /** @type {Partial<KeyBindings>} */ (value);
  if (!Array.isArray(candidate.abilities) || !Array.isArray(candidate.items)) return defaultKeyBindings();
  const keys = [...candidate.abilities, ...candidate.items];
  if (
    candidate.abilities.length !== 4
    || candidate.items.length !== 4
    || keys.some((key) => typeof key !== 'string' || !/^(Key[A-Z]|Digit[0-9])$/.test(key))
    || new Set(keys).size !== 8
  ) return defaultKeyBindings();
  return { abilities: [...candidate.abilities], items: [...candidate.items] };
}

/** @returns {KeyBindings} */
export function defaultKeyBindings() {
  return {
    abilities: [...DEFAULT_KEY_BINDINGS.abilities],
    items: [...DEFAULT_KEY_BINDINGS.items],
  };
}

/**
 * Resolves a physical key code to an ability or item slot.
 * @param {KeyBindings} bindings
 * @param {string} code
 * @returns {{ kind: 'ability' | 'item', slot: number } | null}
 */
export function actionForKey(bindings, code) {
  const ability = bindings.abilities.indexOf(code);
  if (ability >= 0) return { kind: 'ability', slot: ability };
  const item = bindings.items.indexOf(code);
  return item < 0 ? null : { kind: 'item', slot: item };
}

/** @param {string} code */
export function keyLabel(code) {
  return code.startsWith('Key') || code.startsWith('Digit') ? code.slice(-1) : code;
}
