// @ts-check
/**
 * The orders window: a small floating window, collapsed by default, that logs every order the player made and
 * shows the live timer of the ones still in a queue. It lives outside the barracks panel, so a new order never
 * pushes the panel's buttons around. A queued order has a cancel button. It shows at most three rows at a time
 * and scrolls for the rest. The decisions are in `order-log.js`.
 */

import { logRows, updateOrderLog } from './order-log.js';

/** Rows the window shows before it scrolls. */
export const VISIBLE_ROWS = 3;

/** @param {string} tag @param {string} className @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {{
 *   parent: HTMLElement,
 *   view: import('../../shared/world-view.js').WorldView,
 *   viewerTeam: number,
 *   tickHz: number,
 *   heroNames: readonly string[],
 *   itemNames: readonly string[],
 *   pending: () => readonly { id: number, text: string }[],  // orders just sent, not yet in a snapshot
 *   cancel: (order: { id: number, barracksId: number }) => void,
 * }} opts
 */
export function createOrderWindow({ parent, view, viewerTeam, tickHz, heroNames, itemNames, pending, cancel }) {
  const root = el('div', 'orders collapsed');
  root.id = 'orders';
  const toggle = /** @type {HTMLButtonElement} */ (el('button', 'orders-toggle'));
  const list = el('div', 'orders-list');
  root.append(toggle, list);
  parent.append(root);
  toggle.addEventListener('click', () => {
    root.classList.toggle('collapsed');
    draw();
  });

  /** @type {import('./order-log.js').LogEntry[]} */
  let log = [];
  /** @type {number[]} */
  let cancelled = [];
  let key = '';
  /** @type {Map<number, HTMLElement>} */
  const texts = new Map();

  function draw() {
    const open = !root.classList.contains('collapsed');
    const queued = log.filter((e) => e.state === 'queued').length + pending().length;
    const label = `Orders (${queued}) ${open ? '▾' : '▸'}`;
    if (toggle.textContent !== label) toggle.textContent = label;
  }

  return {
    root,
    /** Remembers that the player cancelled an order, so the log shows it as cancelled and not as done. @param {number} orderId */
    noteCancelled(orderId) {
      cancelled.push(orderId);
    },
    /** Called every frame. Rebuilds the rows only when they change, and updates the timers in place. */
    update() {
      const orders = view.orders();
      log = updateOrderLog(log, orders, viewerTeam, view.tick(), cancelled, heroNames, itemNames);
      cancelled = [];
      const rows = logRows(log, orders, tickHz);
      const waiting = pending();
      const nextKey = `${waiting.map((p) => p.id).join(',')}|${rows.map((r) => `${r.id}:${r.state}`).join(',')}`;
      if (nextKey !== key) {
        key = nextKey;
        texts.clear();
        list.replaceChildren(
          ...waiting.map((p) => {
            const row = el('div', 'log-row pending');
            const cancelButton = /** @type {HTMLButtonElement} */ (el('button', 'cancel', '✕'));
            cancelButton.disabled = true;
            row.append(el('span', 'log-time', '...'), el('span', 'log-text', p.text), cancelButton);
            return row;
          }),
          ...rows.map((r) => {
            const row = el('div', `log-row ${r.state}`);
            const text = el('span', 'log-text', r.text);
            texts.set(r.id, text);
            row.append(el('span', 'log-time', r.time), text);
            const cancelButton = el('button', 'cancel', '✕');
            cancelButton.hidden = !r.canCancel;
            cancelButton.addEventListener('click', () => cancel({ id: r.id, barracksId: r.barracksId }));
            row.append(cancelButton);
            return row;
          }),
        );
      } else {
        for (const r of rows) {
          const node = texts.get(r.id);
          if (node && node.textContent !== r.text) node.textContent = r.text;
        }
      }
      draw();
    },
  };
}
