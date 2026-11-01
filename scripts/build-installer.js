// Wraps the electron-builder installer in the branded installer window (installer/).
//
//   npm run dist            first, to produce the electron-builder installer
//   npm run installer       then this, which writes dist/Battery-Hub-Installer-<version>.exe
//
// Uses the C# compiler included with Windows, so there is nothing to install.
// Pass --preview <out.exe> to build a test copy that holds still and saves a picture of itself.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { version, build } = require('../package.json');
const FRAMEWORK = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const WPF = path.join(FRAMEWORK, 'WPF');

const previewAt = process.argv.indexOf('--preview');
const preview = previewAt > 0 ? process.argv[previewAt + 1] : null;
const payload = path.join(ROOT, 'dist', `${build.productName} Setup ${version}.exe`);
const out = preview || path.join(ROOT, 'dist', `Battery-Hub-Installer-${version}.exe`);

if (!preview && !fs.existsSync(payload)) {
  console.error(`Missing ${payload}. Run "npm run dist" first.`);
  process.exit(1);
}

const args = [
  '/nologo',
  '/optimize+',
  '/target:winexe',
  `/out:${out}`,
  `/win32icon:${path.join(ROOT, 'assets', 'icon.ico')}`,
  `/win32manifest:${path.join(ROOT, 'installer', 'app.manifest')}`,
  `/resource:${path.join(ROOT, 'assets', 'icon.png')},art.png`,
  ...['PresentationFramework', 'PresentationCore', 'WindowsBase'].map((dll) => `/reference:${path.join(WPF, `${dll}.dll`)}`),
  `/reference:${path.join(FRAMEWORK, 'System.Xaml.dll')}`,
  preview ? '/define:PREVIEW' : `/resource:${payload},payload.exe`,
  path.join(ROOT, 'installer', 'BatteryHubInstaller.cs'),
];

execFileSync(path.join(FRAMEWORK, 'csc.exe'), args, { stdio: 'inherit' });
console.log(`Wrote ${out} (${Math.round(fs.statSync(out).size / 1048576)} MB)`);
