// Builds src/main/system-batteries.exe from src/main/batteries/SystemBatteries.cs with the C# compiler
// that ships with Windows, so there is nothing to install. Runs before `npm start` and `npm run dist`.
// Not on Windows, or without the compiler, it skips: the app then uses the PowerShell script.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'main', 'batteries', 'SystemBatteries.cs');
const OUT = path.join(ROOT, 'src', 'main', 'system-batteries.exe');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (process.platform !== 'win32' || !fs.existsSync(CSC)) {
  console.log('build-batteries: no Windows C# compiler here, skipping (the PowerShell script is used instead)');
  process.exit(0);
}
if (fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs >= fs.statSync(SOURCE).mtimeMs) process.exit(0);

execFileSync(CSC, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${OUT}`, SOURCE], { stdio: 'inherit' });
console.log(`Wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
