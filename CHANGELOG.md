# Changelog

All notable changes to this project are documented here. Versions follow
[semantic versioning](https://semver.org/); each entry corresponds to a
[GitHub release](https://github.com/DORON177/battery-hub/releases).

## [Unreleased]

### Added
- Overview above the cards showing which device needs charging next, how soon, and how
  many devices are charging and connected.
- Device detail panel: click a card for a 24-hour or 7-day battery chart, drain rate, time
  left, last charge and voltage.

### Fixed
- Time-left estimates were far too short. Flat stretches of history were left out of the
  drain-rate calculation, so each 1% drop was divided by only the last few minutes before
  it. A device that lost 15% in 17 hours showed about 1 hour left instead of about 51.
- Card hover lift never applied, and offline cards were never dimmed: the entry animation
  kept overriding both after it finished.
- Choosing an accent colour left the selection tint and button hover blue.
- Removing or hiding a device during a battery read could bring it back as an empty entry
  or restore its tray icon.
- Restarting monitoring could leave a headset reader process running untracked, after
  which another one was started alongside it.
- Time-left estimates no longer appear for a reading more than a week old.
- Calibrated devices could be read from the wrong collection when several share a usage
  page. New calibrations record the exact collection; existing ones behave as before.
- A calibrated device reporting an all-zero or too-short frame could show 0% or an invalid
  level. Those frames are now ignored.
- A device that rejected its first battery request left a timer writing to a closed handle
  twice a second, for every poll, until the worker restarted.
- Polls no longer run during a calibration scan, where they could swallow the frames being
  scanned for.
- A headset dongle reconnecting, or the app restarting, no longer leaves the card showing
  "not connected" until the battery next changes.
- A device moved to another USB port is found on the next poll instead of up to five
  minutes later.
- Python launchers that exit without running the reader, such as the Windows store alias,
  now fall through to the next launcher instead of failing silently.

### Changed
- Wider device cards with the ring beside the device details.
- HID devices now stay open between polls and reads run strictly one at a time. Closing a
  handle with a read in flight frees memory Windows may still be using, which fits the
  heap-corruption crashes in the background HID process.
- Calibrated devices that broadcast their battery level are picked up from the frames
  received since the last poll, instead of only during an 8-second listening window.
- Calibration scans poll only the reports a device actually supports.
- Tab switches are much smoother: frame gaps fall from about 60 ms to under 17 ms, with
  the worst stall dropping from 129 ms to about 25 ms. Blur filters were removed from
  surfaces that had nothing behind them to blur; they were being rendered in software and
  drew faint wavy lines on the cards.
- Removed the unused background layer and its colour tokens.

## [1.2.0] — 2026-07-25

First stable release, consolidating the 1.0.x and 1.1.x series.

### Added
- Hide devices from the ⋯ menu — polling and tray icons stop, calibration is kept, and
  hidden devices can be restored from a strip below the dashboard.
- `SHA256SUMS.txt` published with every release, and a "Verifying a download" section in
  the README, so unsigned installers can still be checked for integrity.
- Unit tests (`npm test`) covering the drain-rate estimate, history retention and HID
  driver parsing, run in CI on every push and pull request.
- Issue template for unsupported-device requests.
- Windows Package Manager listing: `winget install DORON177.BatteryHub`.
- Contributing, security and changelog documentation.

### Fixed
- Memory leak in the dashboard: a document-level click handler was registered for every
  device card on every refresh and never removed, so listeners accumulated for the life
  of the session and kept discarded cards in memory. Replaced with a single delegated
  handler.

### Changed
- Cursor tracking for the glass highlight now exits earlier, and does no work at all when
  **Reduce animations** is on.
- Removed dead code left over from an earlier gauge implementation.

## [1.1.5] — 2026-07-07

### Fixed
- Laggy scrolling in Settings.

## [1.1.4] — 2026-07-06

### Added
- Liquid-glass interface with a translucent Windows 11 acrylic backdrop, in light and dark.
- Animated view transitions, hover and press feedback, and a **Reduce animations** setting
  that disables all motion.

### Changed
- Opening the card menu now closes the icon picker.

## [1.1.3] — 2026-07-05

### Added
- Change a device's icon by clicking the icon itself.

### Changed
- Time-left estimates now use the whole stored history, so they survive restarts.
- Icon picker limited to computer peripherals.

## [1.1.2] — 2026-07-04

### Added
- Device icon picker.
- App logo as the tray icon in single-list mode.
- Automated release pipeline via GitHub Actions.

### Changed
- Smoother scrolling in Settings.

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

[Unreleased]: https://github.com/DORON177/battery-hub/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/DORON177/battery-hub/releases/tag/v1.2.0
[1.1.5]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.5
[1.1.4]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.4
[1.1.3]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.3
[1.1.2]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.2
[1.1.1]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.1
[1.1.0]: https://github.com/DORON177/battery-hub/releases/tag/v1.1.0
[1.0.4]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.4
[1.0.3]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.3
[1.0.2]: https://github.com/DORON177/battery-hub/releases/tag/v1.0.2
