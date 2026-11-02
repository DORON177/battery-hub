const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeManifest, verify } = require('../src/main/package-check');
const {
  runChecks, deviceReport, isExpectedFailure, verdictOf, formatReport, requestUrl, sanitize, isNewer, checkDevice, checkPython, readLog, checkPackage,
} = require('../src/main/diagnostics');

function tempPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-package-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'one');
  return root;
}

test('a healthy package passes', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.0.0');
  const result = await verify(root);
  assert.deepEqual([result.total, result.missing, result.changed], [2, [], []]);
  assert.equal(result.fingerprint.length, 16);
  fs.rmSync(root, { recursive: true });
});

test('a changed file and a missing file are both found', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.0.0');
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'two');
  fs.unlinkSync(path.join(root, 'package.json'));
  const result = await verify(root);
  assert.deepEqual(result.changed, ['src/main.js']);
  assert.deepEqual(result.missing, ['package.json']);
  fs.rmSync(root, { recursive: true });
});

test('a changed package gives a different fingerprint', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.0.0');
  const before = (await verify(root)).fingerprint;
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'two');
  assert.notEqual((await verify(root)).fingerprint, before);
  fs.rmSync(root, { recursive: true });
});

test('a damaged install puts the fault on the PC and says how to fix it', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.0.0');
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'two');
  const result = await checkPackage(root, true);
  assert.equal(result.status, 'fail');
  assert.equal(result.side, 'pc');
  assert.match(result.fix, /Reinstall/);
  fs.rmSync(root, { recursive: true });
});

test('a damaged file list counts as no list, not as a crash', async () => {
  const root = tempPackage();
  fs.writeFileSync(path.join(root, 'package-manifest.json'), '{}');
  assert.equal(await verify(root), null);
  fs.writeFileSync(path.join(root, 'package-manifest.json'), '{"version":"1.0.0","fil');
  assert.equal(await verify(root), null);
  fs.rmSync(root, { recursive: true });
});

test('a copy with no file list fails, and running from source is not tested', async () => {
  const root = tempPackage();
  assert.equal((await checkPackage(root, true)).status, 'fail');
  assert.equal((await checkPackage(root, false)).status, 'ok');
  fs.rmSync(root, { recursive: true });
});

test('the verdict says where the problem is', () => {
  const ok = { status: 'ok', side: null };
  assert.equal(verdictOf([ok]).tone, 'good');
  assert.equal(verdictOf([ok, { status: 'fail', side: 'pc' }]).side, 'pc');
  assert.equal(verdictOf([ok, { status: 'warn', side: 'device' }]).side, 'app');
  assert.equal(verdictOf([{ status: 'fail', side: 'pc' }, { status: 'warn', side: 'device' }]).side, 'pc');
  assert.equal(verdictOf([ok, { status: 'warn', side: 'pc' }]).title, 'Mostly fine');
});

test('versions compare as numbers', () => {
  assert.equal(isNewer('1.3.10', '1.3.2'), true);
  assert.equal(isNewer('v1.3.1', '1.3.1'), false);
  assert.equal(isNewer('1.2.0', '1.3.1'), false);
});

test('a sleeping device is not treated as a problem, but a real error is', () => {
  const base = { id: '1:2:x', product: 'Mouse', lastReadingAt: Date.now() };
  assert.equal(checkDevice({ ...base, online: false }).status, 'ok');
  assert.equal(checkDevice({ ...base, lastError: 'device is off' }).status, 'ok');
  assert.equal(checkDevice({ ...base, lastError: 'waiting for device to report' }).status, 'ok');
  const failing = checkDevice({ ...base, lastError: 'cannot open device' });
  assert.equal(failing.status, 'warn');
  assert.equal(failing.side, 'device');
  assert.equal(checkDevice({ id: '1:2:x', product: 'Mouse' }).status, 'warn');
});

test('every message a device can leave is judged correctly', () => {
  const base = { id: '1:2:x', product: 'Mouse', lastReadingAt: Date.now() };
  const status = (lastError, extra = {}) => checkDevice({ ...base, ...extra, lastError }).status;
  for (const asleep of ['not connected', 'headset is off', 'keyboard is off', 'waiting for headset update']) assert.equal(status(asleep), 'ok', asleep);
  assert.equal(status('Bluetooth reading is off in Settings'), 'ok');
  for (const bad of ['could not read device', 'no command channel', 'unsupported device', 'device did not accept the request']) assert.equal(status(bad), 'warn', bad);
});

