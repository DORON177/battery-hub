// Long-lived HID handles, one per channel path. Everything in the worker that talks to a
// device goes through here.
//
// Do not close a handle that may have a read pending. hid_read_timeout() leaves its
// overlapped read running when it times out, and hid_close() only calls CancelIo(), which
// cancels I/O issued by the *calling* thread. node-hid reads and closes on different threads,
// so the read survives, and hid_close() frees the buffer and OVERLAPPED the kernel is still
// using. The worker has a long history of heap-corruption crashes; this defect fits them,
// though it has not been reproduced on demand.
//
// So handles stay open across polls. The one safe moment to close is straight after a read
// fails, because a failed read leaves nothing pending. Anything else is released by ending
// the process, which is why hid-client recycles the worker after a calibration scan.
//
// Reads use dev.read() rather than a 'data' listener so that reads and writes on a handle run
// one at a time through node-hid's work queue instead of alongside a background read thread.
const HID = require('node-hid');

const MAX_QUEUED_FRAMES = 64; // more than the OS input buffer holds

const sessions = new Map(); // path -> Promise<HIDAsync>

function acquire(path) {
  let opening = sessions.get(path);
  if (!opening) {
    opening = HID.HIDAsync.open(path);
    sessions.set(path, opening);
    opening.catch(() => { if (sessions.get(path) === opening) sessions.delete(path); });
  }
  return opening;
}

// Returns the next frame as a plain array, or [] if none arrived within timeoutMs.
async function read(path, dev, timeoutMs) {
  try {
    return Array.from(await dev.read(timeoutMs));
  } catch (e) {
    sessions.delete(path);
    dev.close().catch(() => {});
    throw e;
  }
}

// Everything that arrived since the last poll, oldest first.
async function readQueued(path, dev) {
  const frames = [];
  while (frames.length < MAX_QUEUED_FRAMES) {
    const frame = await read(path, dev, 0);
    if (frame.length === 0) break;
    frames.push(frame);
  }
  return frames;
}

async function write(path, dev, bytes) {
  try { await dev.write(bytes); }
  catch (e) { sessions.delete(path); dev.close().catch(() => {}); throw e; }
}

module.exports = { acquire, read, readQueued, write };
