<div align="center">
  <img src="assets/brand/watcher-tile.png" width="120" alt="Battery Hub" />
  <h1>Battery Hub</h1>
  <p><strong>Live battery monitoring for wireless mice, keyboards, headsets and controllers on Windows.</strong></p>

  <a href="https://github.com/DORON177/battery-hub/releases/latest"><img src="https://img.shields.io/github/v/release/DORON177/battery-hub?sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/DORON177/battery-hub/releases"><img src="https://img.shields.io/github/downloads/DORON177/battery-hub/total" alt="Downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/DORON177/battery-hub" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D6" alt="Platform: Windows 10/11" />
</div>

---

Battery Hub reads the battery level of your wireless HID devices and shows each one on a live dashboard, with a per-device indicator in the system tray. Built with Electron.

<p align="center">
  <img src="docs/screenshot.png" width="820" alt="Battery Hub dashboard showing five devices with charge rings, history sparklines and time-left estimates" />
  <br />
  <sub>The dashboard, shown with sample devices. Regenerate with <code>npx electron scripts/screenshot.js</code>.</sub>
</p>

## Features

- **Multi-device dashboard** — mice, keyboards, headsets and controllers, each with a colour-coded charge ring.
- **System-tray icons** — a live battery indicator per device beside the clock.
- **At-a-glance overview** — which device needs charging next, how soon, and how many are connected.
- **History & estimates** — click any device for a 24-hour or 7-day battery chart, its drain rate and when it was last charged.
- **Low-battery notifications** — Windows alerts when a device falls below a configurable threshold.
- **Guided calibration** — a 30-second scan detects the battery byte for devices that aren't recognised automatically.
- **Liquid-glass interface** — translucent Windows 11 acrylic design with light/dark themes and a reduce-motion option.
- **Auto-updates** — delivered through GitHub Releases.

## Installation

With the [Windows Package Manager](https://learn.microsoft.com/windows/package-manager/):

```powershell
winget install DORON177.BatteryHub
```

Or download the latest `Battery-Hub-Installer-x.y.z.exe` from the [releases page](https://github.com/DORON177/battery-hub/releases/latest) and run it. Battery Hub installs per-user and requires no administrator rights.

Windows SmartScreen shows a **"Windows protected your PC"** prompt because the installer isn't code-signed — select **More info → Run anyway**. Code signing certificates are issued to identified publishers for a recurring fee; this project is unfunded, so builds are unsigned. See [Verifying a download](#verifying-a-download) if you'd like to confirm the file's integrity first.

### Verifying a download

Every release is built and published by [GitHub Actions](.github/workflows/release.yml) directly from a tagged commit — no binaries are uploaded by hand — and each one ships a `SHA256SUMS.txt`. To confirm your download matches, run:

```powershell
(Get-FileHash "Battery-Hub-Installer-1.3.1.exe" -Algorithm SHA256).Hash
```

and compare the result with the checksum in that release's `SHA256SUMS.txt`. Pasting the same hash into [VirusTotal](https://www.virustotal.com/gui/home/search) will show any scan results for the exact file.

## Usage

### Adding a device

Open **Add device**. Recognised devices are listed first with a *Supported* badge: click **Add**. For anything else, choose **Set up**:

1. Start the 30-second scan.
2. Power the device off and on while it scans — many wireless devices only report their battery on power-up.
3. Select the value that matches your current battery percentage.
4. If the device reports on a different scale, enter your real percentage and it's converted automatically from then on.

### Reading a card

Each card shows the current percentage and ring (green / yellow / red), a charging indicator, a history sparkline, an estimated time remaining, and the age of the last reading. Click a card for its full history. Every device also appears as a tray icon that fills and changes colour with the charge.

### Settings

Theme, card density, reduce animations, low-battery threshold, tray behaviour, launch at login, and refresh interval.

Devices can be renamed, given a custom icon, dragged to reorder, or **hidden** from the ⋯ menu. Hiding keeps the device and its calibration but stops polling and removes its tray icon; hidden devices are listed below the grid and can be restored at any time.

## Build from source

Requires [Node.js](https://nodejs.org).

```bash
npm install
npm start        # run in development
npm run dist     # build the Windows installer into dist/
npm run installer  # wrap it in the branded installer window
```

## Supported devices

Battery Hub reads these directly. Anything else can usually be added with **Set up**.

| Family | Devices |
| --- | --- |
| Bluetooth | Any paired device that reports its battery to Windows |
| Xbox | Wireless controllers |
| PlayStation | DualSense, DualSense Edge, DualShock 4 (USB and Bluetooth) |
| Logitech | Mice and keyboards using HID++ 2.0 (Bolt, Unifying, Lightspeed); G PRO, G533, G535, G633, G733, G933, G935 headsets |
| Razer | 81 wireless mice and keyboards |
| SteelSeries | Arctis 1, 7, 7+, 9, Nova 3P, Nova 5, Nova 7, Nova Pro Wireless headsets; Aerox, Prime and Rival 3 Wireless mice |
| HyperX | Cloud Alpha Wireless, Cloud Flight, Cloud II Wireless |
| Corsair | Void and Virtuoso headsets |
| Audeze | Maxwell, Maxwell 2 |
| MCHOSE | V9 Turbo+, X9 |
| VXE | NordicMouse and other Kysona-based mice |

Tested on real hardware: VXE NordicMouse, MCHOSE V9 Turbo+, DualSense on USB and Bluetooth, and Logitech MX Master 4 over Bluetooth. The rest are built from the protocols documented by the projects below and checked against those byte layouts, so please [report a device](https://github.com/DORON177/battery-hub/issues/new?template=device-support.yml) if one misbehaves.

Protocol work comes from [HeadsetControl](https://github.com/Sapd/HeadsetControl), [OpenRazer](https://github.com/openrazer/openrazer), [rivalcfg](https://github.com/flozz/rivalcfg) and the Linux kernel's HID drivers.

A device connected more than one way, such as a controller on its cable and over Bluetooth, shows as one card when both connections report the same Bluetooth address.

Reading a PlayStation controller over Bluetooth switches it to its full report mode until it's turned off, as Steam and DS4Windows do. A few older games may not see the controller in that mode. You can turn this off in Settings.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/main` | Electron main process — HID polling, tray, notifications, updates. |
| `src/main/hid/drivers` | Per-device battery drivers; `table.js` lists simple request/response devices. |
| `src/renderer` | Application UI. |
| `scripts` | Icon generation and build tooling. |

Native `node-hid` runs in an isolated utility process, so a driver fault can't bring the app down.

## Troubleshooting

- **"Can't read this device's battery."** Some devices block battery requests at the driver level and can't be read.
- **Nothing captured during calibration.** Rerun the scan and power the device off and on while it runs.
- **MCHOSE V9 Turbo+ shows "needs Python + hid module".** This headset is read through Python. Install [Python](https://www.python.org/downloads/), then run `pip install hidapi`.
- **A device won't work.** After two failed scans, or three failed reads in a row (open the device's card), a Send device report button appears. It fills in a device request on GitHub for you to check and submit.
- **Something else isn't working.** Open Settings > Help and press Run check. It tests your install, this PC and your devices, tells you where the problem is, and can open a filled-in support request.
- **Crash logs** are written to `%APPDATA%\battery-hub\battery-hub.log`.

## Contributing

Device support requests and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Release history is in [CHANGELOG.md](CHANGELOG.md), and security reports are covered by
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 DORON177
