import { apiRequest } from './client';
import { AdminUser } from '@/types';

// Backend sends user_id / assigned_location_ids; normalize to the AdminUser shape the UI uses.
type RawAdminUser = Omit<AdminUser, 'id' | 'assigned_locations'> & {
  id?: string;
  user_id?: string;
  assigned_locations?: string[];
  assigned_location_ids?: string[];
};

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const rows = await apiRequest<RawAdminUser[]>('/admin/users', { auth: true });
  return (rows ?? []).map(({ user_id, assigned_location_ids, ...u }) => ({
    ...u,
    id: u.id ?? user_id ?? '',
    assigned_locations: u.assigned_locations ?? assigned_location_ids ?? [],
  }));
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

export async function updateUserLocations(userId: string, locationIds: string[]) {
  return apiRequest(`/admin/users/${userId}/locations`, {
    method: 'PATCH',
    auth: true,
    body: { location_ids: locationIds },
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
