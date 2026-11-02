// Device detail sheet: full battery history and the numbers behind a card.
// Loaded after app.js and shares its globals (state, timeAgo, formatDuration, iconFor,
// positionSegThumbs), plus the battery maths in estimate.js.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 24 * 3600000;
const RANGES = { day: DAY_MS, week: 7 * DAY_MS };
const CHART_HEIGHT = 196;
const CHART_PAD = { top: 10, right: 10, bottom: 24, left: 36 };

const detail = {
  id: null,      // device being shown
  range: 'day',
  points: [],    // chart points in the current range, with x/y in pixels
  hover: null,   // index of the point under the crosshair
  closing: null, // timer while the sheet animates out
  opening: null, // timer until the sheet has landed
};

const sheet = document.getElementById('detail-sheet');
const scrim = document.getElementById('sheet-scrim');
const chartBox = document.getElementById('detail-chart');
const tooltip = document.getElementById('detail-tooltip');

function statusOf(dev) {
  const pct = dev.lastReading ? dev.lastReading.capacity : null;
  if (isOffline(dev)) return { label: 'Not connected', tone: 'off' };
  if (isCharging(dev)) return { label: 'Charging', tone: 'good' };
  if (pct == null) return { label: 'Waiting for a reading', tone: 'off' };
  if (!hasRecentReading(dev)) return { label: 'No recent reading', tone: 'off' };
  if (pct <= 20) return { label: 'Low', tone: 'bad' };
  if (pct <= 45) return { label: 'Getting low', tone: 'warn' };
  return { label: 'Healthy', tone: 'good' };
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function pointsToPath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function formatTick(ts, range) {
  const d = new Date(ts);
  if (range === 'week') return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatMoment(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// Stretches of consecutive charging points, as [firstIndex, lastIndex] pairs.
function chargingSpans(points) {
  const spans = [];
  let start = null;
  points.forEach((p, i) => {
    if (p.ch && start === null) start = i;
    if (!p.ch && start !== null) { spans.push([start, i]); start = null; }
  });
  if (start !== null) spans.push([start, points.length - 1]);
  return spans;
}

function renderChart() {
  const dev = state.saved[detail.id];
  if (!dev) return;
  const width = chartBox.clientWidth;
  if (width === 0) return;

  const now = Date.now();
  const span = RANGES[detail.range];
  const from = now - span;
  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const xOf = (t) => CHART_PAD.left + ((t - from) / span) * plotW;
  const yOf = (c) => CHART_PAD.top + (1 - Math.max(0, Math.min(100, c)) / 100) * plotH;

  detail.points = (dev.history || [])
    .filter((p) => p.t >= from)
    .map((p) => ({ ...p, x: xOf(p.t), y: yOf(p.c) }));
  detail.hover = null;
  tooltip.hidden = true;
  chartBox.replaceChildren();

  const hasData = detail.points.length >= 2;
  const empty = document.getElementById('detail-chart-empty');
  empty.hidden = hasData;
  document.getElementById('detail-chart-key').hidden = !chargingSpans(detail.points).length;
  chartBox.hidden = !hasData;
  if (!hasData) return;

  const svg = svgEl('svg', { width, height: CHART_HEIGHT, viewBox: `0 0 ${width} ${CHART_HEIGHT}`, 'aria-hidden': 'true' });

  for (const level of [0, 50, 100]) {
    const y = yOf(level);
    svg.append(svgEl('line', { class: 'chart-grid', x1: CHART_PAD.left, x2: width - CHART_PAD.right, y1: y, y2: y }));
    svg.append(svgEl('text', { class: 'chart-tick', x: CHART_PAD.left - 8, y: y + 3.5, 'text-anchor': 'end' }, `${level}%`));
  }

  const ticks = detail.range === 'week' ? 7 : 4;
  for (let i = 0; i <= ticks; i++) {
    const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
    const label = i === ticks ? 'Now' : formatTick(from + (span * i) / ticks, detail.range);
    svg.append(svgEl('text', { class: 'chart-tick', x: CHART_PAD.left + (plotW * i) / ticks, y: CHART_HEIGHT - 6, 'text-anchor': anchor }, label));
  }

  for (const [a, b] of chargingSpans(detail.points)) {
    const x = detail.points[a].x;
    svg.append(svgEl('rect', { class: 'chart-charging', x, y: CHART_PAD.top, width: Math.max(2, detail.points[b].x - x), height: plotH }));
  }

  const first = detail.points[0];
  const last = detail.points[detail.points.length - 1];
  const line = pointsToPath(detail.points);
  svg.append(svgEl('path', { class: 'chart-area', d: `${line} L${last.x.toFixed(1)} ${yOf(0)} L${first.x.toFixed(1)} ${yOf(0)} Z` }));
  svg.append(svgEl('path', { class: 'chart-line', d: line }));
  svg.append(svgEl('circle', { class: 'chart-now', cx: last.x, cy: last.y, r: 4 }));

  svg.append(svgEl('line', { class: 'chart-cross', id: 'chart-cross', y1: CHART_PAD.top, y2: CHART_PAD.top + plotH, visibility: 'hidden' }));
  svg.append(svgEl('circle', { class: 'chart-dot', id: 'chart-dot', r: 4, visibility: 'hidden' }));
  chartBox.append(svg);

  const lows = Math.min(...detail.points.map((p) => p.c));
  const highs = Math.max(...detail.points.map((p) => p.c));
  chartBox.setAttribute('aria-label', `Battery from ${first.c}% to ${last.c}%, between ${lows}% and ${highs}%. Use the arrow keys to read each point.`);
}

// Move the crosshair to a point and show its reading.
function showPoint(index) {
  const p = detail.points[index];
  if (!p) return;
  detail.hover = index;
  const cross = document.getElementById('chart-cross');
  const dot = document.getElementById('chart-dot');
  cross.setAttribute('x1', p.x);
  cross.setAttribute('x2', p.x);
  cross.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', p.x);
  dot.setAttribute('cy', p.y);
  dot.setAttribute('visibility', 'visible');

  setText('detail-tooltip-value', `${p.c}%`);
  setText('detail-tooltip-time', formatMoment(p.t));
  document.getElementById('detail-tooltip-state').hidden = !p.ch;
  tooltip.hidden = false;
  const room = chartBox.clientWidth - tooltip.offsetWidth - 4;
  tooltip.style.left = `${Math.max(4, Math.min(room, p.x - tooltip.offsetWidth / 2))}px`;
}

function hidePoint() {
  detail.hover = null;
  tooltip.hidden = true;
  for (const id of ['chart-cross', 'chart-dot']) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('visibility', 'hidden');
  }
}

function nearestPoint(x) {
  let best = 0;
  detail.points.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs(detail.points[best].x - x)) best = i;
  });
  return best;
}

