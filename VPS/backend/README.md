# VPS Backend Structure

This backend structure follows the working pattern proven in `relay-app`:
- routes isolated by domain
- MQTT bridge isolated from HTTP handlers
- service layer for business rules
- centralized auth middleware

## Source Layout

```text
backend/src/
  routes/      # REST endpoints (devices, commands, incidents, audit, ota)
  services/    # incident engine, push, audit, RBAC
  middleware/  # auth, tenant key, validation, error handling
  mqtt/        # MQTT bridge + topic parser
  jobs/        # cron/scheduled jobs
  db/          # schema + repository layer
```

## Request Flow
1. API request enters route.
2. Middleware validates auth + role + tenant.
3. Service executes business logic.
4. DB write/read and MQTT publish/subscribe actions run.
5. Audit entry created for sensitive actions.

## Integration Contract (for parent apps)
- Required headers when proxied from parent backend:
  - `x-api-key`
  - `x-user-id`
  - `x-user-name`

This mirrors the QRunlock to relay pattern and keeps FloodGuard ready for future integrations.

