import { apiRequest } from './client';
import { User, Session, AppRelease } from '@/types';

export async function login(apiBase: string, loginId: string, password: string) {
  const response = await apiRequest<{ token: string; refreshToken?: string; expiresAt?: string; user: User }>('/auth/login', {
    method: 'POST',
    body: { login_id: loginId, password },
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

export async function sendFcmToken(token: string) {
  return apiRequest('/auth/fcm-token', { method: 'PUT', auth: true, body: { fcm_token: token } });
}

export async function fetchAppRelease() {
  return apiRequest<AppRelease>('/app-release/mobile');
}
