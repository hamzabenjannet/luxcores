// @ts-check
/**
 * The test hub page (`/tests`): ready-made links, a form per page that takes URL parameters, and the
 * API links, all read from `GET /api/dev/links`. Built for the person holding a phone: pick the address
 * the phone can reach, tap a link or copy it.
 */

import { buildUrl, linkUrl } from './test-hub-links.js';

/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Copies text, or selects it where the clipboard is not available (plain http). @param {string} text @param {HTMLElement} button */
async function copy(text, button) {
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Press and hold the link to copy';
  }
  setTimeout(() => { button.textContent = was; }, 1500);
}

/** @param {string} href @param {string} text */
function openLink(href, text) {
  const a = /** @type {HTMLAnchorElement} */ (el('a', 'open', text));
  a.href = href;
  return a;
}

const root = /** @type {HTMLElement} */ (document.getElementById('hub'));

try {
  const res = await fetch('/api/dev/links');
  if (!res.ok) throw new Error(res.status === 404 ? 'The test hub is off on this server (TEST_HUB=false).' : `The server answered ${res.status}.`);
  const data = await res.json();

  /** The address every link uses; each link redraws when it changes. */
  let origin = data.origins[0].url;
  /** @type {(() => void)[]} */
  const redraw = [];

  const picker = /** @type {HTMLSelectElement} */ (el('select'));
  for (const o of data.origins) picker.append(new Option(`${o.label}: ${o.url}`, o.url));
  picker.addEventListener('change', () => {
    origin = picker.value;
    for (const r of redraw) r();
  });
  const where = el('section');
  where.append(
    el('h2', undefined, 'Address'),
    el('p', 'help', 'Links use this address. A phone on the same network needs a LAN address. Open this page on the phone to start there.'),
    picker,
  );
  root.append(where);

  // Ready-made links, by group.
  const groups = [...new Set(data.presets.map((/** @type {any} */ p) => p.group))];
  for (const group of groups) {
    const section = el('section');
    section.append(el('h2', undefined, String(group)));
    for (const preset of data.presets.filter((/** @type {any} */ p) => p.group === group)) {
      const card = el('div', 'card');
      const text = el('div');
      text.append(el('strong', undefined, preset.title), el('div', 'help', preset.description));
      const url = el('code', 'url');
      const buttons = el('div', 'buttons');
      const open = openLink('#', 'Open');
      const copyButton = el('button', undefined, 'Copy link');
      copyButton.addEventListener('click', () => copy(linkUrl(origin, preset), copyButton));
      buttons.append(open, copyButton);
      card.append(text, url, buttons);
      section.append(card);
      const draw = () => {
        url.textContent = linkUrl(origin, preset);
        open.href = linkUrl(origin, preset);
      };
      redraw.push(draw);
      draw();
    }
    root.append(section);
  }

  // A form per page, to set the parameters by hand.
  const builder = el('section');
  builder.append(el('h2', undefined, 'Build a link'));
  for (const page of data.pages) {
    const form = el('details', 'card');
    form.append(el('summary', undefined, `${page.title}: ${page.path}`), el('p', 'help', page.description));
    /** @type {Record<string, string | boolean>} */
    const values = {};
    const url = el('code', 'url');
    const draw = () => { url.textContent = buildUrl(origin, page, values); open.href = buildUrl(origin, page, values); };
    for (const param of page.params) {
      const row = el('label', param.kind === 'flag' ? 'row flag' : 'row');
      if (param.kind === 'flag') {
        const box = /** @type {HTMLInputElement} */ (el('input'));
        box.type = 'checkbox';
        box.addEventListener('change', () => { values[param.name] = box.checked; draw(); });
        row.append(box, el('span', undefined, param.label));
      } else {
        row.append(el('span', undefined, param.label));
        const input = /** @type {HTMLInputElement} */ (el('input'));
        input.type = 'text';
        input.inputMode = param.kind === 'number' ? 'numeric' : 'text';
        input.placeholder = param.default ?? param.name;
        input.addEventListener('input', () => { values[param.name] = input.value; draw(); });
        row.append(input);
      }
      row.append(el('small', 'help', param.help));
      form.append(row);
    }
    const buttons = el('div', 'buttons');
    const open = openLink('#', 'Open');
    const copyButton = el('button', undefined, 'Copy link');
    copyButton.addEventListener('click', () => copy(buildUrl(origin, page, values), copyButton));
    buttons.append(open, copyButton);
    form.append(url, buttons);
    redraw.push(draw);
    draw();
    builder.append(form);
  }
  root.append(builder);

  // The API and the files.
  const linkGroups = [...new Set(data.links.map((/** @type {any} */ l) => l.group))];
  for (const group of linkGroups) {
    const section = el('section');
    section.append(el('h2', undefined, String(group)));
    for (const link of data.links.filter((/** @type {any} */ l) => l.group === group)) {
      const row = el('div', 'card');
      const a = /** @type {HTMLAnchorElement} */ (el('a', undefined, link.title));
      const text = el('div');
      text.append(a, el('div', 'help', link.description));
      row.append(text);
      section.append(row);
      const draw = () => { a.href = linkUrl(origin, link); };
      redraw.push(draw);
      draw();
    }
    root.append(section);
  }
  root.dataset.ready = '1';
} catch (err) {
  root.append(el('p', 'error', err instanceof Error ? err.message : String(err)));
  root.dataset.ready = 'error';
}
