import { apiRequest } from './client';
import { Location, DashboardData, AuditLog } from '@/types';

export async function fetchLocations() {
  return apiRequest<Location[]>('/locations', { auth: true });
}

export async function fetchDashboard(locationId: string) {
  return apiRequest<DashboardData>(`/locations/${locationId}/dashboard`, { auth: true });
}

export async function fetchAuditLogs(locationId: string) {
  return apiRequest<AuditLog[]>(`/audit-logs?location_id=${encodeURIComponent(locationId)}`, { auth: true });
}

export async function addLocation(body: {
  location_id?: string;
  location_name: string;
  description?: string;
  mount_height_mm?: number;
  department_id?: string;
}) {
  return apiRequest<Location>('/admin/locations', { method: 'POST', auth: true, body });
}

export async function saveLocationDetails(locationId: string, body: {
  location_name?: string;
  description?: string;
  sensor_mount_height_mm?: number;
}) {
  return apiRequest<Location>(`/admin/locations/${locationId}`, { method: 'PATCH', auth: true, body });
}

export async function deleteLocation(locationId: string) {
  return apiRequest(`/admin/locations/${locationId}`, { method: 'DELETE', auth: true });
}

export async function addDevice(deviceId: string, locationId?: string) {
  return apiRequest('/admin/devices', {
    method: 'POST',
    auth: true,
    body: { device_id: deviceId, location_id: locationId },
  });
}

export async function fetchAdminDevices() {
  return apiRequest<{
    device_id: string;
    hardware_id?: string | null;
    mqtt_route_id?: string | null;
    last_reported_device_id?: string | null;
    location_id?: string;
    status?: string;
  }[]>('/admin/devices', { auth: true });
}

export async function bindDevice(locationId: string, deviceId: string) {
  return apiRequest(`/admin/locations/${locationId}/bind-device`, {
    method: 'POST',
    auth: true,
    body: { device_id: deviceId },
  });
}

export async function unbindDevice(locationId: string) {
  return apiRequest(`/admin/locations/${locationId}/bind-device`, { method: 'DELETE', auth: true });
}

// No dedicated /unassigned endpoint — filter locally from fetchAdminDevices()
export async function fetchUnassignedDevices() {
  const all = await fetchAdminDevices();
  return all.filter((d) => !d.location_id);
}

export async function assignDeviceToLocation(deviceId: string, locationId: string, markFaulty?: boolean) {
  return apiRequest(`/admin/locations/${locationId}/bind-device`, {
    method: 'POST',
    auth: true,
    body: { device_id: deviceId, mark_existing_faulty: markFaulty },
  });
}
