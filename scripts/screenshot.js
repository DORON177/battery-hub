// Regenerate docs/screenshot.png for the README.
//
//   npx electron scripts/screenshot.js
//
// Loads the real renderer with no preload, so src/renderer/mock.js installs its demo
// devices (covering healthy / low / charging / offline states). Capture is done with
// webContents.capturePage(), which reads the window's own compositor output — it never
// touches the desktop, so nothing outside the app can end up in the image.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshot.png');
const WIDTH = 1000;
const HEIGHT = 810;

app.disableHardwareAcceleration(); // match the app's own runtime config

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    // Opaque background: the shipped app is translucent over the desktop, which would
    // capture as transparent here. A solid backdrop keeps the PNG readable on GitHub.
    backgroundColor: '#141416',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  // let entry animations settle and the gauges finish their sweep
  await new Promise((r) => setTimeout(r, 2500));

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, image.toPNG());
  console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);

  win.destroy();
  app.quit();
});
