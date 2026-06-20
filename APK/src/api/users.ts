import { apiRequest } from './client';
import { AdminUser } from '@/types';

export async function fetchAdminUsers() {
  return apiRequest<AdminUser[]>('/admin/users', { auth: true });
}

export async function createUser(body: {
  login_id: string;
  name: string;
  password: string;
  role: string;
  assigned_locations?: string[];
}) {
  return apiRequest<AdminUser>('/admin/users', { method: 'POST', auth: true, body });
}

export async function toggleUserAccess(userId: string, activate: boolean) {
  return apiRequest(`/admin/users/${userId}/access`, {
    method: 'PATCH',
    auth: true,
    body: { is_active: activate },
  });
}

export async function resetUserPassword(userId: string, newPassword: string) {
  return apiRequest(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    auth: true,
    body: { new_password: newPassword },
  });
}

export async function submitLocationTransfer(body: {
  location_id: string;
  receiver?: string;
  rights?: string;
  new_user?: { login_id: string; name: string; password: string; role: string };
}) {
  return apiRequest('/admin/location-transfers', { method: 'POST', auth: true, body });
}