test('a mouse that has worked before and stops answering is asleep, one that never worked is not', () => {
  const lastError = 'timeout waiting for battery response';
  assert.equal(checkDevice({ id: '1:2:x', lastError, lastReadingAt: Date.now() - 3 * 3600000 }).detail, "Didn't answer, so it may be asleep. Last read 3 h ago.");
  assert.equal(checkDevice({ id: '1:2:x', lastError }).status, 'warn');
});

test('a missing Python install is put on the PC, not on the app', () => {
  const result = checkDevice({ id: '1:2:x', product: 'Headset', lastError: 'needs Python + hid module' });
  assert.equal(result.side, 'pc');
  assert.equal(verdictOf([{ status: 'fail', side: 'pc' }, result]).side, 'pc');
});

test('Python is only tested for devices that need it', async () => {
  assert.equal(await checkPython([{ driverId: 'kysona' }], async () => false), null);
  assert.equal((await checkPython([{ driverId: 'mchose' }], async () => false)).status, 'fail');
  assert.match((await checkPython([{ driverId: 'mchose' }], async () => false)).fix, /pip install hidapi$/);
  assert.equal((await checkPython([{ driverId: 'mchose' }], async (cmd) => cmd === 'py')).status, 'ok');
  assert.equal(await checkPython([{ driverId: 'mchose', hidden: true }], async () => false), null);
});

test('only recent errors are picked out of the log', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const log = [
    '[2026-11-02T10:00:00.000Z] INFO app ready',
    '[2026-11-02T11:00:00.000Z] ERROR something',
    '[2026-10-01T11:00:00.000Z] FATAL old',
  ].join('\n');
  assert.deepEqual(readLog('x', now, () => log), ['[2026-11-02T11:00:00.000Z] ERROR something']);
  assert.deepEqual(readLog('x', now, () => { throw new Error('none'); }), []);
});

test('nothing personal survives sanitizing', () => {
  const home = 'C:\\Users\\doron';
  const text = sanitize('at C:\\Users\\doron\\AppData\\x c:\\users\\DORON\\y serial d228599c0140 and 14:3a:9a:e2:ea:5c path \\\\?\\HID#VID_054C&x', home);
  assert.ok(!/doron/i.test(text));
  assert.ok(!/d228599c0140/.test(text));
  assert.ok(!/14:3a/.test(text));
  assert.ok(!/HID#VID/.test(text));
  assert.match(text, /~\\AppData/);
  assert.ok(!/alex/i.test(sanitize('file:///C:/Users/alex/app/main.js', home)));
});

test('the report leaves out what the user named a device and its serial', () => {
  const device = checkDevice({ id: '1133:45122:d228599c0140', product: 'MX Master 4', customName: "Doron's mouse", driverId: 'hidpp', lastReadingAt: Date.now() });
  assert.equal(device.title, "Doron's mouse"); // shown on screen only
  const report = formatReport({
    checks: [device],
    verdict: { title: 'Everything looks fine' },
    facts: { version: '1.3.1', packaged: true, windows: '10.0', arch: 'x64', electron: '33' },
    errors: [],
  });
  assert.match(report, /MX Master 4 \(046d:b042, hidpp, 1 connection\)/);
  assert.ok(!/Doron/.test(report));
  assert.ok(!/d228599c0140/.test(report));
});

test('a Bluetooth name from Windows stays out of the report', () => {
  const device = checkDevice({ id: 'bt:BTHENUM\\DEV_D228599C0140', product: "Doron's AirPods", driverId: 'system', lastReadingAt: Date.now() });
  const report = formatReport({
    checks: [device],
    verdict: { title: 'x' },
    facts: { version: '1', packaged: true, windows: '10.0', arch: 'x64', electron: '33' },
    errors: [],
  });
  assert.match(report, /Bluetooth device \(bt, system/);
  assert.ok(!/AirPods/.test(report));
});

test('a short report fits the link whole', () => {
  const { url, complete } = requestUrl('Verdict: fine');
  assert.equal(complete, true);
  assert.match(url, /template=support-request\.yml/);
  assert.match(decodeURIComponent(url), /Verdict: fine$/);
});

test('a long report is cut to what Windows can open, and says so', () => {
  const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  const { url, complete } = requestUrl(long);
  assert.equal(complete, false);
  assert.ok(url.length <= 2081);
  assert.match(decodeURIComponent(url), /line 0\n/);
  assert.match(decodeURIComponent(url), /Paste the full report here/);
});

function healthyDeps(root) {
  return {
    root,
    packaged: true,
    version: '1.3.1',
    userData: root,
    logFile: path.join(root, 'no-such.log'),
    fetcher: async () => ({ ok: true, json: async () => ({ tag_name: 'v1.3.1' }) }),
    enumerate: async () => [{}, {}],
    windowsSelfTest: async () => ({ ok: true, count: 1 }),
    devices: {
      a: { id: '13652:62858:serial', product: 'VXE', customName: 'Doron desk mouse', driverId: 'kysona', lastReadingAt: Date.now() },
      b: { id: '1:2:x', product: 'Hidden one', hidden: true },
    },
  };
}

test('the whole check on a healthy PC says everything is fine', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.3.1');
  const result = await runChecks(healthyDeps(root));
  assert.equal(result.verdict.tone, 'good');
  assert.deepEqual(result.checks.map((c) => c.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(result.complete, true);
  assert.match(result.report, /VXE \(3554:f58a, kysona, 1 connection\)/);
  assert.ok(!/Hidden one|Doron/.test(result.report));
  fs.rmSync(root, { recursive: true });
});

test('the whole check still reports when parts of the PC are broken', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.3.1');
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'quarantined');
  const result = await runChecks({
    ...healthyDeps(root),
    fetcher: async () => { throw new Error('offline'); },
    enumerate: async () => { throw new Error('hid worker exited'); },
    windowsSelfTest: async () => ({ ok: false, error: 'blocked by policy' }),
  });
  assert.equal(result.verdict.side, 'pc');
  assert.match(result.report, /FAIL Install files: 1 of 2 files[\s\S]*src\/main\.js/);
  assert.match(result.report, /FAIL Device reader[\s\S]*hid worker exited/);
  assert.match(result.report, /WARN Windows Bluetooth access[\s\S]*blocked by policy/);
  assert.ok(result.checks.every((c) => !('device' in c) && !('files' in c)));
  fs.rmSync(root, { recursive: true });
});

test('only the first line of a long error goes in the report', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.3.1');
  const result = await runChecks({
    ...healthyDeps(root),
    enumerate: async () => { throw new Error('Failed to find binding for HID\nTried paths:\n - D:\\My Stuff\\battery-hub\\HID.node'); },
  });
  assert.match(result.report, /Failed to find binding for HID/);
  assert.ok(!/Tried paths|My Stuff/.test(result.report));
  fs.rmSync(root, { recursive: true });
});

