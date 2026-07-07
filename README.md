<div align="center">
  <img src="assets/icon.png" width="88" alt="Battery Hub" />
  <h1>Battery Hub</h1>
  <p><strong>Live battery monitoring for wireless mice, keyboards, headsets and controllers on Windows.</strong></p>

  <a href="https://github.com/DORON177/battery-hub/releases/latest"><img src="https://img.shields.io/github/v/release/DORON177/battery-hub?sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/DORON177/battery-hub/releases"><img src="https://img.shields.io/github/downloads/DORON177/battery-hub/total" alt="Downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/DORON177/battery-hub" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D6" alt="Platform: Windows 10/11" />
</div>

---

Battery Hub reads the battery level of your wireless HID devices and shows each one on a live dashboard, with a per-device indicator in the system tray. Built with Electron.

## Features

- **Multi-device dashboard** — mice, keyboards, headsets and controllers, each with a colour-coded charge ring.
- **System-tray icons** — a live battery indicator per device beside the clock.
- **History & estimates** — a recent-trend sparkline and a *time-left* estimate derived from the drain rate.
- **Low-battery notifications** — Windows alerts when a device falls below a configurable threshold.
- **Guided calibration** — a 30-second scan detects the battery byte for devices that aren't recognised automatically.
- **Liquid-glass interface** — translucent Windows 11 acrylic design with light/dark themes and a reduce-motion option.
- **Auto-updates** — delivered through GitHub Releases.

## Installation

Download the latest `Battery Hub Setup x.y.z.exe` from the [releases page](https://github.com/DORON177/battery-hub/releases/latest) and run it. Battery Hub installs per-user and requires no administrator rights.

> The installer isn't code-signed, so Windows SmartScreen may show a warning. Select **More info → Run anyway**.

## Usage

### Adding a device

Open **Add Device**. Recognised devices show an *auto-detected* badge — click **Add**. Otherwise choose **Calibrate & Add**:

1. Start the 30-second scan.
2. Power the device off and on while it scans — many wireless devices only report their battery on power-up.
3. Select the value that matches your current battery percentage.
4. If the device reports on a different scale, enter your real percentage and it's converted automatically from then on.

### Reading a card

Each card shows the current percentage and ring (green / yellow / red), a charging indicator, a history sparkline, an estimated time remaining, and the age of the last reading. Every device also appears as a tray icon that fills and changes colour with the charge.

### Settings

Theme and accent colour, card density, reduce animations, low-battery threshold, tray behaviour, launch at login, and refresh interval.

## Build from source

Requires [Node.js](https://nodejs.org).

```bash
npm install
npm start        # run in development
npm run dist     # build the Windows installer into dist/
```

## Project structure

| Path | Purpose |
| --- | --- |
| `src/main` | Electron main process — HID polling, tray, notifications, updates. |
| `src/main/hid/drivers` | Per-device battery drivers. |
| `src/renderer` | Application UI. |
| `scripts` | Icon generation and build tooling. |

Native `node-hid` runs in an isolated utility process, so a driver fault can't bring the app down.

## Troubleshooting

- **"Can't read this device's battery."** Some devices block battery requests at the driver level and can't be read.
- **Nothing captured during calibration.** Rerun the scan and power the device off and on while it runs.
- **Crash logs** are written to `%APPDATA%\battery-hub\battery-hub.log`.

## License

[MIT](LICENSE) © 2026 DORON177
