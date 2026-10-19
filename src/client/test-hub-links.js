// @ts-check
/**
 * Link building for the test hub page (`/tests`). The backend lists the pages and their parameters
 * (`GET /api/dev/links`); this turns the values a person typed into a URL.
 */

/**
 * @typedef {{ name: string, kind: 'text' | 'number' | 'flag' }} Param
 * @typedef {{ path: string, params: readonly Param[] }} Page
 */

/**
 * The URL of a page with the given values. A flag is `name=1` when set and left out otherwise, and an empty
 * text or number is left out, so the page uses its own default. Parameters keep the order the page lists.
 * @param {string} origin  such as http://192.168.1.20:3000, without a trailing slash
 * @param {Page} page
 * @param {Record<string, string | boolean | undefined>} values
 * @returns {string}
 */
export function buildUrl(origin, page, values) {
  const pairs = [];
  for (const param of page.params) {
    const value = values[param.name];
    if (param.kind === 'flag') {
      if (value === true) pairs.push(`${param.name}=1`);
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    if (text !== '') pairs.push(`${param.name}=${encodeURIComponent(text)}`);
  }
  return `${origin.replace(/\/$/, '')}${page.path}${pairs.length > 0 ? `?${pairs.join('&')}` : ''}`;
}

/**
 * A ready-made link on a chosen address.
 * @param {string} origin
 * @param {{ path: string }} link  `path` starts at `/` and may carry a query
 */
export function linkUrl(origin, link) {
  return `${origin.replace(/\/$/, '')}${link.path}`;
}
