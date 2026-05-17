# FloodGuard Work Organization

This repository is organized into dedicated execution tracks:

- `HARDWARE/` -> ESP32 firmware and on-site electronics behavior
- `VPS/` -> backend APIs, broker integration, database, auth, push, audit
- `APK/` -> responsive PWA UI, Android app build, mobile push UX

## Execution Order
1. Read `PROJECT_ARCHITECTURE.md`
2. Execute track plans in:
   - `HARDWARE/WORK_PLAN.md`
   - `VPS/WORK_PLAN.md`
   - `APK/WORK_PLAN.md`
3. Validate integration with end-to-end test checklist

## Integration Rules
- Hardware team owns sensor truth and relay behavior.
- VPS team owns authorization, command routing, incident persistence, and notifications.
- APK team owns user interaction, live visibility, and action request UX.
- No team changes cross-track contracts without updating architecture and API contract docs.

