// Fills the tray flyout. Device names go through textContent like everywhere else.
const rows = document.getElementById('rows');
const panel = document.getElementById('panel');

function row(d, n) {
  const off = d.offline || d.capacity == null;
  const el = document.createElement('div');
  el.className = off ? 'row off' : 'row';
  el.style.setProperty('--n', n);
  if (!off && !d.charging) el.dataset.tone = d.capacity <= 10 ? 'bad' : d.capacity <= 20 ? 'warn' : 'ok';
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.innerHTML = iconSvg(deviceIconName(d), 18);
  const body = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  const label = document.createElement('span');
  label.textContent = d.name;
  name.append(label);
  if (d.charging && !off) name.insertAdjacentHTML('beforeend', iconSvg('flash', 13));
  const track = document.createElement('div');
  track.className = 'track';
  const fill = document.createElement('span');
  fill.className = 'fill';
  fill.style.width = `${off ? 0 : d.capacity}%`;
  track.append(fill);
  body.append(name, track);
  const pct = document.createElement('div');
  pct.className = 'pct';
  pct.textContent = off ? 'Off' : `${d.capacity}%`;
  el.append(icon, body, pct);
  return el;
}

function render(items) {
  rows.replaceChildren(...items.map(row));
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Add a device to see it here.';
    rows.append(p);
  }
}

window.batteryHub.onFlyoutData(render);
let settle = null;
window.batteryHub.onFlyoutOpen((animated) => {
  clearTimeout(settle);
  panel.classList.remove('enter', 'leave');
  if (!animated) return;
  void panel.offsetWidth; // restart the entrance animation
  panel.classList.add('enter');
  settle = setTimeout(() => panel.classList.remove('enter'), 900);
});
window.batteryHub.onFlyoutClose(() => {
  clearTimeout(settle);
  panel.classList.remove('enter');
  panel.classList.add('leave');
});
window.batteryHub.getFlyoutData().then(render);
document.getElementById('open-app').addEventListener('click', () => window.batteryHub.openApp());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.batteryHub.hideFlyout(); });
