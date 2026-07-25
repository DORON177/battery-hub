# Security policy

## Supported versions

Fixes are released against the latest version only. Please update to the
[current release](https://github.com/DORON177/battery-hub/releases/latest) before
reporting an issue.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's
[security advisory form](https://github.com/DORON177/battery-hub/security/advisories/new)
rather than opening a public issue.

Please include the affected version, what an attacker could achieve, and the steps to
reproduce it. This is a small hobby project, so expect an initial response within a couple
of weeks rather than the same day.

## What Battery Hub does on your machine

Useful context when assessing a report:

- It reads battery data from local USB/HID devices and stores device settings and battery
  history under `%APPDATA%\battery-hub`. Nothing is transmitted anywhere.
- The only outbound network requests are update checks against the GitHub Releases API,
  and downloading an installer when an update is applied.
- The renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled; all
  privileged operations go through the preload bridge in `src/main/preload.js`.
- Native `node-hid` calls are isolated in a separate utility process.

## Note on code signing

Release installers are **not code-signed**, so Windows SmartScreen will warn on download.
Every release is built by GitHub Actions from a tagged commit and published with a
`SHA256SUMS.txt` checksum — see
[Verifying a download](README.md#verifying-a-download).
