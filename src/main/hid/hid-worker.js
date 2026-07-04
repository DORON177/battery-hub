// Isolated node-hid worker (runs as an Electron utilityProcess).
//
// node-hid is a native addon and, on this Windows setup, occasionally corrupts the process
// heap during device open/read/close (WER crash signature 0xc0000374). Running every
// node-hid call here — out of the main process — means such a crash only kills THIS worker;
// the main app detects the exit and respawns it, losing at most one poll cycle.
const { listLogicalDevices } = require('./catalog');
const { kysona, generic, mchose } = require('./drivers');
const { capture } = require('./inspector');

function driverFor(id) {
  if (id === 'kysona') return kysona;
  if (id === 'mchose') return mchose;
  return generic;
}

async function handle(cmd, args) {
  if (cmd === 'enumerate') return listLogicalDevices();
  if (cmd === 'readBattery') {
    const [driverId, device, profile] = args;
    return driverFor(driverId).readBattery(device, profile);
  }
  if (cmd === 'capture') return capture(args[0]);
  throw new Error(`unknown hid command: ${cmd}`);
}

process.parentPort.on('message', async (e) => {
  const { id, cmd, args } = e.data;
  try {
    const result = await handle(cmd, args || []);
    process.parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    process.parentPort.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
});
