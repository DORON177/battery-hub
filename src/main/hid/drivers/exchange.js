// Shared request/response step for vendor protocols: send one report, then wait for the frame the
// caller accepts. Devices interleave unrelated reports, so anything else is skipped.
const session = require('../session');

const READ_SLICE_MS = 100;

function pad(bytes, length) {
  return bytes.concat(new Array(Math.max(0, length - bytes.length)).fill(0));
}

async function exchange(channel, request, accept, timeoutMs = 1500) {
  const dev = await session.acquire(channel.path);
  await session.readQueued(channel.path, dev); // a late reply to an old request is stale
  await session.write(channel.path, dev, request);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await session.read(channel.path, dev, READ_SLICE_MS);
    if (frame.length === 0) continue;
    const result = accept(frame);
    if (result !== null && result !== undefined) return result;
  }
  throw new Error('timeout waiting for battery response');
}

// Scales a raw value onto 0-100, clamped.
function scale(value, min, max) {
  return Math.round(Math.min(100, Math.max(0, ((value - min) * 100) / (max - min))));
}

// Level from a Li-ion cell voltage, interpolated between [millivolts, percent] points.
function fromVoltage(mv, points) {
  if (mv >= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [v, p] = points[i];
    if (mv >= v) {
      const [hiV, hiP] = points[i - 1];
      return Math.round(p + ((mv - v) * (hiP - p)) / (hiV - v));
    }
  }
  return 0;
}

module.exports = { exchange, pad, scale, fromVoltage };