test('counts read properly', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.3.1');
  const { report } = await runChecks({ ...healthyDeps(root), enumerate: async () => [{}], windowsSelfTest: async () => ({ ok: true, count: 1 }) });
  assert.match(report, /found 1 device in/);
  assert.match(report, /battery reading for 1 device\./);
  fs.rmSync(root, { recursive: true });
});

const vendorChannel = { usagePage: 0xff00, usage: 1, path: '\\\\?\\hid#vid_3554&pid_f58a&mi_02#7&secret' };
const inputFrame = (bytes, count = 3) => ({ usagePage: 0xff00, usage: 1, reportKind: 'input', reportId: bytes[0], bytes, count });

async function reportFor(request, live, changeDeps = (d) => d) {
  const root = tempPackage();
  await writeManifest(root, '1.3.1');
  const deps = changeDeps(healthyDeps(root), root);
  const result = await deviceReport(deps, { id: '13652:62858:secretserial', product: 'VXE Mouse', manufacturer: 'VXE', ...request }, live);
  fs.rmSync(root, { recursive: true });
  return { ...result, form: new URL(result.url).searchParams };
}

test('a device report fills in every required field of the request form', async () => {
  const { form, complete } = await reportFor({
    scans: [{ captured: 0, error: null }, { captured: 2, error: null }, { captured: 0, error: 'device not connected' }],
    frames: [inputFrame([5, 100, 0])],
  }, { channels: [vendorChannel, vendorChannel, { usagePage: 1, usage: 2, path: 'x' }] });
  assert.equal(complete, true);
  assert.equal(form.get('template'), 'device-support.yml');
  assert.equal(form.get('title'), '[Device] VXE Mouse');
  assert.equal(form.get('device'), 'VXE VXE Mouse');
  assert.equal(form.get('connection'), 'USB');
  assert.equal(form.get('ids'), 'VID_3554 / PID_F58A');
  assert.equal(form.get('version'), '1.3.1');
  const scan = form.get('scan');
  assert.match(scan, /^Channels: ff00:0001, 0001:0002$/m);
  assert.match(scan, /^Scan 1: nothing captured$/m);
  assert.match(scan, /^Scan 2: 2 messages$/m);
  assert.match(scan, /^Scan 3: failed \(device not connected\)$/m);
  assert.match(scan, /^ff00:0001 report 5, seen 3x: 056400$/m);
  assert.match(form.get('notes'), /^Verdict: Everything looks fine$/m);
});

