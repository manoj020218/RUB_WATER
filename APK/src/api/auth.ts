import { REQUEST_TIMEOUT_MS } from '@/constants';
import { apiRequest, normalizeApiBase } from './client';
import { User, Session, AppRelease } from '@/types';

interface LoginOptions {
  deviceName?: string;
  appType?: string;
  fcmToken?: string | null;
}

interface AuthRequestOptions {
  apiBase: string;
  authToken: string;
}

async function fetchWithAuth<T>(path: string, body: Record<string, unknown>, opts: AuthRequestOptions): Promise<T> {
  const url = `${normalizeApiBase(opts.apiBase).replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.authToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null; } catch (_) {}

    if (!response.ok || (parsed && parsed.ok === false)) {
      const errObj = parsed?.error as Record<string, unknown> | undefined;
      const detail = String(errObj?.message ?? parsed?.message ?? raw ?? `HTTP ${response.status}`);
      throw new Error(detail);
    }

    if (parsed && 'ok' in parsed && 'data' in parsed) return parsed.data as T;
    return parsed as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function login(apiBase: string, loginId: string, password: string, options: LoginOptions = {}) {
  const response = await apiRequest<{ token: string; refreshToken?: string; expiresAt?: string; user: User }>('/auth/login', {
    method: 'POST',
    body: {
      login_id: loginId,
      password,
      device_name: options.deviceName,
      app_type: options.appType,
      fcm_token: options.fcmToken || undefined,
    },
  });
  return response;
}

export async function refreshToken(refreshTok: string) {
  return apiRequest<{ token: string; expiresAt?: string }>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: refreshTok },
  });
}

export async function verifySession() {
  return apiRequest<{ user: User; session: Session }>('/auth/me', { auth: true });
}

export async function logout() {
  return apiRequest('/auth/logout', { method: 'POST', auth: true }).catch(() => {});
}

export async function changePassword(current: string, next: string, confirm: string) {
  return apiRequest('/auth/change-password', {
    method: 'POST',
    auth: true,
    body: { current_password: current, new_password: next, confirm_password: confirm },
  });
}

export async function submitForcePwChange(newPw: string, confirmPw: string) {
  return apiRequest('/auth/change-password', {
    method: 'POST',
    auth: true,
    body: { new_password: newPw, confirm_password: confirmPw, force_change: true },
  });
}

export async function sendFcmToken(token: string, authOptions?: AuthRequestOptions) {
  if (authOptions?.apiBase && authOptions?.authToken) {
    return fetchWithAuth('/auth/fcm-token', { fcm_token: token }, authOptions);
  }
  return apiRequest('/auth/fcm-token', { method: 'PUT', auth: true, body: { fcm_token: token } });
}

export async function fetchAppRelease() {
  return apiRequest<AppRelease>('/app-release/mobile');
}
