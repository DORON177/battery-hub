// Runs after electron-builder lays out the app, before the installer is made. Leaves out
// dxcompiler.dll (25 MB): it compiles shaders for WebGPU and Direct3D 12, and Battery Hub runs with
// hardware acceleration off. The window, cards, chart and tray popup were checked without it.
const fs = require('fs');
const path = require('path');

const UNUSED = ['dxcompiler.dll'];

module.exports = async ({ appOutDir }) => {
  for (const name of UNUSED) {
    const file = path.join(appOutDir, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
};