test('a device report never holds the serial or the device path', async () => {
  const result = await reportFor({ frames: [] }, { channels: [vendorChannel] });
  assert.ok(!/secret/.test(result.report + decodeURIComponent(result.url)));
});

test('what a keyboard sends never goes in a report', async () => {
  const typed = [1, 0, 0, 0x13, 0x04, 0x16, 0x16, 0x1a];
  const result = await reportFor({ frames: [inputFrame(typed, 1)] }, { channels: [vendorChannel, { usagePage: 1, usage: 6, path: 'x' }] });
  assert.ok(!/1304161a|13 04 16/.test(result.report + decodeURIComponent(result.url)));
  assert.match(result.form.get('scan'), /Input messages: 1, left out because this device has a keyboard/);
});

test('the contents of a feature report stay out, but its size is kept', async () => {
  const address = [0x09, 0x5c, 0xea, 0xe2, 0x9a, 0x3a, 0x14];
  const feature = { usagePage: 0xff00, usage: 1, reportKind: 'feature', reportId: 9, bytes: address, count: 2 };
  const result = await reportFor({ frames: [feature, feature] }, { channels: [vendorChannel] });
  assert.ok(!/5cea|143a/i.test(result.report + decodeURIComponent(result.url)));
  assert.match(result.form.get('scan'), /^Feature reports: 9 \(7 bytes\)$/m);
});

test('a Bluetooth device is called Bluetooth, on either kind of link', async () => {
  const classic = { usagePage: 1, usage: 5, path: 'x{00001124-0000-1000-8000-00805f9b34fb}y' };
  const low = { usagePage: 1, usage: 2, path: 'x{00001812-0000-1000-8000-00805f9b34fb}y' };
  assert.equal((await reportFor({}, { channels: [classic] })).form.get('connection'), 'Bluetooth');
  assert.equal((await reportFor({}, { channels: [low] })).form.get('connection'), 'Bluetooth');
  const windows = await reportFor({ id: 'bt:BTHENUM\\DEV_D228599C0140', product: "Doron's AirPods", manufacturer: '' });
  assert.equal(windows.form.get('connection'), 'Bluetooth');
  assert.equal(windows.form.get('device'), 'Bluetooth device');
  assert.equal(windows.form.get('ids'), 'bt');
});

test('a device that has gone can still be reported', async () => {
  const { form } = await reportFor({ driverId: 'razer', lastError: 'no command channel', failedReads: 4 });
  assert.equal(form.get('connection'), 'Unknown');
  assert.match(form.get('scan'), /^Failed reads in a row: 4$/m);
  assert.match(form.get('scan'), /^Last error: no command channel$/m);
});

test('a long scan is cut to fit the link, and the full report keeps the rest', async () => {
  const frames = Array.from({ length: 40 }, (_, i) => inputFrame(Array.from({ length: 64 }, (__, b) => (b + i) % 256), 40 - i));
  const scans = Array.from({ length: 40 }, () => ({ captured: 0, error: 'device not connected' }));
  const result = await reportFor({ scans, frames }, { channels: [vendorChannel] });
  assert.equal(result.complete, false);
  assert.ok(result.url.length <= 2081);
  assert.equal(result.form.get('ids'), 'VID_3554 / PID_F58A');
  assert.match(result.form.get('scan'), /Paste the full report here/);
  assert.equal((result.report.match(/report \d+, seen/g) || []).length, 12);
});

test('a fault on the sender\'s end shows up in the device report', async () => {
  const result = await reportFor({}, null, (deps, root) => {
    fs.writeFileSync(path.join(root, 'src', 'main.js'), 'quarantined');
    return deps;
  });
  assert.equal(result.verdict.tone, 'bad');
  assert.match(result.form.get('notes'), /FAIL Install files: 1 of 2 files/);
  assert.match(result.report, /src\/main\.js/);
});

test('only failures that say something is wrong count against a device', () => {
  assert.equal(isExpectedFailure('mouse is off', false), true);
  assert.equal(isExpectedFailure('Bluetooth reading is off in Settings', false), true);
  assert.equal(isExpectedFailure('timeout waiting for battery response', true), true);
  assert.equal(isExpectedFailure('timeout waiting for battery response', false), false);
  assert.equal(isExpectedFailure('no command channel', true), false);
});

test('an old version is called out', async () => {
  const root = tempPackage();
  await writeManifest(root, '1.0.0');
  const result = await runChecks({ ...healthyDeps(root), fetcher: async () => ({ ok: true, json: async () => ({ tag_name: 'v9.0.0' }) }) });
  assert.equal(result.checks.find((c) => c.id === 'version').status, 'fail');
  assert.equal(result.verdict.side, 'pc');
  fs.rmSync(root, { recursive: true });
});
