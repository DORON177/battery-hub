# SignPath Foundation application (free code signing)

Battery Hub's installer is unsigned, so Windows SmartScreen warns "Windows protected your PC" and
many people stop there. SignPath Foundation signs open source projects for free. The first
application (July 2026) was refused for too little publicity: 1 star, about 6 downloads, 3 weeks
old. This file holds the answers for a new application.

Apply at https://signpath.org/apply (the form needs a browser). Terms: https://signpath.org/terms

## Before applying

- [ ] Turn on two-factor authentication for the GitHub account (Settings → Password and
      authentication). SignPath requires it for everyone with access to the source and signing.
- [x] Privacy policy on the project page: the **Privacy** section of README.md.
- [x] Releases are built by GitHub Actions from tagged commits, with no hand-uploaded binaries.
- [x] Product name and version are set by the build (package.json → electron-builder).
- [x] The installer can be uninstalled from Windows Settings and changes no system settings
      without asking (launch at login is an opt-in setting).

## Answers

**Project name:** Battery Hub

**Repository:** https://github.com/battery-hub/battery-hub

**Download page:** https://github.com/battery-hub/battery-hub/releases/latest
(also `winget install DORON177.BatteryHub`, in the Windows Package Manager since August 2026)

**License:** MIT (OSI approved), for all of the project's own code.

**Description:** Battery Hub shows the battery level of wireless mice, keyboards, headsets and game
controllers on Windows, in one window, the system tray and notifications. It reads devices from
Logitech, Razer, SteelSeries, HyperX, Corsair, Sony, Xbox, VXE, AULA and others, using the protocols
published by HeadsetControl, OpenRazer, rivalcfg and the Linux kernel, plus anything Windows reports
over Bluetooth. Everything runs locally and nothing is collected.

**What will be signed:** the Windows installers attached to each GitHub release
(`Battery-Hub-Update-<version>.exe`, the NSIS installer used by auto-update and winget, and
`Battery-Hub-Installer-<version>.exe`, a small WPF wrapper around it), built by
`.github/workflows/release.yml` on `windows-latest` from a pushed `v*` tag.

**Build:** Electron 45 app packaged by electron-builder; the wrapper and a small helper program are
compiled from C# sources in the repository with the C# compiler included in Windows. No upstream
binaries are signed under the project.

**Reputation (as of 2026-11-15):**
- about 1,400 installer downloads from GitHub releases, plus winget installs
- in the Windows Package Manager (microsoft/winget-pkgs), updated to each release
- 114 unique visitors and 59 unique cloners in the last 14 days; found mostly through Google and Bing
- users file device reports through the project's issue form (#5, #6, #7)
- releases since July 2026, most recent 2.0.1 on 2026-11-10

**Team and roles:**
- Author, reviewer and approver: the maintainers of https://github.com/battery-hub

**Data collection:** none. See the Privacy section of the README.

## After approval

Add this section to README.md, as SignPath's terms require:

```markdown
## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [battery-hub](https://github.com/battery-hub) maintainers
- Approvers: [battery-hub](https://github.com/battery-hub) maintainers

Every release is built by GitHub Actions from a tagged commit and signed only after manual approval.
See [Privacy](#privacy) for what the app does and doesn't send.
```

Then add the SignPath GitHub Action to `.github/workflows/release.yml` between building and
uploading, using the project slug and signing policy SignPath gives you.
