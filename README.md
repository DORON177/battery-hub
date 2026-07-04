# Battery Hub

A clean, live battery monitor for wireless HID devices (mice, keyboards, headsets, controllers) on Windows. Each device gets a card with its charge level, a color-coded ring, recent-history sparkline, a rough "time left" estimate, and its own system-tray battery icon.

![Battery Hub](assets/icon.png)

## Download & install (for everyone)

1. Grab **`Battery Hub Setup x.y.z.exe`** from the [Releases](../../releases) page.
2. Run it. Windows may show a blue **"Windows protected your PC"** box — this only appears because the app isn't code-signed (a paid certificate), not because it's harmful. Click **More info → Run anyway**.
3. It installs per-user (no admin needed) and adds Start-menu + desktop shortcuts. Uninstall anytime via *Add or remove programs*.

### Adding a device

Open **Add Device**. If your device is recognized, it's one click. Otherwise choose **Calibrate & Add** and run the 30-second scan — **turn the device off and back on while it scans** so it broadcasts its battery level, then click the number that matches your battery %.

## Notes on device support

- **Wireless mice / keyboards / controllers:** work out of the box or via the calibration scan.
- **MCHOSE-style headsets:** these need **Python + the `hid` module** installed (`pip install hid`) because the headset can only be read that way. If you don't have such a headset, you don't need Python.
- Some devices block battery requests at the driver level and simply can't be read — the app will say so on the card.

## Build from source (for developers)

Requires Node.js.

```bash
npm install
npm start                 # run the app in dev
node scripts/make-icon.js # regenerate app + tray icons (run with electron)
npm run dist              # build the Windows installer into dist/
```

- **Main process:** `src/main` (Electron main, HID polling, tray, notifications). Native `node-hid` runs in an isolated `utilityProcess` so a driver crash can't take the app down.
- **Renderer:** `src/renderer` (the UI).
- **Device drivers:** `src/main/hid/drivers`.

## License

MIT — see [LICENSE](LICENSE).
