// Compx's shared 2.4G receiver 3554:fa09, used by several keyboards: AULA F87 Pro and F99 Pro,
// Lingbao K98 and MCHOSE G75. They share the collection 0xFF02/0x0002 with 20-byte report 0x13,
// and each answers the battery in one of two ways. Sources: dongfangshu/AulaF87ProBattery
// (docs/PROTOCOL.md) and evren-oct/vigil-watt (docs/hardware/aula.md, lingbao.md, mchose.md),
// both checked on real keyboards. Not tested here: nobody on this project has one.
//
//   every frame: 13 <command> <argument> ... <sum of bytes 0-18, low 8 bits>
//   open session 13 05 01   -> ack 13 05 01 00 0A 03 ...       (the receiver answers this)
//   battery push             13 0A 01 00 04 05 <percent> <flags> (K98, F99 Pro, after the session)
//   battery query 13 4A 00 / 13 4A 01 -> 13 4A 01 00 02 <percent> <state> (F87 Pro / G75)
//   flags and state: 0x10 set while on external power
//
// The AULA project found a plain write got no answer on battery power, and sends with
// HidD_SetOutputReport instead, so that is tried when a plain write gets nothing.
const { execFile } = require('child_process');
const path = require('path');
const session = require('../session');

const VENDOR = 0x3554;
const PRODUCT = 0xfa09;
const USAGE_PAGE = 0xff02;
const LENGTH = 20;
const PLAIN_MS = 1500;
const CONTROL_MS = 2000;
const REPOKE_MS = 500;
const READ_SLICE_MS = 100;
const SCRIPT = path.join(__dirname, '..', 'output-report.ps1');
const SCRIPT_TIMEOUT_MS = 6000;

function frame(command, argument) {
  const f = new Array(LENGTH).fill(0);
  f[0] = 0x13;
  f[1] = command;
  f[2] = argument;
  f[LENGTH - 1] = f.reduce((sum, b) => sum + b, 0) & 0xff;
  return f;
}
const SESSION = frame(0x05, 0x01);
const QUERIES = [frame(0x4a, 0x01), frame(0x4a, 0x00)];
const REQUESTS = [SESSION, ...QUERIES];

const channelOf = (logicalDevice) => logicalDevice.channels.find((c) => c.usagePage === USAGE_PAGE && (c.usage === undefined || c.usage === 2));

function matches(logicalDevice) {
  return logicalDevice.vendorId === VENDOR && logicalDevice.productId === PRODUCT && !!channelOf(logicalDevice);
}

// A battery reading, { ack: true } for the receiver's session answer, or null for anything else.
function parseFrame(f) {
  if (f.length < LENGTH || f[0] !== 0x13) return null;
  let sum = 0;
  for (let i = 0; i < LENGTH - 1; i++) sum += f[i];
  if ((sum & 0xff) !== f[LENGTH - 1]) return null;
  let level = null;
  let flags = 0;
  if ((f[1] & 0x7f) === 0x4a && f[2] === 0x01 && f[3] === 0x00 && f[4] === 0x02) [level, flags] = [f[5], f[6]];
  else if (f[1] === 0x0a && f[2] === 0x01 && f[4] === 0x04 && f[5] === 0x05) [level, flags] = [f[6], f[7]];
  else if (f[1] === 0x05 && f[2] === 0x01 && f[4] === 0x0a) return { ack: true };
  if (level === null || level < 1 || level > 100) return null;
  return { capacity: level, charging: !!(flags & 0x10) };
}

function sendControl(channelPath) {
  const hex = REQUESTS.map((r) => r.map((b) => b.toString(16).padStart(2, '0')).join(''));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, channelPath, ...hex],
      { windowsHide: true, timeout: SCRIPT_TIMEOUT_MS }, (err) => (err ? reject(new Error('could not send to device')) : resolve()));
  });
}

async function readBattery(logicalDevice) {
  const channel = channelOf(logicalDevice);
  if (!channel) throw new Error('no command channel');
  const dev = await session.acquire(channel.path);
  await session.readQueued(channel.path, dev); // a late reply to an old request is stale

  let answered = false; // the receiver acknowledged the session, so it is there
  let writeError = null;
  const listen = async (more, poke) => {
    let nextPoke = 0;
    while (more()) {
      if (poke && Date.now() >= nextPoke) {
        for (const request of REQUESTS) {
          try { await dev.write(request); } catch (e) { writeError = e; }
        }
        nextPoke = Date.now() + REPOKE_MS;
      }
      const parsed = parseFrame(await session.read(channel.path, dev, READ_SLICE_MS));
      if (parsed && parsed.ack) answered = true;
      else if (parsed) return parsed;
    }
    return null;
  };

  const plainUntil = Date.now() + PLAIN_MS;
  const plain = await listen(() => Date.now() < plainUntil, true);
  if (plain) return plain;

  // The same requests as control transfers, read back on this handle while they go out. The
  // helper takes a moment to start, so the wait runs from when it has sent them.
  let controlError = null;
  let sentAt = null;
  const giveUpAt = Date.now() + SCRIPT_TIMEOUT_MS + CONTROL_MS;
  const sent = sendControl(channel.path).catch((e) => { controlError = e; }).then(() => { sentAt = Date.now(); });
  const control = await listen(() => Date.now() < giveUpAt && (sentAt === null || Date.now() < sentAt + CONTROL_MS), false);
  await sent;
  if (control) return control;
  if (answered) throw new Error('keyboard is not answering');
  throw writeError || controlError || new Error('timeout waiting for battery response');
}

module.exports = { id: 'compx', matches, readBattery, parseFrame, frame };
