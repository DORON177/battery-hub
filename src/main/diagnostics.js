// The check behind Settings > Help. Tests this install, this PC and the user's devices, then says
// where a problem most likely is, so a support request starts from facts.
//
// The report can end up in a public GitHub issue, so nothing personal goes in it: no user name,
// no device serial or Bluetooth address, and no names the user gave their devices.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const packageCheck = require('./package-check');
const { PY_CANDIDATES } = require('./monitor');

const REPO = 'DORON177/battery-hub';
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const NETWORK_TIMEOUT_MS = 5000;
const LOG_DAYS = 7;
const LOG_LINES = 8;
const CRASHES_WORTH_MENTIONING = 3;
const URL_LIMIT = 2000; // Windows can't open a link over 2081 characters
const CUT_SHORT = '(Cut short to fit a link. Paste the full report here.)';
const FRAMES_IN_REPORT = 12;
const BYTES_PER_FRAME = 32;
const BLUETOOTH_PATH = /0000(1124|1812)-0000-1000-8000-00805f9b34fb/i;
const BRIEF_LINES = /^(Verdict|Windows|Package fingerprint|- (FAIL|WARN))/;
const PC = 'pc';
const APP = 'app';
const DEVICE = 'device';

const check = (id, title, status, detail, extra = {}) => ({ id, title, status, detail, side: null, fix: null, ...extra });
// A value Windows didn't give (a collection without a usage) shows as ---- rather than NaN.
const hex4 = (n) => (n == null || Number.isNaN(Number(n)) ? '----' : Number(n).toString(16).padStart(4, '0'));
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function sanitize(text, home = os.homedir()) {
  const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text)
    .replace(new RegExp(escapedHome, 'gi'), '~')
    .replace(/[a-z]:[\\/]users[\\/][^\\/\s"']+/gi, '~')
    .replace(/\\\\\?\\[^\s"']+/g, '<device path>')
    .replace(/\b[0-9a-f]{12}\b/gi, '<address>')
    .replace(/\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b/gi, '<address>');
}

function isNewer(latest, current) {
  const parts = (v) => String(v).replace(/^v/, '').split('.').map(Number);
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function ago(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

async function checkPackage(root, packaged) {
  if (!packaged) return check('package', 'Install files', 'ok', 'Running from source, so there is nothing to test.');
  const result = await packageCheck.verify(root);
  if (!result) {
    return check('package', 'Install files', 'fail', 'This install is missing its file list, so it can\'t be tested.', {
      side: PC, fix: 'Reinstall Battery Hub.',
    });
  }
  const bad = result.missing.length + result.changed.length;
  if (bad === 0) return check('package', 'Install files', 'ok', `All ${result.total} files match what was shipped.`, { fingerprint: result.fingerprint });
  return check('package', 'Install files', 'fail', `${bad} of ${result.total} files are missing or changed.`, {
    side: PC,
    fix: 'Reinstall Battery Hub. If it happens again, antivirus software may be changing its files.',
    fingerprint: result.fingerprint,
    files: [...result.missing, ...result.changed].slice(0, 10),
  });
}

async function checkVersion(current, fetchLatest) {
  try {
    const latest = await fetchLatest();
    if (isNewer(latest, current)) {
      return check('version', 'Version', 'fail', `You have ${current}. The latest is ${latest}.`, {
        side: PC, fix: 'Update first: this problem may already be fixed.',
      });
    }
    return check('version', 'Version', 'ok', `You have ${current}, the latest version.`);
  } catch (_) {
    return check('version', 'Version', 'warn', `You have ${current}. Couldn't reach GitHub to compare.`, { side: PC, fix: 'Check your internet connection.' });
  }
}

function checkStorage(folder) {
  const probe = path.join(folder, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    const works = fs.readFileSync(probe, 'utf8') === 'ok';
    fs.unlinkSync(probe);
    if (works) return check('storage', 'Saved settings', 'ok', 'Settings can be saved and read back.');
  } catch (_) { /* reported below */ }
  return check('storage', 'Saved settings', 'fail', "Settings can't be saved.", {
    side: PC, fix: 'Check your disk has free space and that antivirus software isn\'t blocking Battery Hub.',
  });
}

async function checkDeviceReader(enumerate) {
  const started = Date.now();
  try {
    const devices = await enumerate();
    return check('hid', 'Device reader', 'ok', `Working: found ${count(devices.length, 'device')} in ${Date.now() - started} ms.`);
  } catch (e) {
    return check('hid', 'Device reader', 'fail', "The part that talks to your devices didn't start.", {
      side: PC, fix: 'Reinstall Battery Hub. If that doesn\'t help, antivirus software may be blocking it.', error: e.message,
    });
  }
}

async function checkWindowsAccess(selfTest) {
  const result = await selfTest();
  if (result.ok) return check('windows', 'Windows Bluetooth access', 'ok', `Working: Windows has a battery reading for ${count(result.count, 'device')}.`);
  return check('windows', 'Windows Bluetooth access', 'warn', "PowerShell couldn't run, so Bluetooth and Xbox batteries can't be read.", {
    side: PC, fix: 'A security policy or antivirus software may be blocking PowerShell.', error: result.error,
  });
}

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

async function checkPython(devices, runner = run) {
  if (!devices.some((d) => d.driverId === 'mchose' && !d.hidden)) return null;
  for (const python of PY_CANDIDATES) {
    if (await runner(python, ['-c', 'import hid'])) return check('python', 'Python for your headset', 'ok', 'Python and its hid module are installed.');
  }
  return check('python', 'Python for your headset', 'fail', 'Your MCHOSE headset needs Python and its hid module.', {
    side: PC, fix: 'Install Python from python.org, then run: pip install hidapi',
  });
}

function vendorProduct(id) {
  const [vendor, product] = String(id).split(':').map(Number);
  if (!Number.isInteger(vendor) || !Number.isInteger(product)) return String(id).split(':')[0];
  return `${hex4(vendor)}:${hex4(product)}`;
}

// Windows shows Bluetooth devices under the name the user gave them.
const reportName = (device) => (String(device.id).startsWith('bt:') ? 'Bluetooth device' : device.product || 'Unknown');

const ASLEEP = /^(not connected|waiting\b)|\bis off$/i;
const TURNED_OFF_IN_SETTINGS = /in Settings$/;
const NEEDS_PYTHON = /^needs Python/;
const NO_ANSWER = /timeout|timed out|not answering/i;
const OFF_OR_ASLEEP = /\bis (off|not answering)$/i;

// A failed read that doesn't count against the device: it is off, or it has worked before and
// has gone quiet, which usually means it's asleep.
function isExpectedFailure(error, everRead) {
  return ASLEEP.test(error) || TURNED_OFF_IN_SETTINGS.test(error) || (NO_ANSWER.test(error) && everRead);
}

function checkDevice(device, now = Date.now()) {
  const name = device.customName || device.product || 'Device';
  const facts = {
    product: reportName(device),
    driver: device.driverId || 'generic',
    hardware: vendorProduct(device.id),
    connections: 1 + (device.links || []).length,
    error: device.lastError || null,
  };
  const make = (status, detail, extra) => check(`device:${device.id}`, name, status, detail, { device: facts, ...extra });
  const error = device.lastError;
  const lastRead = device.lastReadingAt ? `Last read ${ago(now - device.lastReadingAt)}.` : '';
  if (device.online === false) return make('ok', OFF_OR_ASLEEP.test(error || '') ? 'Asleep or turned off.' : 'Not connected right now.');
  if (error && ASLEEP.test(error)) return make('ok', 'Asleep or turned off.');
  if (error && TURNED_OFF_IN_SETTINGS.test(error)) return make('ok', `${error}.`);
  if (error && NEEDS_PYTHON.test(error)) return make('warn', 'Needs Python. See the fix above.', { side: PC });
  // A device that has answered before and stops answering has usually just gone to sleep.
  if (error && NO_ANSWER.test(error) && lastRead) return make('ok', `Didn't answer, so it may be asleep. ${lastRead}`);
  if (error) return make('warn', `Can't read it: ${error}`, { side: DEVICE, fix: 'Reconnect it. If that doesn\'t help, send a support request.' });
  if (!lastRead) return make('warn', 'No battery reading yet.', { side: DEVICE, fix: 'Turn it off and on, then run this check again.' });
  return make('ok', lastRead);
}

function readLog(file, now = Date.now(), read = fs.readFileSync) {
  let text = '';
  try { text = read(file, 'utf8'); } catch (_) { return []; }
  const since = now - LOG_DAYS * 86400000;
  return text.split(/\r?\n/).filter((line) => {
    const m = /^\[([^\]]+)\] (ERROR|FATAL)/.exec(line);
    return m && Date.parse(m[1]) >= since;
  });
}

function checkCrashes(errors) {
  if (errors.length < CRASHES_WORTH_MENTIONING) return check('errors', 'Recent errors', 'ok', errors.length ? `${errors.length} in the last week.` : 'None in the last week.');
  return check('errors', 'Recent errors', 'warn', `${errors.length} in the last week.`, { side: APP });
}

function verdictOf(checks) {
  const onPc = checks.filter((c) => c.status === 'fail' && c.side === PC);
  const others = checks.filter((c) => c.status !== 'ok' && c.side !== PC);
  const softPc = checks.filter((c) => c.status === 'warn' && c.side === PC);
  if (onPc.length) {
    return { tone: 'bad', side: PC, title: 'The problem looks to be on this PC', detail: 'Try the fixes below first. They may solve it without needing support.' };
  }
  if (others.length) {
    return { tone: 'warn', side: APP, title: 'Your install and PC look fine', detail: 'This may be a Battery Hub problem. Send a support request and we\'ll take a look.' };
  }
  if (softPc.length) {
    return { tone: 'warn', side: PC, title: 'Mostly fine', detail: 'One thing on this PC needs a look. See below.' };
  }
  return { tone: 'good', side: null, title: 'Everything looks fine', detail: 'If something still seems wrong, send a support request and describe it.' };
}

function formatReport({ checks, verdict, facts, errors }) {
  const lines = [
    `Verdict: ${verdict.title}`, '',
    `Battery Hub ${facts.version}${facts.packaged ? '' : ' (from source)'}`,
    `Windows ${facts.windows} ${facts.arch}, Electron ${facts.electron}`,
  ];
  const pack = checks.find((c) => c.id === 'package');
  if (pack && pack.fingerprint) lines.push(`Package fingerprint: ${pack.fingerprint}`);
  lines.push('', 'Checks:');
  for (const c of checks.filter((x) => !x.device)) {
    lines.push(`- ${c.status.toUpperCase()} ${c.title}: ${c.detail}`);
    for (const f of c.files || []) lines.push(`    ${f}`);
    if (c.error) lines.push(`    ${c.error.split('\n')[0]}`);
  }
  const devices = checks.filter((c) => c.device);
  if (devices.length) lines.push('', 'Devices:');
  for (const c of devices) {
    const d = c.device;
    lines.push(`- ${c.status.toUpperCase()} ${d.product} (${d.hardware}, ${d.driver}, ${count(d.connections, 'connection')})${d.error ? `: ${d.error}` : ''}`);
  }
  if (errors.length) lines.push('', `Recent errors (last ${Math.min(errors.length, LOG_LINES)} of ${errors.length}):`, ...errors.slice(-LOG_LINES).map((e) => e.slice(0, 200)));
  return sanitize(lines.join('\n'));
}

// A link that opens a filled-in issue. Nothing is posted until the person submits it on GitHub. The
// last field is cut if the link gets too long, so it goes last with its most useful lines first.
// `complete` says if everything fit.
function issueLink(template, fields, limit = URL_LIMIT) {
  const base = `https://github.com/${REPO}/issues/new?template=${template}&`;
  const link = (values) => base + Object.entries(values).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  if (link(fields).length <= limit) return { url: link(fields), complete: true };
  const last = Object.keys(fields).pop();
  const lines = fields[last].split('\n');
  const cut = () => ({ ...fields, [last]: `${lines.join('\n')}\n${CUT_SHORT}` });
  while (lines.length && link(cut()).length > limit) lines.pop();
  return { url: link(cut()), complete: false };
}

function requestUrl(report, limit = URL_LIMIT) {
  return issueLink('support-request.yml', { title: 'Support request', report }, limit);
}

function deviceFacts(request, live) {
  const channels = live ? live.channels : [];
  const bluetooth = String(request.id).startsWith('bt:') || channels.some((c) => BLUETOOTH_PATH.test(c.path || ''));
  return {
    product: reportName(request),
    manufacturer: request.manufacturer || '',
    hardware: vendorProduct(request.id),
    driver: request.driverId || 'none',
    connection: bluetooth ? 'Bluetooth' : live ? 'USB' : 'Unknown',
    hasKeyboard: channels.some((c) => c.usagePage === 1 && c.usage === 6),
    channels: [...new Set(channels.map((c) => `${hex4(c.usagePage)}:${hex4(c.usage)}`))],
  };
}

function frameLine(frame) {
  const hex = frame.bytes.slice(0, BYTES_PER_FRAME).map((b) => b.toString(16).padStart(2, '0')).join('');
  const more = frame.bytes.length > BYTES_PER_FRAME ? '...' : '';
  return `${hex4(frame.usagePage)}:${hex4(frame.usage)} report ${frame.reportId}, seen ${frame.count}x: ${hex}${more}`;
}

// What was tried and what came back. A scan's raw messages are public once sent, so a keyboard's
// are left out because they can hold typed keys, and feature reports because they can hold the
// device's address. Their sizes and counts still say a lot about the protocol.
function scanLines({ scans = [], frames = [], lastError, failedReads }, facts) {
  const lines = [`Channels: ${facts.channels.join(', ') || 'unknown'}`];
  if (failedReads) lines.push(`Failed reads in a row: ${failedReads}`);
  if (lastError) lines.push(`Last error: ${lastError}`);
  scans.forEach((scan, i) => {
    const outcome = scan.error ? `failed (${scan.error})` : scan.captured ? count(scan.captured, 'message') : 'nothing captured';
    lines.push(`Scan ${i + 1}: ${outcome}`);
  });
  const feature = frames.filter((f) => f.reportKind !== 'input');
  const input = frames.filter((f) => f.reportKind === 'input').sort((a, b) => b.count - a.count);
  if (feature.length) lines.push(`Feature reports: ${[...new Set(feature.map((f) => `${f.reportId} (${f.bytes.length} bytes)`))].join(', ')}`);
  if (input.length && facts.hasKeyboard) lines.push(`Input messages: ${input.length}, left out because this device has a keyboard`);
  else lines.push(...input.slice(0, FRAMES_IN_REPORT).map(frameLine));
  return lines;
}

// The report behind Send device report: what happened with the device, plus the full check so a
// fault on the sender's end shows up. Fills in the device request form.
async function deviceReport(deps, request, live) {
  const health = await runChecks(deps);
  const facts = deviceFacts(request, live);
  const scan = sanitize(scanLines(request, facts).join('\n'));
  const [vendor, product] = facts.hardware.split(':');
  const report = sanitize([
    `Device: ${facts.product}`,
    `Maker: ${facts.manufacturer || 'Unknown'}`,
    `Hardware: ${facts.hardware}`,
    `Connection: ${facts.connection}`,
    `Driver: ${facts.driver}`,
    scan, '', health.report,
  ].join('\n'));
  return {
    ...health,
    report,
    ...issueLink('device-support.yml', {
      title: `[Device] ${facts.product}`,
      device: [facts.manufacturer, facts.product].filter(Boolean).join(' '),
      connection: facts.connection,
      ids: product ? `VID_${vendor} / PID_${product}`.toUpperCase() : facts.hardware,
      version: deps.version,
      notes: health.report.split('\n').filter((line) => BRIEF_LINES.test(line)).join('\n'),
      scan,
    }),
  };
}

async function fetchLatestVersion(fetcher) {
  const response = await fetcher(LATEST_RELEASE, { headers: { 'User-Agent': 'Battery-Hub', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()).tag_name.replace(/^v/, '');
}

// deps: { root, packaged, version, userData, logFile, fetcher, enumerate, windowsSelfTest, devices }
async function runChecks(deps) {
  const devices = Object.values(deps.devices).filter((d) => !d.hidden);
  const errors = readLog(deps.logFile);
  const checks = [
    await checkPackage(deps.root, deps.packaged),
    await checkVersion(deps.version, () => fetchLatestVersion(deps.fetcher)),
    checkStorage(deps.userData),
    await checkDeviceReader(deps.enumerate),
    await checkWindowsAccess(deps.windowsSelfTest),
    await checkPython(devices),
    checkCrashes(errors),
    ...devices.map((d) => checkDevice(d)),
  ].filter(Boolean);
  const verdict = verdictOf(checks);
  const facts = { version: deps.version, packaged: deps.packaged, windows: os.release(), arch: os.arch(), electron: process.versions.electron };
  const report = formatReport({ checks, verdict, facts, errors });
  const shown = checks.map(({ device, files, error, fingerprint, ...rest }) => rest);
  return { checks: shown, verdict, report, ...requestUrl(report) };
}

module.exports = { runChecks, deviceReport, isExpectedFailure, verdictOf, formatReport, requestUrl, sanitize, isNewer, checkDevice, checkPython, readLog, checkPackage };
