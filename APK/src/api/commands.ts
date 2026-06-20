import { apiRequest } from './client';
import { DeviceConfig } from '@/types';

export async function muteAlarm(locationId: string, deviceId: string) {
  return apiRequest('/commands/mute', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId } });
}

export async function dryRun(locationId: string, deviceId: string) {
  return apiRequest('/commands/dry-run', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId } });
}

export async function forceClear(locationId: string, deviceId: string, reason: string) {
  return apiRequest('/commands/force-clear', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId, reason } });
}

export async function fetchDeviceConfig(deviceId: string) {
  return apiRequest<DeviceConfig>(`/devices/${deviceId}/config`, { auth: true });
}

export async function saveDeviceConfig(deviceId: string, config: Partial<DeviceConfig>) {
  return apiRequest<DeviceConfig>(`/devices/${deviceId}/config`, { method: 'PUT', auth: true, body: config });
}

export async function pushDeviceConfig(deviceId: string) {
  return apiRequest(`/devices/${deviceId}/config/push`, { method: 'POST', auth: true });
}

export async function fetchDeviceConfigHistory(deviceId: string) {
  return apiRequest<DeviceConfig[]>(`/devices/${deviceId}/config/history`, { auth: true });
}

export async function fetchAllDeviceConfigs() {
  return apiRequest<DeviceConfig[]>('/admin/device-configs', { auth: true });
}

export async function fetchDeviceLifecycle(deviceId: string) {
  return apiRequest<{ status: string; note?: string; updated_at?: string }>(`/devices/${deviceId}/lifecycle`, { auth: true });
}

export async function patchDeviceLifecycle(deviceId: string, status: string, reason: string) {
  return apiRequest(`/devices/${deviceId}/lifecycle`, { method: 'PATCH', auth: true, body: { status, reason } });
}

export async function fetchDeviceLifecycleHistory(deviceId: string) {
  return apiRequest<{ status: string; reason?: string; created_at?: string; user_id?: string }[]>(
    `/devices/${deviceId}/lifecycle/history`, { auth: true }
  );
}

export async function saveDeviceConfigLocal(localUrl: string, config: Partial<DeviceConfig>, pin: string) {
  return apiRequest<DeviceConfig>('/config', { method: 'POST', localUrl, localPin: pin, body: config });
}

export async function resetDeviceConfigToDefault(deviceId: string) {
  return apiRequest(`/admin/devices/${deviceId}/config/reset`, { method: 'POST', auth: true });
}

export async function provisionDevice(deviceId: string, locationId: string) {
  return apiRequest(`/devices/${deviceId}/claim`, { method: 'POST', auth: true, body: { location_id: locationId } });
}

export async function requestProvisionProfile(deviceId: string) {
  return apiRequest(`/devices/${deviceId}/provision-profile`, { method: 'POST', auth: true });
}
