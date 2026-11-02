// @ts-check
/**
 * Transport for one Ollama server, and nothing else.
 *
 * The only call the driver needs is `POST {endpoint}/api/chat` with
 * `stream: false`, so one request carries the whole answer and the caller waits
 * for a single response body. `GET {endpoint}/api/tags` lists the models a
 * server holds, which the tools use to report what is installed.
 *
 * This file stays free of game knowledge: it moves messages and returns text.
 * It never throws. Every failure comes back as `{ ok: false, error }`, because
 * a bot that loses its model must keep playing (see `llm-bot.js`).
 */

/** Where Ollama listens after a default install. */
export const DEFAULT_ENDPOINT = 'http://localhost:11434';
/** The model the owners tested the driver with. */
export const DEFAULT_MODEL = 'qwen2.5:3b';
/** Milliseconds one chat request may take before the driver gives up on it. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Bytes of an answer the driver reads. A longer answer counts as a failure, so a wild model cannot fill memory. */
export const MAX_REPLY_BYTES = 262_144;

/**
 * @typedef {Object} ChatMessage
 * @property {'system' | 'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatResult
 * @property {boolean} ok
 * @property {string} content   the assistant message, empty when the call failed
 * @property {number} ms        milliseconds the call took
 * @property {string} [error]   why it failed
 */

/**
 * Options of a client. `temperature` 0 keeps the answers as repeatable as a
 * model allows, `maxTokens` caps what it may answer, and `fetchImpl` and `now`
 * exist so tests can drive the client without a server.
 * @param {{
 *   endpoint?: string,
 *   model?: string,
 *   timeoutMs?: number,
 *   maxReplyBytes?: number,
 *   temperature?: number,
 *   maxTokens?: number,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} [opts]
 */
export function createOllamaClient(opts = {}) {
  const endpoint = normalizeEndpoint(opts.endpoint ?? DEFAULT_ENDPOINT);
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxReplyBytes = opts.maxReplyBytes ?? MAX_REPLY_BYTES;
  const temperature = opts.temperature ?? 0;
  const maxTokens = opts.maxTokens ?? 512;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());

  return {
    endpoint,
    model,
    timeoutMs,
    chat,
    listModels,
  };

  /**
   * One chat completion. `format` asks Ollama for a JSON object, which keeps a
   * small model from wrapping its answer in prose.
   * @param {readonly ChatMessage[]} messages
   * @param {{ json?: boolean }} [options]
   * @returns {Promise<ChatResult>}
   */
  async function chat(messages, options = {}) {
    const started = now();
    if (typeof fetchImpl !== 'function') {
      return { ok: false, content: '', ms: 0, error: 'This runtime has no fetch, so the model cannot be reached' };
    }
    const body = {
      model,
      stream: false,
      messages,
      ...(options.json === false ? {} : { format: 'json' }),
      options: { temperature, num_predict: maxTokens },
    };
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: control.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        return { ok: false, content: '', ms: now() - started, error: `${endpoint} answered ${response.status}: ${text.slice(0, 200)}` };
      }
      if (text.length > maxReplyBytes) {
        return { ok: false, content: '', ms: now() - started, error: `the answer is longer than ${maxReplyBytes} bytes` };
      }
      /** @type {any} */
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, content: '', ms: now() - started, error: 'the answer is no JSON envelope' };
      }
      const content = parsed?.message?.content;
      if (typeof content !== 'string') {
        return { ok: false, content: '', ms: now() - started, error: 'the answer carries no message.content' };
      }
      if (content.trim() === '') {
        return { ok: false, content: '', ms: now() - started, error: 'the model answered with an empty message' };
      }
      return { ok: true, content, ms: now() - started };
    } catch (err) {
      const reason = control.signal.aborted ? `no answer within ${timeoutMs} ms` : describe(err);
      return { ok: false, content: '', ms: now() - started, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The models the server holds, by name. An unreachable server gives an empty
   * list and the reason.
   * @returns {Promise<{ ok: boolean, models: string[], error?: string }>}
   */
  async function listModels() {
    if (typeof fetchImpl !== 'function') return { ok: false, models: [], error: 'This runtime has no fetch' };
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}/api/tags`, { signal: control.signal });
      if (!response.ok) return { ok: false, models: [], error: `${endpoint} answered ${response.status}` };
      const data = /** @type {any} */ (await response.json());
      const models = Array.isArray(data?.models) ? data.models.map((/** @type {any} */ m) => String(m?.name ?? '')).filter(Boolean) : [];
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: control.signal.aborted ? `no answer within ${timeoutMs} ms` : describe(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * An endpoint without its trailing slash and without a trailing `/api`, which is a common paste.
 * @param {string} endpoint
 */
export function normalizeEndpoint(endpoint) {
  return String(endpoint).trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
