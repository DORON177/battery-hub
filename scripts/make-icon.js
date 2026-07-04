// Build-time icon generator. Renders the Battery Hub app icon on a canvas via a
// hidden Electron window and writes assets/icon.png (256) + assets/icon.ico (multi-size).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });

// Clean, flat icon: one solid circle, one white lightning bolt. No gradients, no
// sheen, no shadow. This exact PNG is reused as the in-app brand mark so the icon
// looks identical inside and outside the app.
const BRAND_COLOR = '#0a84ff';
const drawScript = (size) => `
(() => {
  const s = ${size};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const cx = s / 2, cy = s / 2, r = s * 0.5;

  // Solid flat circle.
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.closePath();
  x.fillStyle = ${JSON.stringify(BRAND_COLOR)};
  x.fill();

  // Lightning bolt, geometrically centered (24x24 path, bbox x[4..18] y[2..22] -> center 11,12).
  const pts = [[13,2],[4,14],[10,14],[9,22],[18,10],[12,10]];
  const boltScale = s / 24 * 0.9;
  x.translate(cx - 11 * boltScale, cy - 12 * boltScale);
  x.beginPath();
  x.moveTo(pts[0][0]*boltScale, pts[0][1]*boltScale);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0]*boltScale, pts[i][1]*boltScale);
  x.closePath();
  x.fillStyle = '#ffffff';
  x.fill();
  return c.toDataURL('image/png');
})()
`;

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

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const dataUrl = await win.webContents.executeJavaScript(drawScript(size));
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    pngs.push({ size, buffer });
    if (size === 256) fs.writeFileSync(path.join(ASSETS, 'icon.png'), buffer);
    // Same PNG the renderer shows as its brand mark, so in-app == taskbar icon.
    if (size === 128) fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app-icon.png'), buffer);
  }

  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(pngs));

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

  console.log(`Wrote assets/icon.png, icon-32.png, icon.ico, src/renderer/app-icon.png, and ${variants.length} tray glyphs`);
  app.quit();
});
