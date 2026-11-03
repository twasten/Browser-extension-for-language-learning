// Small fetch helper shared by providers: timeout + readable errors.
export class ProviderError extends Error {
  constructor(message, { status, provider } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
  }
}

export async function fetchJson(url, { timeout = 10000, provider, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Request timed out' : `Network error: ${e.message}`;
    throw new ProviderError(msg, { provider });
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = (json && (json.message || json.error || json.detail)) || body.slice(0, 200) || res.statusText;
    throw new ProviderError(`${provider || 'Provider'} error ${res.status}: ${detail}`, { status: res.status, provider });
  }
  if (json === null) throw new ProviderError(`${provider || 'Provider'} returned an unexpected response`, { provider });
  return json;
}
