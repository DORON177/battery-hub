# winget package manifests

Manifests for publishing Battery Hub to the
[Windows Package Manager](https://github.com/microsoft/winget-pkgs), which lets users
install with:

```powershell
winget install DORON177.BatteryHub
```

## Updating for a new release

1. Compute the installer's SHA-256 — CI attaches `SHA256SUMS.txt` to every release, or:

   ```powershell
   (Get-FileHash "Battery-Hub-Setup-<version>.exe" -Algorithm SHA256).Hash
   ```

2. In all three YAML files update `PackageVersion`, and in the installer manifest update
   `InstallerUrl`, `InstallerSha256` and `ReleaseDate`. Update `ReleaseNotesUrl` in the
   locale manifest.

3. Validate locally:

   ```powershell
   winget validate --manifest packaging/winget
   ```

4. Submit a pull request to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
   placing the three files under `manifests/d/DORON177/BatteryHub/<version>/`.
   [wingetcreate](https://github.com/microsoft/winget-create) can automate steps 1–4:

   ```powershell
   wingetcreate update DORON177.BatteryHub --version <version> --urls <installer-url> --submit
   ```

Microsoft's automated validation installs the package in a sandbox before a moderator
approves the PR.
