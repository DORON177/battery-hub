// Runs after electron-builder lays out the app, before the installer is made. Leaves out
// dxcompiler.dll (25 MB): it compiles shaders for WebGPU and Direct3D 12, and Battery Hub runs with
// hardware acceleration off. The window, cards, chart and tray popup were checked without it.
const fs = require('fs');
const path = require('path');

// Then records the file list that Settings > Help checks an install against (write-manifest.js).
// Both steps live here because package.json can only name one afterPack hook.
const writeManifest = require('./write-manifest').default;

const UNUSED = ['dxcompiler.dll'];

module.exports = async (context) => {
  for (const name of UNUSED) {
    const file = path.join(context.appOutDir, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  await writeManifest(context);
};
