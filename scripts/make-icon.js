// Build-time icon generator. Renders the Battery Hub app icon on a canvas via a
// hidden Electron window and writes assets/icon.png (256) + assets/icon.ico (multi-size).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { flat } = require('./brand-marks');

const ASSETS = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });

// Sizes up to 32px are the hand-tuned marks from brand-marks.js; a render shrunk that far turns
// to mush. Larger sizes come from the 3D render in assets/brand, halved stepwise for quality.
const BRAND = path.join(ASSETS, 'brand');
const toDataUrl = (type, data) => `data:${type};base64,${Buffer.from(data).toString('base64')}`;
const rasterScript = (src, size) => `
(async () => {
  const im = new Image();
  im.src = ${JSON.stringify(src)};
  await im.decode();
  let from = im, w = im.naturalWidth;
  while (w > size * 2) {
    w = Math.ceil(w / 2);
    const step = document.createElement('canvas'); step.width = step.height = w;
    const sx = step.getContext('2d'); sx.imageSmoothingQuality = 'high';
    sx.drawImage(from, 0, 0, w, w);
    from = step;
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(from, 0, 0, size, size);
  return c.toDataURL('image/png');
})()
`.replace(/\bsize\b/g, String(size));
async function raster(win, src, size) {
  const url = await win.webContents.executeJavaScript(rasterScript(src, size));
  return Buffer.from(url.split(',')[1], 'base64');
}

// Horizontal battery glyph used for the system-tray icons: white shell + terminal, an
// inner fill bar sized to capacity and coloured by state, a bolt overlay when charging.
const trayDrawScript = (size, fill, color, charging, offline) => `
(() => {
  const s = ${size};
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  const shell = ${offline ? "'rgba(255,255,255,0.55)'" : "'#ffffff'"};
  const bx = s * 0.09, by = s * 0.28, bw = s * 0.74, bh = s * 0.44;
  const rad = s * 0.09;
  const round = (px, py, pw, ph, r) => {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + pw, py, px + pw, py + ph, r);
    x.arcTo(px + pw, py + ph, px, py + ph, r);
    x.arcTo(px, py + ph, px, py, r);
    x.arcTo(px, py, px + pw, py, r);
    x.closePath();
  };
  x.lineWidth = s * 0.055;
  x.strokeStyle = shell;
  round(bx, by, bw, bh, rad);
  x.stroke();
  const nubW = s * 0.06, nubH = bh * 0.42;
  round(bx + bw + s * 0.02, by + (bh - nubH) / 2, nubW, nubH, s * 0.03);
  x.fillStyle = shell; x.fill();
  const pad = s * 0.07;
  const ix = bx + pad, iy = by + pad;
  const iw = (bw - pad * 2), ih = bh - pad * 2;
  ${offline ? '' : `
  const frac = Math.max(0.06, Math.min(1, ${fill} / 100));
  round(ix, iy, iw * frac, ih, s * 0.04);
  x.fillStyle = ${JSON.stringify(color)}; x.fill();`}
  ${charging ? `
  const u = s / 24;
  const p = [[13,3],[7,13],[11,13],[10,21],[17,9],[13,9]];
  const bs = u * 0.62;
  x.save();
  x.translate(s*0.5 - 12*bs, s*0.5 - 12*bs);
  x.beginPath();
  x.moveTo(p[0][0]*bs, p[0][1]*bs);
  for (let i = 1; i < p.length; i++) x.lineTo(p[i][0]*bs, p[i][1]*bs);
  x.closePath();
  x.fillStyle = '#ffffff';
  x.strokeStyle = ${JSON.stringify(color)}; x.lineWidth = s * 0.05; x.lineJoin = 'round';
  x.stroke(); x.fill();
  x.restore();` : ''}
  return c.toDataURL('image/png');
})()
`;

function buildIco(pngBuffers) {
  // pngBuffers: array of { size, buffer }
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(count, 4);  // image count

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngBuffers.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0); // width
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1); // height
    dir.writeUInt8(0, b + 2);   // palette
    dir.writeUInt8(0, b + 3);   // reserved
    dir.writeUInt16LE(1, b + 4);  // planes
    dir.writeUInt16LE(32, b + 6); // bpp
    dir.writeUInt32LE(img.buffer.length, b + 8);  // size of data
    dir.writeUInt32LE(offset, b + 12);            // offset
    offset += img.buffer.length;
  });

  return Buffer.concat([header, dir, ...pngBuffers.map((p) => p.buffer)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const render = toDataUrl('image/png', fs.readFileSync(path.join(BRAND, 'watcher.png')));
  const mark = (size, mood) => toDataUrl('image/svg+xml', flat(size, mood));
  const pngs = [];
  for (const size of [16, 20, 24, 32]) pngs.push({ size, buffer: await raster(win, mark(size), size) });
  for (const size of [48, 64, 128, 256]) pngs.push({ size, buffer: await raster(win, render, size) });
  const big = pngs[pngs.length - 1].buffer;
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), big);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(pngs));
  const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
  fs.writeFileSync(path.join(RENDERER, 'watcher.png'), big);          // About page, empty state
  fs.writeFileSync(path.join(RENDERER, 'app-icon.png'), pngs[3].buffer); // title bar

  // --- Pre-render the system-tray battery glyphs to static PNGs (one per 5% bucket,
  // plus charging + offline). Rendering these once at build time means the running app
  // never touches a canvas / hidden window / per-update COM image for the tray, which was
  // crashing Windows' shell COM layer (combase.dll). At runtime tray.js just loads a file.
  const TRAY_DIR = path.join(ASSETS, 'tray');
  if (!fs.existsSync(TRAY_DIR)) fs.mkdirSync(TRAY_DIR, { recursive: true });
  const trayColor = (p) => (p <= 20 ? '#ff3b30' : p <= 45 ? '#ff9f0a' : '#34c759');
  const variants = [];
  for (let p = 0; p <= 100; p += 5) variants.push({ file: `tray-${p}.png`, fill: p, color: trayColor(p), charging: false, offline: false });
  variants.push({ file: 'tray-charging.png', fill: 100, color: '#34c759', charging: true, offline: false });
  variants.push({ file: 'tray-offline.png', fill: 0, color: '#8e8e93', charging: false, offline: true });
  for (const v of variants) {
    const dataUrl = await win.webContents.executeJavaScript(trayDrawScript(32, v.fill, v.color, v.charging, v.offline));
    fs.writeFileSync(path.join(TRAY_DIR, v.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // The face in the tray: 16px plus an @2x file, which Windows picks up on scaled displays.
  for (const mood of ['full', 'low', 'sleep', 'charge']) {
    fs.writeFileSync(path.join(TRAY_DIR, `mood-${mood}.png`), await raster(win, mark(16, mood), 16));
    fs.writeFileSync(path.join(TRAY_DIR, `mood-${mood}@2x.png`), await raster(win, mark(32, mood), 32));
  }

  console.log(`Wrote assets/icon.png, icon.ico, renderer icons, and ${variants.length} tray glyphs + mood faces`);
  app.quit();
});
