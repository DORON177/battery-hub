// Runs the check and sends reports: the Help panel in Settings, and the Send device report button
// that appears when a device keeps failing.
// Text from the check goes through textContent like everywhere else.
const supportRun = document.getElementById('support-run-btn');
const supportResults = document.getElementById('support-results');
const CHECK_ICONS = { ok: 'checkOk', warn: 'checkWarn', fail: 'checkFail' };
const SCANS_BEFORE_REPORT = 2;
const FRAMES_TO_KEEP = 40;
const PRIVACY_NOTE = 'You need a free GitHub account. Issues are public, so your user name, device serials and Bluetooth details are left out.';
const SEND_NOTE = `Opens GitHub with the report filled in. Nothing is posted until you submit it there. ${PRIVACY_NOTE}`;
const SENT_NOTE = `Your browser opened with the report filled in. Nothing is posted until you submit it there. ${PRIVACY_NOTE}`;
const LONG_NOTE = ' This report is too long for a link, so the full version is also copied for you to paste in.';
const plainError = (e) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const scanHistory = new Map(); // device id -> { scans, frames }, for this run of the app

function supportText(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function renderCheck(item) {
  const row = document.createElement('div');
  row.className = 'check-row';
  row.dataset.status = item.status;
  const icon = document.createElement('span');
  icon.className = 'check-icon';
  icon.innerHTML = iconSvg(CHECK_ICONS[item.status], 18);
  const body = document.createElement('div');
  body.className = 'check-body';
  body.append(supportText('div', 'check-title', item.title), supportText('div', 'check-detail', item.detail));
  if (item.fix) body.append(supportText('div', 'check-fix', item.fix));
  row.append(icon, body);
  return row;
}

function copyButton(report) {
  const copy = document.createElement('button');
  copy.className = 'btn btn-ghost';
  copy.textContent = 'Copy report';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(report);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy report'; }, 1500);
  });
  return copy;
}

async function openReport(result, note) {
  try {
    if (!result.complete) await navigator.clipboard.writeText(result.report);
    await window.batteryHub.openExternal(result.url);
  } catch (_) {
    note.textContent = 'Your browser didn\'t open. Use Copy report and paste it into a new issue on GitHub.';
  }
}

function checkActions(...buttons) {
  const actions = document.createElement('div');
  actions.className = 'check-actions';
  actions.append(...buttons);
  return actions;
}

function renderResults(result, target = supportResults, sendLabel = 'Send support request') {
  const verdict = document.createElement('div');
  verdict.className = 'check-verdict';
  verdict.dataset.tone = result.verdict.tone;
  verdict.append(supportText('div', 'check-verdict-title', result.verdict.title), supportText('div', 'check-detail', result.verdict.detail));

  const list = document.createElement('div');
  list.className = 'check-list';
  list.append(...result.checks.map(renderCheck));

  const preview = document.createElement('details');
  preview.className = 'check-report';
  preview.append(
    supportText('summary', '', 'See exactly what the report contains'),
    supportText('pre', '', result.report),
  );

  const note = supportText('div', 'check-note', result.complete ? SEND_NOTE : SEND_NOTE + LONG_NOTE);
  const send = document.createElement('button');
  send.className = 'btn btn-primary';
  send.textContent = sendLabel;
  send.addEventListener('click', () => openReport(result, note));

  target.replaceChildren(verdict, list, preview, checkActions(copyButton(result.report), send), note);
  target.hidden = false;
}

async function sendDeviceReport(button, request, target) {
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const result = await window.batteryHub.deviceReport(request);
    if (result.verdict.tone === 'bad') {
      // The fault looks to be on their end, so show them the fix before anything else.
      renderResults(result, target, 'Send anyway');
    } else {
      const note = supportText('div', 'check-note', result.complete ? SENT_NOTE : SENT_NOTE + LONG_NOTE);
      target.replaceChildren(note, checkActions(copyButton(result.report)));
      await openReport(result, note);
    }
  } catch (e) {
    target.replaceChildren(supportText('div', 'check-detail', `The report couldn't be made: ${plainError(e)}`));
  } finally {
    button.disabled = false;
    button.textContent = 'Send device report';
    target.scrollIntoView({ block: 'nearest' });
  }
}

function deviceReportCard(request) {
  const card = document.createElement('div');
  card.className = 'step-card';
  const button = document.createElement('button');
  button.className = 'btn btn-primary';
  button.textContent = 'Send device report';
  const result = document.createElement('div');
  result.className = 'device-report-result';
  button.addEventListener('click', () => sendDeviceReport(button, request, result));
  card.append(
    supportText('div', 'step-title', 'Still not working?'),
    supportText('div', 'step-desc', 'Send a report on this device and we\'ll take a look.'),
    button,
    result,
  );
  return card;
}

function offerScanReport(device) {
  const history = scanHistory.get(device.id);
  if (!history || history.scans.length < SCANS_BEFORE_REPORT) return;
  const { id, product, manufacturer } = device;
  document.getElementById('scan-report').replaceChildren(deviceReportCard({ id, product, manufacturer, ...history }));
}

function noteScan(device, frames, error) {
  const history = scanHistory.get(device.id) || { scans: [], frames: [] };
  history.scans.push({ captured: frames.length, error });
  if (frames.length) history.frames = frames.slice(0, FRAMES_TO_KEEP);
  scanHistory.set(device.id, history);
  offerScanReport(device);
}

// Called on every update of the detail panel, so it only touches the card when the answer changes
// and a report in progress stays on screen.
function offerReadReport(dev) {
  const slot = document.getElementById('detail-report');
  const wanted = dev.failedReads >= READS_BEFORE_REPORT ? dev.id : '';
  if (slot.dataset.device === wanted) return;
  slot.dataset.device = wanted;
  const { id, product, manufacturer, driverId, lastError, failedReads } = dev;
  slot.replaceChildren(...(wanted ? [deviceReportCard({ id, product, manufacturer, driverId, lastError, failedReads })] : []));
}

supportRun.addEventListener('click', async () => {
  supportRun.disabled = true;
  supportRun.textContent = 'Checking…';
  try {
    renderResults(await window.batteryHub.runSupportCheck());
  } catch (e) {
    supportResults.replaceChildren(supportText('div', 'check-detail', `The check couldn't finish: ${plainError(e)}`));
    supportResults.hidden = false;
  } finally {
    supportRun.disabled = false;
    supportRun.textContent = 'Run again';
  }
});
