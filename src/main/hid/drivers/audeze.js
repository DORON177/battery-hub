// Audeze Maxwell and Maxwell 2. Protocol recovered by HeadsetControl from Audeze's own app.
//
// Reports are 62 bytes: <report id> <fragment length> <route> <fragment...>. Fragments form a
// stream of messages: 05 <type> <length lo> <length hi> <body...>. Asking for the battery gets
// an acknowledgement, then a result: 05 5D 05 00 D6 0C 00 00 <percent>.
//
// Replies only arrive through HidD_GetInputReport, which node-hid doesn't expose, so a small
// PowerShell script does the exchange and hands back the raw reports.
const { execFile } = require('child_process');
const path = require('path');
const { pad } = require('./exchange');

const AUDEZE = 0x3329;
const PRODUCTS = new Set([0x4b19, 0x4b18, 0x4b29, 0x4b28]); // Maxwell and Maxwell 2, PC and Xbox
const REPORT_OUT = 0x06;
const REPORT_SIZE = 62;
const ROUTE_HEADSET = 0x80;
const FRAGMENT_OFFSET = 3;
const MARKER = 0x05;
const TYPE_RESPONSE = 0x5b;
const TYPE_RESULT = 0x5d;
const CMD = [0xd6, 0x0c];
const SCRIPT = path.join(__dirname, '..', 'input-report.ps1');
const SCRIPT_TIMEOUT_MS = 6000;

// The collection HeadsetControl uses comes first, then any other vendor collection in case a
// model differs.
const COMMAND = { usagePage: 0xff13, usage: 0x01 };
const preference = (c) => (c.usagePage === COMMAND.usagePage && c.usage === COMMAND.usage ? 2 : Number(c.usagePage >= 0xff00));
const candidates = (logicalDevice) => [...logicalDevice.channels].sort((a, b) => preference(b) - preference(a));

function matches(logicalDevice) {
  return logicalDevice.vendorId === AUDEZE && PRODUCTS.has(logicalDevice.productId);
}

function buildRequest() {
  const body = [...CMD, 0x00];
  const message = [MARKER, 0x5a, body.length, 0x00, ...body];
  return pad([REPORT_OUT, message.length, ROUTE_HEADSET, ...message], REPORT_SIZE);
}

// Walks the reports' message stream for the battery result.
function parseReports(reports) {
  const stream = [];
  for (const report of reports) {
    const length = report[1];
    if (length > 0) stream.push(...report.slice(FRAGMENT_OFFSET, FRAGMENT_OFFSET + length));
  }
  for (let i = 0; i + 4 <= stream.length;) {
    if (stream[i] !== MARKER) { i += 1; continue; }
    const type = stream[i + 1];
    const size = stream[i + 2] | (stream[i + 3] << 8);
    const body = stream.slice(i + 4, i + 4 + size);
    if (body[0] === CMD[0] && body[1] === CMD[1]) {
      if (type === TYPE_RESULT && body.length >= 5) return { capacity: Math.min(body[4], 100), charging: null };
      if (type === TYPE_RESPONSE && body[2] !== 0x00) return { off: true };
    }
    i += 4 + size;
  }
  return null;
}

function exchange(channelPath) {
  const hex = buildRequest().map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, channelPath, hex, String(REPORT_SIZE), '7'],
      { windowsHide: true, timeout: SCRIPT_TIMEOUT_MS }, (err, stdout) => {
        if (err) { reject(new Error('could not read device')); return; }
        resolve(stdout.split(/\r?\n/).filter(Boolean).map((line) => Array.from(Buffer.from(line.trim(), 'hex'))));
      });
  });
}

async function readBattery(logicalDevice) {
  let lastError = new Error('no command channel');
  for (const channel of candidates(logicalDevice)) {
    let reports;
    try {
      reports = await exchange(channel.path);
    } catch (e) {
      lastError = e; // this collection doesn't take the request
      continue;
    }
    const reading = parseReports(reports);
    if (reading && !reading.off) return reading;
    // Only the command collection takes the request, and the headset does not answer there
    // while it is switched off (HeadsetControl reads the silence the same way).
    throw new Error('headset is off');
  }
  throw lastError;
}

module.exports = { id: 'audeze', matches, readBattery, buildRequest, parseReports, candidates };
