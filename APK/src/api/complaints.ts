import { apiRequest } from './client';
import { Complaint } from '@/types';

export async function fetchComplaints(locationId: string) {
  return apiRequest<Complaint[]>(`/complaints?location_id=${locationId}`, { auth: true });
}

export async function raiseComplaint(body: {
  location_id: string;
  complaint_type: string;
  priority: string;
  description: string;
}) {
  return apiRequest<Complaint>('/complaints', { method: 'POST', auth: true, body });
}

export async function updateComplaintStatus(complaintId: string, action: 'acknowledge' | 'resolve' | 'close') {
  return apiRequest(`/complaints/${complaintId}/${action}`, { method: 'PATCH', auth: true });
}

export async function fetchAuditReport(params: {
  from?: string;
  to?: string;
  location_id?: string;
  event_type?: string;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.location_id) q.set('location_id', params.location_id);
  if (params.event_type) q.set('event_type', params.event_type);
  if (params.limit) q.set('limit', String(params.limit));
  return apiRequest<{ rows: import('@/types').ReportRow[] }>(`/reports/audit?${q.toString()}`, { auth: true });
}