chartBox.addEventListener('pointermove', (e) => {
  if (detail.points.length === 0) return;
  showPoint(nearestPoint(e.clientX - chartBox.getBoundingClientRect().left));
});
chartBox.addEventListener('pointerleave', hidePoint);
chartBox.addEventListener('blur', hidePoint);
chartBox.addEventListener('keydown', (e) => {
  if (detail.points.length === 0) return;
  const lastIndex = detail.points.length - 1;
  const steps = { ArrowLeft: -1, ArrowRight: 1 };
  if (e.key in steps) {
    e.preventDefault();
    const from = detail.hover === null ? lastIndex : detail.hover;
    showPoint(Math.max(0, Math.min(lastIndex, from + steps[e.key])));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    showPoint(e.key === 'Home' ? 0 : lastIndex);
  }
});

function renderDetail() {
  const dev = state.saved[detail.id];
  if (!dev) { closeDetail(); return; }

  const pct = dev.lastReading ? dev.lastReading.capacity : null;
  const status = statusOf(dev);
  const charging = isCharging(dev);
  const offline = isOffline(dev);
  const rate = drainRatePerHour(dev.history);
  const hoursLeft = estimateHoursLeft(dev.history, pct);
  const charged = lastChargedAt(dev.history);
  const voltage = dev.lastReading && dev.lastReading.voltageMv;

  paintDeviceIcon(document.getElementById('detail-icon'), dev);
  setText('detail-name', dev.customName || dev.product || 'Device');
  setText('detail-maker', dev.manufacturer || '');
  setText('detail-pct', pct == null ? '—' : `${pct}%`);
  setText('detail-status', status.label);
  document.getElementById('detail-status-wrap').dataset.tone = status.tone;

  let left = 'Still learning';
  if (charging) left = 'Charging';
  else if (offline || !hasRecentReading(dev)) left = '—';
  else if (hoursLeft != null) left = `~${formatDuration(hoursLeft)}`;
  setText('detail-left', left);
  setText('detail-rate', rate ? `${(rate * 24).toFixed(1)}% a day` : 'Still learning');
  setText('detail-charged', charging ? 'Now' : charged ? timeAgo(charged) : 'Not recently');
  setText('detail-updated', timeAgo(dev.lastReadingAt));
  document.getElementById('detail-voltage-row').hidden = !voltage;
  if (voltage) setText('detail-voltage', `${(voltage / 1000).toFixed(2)} V`);

  renderAlert(dev);
  offerReadReport(dev);

  // Keep a reading the user is hovering rather than redrawing it out from under them.
  if (detail.hover === null && !detail.opening) renderChart();
}

