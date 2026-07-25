# Changelog

All notable changes to this project are documented here. Versions follow
[semantic versioning](https://semver.org/); each entry corresponds to a
[GitHub release](https://github.com/DORON177/battery-hub/releases).

## [Unreleased]

### Added
- Hide devices from the ⋯ menu — polling and tray icons stop, calibration is kept, and
  hidden devices can be restored from a strip below the dashboard.
- `SHA256SUMS.txt` published with every release, and a "Verifying a download" section in
  the README.
- Unit tests (`npm test`) covering the drain-rate estimate, history retention and HID
  driver parsing, run in CI on every push and pull request.
- Issue template for unsupported-device requests.
- winget package manifests (`packaging/winget`).

## [1.1.5] — 2026-07-07

### Added
- Liquid-glass interface with a translucent Windows 11 acrylic backdrop, in light and dark.
- Animated view transitions, hover and press feedback, and a **Reduce animations** setting
  that disables all motion.

### Changed
- Smoother scrolling in Settings.

## [1.1.4] — 2026-07-06

### Changed
- Refreshed visual design: frosted title bar, softer shadows, squarer corners and
  colour-reflecting glass surfaces.

## [1.1.3] — 2026-07-05

### Added
- Change a device's icon by clicking the icon itself.

### Changed
- Battery "time left" estimates now average every discharge interval in the stored
  history, so they stay stable and survive restarts.
- Icon picker limited to computer peripherals.

## [1.1.2] — 2026-07-04

### Added
- Device icon picker.
- Automated release pipeline via GitHub Actions.

## [1.1.1] — 2026-07-04

### Fixed
- "Restart & install" button no longer stayed visible when already up to date.

## [1.1.0] — 2026-07-04

### Added
- In-app automatic updates via electron-updater.
- Tray layout setting: one icon per device, or a single icon listing them all.

## [1.0.4] — 2026-07-04

### Fixed
- Calibrated devices that reject HID writes but broadcast their battery frame are now
  read correctly instead of aborting.

## [1.0.3] — 2026-07-04

### Added
- Update checking against GitHub releases.

## [1.0.2] — 2026-07-04

Initial public release: live battery monitoring for wireless HID devices, per-device tray
icons, low-battery notifications, history sparklines and the guided calibration wizard.

[Unreleased]: https://github.com/DORON177/battery-hub/compare/v1.1.5...HEAD
[1.1.5]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.5
[1.1.4]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.4
[1.1.3]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.3
[1.1.2]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.2
[1.1.1]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.1
[1.1.0]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.0
[1.0.4]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.4
[1.0.3]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.3
[1.0.2]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.2
