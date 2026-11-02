// Runs the devices described in table.js.
const { exchange } = require('./exchange');
const table = require('./table');

// The collection a table entry names; with none named, every vendor collection is a candidate.
function channelsFor(logicalDevice, entry) {
  const rule = entry.channel;
  if (!rule) return logicalDevice.channels.filter((c) => c.usagePage >= 0xff00);
  return logicalDevice.channels.filter((c) => (rule.usagePage === undefined || c.usagePage === rule.usagePage)
    && (rule.usage === undefined || c.usage === rule.usage)
    && (rule.interface === undefined || c.interface === rule.interface));
}

function matches(logicalDevice) {
  const entry = table.find(logicalDevice);
  return !!entry && channelsFor(logicalDevice, entry).length > 0;
}

async function runSteps(channel, entry, productId) {
  const reading = { charging: null };
  for (const step of entry.steps) {
    const part = await exchange(channel, step.request, (frame) => step.parse(frame, productId));
    if (part.offline) throw new Error(`${entry.kind} is off`);
    Object.assign(reading, part);
  }
  if (typeof reading.capacity !== 'number') throw new Error('waiting for device to report');
  return reading;
}

async function readBattery(logicalDevice) {
  const entry = table.find(logicalDevice);
  if (!entry) throw new Error('unsupported device');
  let lastError = new Error('no command channel');
  for (const channel of channelsFor(logicalDevice, entry)) {
    try {
      return await runSteps(channel, entry, logicalDevice.productId);
    } catch (e) {
      lastError = e;
      if (/ is off$/.test(e.message)) break; // the dongle answered: no other channel will do better
    }
  }
  throw lastError;
}

module.exports = { id: 'tabled', matches, readBattery, channelsFor };
