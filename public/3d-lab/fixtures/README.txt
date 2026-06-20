Local, dev-only fixture images for the 3D Room Lab "Fixture Harness".

Purpose:
- Controlled, deliberate testing of known room-image categories for auto floor
  detection (repeatability, success/failure, geometry score, manual-correction
  amount, which room types work vs. should fall back to manual setup).

Usage:
- Put image files in this folder: public/3d-lab/fixtures/
- The committed manifest (app/admin/3d-room-lab/auto-floor-fixtures.ts) expects
  files named after each fixture id, for example:
    public/3d-lab/fixtures/clean-open-floor.jpg
    public/3d-lab/fixtures/rug-dominant.jpg
    public/3d-lab/fixtures/open-plan-or-angled-room.jpg
- In the lab, pick a fixture in "Fixture Harness" and click "Load fixture image".
  Detection is never auto-run; click "Run detection for current fixture" to test
  with the currently selected provider (choose Gemini vision for real testing).

Notes:
- These are LOCAL TEST ASSETS ONLY. Do NOT commit private/customer room photos.
- Fixture image files in this folder are git-ignored; only this README is tracked.
- Missing fixture files do not crash the lab — the image simply fails to load and
  the lab shows a clear local message.
- Common web formats work (jpg, png, webp). EXIF-rotated images intentionally fail
  closed through the existing real-route image guards.
