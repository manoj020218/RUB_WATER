# VPS Dashboard Structure

Dashboard responsibilities:
- live device status and incident view
- command controls with role checks
- audit timeline and reports
- network + SIM diagnostics visibility

## Recommended Frontend Modules
- `pages/`:
  - Login
  - LocationList
  - LiveDashboard
  - Controls
  - AuditLogs
  - IncidentReports
- `services/`:
  - REST API client
  - WebSocket live channel
- `store/`:
  - auth and role state
  - location/device cache
  - incident session state

## Integration Rule
Frontend talks only to FloodGuard backend API.
If FloodGuard is embedded inside another platform, that platform backend should proxy requests using the tenant header contract.

