// Hand-tuned small masters of the Watcher logo (used by make-icon.js). Every coordinate lands on the pixel grid of its own size:
// a render shrunk to 16px turns to mush, so small sizes are drawn, not scaled.
const EYE = { full: '#4df5b6', low: '#ffb03c', sleep: '#ff5c60', charge: '#b9f53e' };
const r = (x, y, w, h, rx, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const defs = (id) => `<defs>
  <linearGradient id="b${id}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cdd3da"/></linearGradient>
  <linearGradient id="c${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a9623a"/><stop offset=".38" stop-color="#ffdcc0"/><stop offset=".62" stop-color="#e09a68"/><stop offset="1" stop-color="#8f4f2c"/></linearGradient></defs>`;
const LINE = '#5f6975';
// the app's bolt on its 24 unit grid, fitted to the screen of each size
const BOLT = [[13, 2], [4, 14], [10, 14], [9, 22], [18, 10], [12, 10]];
function bolt(vx, vy, vw, vh, color) {
  const k = (vh - 0.4) / 20, cx = vx + vw / 2, cy = vy + vh / 2;
  const points = BOLT.map(([x, y]) => `${(cx + (x - 11) * k).toFixed(2)},${(cy + (y - 12) * k).toFixed(2)}`).join(' ');
  return `<polygon points="${points}" fill="${color}" stroke="${color}" stroke-width="0.35" stroke-linejoin="round"/>`;
}

// size: [body x,y,w,h,rx], [nub x,y,w,h,rx], [visor x,y,w,h,rx], eye w,h, left x, right x, eye y
const GRID = {
  16: { body: [3, 3, 10, 12, 3.5], nub: [6, 1, 4, 3, 0.75], visor: [4, 5, 8, 5, 1.5], eye: [2, 3, 5, 9, 6] },
  20: { body: [4, 4, 12, 15, 4], nub: [8, 1, 4, 4, 1], visor: [5, 7, 10, 6, 2], eye: [2, 4, 7, 11, 8] },
  24: { body: [5, 4, 14, 19, 4.5], nub: [9, 1, 6, 4, 1.25], visor: [6, 8, 12, 8, 2.5], eye: [2, 4, 9, 13, 9], mouth: [11, 14, 2, 1] },
  32: { body: [7, 6, 18, 24, 6], nub: [12, 2, 8, 5, 1.5], visor: [8, 10, 16, 11, 3], eye: [3, 4, 11, 18, 12], arc: 'M14 17.9Q16 19.5 18 17.9', pips: [12, 15, 18, 25] },
};
let uid = 0;
function flat(size, mood = 'full') {
  const g = GRID[size], id = `${size}${uid += 1}`, c = EYE[mood];
  const [bx, by, bw, bh, brx] = g.body, [nx, ny, nw, nh, nrx] = g.nub, [vx, vy, vw, vh, vrx] = g.visor;
  const [ew, eh, lx, rx, ey] = g.eye;
  let face = '';
  if (mood === 'charge') {
    face += bolt(vx, vy, vw, vh, c);
  } else if (mood === 'full') {
    face += r(lx, ey, ew, eh, Math.min(ew, eh) / 2.2, c) + r(rx, ey, ew, eh, Math.min(ew, eh) / 2.2, c);
    if (g.mouth) face += r(...g.mouth, 0.4, c);
    if (g.arc) face += `<path d="${g.arc}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`;
  } else {
    const y = mood === 'low' ? ey + Math.ceil(eh / 2) - 1 : ey + eh - 2;
    const h = mood === 'low' ? Math.max(1, Math.floor(eh / 2)) : 1;
    face += r(lx, y, ew, h, 0.4, c) + r(rx, y, ew, h, 0.4, c);
  }
  const pips = g.pips ? g.pips.slice(0, 3).map((x, i) => `<rect x="${x}" y="${g.pips[3]}" width="2" height="2" rx="0.7" fill="${(mood === 'low' || mood === 'sleep') && i ? '#aeb5be' : (mood === 'full' || mood === 'charge' ? '#17b784' : c)}"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs(id)}
  ${r(nx, ny, nw, nh, nrx, `url(#c${id})`)}
  ${r(bx, by, bw, bh, brx, LINE)}${r(bx + 1, by + 1, bw - 2, bh - 2, brx - 1, `url(#b${id})`)}
  ${r(vx, vy, vw, vh, vrx, '#070b0e')}${face}${pips}</svg>`;
}
module.exports = { flat, EYE };
