const { dataStore } = require('../db/datastore');
const locationRepository = require('../repositories/locationRepository');
const { assertPermission } = require('./rbacService');
const { listAccessibleLocationIds } = require('./accessService');
const { badRequest } = require('../utils/errors');

function parseIso(value) {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

function toTimestamp(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeFilters(raw = {}) {
  return {
    from: parseIso(raw.from || raw.date_from),
    to: parseIso(raw.to || raw.date_to),
    location_id: String(raw.location_id || '').trim(),
    device_id: String(raw.device_id || '').trim(),
    event_type: String(raw.event_type || '').trim().toUpperCase(),
    login_id: String(raw.login_id || '').trim(),
    severity: String(raw.severity || '').trim().toUpperCase(),
    department_id: String(raw.department_id || '').trim(),
    format: String(raw.format || '').trim().toLowerCase()
  };
}

function isWithinWindow(timestamp, filters) {
  const targetMs = toTimestamp(timestamp);
  if (filters.from && targetMs < toTimestamp(filters.from)) {
    return false;
  }
  if (filters.to && targetMs > toTimestamp(filters.to)) {
    return false;
  }
  return true;
}

function allowedLocationSet(authContext) {
  const ids = listAccessibleLocationIds(authContext.user);
  return new Set(ids);
}

function filterLocation(locationId, allowedSet, filters) {
  if (locationId && !allowedSet.has(locationId)) {
    return false;
  }
  if (filters.location_id && locationId !== filters.location_id) {
    return false;
  }
  if (filters.department_id) {
    const location = locationRepository.findById(locationId);
    if (!location || location.department_id !== filters.department_id) {
      return false;
    }
  }
  return true;
}

function collectReportRows(filters, authContext) {
  assertPermission(authContext.user.role, 'EXPORT_AUDIT_REPORT');
  const allowedSet = allowedLocationSet(authContext);

  const rows = [];
  const pushRow = (row) => {
    if (!filterLocation(row.location_id || null, allowedSet, filters)) {
      return;
    }
    if (filters.device_id && String(row.device_id || '') !== filters.device_id) {
      return;
    }
    if (filters.event_type && String(row.event_type || '').toUpperCase() !== filters.event_type) {
      return;
    }
    if (filters.login_id && String(row.login_id || '') !== filters.login_id) {
      return;
    }
    if (filters.severity && String(row.severity || '').toUpperCase() !== filters.severity) {
      return;
    }
    if (!isWithinWindow(row.timestamp, filters)) {
      return;
    }
    rows.push(row);
  };

  dataStore.auditLogs.forEach((item) => {
    pushRow({
      module: 'AUDIT_LOG',
      timestamp: item.timestamp,
      location_id: item.location_id || null,
      device_id: item.details?.device_id || null,
      event_type: item.event_type,
      severity: item.details?.severity || null,
      login_id: item.login_id || null,
      performed_by: item.performed_by || null,
      reason: item.details?.reason || null,
      details_json: JSON.stringify(item.details || {})
    });
  });

  dataStore.incidents.forEach((item) => {
    pushRow({
      module: 'INCIDENT',
      timestamp: item.updated_at || item.started_at,
      location_id: item.location_id || null,
      device_id: item.device_id || null,
      event_type: item.status === 'ACTIVE' ? 'INCIDENT_ACTIVE' : 'INCIDENT_CLOSED',
      severity: item.max_water_level_mm >= 500 ? 'CRITICAL' : 'HIGH',
      login_id: null,
      performed_by: item.force_cleared_by || null,
      reason: item.force_clear_reason || item.latest_reason || item.trigger_reason || null,
      details_json: JSON.stringify(item)
    });
  });

  dataStore.telemetry.forEach((item) => {
    const moduleName = item.type === 'EVENT' ? 'DEVICE_EVENT' : item.type;
    const level = Number(item.water_level_mm || 0);
    const severity = item.status === 'DANGER'
      ? 'CRITICAL'
      : item.status === 'ALERT'
        ? 'HIGH'
        : level > 0
          ? 'MEDIUM'
          : 'LOW';
    pushRow({
      module: moduleName,
      timestamp: item.timestamp,
      location_id: item.location_id || null,
      device_id: item.device_id || null,
      event_type: item.event_type || item.status || item.type,
      severity,
      login_id: null,
      performed_by: null,
      reason: item.reason || item.remark || null,
      details_json: JSON.stringify(item)
    });
  });

  dataStore.commands.forEach((item) => {
    pushRow({
      module: 'COMMAND',
      timestamp: item.issued_at,
      location_id: item.location_id || null,
      device_id: item.device_id || null,
      event_type: item.command,
      severity: 'MEDIUM',
      login_id: item.issued_by || null,
      performed_by: item.issued_by || null,
      reason: item.payload?.reason || null,
      details_json: JSON.stringify(item)
    });
  });

  dataStore.complaints.forEach((item) => {
    pushRow({
      module: 'COMPLAINT',
      timestamp: item.updated_at || item.created_at,
      location_id: item.location_id || null,
      device_id: item.device_id || null,
      event_type: `COMPLAINT_${item.status}`,
      severity: String(item.priority || '').toUpperCase() || 'MEDIUM',
      login_id: item.raised_by_login_id || null,
      performed_by: item.raised_by_user_id || null,
      reason: item.description || item.title || null,
      details_json: JSON.stringify(item)
    });
  });

  dataStore.deviceLifecycleHistory.forEach((item) => {
    pushRow({
      module: 'DEVICE_LIFECYCLE',
      timestamp: item.timestamp,
      location_id: item.location_id || null,
      device_id: item.device_id || null,
      event_type: `DEVICE_${item.next_status}`,
      severity: ['FAULTY', 'UNDER_REPLACEMENT', 'DECOMMISSIONED'].includes(item.next_status) ? 'HIGH' : 'MEDIUM',
      login_id: item.performed_by_login_id || null,
      performed_by: item.performed_by_user_id || null,
      reason: item.reason || null,
      details_json: JSON.stringify(item)
    });
  });

  dataStore.userSessions.forEach((item) => {
    const user = dataStore.users.find((u) => u._id === item.user_id) || null;
    const locationIds = Array.isArray(user?.assigned_location_ids) ? user.assigned_location_ids : [];
    if (locationIds.length === 0) {
      return;
    }
    locationIds.forEach((locationId) => {
      pushRow({
        module: 'LOGIN_SESSION',
        timestamp: item.last_seen || item.created_at || new Date().toISOString(),
        location_id: locationId,
        device_id: null,
        event_type: item.is_active ? 'SESSION_ACTIVE' : 'SESSION_CLOSED',
        severity: 'LOW',
        login_id: item.login_id || null,
        performed_by: item.user_id || null,
        reason: item.device_name || null,
        details_json: JSON.stringify(item)
      });
    });
  });

  return rows.sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
}

function csvEscape(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const headers = [
    'timestamp',
    'module',
    'location_id',
    'device_id',
    'event_type',
    'severity',
    'login_id',
    'performed_by',
    'reason',
    'details_json'
  ];
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((key) => csvEscape(row[key])).join(','));
  });
  return `${lines.join('\n')}\n`;
}

function xmlEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toExcelXml(rows) {
  const headers = [
    'timestamp',
    'module',
    'location_id',
    'device_id',
    'event_type',
    'severity',
    'login_id',
    'performed_by',
    'reason'
  ];

  const rowXml = [];
  rowXml.push('<Row>');
  headers.forEach((header) => {
    rowXml.push(`<Cell><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`);
  });
  rowXml.push('</Row>');

  rows.forEach((row) => {
    rowXml.push('<Row>');
    headers.forEach((header) => {
      rowXml.push(`<Cell><Data ss:Type="String">${xmlEscape(row[header])}</Data></Cell>`);
    });
    rowXml.push('</Row>');
  });

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="AuditReport">
  <Table>
   ${rowXml.join('')}
  </Table>
 </Worksheet>
</Workbook>`;
}

function pdfEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  const maxLines = 36;
  const safeLines = lines.slice(0, maxLines).map((line) => pdfEscape(line).slice(0, 110));
  const textOps = ['BT', '/F1 10 Tf', '50 790 Td', '14 TL'];
  safeLines.forEach((line, index) => {
    if (index === 0) {
      textOps.push(`(${line}) Tj`);
    } else {
      textOps.push(`T* (${line}) Tj`);
    }
  });
  textOps.push('ET');
  const content = textOps.join('\n');

  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push(`5 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  });
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function buildReport({ filters, authContext }) {
  const normalized = normalizeFilters(filters || {});
  const rows = collectReportRows(normalized, authContext);
  const generatedAt = new Date().toISOString();

  return {
    filters: normalized,
    generated_at: generatedAt,
    row_count: rows.length,
    rows
  };
}

function exportReport({ filters, authContext }) {
  const report = buildReport({ filters, authContext });
  const format = report.filters.format || 'csv';

  if (format === 'csv') {
    return {
      format: 'csv',
      contentType: 'text/csv; charset=utf-8',
      filename: 'audit-report.csv',
      body: Buffer.from(toCsv(report.rows), 'utf8')
    };
  }
  if (format === 'xlsx' || format === 'excel' || format === 'xls') {
    return {
      format: 'excel',
      contentType: 'application/vnd.ms-excel',
      filename: 'audit-report.xls',
      body: Buffer.from(toExcelXml(report.rows), 'utf8')
    };
  }
  if (format === 'pdf') {
    const lines = [
      'FloodGuard Audit Report',
      `Generated at: ${report.generated_at}`,
      `Rows: ${report.row_count}`,
      `Filter location: ${report.filters.location_id || 'ALL'}`,
      `Filter device: ${report.filters.device_id || 'ALL'}`,
      '---',
      ...report.rows.slice(0, 28).map((item) => `${item.timestamp} | ${item.module} | ${item.location_id || '-'} | ${item.event_type}`)
    ];
    return {
      format: 'pdf',
      contentType: 'application/pdf',
      filename: 'audit-report.pdf',
      body: buildSimplePdf(lines)
    };
  }

  throw badRequest('Unsupported report format. Use csv, excel/xlsx, or pdf');
}

module.exports = {
  buildReport,
  exportReport
};
