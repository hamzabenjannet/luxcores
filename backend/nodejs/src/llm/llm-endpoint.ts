/**
 * The policy for an Ollama address a client asks the server to call.
 *
 * A player types the address in the start menu, so the server would otherwise
 * make a request to any host a client names. `checkEndpoint` is the gate: it
 * takes the address apart and accepts it only when the scheme is http or https,
 * the host stands in the configured allowlist, it carries no credentials and no
 * path, and the port is a plain port. The allowlist holds the loopback names by
 * default, which covers an Ollama server on the same machine as the backend.
 *
 * It is a pure function, so `test/llm-endpoint.spec.ts` covers every case.
 */

/** Addresses the clients prefill and the tools use. */
export const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';
/** The longest address the server reads, so a wild value cannot grow the match record. */
export const MAX_ENDPOINT_LENGTH = 200;
/** What a model name may hold: the characters Ollama tags use. */
export const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/;

export interface EndpointCheck {
  ok: boolean;
  /** The address to call, without a trailing slash. Set when `ok` is true. */
  endpoint?: string;
  /** Why the address was refused. Set when `ok` is false. */
  reason?: string;
}

/**
 * Whether the server may call this address, and the form it calls.
 * `allowedHosts` holds host names in lower case; the single entry `*` allows
 * every host, which an owner sets on purpose.
 */
export function checkEndpoint(
  value: unknown,
  allowedHosts: readonly string[],
): EndpointCheck {
  if (typeof value !== 'string' || value.trim() === '')
    return { ok: false, reason: 'The model endpoint is missing' };
  const text = value.trim();
  if (text.length > MAX_ENDPOINT_LENGTH)
    return { ok: false, reason: `The model endpoint is longer than ${MAX_ENDPOINT_LENGTH} characters` };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: `${text} is no URL. Use http://host:11434` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: `The model endpoint must start with http:// or https://, not ${url.protocol}` };
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'The model endpoint must carry no user name or password' };
  if (url.search !== '' || url.hash !== '')
    return { ok: false, reason: 'The model endpoint must carry no query and no fragment' };
  // `/` and `/api` are what players paste; anything else is a path the driver does not call.
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/api')
    return { ok: false, reason: `The model endpoint must name a host and a port, not the path ${url.pathname}` };

  const host = hostOf(url);
  if (!allowedHosts.includes('*') && !allowedHosts.includes(host)) {
    return {
      ok: false,
      reason: `This server calls a model on ${allowedHosts.join(', ')} only, and not on ${host}. Set LLM_ALLOWED_HOSTS to allow it.`,
    };
  }
  return { ok: true, endpoint: `${url.protocol}//${url.host}` };
}

/** Whether a model name is one Ollama could hold. */
export function checkModel(value: unknown): EndpointCheck {
  if (typeof value !== 'string' || value.trim() === '')
    return { ok: false, reason: 'The model name is missing' };
  const model = value.trim();
  if (!MODEL_NAME.test(model))
    return { ok: false, reason: `${model} is no model name. Use a name such as qwen2.5:3b` };
  return { ok: true, endpoint: model };
}

/** The host of a URL in lower case, without the brackets of an IPv6 address. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}
