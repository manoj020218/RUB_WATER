import { REQUEST_TIMEOUT_MS } from '@/constants';

let _apiBase = '';
let _token = '';
let _onUnauthorized: (() => void) | null = null;
let _silentRefresh: (() => Promise<string | null>) | null = null;

export function configureClient(opts: {
  apiBase: string;
  token: string;
  onUnauthorized?: () => void;
  silentRefresh?: () => Promise<string | null>;
}) {
  _apiBase = opts.apiBase;
  _token = opts.token;
  if (opts.onUnauthorized) _onUnauthorized = opts.onUnauthorized;
  if (opts.silentRefresh) _silentRefresh = opts.silentRefresh;
}

export function setClientToken(token: string) {
  _token = token;
}

function requestUrl(path: string): string {
  const base = _apiBase.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export function normalizeApiBase(value: string): string {
  let next = String(value || '').trim();
  if (!next) next = 'https://api.floodguard.iotsoft.in/api';
  if (!/^https?:\/\//i.test(next) && next[0] !== '/') next = `https://${next}`;
  next = next.replace(/\/+$/, '');
  if (!/\/api$/i.test(next)) next = `${next}/api`;
  return next;
}

interface RequestOptions {
  method?: string;
  auth?: boolean;
  body?: unknown;
  signal?: AbortSignal;
  localUrl?: string;
  localPin?: string;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', auth = false, body, signal, localUrl, localPin } = options;

  const baseUrl = localUrl ? localUrl.replace(/\/+$/, '') : null;
  const url = baseUrl ? `${baseUrl}${path.startsWith('/') ? path : `/${path}`}` : requestUrl(path);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && _token) headers['Authorization'] = `Bearer ${_token}`;
  if (localPin) headers['x-local-pin'] = localPin;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = signal || controller.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 && auth) {
    if (_silentRefresh) {
      const newToken = await _silentRefresh();
      if (newToken) {
        _token = newToken;
        headers['Authorization'] = `Bearer ${newToken}`;
        const retry = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retry.ok) {
          if (retry.status === 401) _onUnauthorized?.();
          throw new Error(`HTTP ${retry.status}`);
        }
        const retryRaw = await retry.text();
        let retryParsed: Record<string, unknown> | null = null;
        try { retryParsed = retryRaw ? JSON.parse(retryRaw) as Record<string, unknown> : null; } catch (_) {}
        if (retryParsed && 'ok' in retryParsed && 'data' in retryParsed) return retryParsed.data as T;
        return retryParsed as T;
      }
    }
    _onUnauthorized?.();
    throw new Error('Session expired');
  }

  const raw = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try { parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null; } catch (_) {}

  if (!response.ok || (parsed && parsed.ok === false)) {
    const errObj = parsed?.error as Record<string, unknown> | undefined;
    const detail = String(errObj?.message ?? parsed?.message ?? raw ?? `HTTP ${response.status}`);
    throw new Error(detail);
  }

  if (response.status === 204 || !raw) return undefined as T;
  // Backend wraps all responses: { ok: true, data: { ... } }
  if (parsed && 'ok' in parsed && 'data' in parsed) return parsed.data as T;
  return parsed as T;
}

export async function localGet<T = unknown>(localUrl: string, path: string): Promise<T> {
  const url = `${localUrl.replace(/\/+$/, '')}${path}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<T>;
  } finally {
    clearTimeout(tid);
  }
}
