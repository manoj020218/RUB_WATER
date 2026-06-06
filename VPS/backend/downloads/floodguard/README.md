# FloodGuard APK Downloads

Upload published Android APK files into `downloads/floodguard/android/`.

The VPS backend exposes this folder at:

- `/downloads/floodguard/android/...`

The app checks release metadata from:

- `/api/app-release/mobile`

For each release:

1. Build the signed APK.
2. Copy it to `downloads/floodguard/android/` with the filename referenced in `app-release.json`.
3. Update `app-release.json` with the new version, build code, release date, and notes.
