import { apiRequest } from './client';
import { DeviceActionSheet, DeviceConfig } from '@/types';

interface LocalDeviceConfigSaveResponse {
  status?: string;
  reboot_scheduled?: boolean;
  current_config_version?: number;
  current_config?: DeviceConfig;
}

function pathId(value: string) {
  return encodeURIComponent(String(value || '').trim());
}

export async function muteAlarm(locationId: string, deviceId: string, opts?: { rtu?: 'left' | 'right' | 'both' }) {
  return apiRequest('/commands/mute', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId, rtu: opts?.rtu ?? 'both' } });
}

export async function dryRun(locationId: string, deviceId: string, opts?: { rtu?: 'left' | 'right'; relays?: string[] }) {
  return apiRequest('/commands/dry-run', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId, rtu: opts?.rtu ?? 'right', relays: opts?.relays } });
}

export async function forceClear(locationId: string, deviceId: string, reason: string) {
  return apiRequest('/commands/force-clear', { method: 'POST', auth: true, body: { location_id: locationId, device_id: deviceId, reason } });
}

export async function fetchDeviceConfig(deviceId: string) {
  return apiRequest<DeviceConfig>(`/devices/${pathId(deviceId)}/config`, { auth: true });
}

export async function saveDeviceConfig(deviceId: string, config: Partial<DeviceConfig>) {
  return apiRequest<DeviceConfig>(`/devices/${pathId(deviceId)}/config`, { method: 'PUT', auth: true, body: config });
}

export async function pushDeviceConfig(deviceId: string) {
  return apiRequest(`/devices/${pathId(deviceId)}/config/push`, { method: 'POST', auth: true });
}

export async function fetchDeviceConfigHistory(deviceId: string) {
  return apiRequest<DeviceConfig[]>(`/devices/${pathId(deviceId)}/config/history`, { auth: true });
}

export async function fetchDeviceActionSheet(deviceId: string) {
  return apiRequest<DeviceActionSheet>(`/devices/${pathId(deviceId)}/action-sheet`, { auth: true });
}

export async function saveDeviceActionSheet(deviceId: string, payload: Partial<DeviceActionSheet>) {
  return apiRequest<DeviceActionSheet>(`/devices/${pathId(deviceId)}/action-sheet`, { method: 'PUT', auth: true, body: payload });
}

export async function pushDeviceActionSheet(deviceId: string) {
  return apiRequest<DeviceActionSheet>(`/devices/${pathId(deviceId)}/action-sheet/push`, { method: 'POST', auth: true });
}

export async function fetchDeviceActionSheetHistory(deviceId: string) {
  return apiRequest<DeviceActionSheet[]>(`/devices/${pathId(deviceId)}/action-sheet/history`, { auth: true });
}

export async function fetchAllDeviceConfigs() {
  return apiRequest<DeviceConfig[]>('/admin/device-configs', { auth: true });
}

export async function fetchDeviceLifecycle(deviceId: string) {
  return apiRequest<{ status: string; note?: string; updated_at?: string }>(`/devices/${pathId(deviceId)}/lifecycle`, { auth: true });
}

export async function patchDeviceLifecycle(deviceId: string, status: string, reason: string) {
  return apiRequest(`/devices/${pathId(deviceId)}/lifecycle`, { method: 'PATCH', auth: true, body: { status, reason } });
}

export async function fetchDeviceLifecycleHistory(deviceId: string) {
  return apiRequest<{ status: string; reason?: string; created_at?: string; user_id?: string }[]>(
    `/devices/${pathId(deviceId)}/lifecycle/history`, { auth: true }
  );
}

export async function saveDeviceConfigLocal(localUrl: string, config: Partial<DeviceConfig>, pin: string) {
  return apiRequest<LocalDeviceConfigSaveResponse>('/config', { method: 'POST', localUrl, localPin: pin, body: config });
}

export async function resetDeviceConfigToDefault(deviceId: string) {
  return apiRequest(`/admin/devices/${pathId(deviceId)}/config/reset`, { method: 'POST', auth: true });
}

export async function provisionDevice(deviceId: string, locationId: string) {
  return apiRequest(`/devices/${pathId(deviceId)}/claim`, { method: 'POST', auth: true, body: { location_id: locationId } });
}

export async function requestProvisionProfile(deviceId: string) {
  return apiRequest(`/devices/${pathId(deviceId)}/provision-profile`, { method: 'POST', auth: true });
}
