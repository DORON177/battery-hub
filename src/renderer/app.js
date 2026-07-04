const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52;

const state = {
  view: 'dashboard',
  saved: {},
  live: [],
  cardEls: new Map(),
  calibration: null,
};

function iconFor(product, driverId) {
  const p = (product || '').toLowerCase();
  if (driverId === 'mchose' || p.includes('headset') || p.includes('headphone') || p.includes('earbud') || p.includes('buds')) return '🎧';
  if (driverId === 'kysona' || p.includes('mouse')) return '🖱️';
  if (p.includes('keyboard')) return '⌨️';
  if (p.includes('controller') || p.includes('gamepad') || p.includes('dualsense')) return '🎮';
  return '🔌';
}

function pctColor(pct) {
  if (pct == null) return 'var(--text-secondary)';
  if (pct <= 20) return 'var(--red)';
  if (pct <= 45) return 'var(--yellow)';
  return 'var(--green)';
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------- battery history ----------

// Even-spaced polyline over the most recent samples (y inverted: 100% at top).
function buildSparkPoints(history) {
  const pts = (history || []).slice(-40);
  if (pts.length < 2) return null;
  const n = pts.length;
  return pts.map((p, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 30 - (Math.max(0, Math.min(100, p.c)) / 100) * 30;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function sparkColor(pct, charging) {
  if (charging) return 'var(--green)';
  if (pct == null) return 'var(--text-tertiary)';
  if (pct <= 20) return 'var(--red)';
  if (pct <= 45) return 'var(--yellow)';
  return 'var(--green)';
}

function formatDuration(hours) {
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = Math.round(hours - d * 24);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.max(5, Math.round(hours * 60))}m`;
}

// Rough linear time-to-empty from recent discharging samples; null if too little signal.
function estimateHoursLeft(history) {
  if (!history || history.length < 2) return null;
  const now = Date.now();
  const recent = history.filter((p) => p.t >= now - 24 * 3600 * 1000 && !p.ch);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const hours = (last.t - first.t) / 3600000;
  const drop = first.c - last.c;
  if (hours < 0.5 || drop < 2) return null; // need a real downward trend
  const ratePerHour = drop / hours;
  if (ratePerHour <= 0) return null;
  return last.c / ratePerHour;
}

function renderHistory(card, dev, charging, offline) {
  const points = offline ? null : buildSparkPoints(dev.history);
  if (points) {
    card.sparkLine.setAttribute('points', points);
    const pct = dev.lastReading ? dev.lastReading.capacity : null;
    card.sparkWrap.style.setProperty('--spark', sparkColor(pct, charging));
    card.sparkWrap.hidden = false;
  } else {
    card.sparkWrap.hidden = true;
  }

  let est = '';
  if (!offline && !charging) {
    const hoursLeft = estimateHoursLeft(dev.history);
    if (hoursLeft != null) est = `~${formatDuration(hoursLeft)} left`;
  }
  card.estimateEl.textContent = est;
}

// ---------- window controls ----------

document.getElementById('win-min').addEventListener('click', () => window.batteryHub.minimizeWindow && window.batteryHub.minimizeWindow());
document.getElementById('win-close').addEventListener('click', () => window.batteryHub.closeWindow && window.batteryHub.closeWindow());

// ---------- navigation ----------

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  if (view === 'dashboard') refreshDashboard();
  if (view === 'discover') refreshDiscover();
  if (view === 'settings') refreshSettings();
}

document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
  el.addEventListener('click', () => switchView(el.dataset.view));
});

// ---------- dashboard ----------

async function refreshDashboard() {
  state.saved = await window.batteryHub.listSavedDevices();
  const grid = document.getElementById('device-grid');
  const empty = document.getElementById('dashboard-empty');
  const count = document.getElementById('dashboard-count');
  const ids = Object.keys(state.saved).sort(
    (a, b) => (state.saved[a].order ?? 1e9) - (state.saved[b].order ?? 1e9)
  );

  empty.hidden = ids.length > 0;
  count.textContent = ids.length
    ? `${ids.length} device${ids.length > 1 ? 's' : ''} monitored`
    : '';
  grid.innerHTML = '';
  state.cardEls.clear();

  ids.forEach((id, i) => {
    const card = buildDeviceCard(state.saved[id]);
    card.el.style.setProperty('--i', i);
    grid.appendChild(card.el);
    state.cardEls.set(id, card);
  });
}

// ---------- drag-to-reorder ----------

function wireGridDnd() {
  const grid = document.getElementById('device-grid');
  grid.addEventListener('dragover', (e) => {
    const dragging = grid.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const after = getDragAfterElement(grid, e.clientX, e.clientY);
    if (after == null) grid.appendChild(dragging);
    else if (after !== dragging) grid.insertBefore(dragging, after);
  });
  grid.addEventListener('drop', (e) => e.preventDefault());
}

// First card whose center sits after the pointer in row-major order; null => append last.
function getDragAfterElement(container, x, y) {
  const els = [...container.querySelectorAll('.device-card:not(.dragging)')];
  for (const el of els) {
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    if (y < cy - 4 || (Math.abs(y - cy) <= b.height / 2 && x < cx)) return el;
  }
  return null;
}

async function persistCardOrder() {
  const grid = document.getElementById('device-grid');
  const order = [...grid.querySelectorAll('.device-card')].map((c) => c.dataset.id);
  order.forEach((id, i) => { if (state.saved[id]) state.saved[id].order = i; });
  await window.batteryHub.reorderDevices(order);
}

function buildDeviceCard(dev) {
  const tpl = document.getElementById('device-card-template');
  const el = tpl.content.firstElementChild.cloneNode(true);

  el.dataset.id = dev.id;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dev.id); } catch (_) {}
    // Apply the hidden-source style only AFTER the browser has snapshotted the drag
    // image, otherwise the card you're dragging would be hidden too. This leaves just the
    // drag image floating and a clean gap at the origin (no half-opacity duplicate).
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    persistCardOrder();
  });

  el.querySelector('.device-name').textContent = dev.customName || dev.product || 'Device';
  el.querySelector('.device-type-icon').textContent = iconFor(dev.product, dev.driverId);

  const menuBtn = el.querySelector('.menu-btn');
  const dropdown = el.querySelector('.menu-dropdown');
  const recalBtn = el.querySelector('.menu-recalibrate');
  // Recalibrate only makes sense for hand-calibrated (generic) devices.
  if (dev.driverId !== 'generic') recalBtn.remove();

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.menu-dropdown').forEach((d) => { if (d !== dropdown) d.hidden = true; });
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener('click', () => { dropdown.hidden = true; });

  el.querySelector('.menu-refresh').addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = true;
    triggerRefresh();
  });
  el.querySelector('.menu-rename').addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = true;
    startRename(card, dev);
  });
  el.querySelector('.menu-remove').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.batteryHub.removeDevice(dev.id);
    refreshDashboard();
  });
  if (recalBtn.isConnected) {
    recalBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.hidden = true;
      await startCalibration(dev.id, dev.product, dev.manufacturer);
    });
  }

  const gaugeFill = el.querySelector('.gauge-fill');
  gaugeFill.style.strokeDasharray = `${GAUGE_CIRCUMFERENCE}`;

  const card = {
    el,
    gaugeFill,
    gaugeWrap: el.querySelector('.gauge-wrap'),
    pctLabel: el.querySelector('.gauge-pct'),
    bolt: el.querySelector('.gauge-bolt'),
    subEl: el.querySelector('.device-sub'),
    estimateEl: el.querySelector('.device-estimate'),
    sparkWrap: el.querySelector('.sparkline'),
    sparkLine: el.querySelector('.spark-line'),
    lastPct: null,
  };
  applyReading(card, dev);
  return card;
}

const GRAD_HIGH = 'linear-gradient(135deg, #30d158, #63e6be)';
const GRAD_MID = 'linear-gradient(135deg, #ff9f0a, #ffd60a)';
const GRAD_LOW = 'linear-gradient(135deg, #ff5f6d, #ff453a)';

function gaugeStyleFor(pct, charging, offline) {
  if (offline) return { stroke: 'var(--text-tertiary)', glow: 'transparent', text: 'linear-gradient(180deg, #8e8e93, #8e8e93)' };
  if (charging) return { stroke: 'url(#gradHigh)', glow: 'rgba(52, 199, 89, 0.55)', text: GRAD_HIGH };
  if (pct <= 20) return { stroke: 'url(#gradLow)', glow: 'rgba(255, 69, 58, 0.5)', text: GRAD_LOW };
  if (pct <= 45) return { stroke: 'url(#gradMid)', glow: 'rgba(255, 159, 10, 0.45)', text: GRAD_MID };
  return { stroke: 'url(#gradHigh)', glow: 'rgba(52, 199, 89, 0.4)', text: GRAD_HIGH };
}

// Smoothly counts the percentage label from its previous value to the new one.
function animatePct(card, to) {
  const from = card.lastPct;
  card.lastPct = to;
  if (from == null || from === to) {
    card.pctLabel.textContent = `${to}%`;
    return;
  }
  const start = performance.now();
  const dur = 600;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    card.pctLabel.textContent = `${Math.round(from + (to - from) * eased)}%`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function applyReading(card, dev) {
  const reading = dev.lastReading;
  const pct = reading ? reading.capacity : null;
  const offline = dev.online === false;
  const charging = !!(reading && reading.charging) && !offline;

  card.el.classList.toggle('offline', offline);
  card.el.classList.toggle('charging', charging);
  card.pctLabel.classList.remove('small');

  if (pct == null) {
    card.lastPct = null;
    card.pctLabel.textContent = offline ? 'off' : '…';
    card.pctLabel.classList.add('small');
    card.gaugeFill.style.strokeDashoffset = `${GAUGE_CIRCUMFERENCE}`;
    card.gaugeWrap.style.setProperty('--glow', 'transparent');
  } else {
    animatePct(card, pct);
    const offset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
    card.gaugeFill.style.strokeDashoffset = `${offset}`;
    const style = gaugeStyleFor(pct, charging, offline);
    card.gaugeFill.style.stroke = style.stroke;
    card.gaugeWrap.style.setProperty('--glow', style.glow);
    card.pctLabel.style.setProperty('--pct-grad', style.text);
  }

  card.bolt.classList.toggle('show', charging);

  // Keep showing the last known value with a friendly status; only surface an error
  // if we have never gotten a reading.
  let sub;
  if (offline) {
    sub = 'Not connected';
  } else if (reading) {
    sub = `Updated ${timeAgo(dev.lastReadingAt)}`;
  } else if (dev.lastError && /waiting/i.test(dev.lastError)) {
    sub = 'Waiting for update…';
  } else if (dev.lastError && /cannot write|write to hid/i.test(dev.lastError)) {
    sub = "Can't read this device's battery";
  } else {
    sub = dev.lastError || 'Waiting…';
  }
  card.subEl.textContent = sub;

  renderHistory(card, dev, charging, offline);
}

window.batteryHub.onBatteryUpdate((dev) => {
  state.saved[dev.id] = dev;
  const card = state.cardEls.get(dev.id);
  if (card) applyReading(card, dev);
});

async function triggerRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn.classList.contains('spinning')) return;
  btn.classList.add('spinning');
  try {
    await window.batteryHub.pollNow();
  } finally {
    setTimeout(() => btn.classList.remove('spinning'), 500);
  }
}

document.getElementById('refresh-btn').addEventListener('click', triggerRefresh);

// ---------- discover ----------

async function refreshDiscover() {
  const [live, saved] = await Promise.all([
    window.batteryHub.listLiveDevices(),
    window.batteryHub.listSavedDevices(),
  ]);
  state.live = live;
  const list = document.getElementById('discover-list');
  list.innerHTML = '';

  const unadded = live.filter((d) => !saved[d.id]);
  if (unadded.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-title">No new devices</p><p class="empty-desc">Plug something in and hit Rescan.</p></div>';
    return;
  }

  for (const d of unadded) {
    const row = document.createElement('div');
    row.className = 'list-item';
    const badge = d.suggestedDriver ? '<span class="badge">auto-detected</span>' : '';
    row.innerHTML = `
      <div class="list-item-main">
        <span class="list-item-emoji">${iconFor(d.product, d.suggestedDriver)}</span>
        <div class="list-item-info">
          <div class="list-item-title">${escapeHtml(d.product)}${badge}</div>
          <div class="list-item-sub">${escapeHtml(d.manufacturer || 'Unknown manufacturer')} · ${d.channelCount} channels</div>
        </div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = d.suggestedDriver ? 'Add' : 'Calibrate & Add';
    btn.addEventListener('click', async () => {
      if (d.suggestedDriver) {
        btn.disabled = true;
        btn.textContent = 'Adding…';
        await window.batteryHub.addDevice({
          id: d.id,
          driverId: d.suggestedDriver,
          profile: null,
          product: d.product,
          manufacturer: d.manufacturer,
        });
        switchView('dashboard');
      } else {
        await startCalibration(d.id, d.product, d.manufacturer);
      }
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

document.getElementById('rescan-btn').addEventListener('click', refreshDiscover);

// ---------- calibration wizard ----------

async function startCalibration(id, product, manufacturer) {
  state.calibration = { id, product, manufacturer, frames: [], selected: null };
  switchView('calibrate');
  document.getElementById('calibrate-title').textContent = `Calibrate: ${product}`;
  const body = document.getElementById('calibrate-body');
  body.innerHTML = `
    <div class="step-card">
      <div class="step-title">Step 1 — Scan for the device's signal</div>
      <div class="step-desc">
        Battery Hub will listen to this device for <b>30 seconds</b> and record everything it sends.
      </div>
      <div class="scan-tip">
        <span class="scan-tip-icon">🔌</span>
        <div>
          <b>While it's scanning, turn the device off and back on</b> — once or twice.
          Many wireless devices only report their battery the moment they power on, so this is
          the surest way to catch it. If the device has its own app showing the battery %, keep
          it open too.
        </div>
      </div>
      <button class="btn btn-primary" id="start-capture-btn">Start 30-second Scan</button>
    </div>
    <div id="capture-results"></div>
  `;
  document.getElementById('start-capture-btn').addEventListener('click', runCapture);
}

const SCAN_SECONDS = 30;

async function runCapture() {
  const btn = document.getElementById('start-capture-btn');
  const results = document.getElementById('capture-results');
  btn.disabled = true;
  btn.textContent = 'Scanning…';

  // Live countdown + progress bar while the (30s) scan runs.
  results.innerHTML = `
    <div class="step-card scan-live">
      <div class="scan-live-head">
        <span class="spinner"></span>
        <span>Listening… <b>turn your device off and on now</b></span>
      </div>
      <div class="scan-progress"><div class="scan-bar" id="scan-bar"></div></div>
      <div class="scan-remaining"><span id="scan-timer">${SCAN_SECONDS}</span>s remaining</div>
    </div>
  `;
  const bar = document.getElementById('scan-bar');
  const timerEl = document.getElementById('scan-timer');
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, SCAN_SECONDS - elapsed);
    if (timerEl) timerEl.textContent = Math.ceil(remaining);
    if (bar) bar.style.width = `${Math.min(100, (elapsed / SCAN_SECONDS) * 100)}%`;
  }, 100);

  let frames = [];
  try {
    frames = await window.batteryHub.capture(state.calibration.id);
  } catch (e) {
    clearInterval(ticker);
    results.innerHTML = `<div class="step-card"><div class="step-desc">Scan failed: ${escapeHtml(e.message)}</div></div>`;
    btn.disabled = false;
    btn.textContent = 'Scan Again';
    return;
  }

  clearInterval(ticker);
  btn.disabled = false;
  btn.textContent = 'Scan Again';
  state.calibration.frames = frames;
  renderCaptureResults();
}

function renderCaptureResults() {
  const { frames } = state.calibration;
  const container = document.getElementById('capture-results');

  if (frames.length === 0) {
    container.innerHTML = `<div class="step-card"><div class="step-desc">No signal captured. Make sure the device (or its USB receiver) is connected, then run the scan again — and this time <b>turn the device off and back on</b> a couple of times while it scans.</div></div>`;
    return;
  }

  const rows = frames.map((f, idx) => {
    const cells = f.bytes.map((b, byteIdx) =>
      `<div class="byte-cell" data-frame="${idx}" data-byte="${byteIdx}">${b}</div>`
    ).join('');
    return `
      <div class="frame-row">
        <div class="frame-row-head">channel 0x${f.usagePage.toString(16)} · ${f.reportKind} report ${f.reportId} · seen ${f.count}×</div>
        <div class="byte-grid">${cells}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="step-card">
      <div class="step-title">Step 2 — Pick the battery byte</div>
      <div class="step-desc">
        Each row is one distinct message this device sent. Click the number that matches (or tracks) the battery percentage —
        commonly a value between 0 and 100.
      </div>
      <div class="frame-table">${rows}</div>
    </div>
    <div class="step-card" id="calibrate-form-card" hidden>
      <div class="step-title">Step 3 — Confirm the value</div>
      <div class="calibrate-form">
        <div class="form-row">
          <label>Raw value right now:</label>
          <span id="raw-value-display" style="font-weight:700"></span>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="passthrough-check" checked />
          <label for="passthrough-check">This number already IS the battery percentage</label>
        </div>
        <div class="form-row" id="known-pct-row" hidden>
          <label>Actual battery % right now (check the device's own app):</label>
          <input type="number" id="known-pct-input" min="1" max="100" value="100" />
        </div>
        <button class="btn btn-primary" id="save-calibration-btn">Save &amp; Add Device</button>
      </div>
    </div>
  `;

  container.querySelectorAll('.byte-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      container.querySelectorAll('.byte-cell').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
      const frameIdx = Number(cell.dataset.frame);
      const byteIdx = Number(cell.dataset.byte);
      state.calibration.selected = { frameIdx, byteIdx };
      const raw = frames[frameIdx].bytes[byteIdx];
      document.getElementById('calibrate-form-card').hidden = false;
      document.getElementById('raw-value-display').textContent = raw;
    });
  });

  container.addEventListener('change', (e) => {
    if (e.target.id === 'passthrough-check') {
      document.getElementById('known-pct-row').hidden = e.target.checked;
    }
  });

  container.addEventListener('click', async (e) => {
    if (e.target.id !== 'save-calibration-btn') return;
    const { frameIdx, byteIdx } = state.calibration.selected;
    const frame = frames[frameIdx];
    const raw = frame.bytes[byteIdx];
    const isPassthrough = document.getElementById('passthrough-check').checked;
    const knownPct = Number(document.getElementById('known-pct-input').value) || 100;

    let scaleMin = 0;
    let scaleMax = 100;
    if (!isPassthrough) {
      scaleMax = knownPct > 0 ? Math.round((raw * 100) / knownPct) : raw;
    }

    const profile = {
      usagePage: frame.usagePage,
      reportKind: frame.reportKind,
      reportId: frame.reportId,
      readLength: frame.bytes.length,
      trigger: frame.reportKind === 'input' ? Array(frame.bytes.length).fill(0) : null,
      byteOffset: byteIdx,
      scaleMin,
      scaleMax,
    };

    e.target.disabled = true;
    e.target.textContent = 'Saving…';
    await window.batteryHub.addDevice({
      id: state.calibration.id,
      driverId: 'generic',
      profile,
      product: state.calibration.product,
      manufacturer: state.calibration.manufacturer,
    });
    switchView('dashboard');
  });
}

document.getElementById('calibrate-back').addEventListener('click', () => switchView('discover'));

// ---------- rename ----------

function startRename(card, dev) {
  const nameEl = card.el.querySelector('.device-name');
  if (!nameEl || nameEl.tagName === 'INPUT') return;
  card.el.draggable = false; // let the text field take focus/selection while editing
  const input = document.createElement('input');
  input.className = 'name-edit';
  input.value = dev.customName || dev.product || '';
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    if (save) await window.batteryHub.renameDevice(dev.id, input.value.trim());
    refreshDashboard();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
    else if (ev.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

// ---------- settings ----------

const currentSettings = {};

function applyClientSettings(s) {
  document.body.classList.toggle('density-compact', s.density === 'compact');
  document.documentElement.style.setProperty('--accent', s.accent || '#0a84ff');
}

function reflectSettingControls(s) {
  document.querySelectorAll('.toggle[data-setting]').forEach((t) => {
    t.classList.toggle('on', !!s[t.dataset.setting]);
  });
  document.querySelectorAll('.segmented[data-setting]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === s[seg.dataset.setting]));
  });
  document.querySelectorAll('.swatches[data-setting]').forEach((sw) => {
    sw.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === s[sw.dataset.setting]));
  });
  document.querySelectorAll('input[data-setting]').forEach((inp) => {
    inp.value = s[inp.dataset.setting];
  });
  document.querySelectorAll('.settings-row[data-depends]').forEach((row) => {
    row.classList.toggle('disabled', !s[row.dataset.depends]);
  });
}

async function updateSetting(key, value) {
  const s = await window.batteryHub.setSettings({ [key]: value });
  Object.assign(currentSettings, s);
  applyClientSettings(s);
  reflectSettingControls(s);
}

function wireSettingsControls() {
  document.querySelectorAll('.toggle[data-setting]').forEach((t) => {
    t.addEventListener('click', () => updateSetting(t.dataset.setting, !currentSettings[t.dataset.setting]));
  });
  document.querySelectorAll('.segmented[data-setting] button').forEach((b) => {
    b.addEventListener('click', () => updateSetting(b.parentElement.dataset.setting, b.dataset.value));
  });
  document.querySelectorAll('.swatches[data-setting] button').forEach((b) => {
    b.addEventListener('click', () => updateSetting(b.parentElement.dataset.setting, b.dataset.value));
  });
  document.querySelectorAll('input[data-setting]').forEach((inp) => {
    inp.addEventListener('change', () => {
      let v = Number(inp.value);
      const min = Number(inp.min);
      const max = Number(inp.max);
      if (Number.isNaN(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      inp.value = v;
      updateSetting(inp.dataset.setting, v);
    });
  });
  const quitBtn = document.getElementById('quit-app-btn');
  if (quitBtn) quitBtn.addEventListener('click', () => window.batteryHub.quitApp && window.batteryHub.quitApp());
}

async function loadSettings() {
  const s = await window.batteryHub.getSettings();
  Object.assign(currentSettings, s);
  applyClientSettings(s);
  reflectSettingControls(s);
}

async function refreshSettings() {
  await loadSettings();
}

// ---------- about / updates ----------

async function initAbout() {
  const versionEl = document.getElementById('app-version');
  if (versionEl && window.batteryHub.getVersion) {
    try { versionEl.textContent = `Version ${await window.batteryHub.getVersion()}`; } catch (_) {}
  }

  const btn = document.getElementById('check-updates-btn');
  const row = document.getElementById('update-status-row');
  const titleEl = document.getElementById('update-status-title');
  const hintEl = document.getElementById('update-status-hint');
  const installBtn = document.getElementById('install-update-btn');
  if (!btn || !window.batteryHub.checkForUpdates) return;

  let manual = false; // whether the in-flight check was user-initiated (verbose vs quiet)

  const show = (title, hint, showInstall) => {
    row.hidden = false;
    titleEl.textContent = title;
    hintEl.textContent = hint || '';
    installBtn.hidden = !showInstall;
  };
  const hideRow = () => { row.hidden = true; installBtn.hidden = true; };
  const resetBtn = () => { btn.disabled = false; btn.textContent = 'Check for updates'; };

  // Real update progress arrives asynchronously from electron-updater via this channel.
  if (window.batteryHub.onUpdateEvent) {
    window.batteryHub.onUpdateEvent((e) => {
      switch (e.status) {
        case 'checking': if (manual) show('Checking for updates…', ''); break;
        case 'available': show(`Update available — v${e.version}`, 'Downloading in the background…', false); break;
        case 'downloading': show('Downloading update…', `${e.percent}%`, false); break;
        case 'downloaded':
          show(`Update ready — v${e.version}`, 'Restart to finish installing.', true);
          installBtn.onclick = () => window.batteryHub.installUpdate();
          break;
        case 'not-available': manual ? show("You're up to date", 'You have the latest version.', false) : hideRow(); break;
        case 'error': manual ? show("Couldn't check for updates", e.message || '', false) : hideRow(); break;
      }
      resetBtn();
    });
  }

  // The Download/Restart button only ever appears when an update is downloaded (i.e. you're
  // not up to date). When up to date, the row stays hidden on the automatic check.
  async function runCheck(isManual) {
    manual = isManual;
    if (isManual) { btn.disabled = true; btn.textContent = 'Checking…'; show('Checking for updates…', ''); installBtn.hidden = true; }
    let r;
    try { r = await window.batteryHub.checkForUpdates(); }
    catch (e) { r = { status: 'error', message: e.message }; }
    if (r && r.status === 'dev') { if (isManual) show('Updates run automatically in the installed app', `v${r.version}`, false); resetBtn(); }
    else if (r && r.status === 'error') { if (isManual) show("Couldn't check for updates", r.message || '', false); resetBtn(); }
    // 'checking' -> real result comes through onUpdateEvent
  }

  btn.addEventListener('click', () => runCheck(true));
  runCheck(false); // silent auto-check on load
}

// ---------- boot ----------

// Keep the "Updated Xs ago" labels ticking between polls.
setInterval(() => {
  for (const [id, card] of state.cardEls) {
    const dev = state.saved[id];
    if (dev) applyReading(card, dev);
  }
}, 15000);

(async () => {
  wireSettingsControls();
  wireGridDnd();
  initAbout();
  await loadSettings();
  await refreshDashboard();
})();
