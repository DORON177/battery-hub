# Contributing

Thanks for your interest in Battery Hub.

## Requesting support for a device

The most useful contribution is a device report. Battery Hub can only read a device once
its battery protocol is known, and that requires data from the hardware itself.

Open a [device support request](https://github.com/DORON177/battery-hub/issues/new?template=device-support.yml)
and include the vendor/product ID and the output of the in-app calibration scan
(**Add Device → Calibrate & Add**). Requests without that information usually can't be
acted on.

If your device already works after calibrating it yourself, that's still worth reporting —
those settings can be shipped as a built-in profile so nobody else has to repeat it.

## Development

Requires [Node.js](https://nodejs.org).

```bash
npm install
npm start        # run in development
npm test         # run the unit tests
npm run dist     # build the Windows installer into dist/
```

The renderer can be worked on without hardware: opening `src/renderer/index.html` through
a static server loads `src/renderer/mock.js`, which supplies sample devices covering every
visual state.

### Layout

| Path | Purpose |
| --- | --- |
| `src/main` | Electron main process — HID polling, tray, notifications, updates. |
| `src/main/hid/drivers` | Per-device battery drivers. |
| `src/renderer` | Application UI. |
| `test` | Unit tests (`node:test`, no framework). |
| `scripts` | Icon and screenshot generation. |
| `packaging/winget` | Windows Package Manager manifests. |

Native `node-hid` calls run in an isolated utility process, so a driver fault can't bring
the app down. Anything touching HID belongs behind `src/main/hid/hid-client.js`.

## Pull requests

- Run `npm test` before opening a PR; CI runs the same suite on every push.
- Keep logic that can be tested free of Electron and native imports — see
  `src/main/history.js` and `src/renderer/estimate.js` for the pattern.
- Match the surrounding code style. `.editorconfig` covers indentation and line endings.
- Describe what you tested, especially for driver changes, since most hardware can't be
  verified by anyone but its owner.

## Releasing

Maintainers only:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit and push to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` — GitHub Actions builds the installer,
   attaches `SHA256SUMS.txt` and creates a **draft** release.
4. Publish the draft, or the auto-updater won't offer it.
5. Update the winget manifests — see `packaging/winget/README.md`.
