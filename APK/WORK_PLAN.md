# APK Work Plan

Scope owner: responsive PWA and Android app user experience.

## A. App Architecture Deliverables
- React UI modules:
  - login screen
  - location list
  - live location dashboard
  - control panel
  - audit timeline
- Shared design theme based on mockups:
  - blue/white safety palette
  - danger blink/pulse/glow cues
  - vessel water-fill animation

## B. Responsive + PWA Requirements
- Mobile-first layout across phone, tablet, desktop
- PWA installable manifest
- Service worker baseline for offline shell
- clear update/version visibility in settings

## C. Android Packaging Deliverables
- Capacitor Android setup
- FCM push integration
- token refresh and session rebind handling
- mandatory/optional app update behavior

## D. Role and Action UX
- Role-dependent control actions
- Confirmation dialogs for risky commands
- Mandatory reason input for force clear
- Action result feedback and audit visibility

## E. Data Visibility Requirements
- Live water level in mm and vessel visual
- Sensor/switch state visibility
- Relay statuses and network health summary
- Offline and stale-data indicators

## F. Acceptance Checklist
- Login and role gating validated
- Live dashboard updates in real time
- Push notifications visible and actionable
- PWA install works on supported browsers
- Android build package works with backend auth