// The device's own low battery level. Empty means it follows Settings.
function renderAlert(dev) {
  const custom = typeof dev.alertThreshold === 'number';
  const fallback = currentSettings.notifyThreshold ?? 20;
  document.querySelectorAll('#detail-alert-mode button').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === (custom ? 'custom' : 'default'));
  });
  document.getElementById('detail-alert-stepper').hidden = !custom;
  const input = document.getElementById('detail-alert-value');
  if (custom && document.activeElement !== input) input.value = dev.alertThreshold;
  let hint = custom ? 'Alert at or below' : `Same as Settings (${fallback}%)`;
  if (currentSettings.notifyEnabled === false) hint = 'Low battery alerts are off in Settings';
  setText('detail-alert-hint', hint);
}

async function saveAlert(threshold) {
  const dev = state.saved[detail.id];
  if (!dev) return;
  dev.alertThreshold = threshold;
  renderAlert(dev);
  positionSegThumbs(sheet);
  await window.batteryHub.setDeviceAlert(dev.id, threshold);
}

function openDetail(id) {
  clearTimeout(detail.closing);
  detail.id = id;
  scrim.hidden = false;
  sheet.hidden = false;
  sheet.classList.remove('closing');
  scrim.classList.remove('closing');
  // Drawing the chart is the slow part, so it waits until the panel has landed.
  clearTimeout(detail.opening);
  document.getElementById('detail-chart').replaceChildren();
  detail.opening = setTimeout(() => {
    detail.opening = null;
    if (detail.id !== null) renderChart();
  }, 260);
  renderDetail();
  positionSegThumbs(sheet);
  document.getElementById('detail-close').focus({ preventScroll: true });
}

function closeDetail() {
  if (detail.id === null) return;
  const card = state.cardEls.get(detail.id);
  detail.id = null;
  sheet.classList.add('closing');
  scrim.classList.add('closing');
  detail.closing = setTimeout(() => {
    sheet.hidden = true;
    scrim.hidden = true;
  }, 170);
  if (card) card.el.focus();
}

function updateDetail(id) {
  if (id === detail.id) renderDetail();
}

document.getElementById('detail-close').addEventListener('click', closeDetail);
scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
});

document.querySelectorAll('#detail-range button').forEach((button) => {
  button.addEventListener('click', () => {
    detail.range = button.dataset.value;
    document.querySelectorAll('#detail-range button').forEach((b) => b.classList.toggle('active', b === button));
    positionSegThumbs(sheet);
    hidePoint();
    renderChart();
  });
});

document.querySelectorAll('#detail-alert-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    const dev = state.saved[detail.id];
    if (!dev) return;
    if (button.dataset.value === 'default') saveAlert(null);
    else if (typeof dev.alertThreshold !== 'number') saveAlert(currentSettings.notifyThreshold ?? 20);
  });
});

document.getElementById('detail-alert-value').addEventListener('change', (e) => {
  const input = e.target;
  let v = Math.round(Number(input.value) / 5) * 5;
  if (Number.isNaN(v)) v = currentSettings.notifyThreshold ?? 20;
  v = Math.max(5, Math.min(95, v));
  input.value = v;
  saveAlert(v);
});

window.addEventListener('resize', () => { if (detail.id !== null) renderChart(); });
setInterval(() => { if (detail.id !== null) renderDetail(); }, 15000);
