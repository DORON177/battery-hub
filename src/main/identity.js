// One physical device can show up several ways: a DualSense on its cable and over Bluetooth, or a
// Bluetooth mouse both as a HID device and through Windows. Each is a "route" to the same card.
//
// The Bluetooth address is the proof they are the same device. It is in the HID serial number on
// Bluetooth and in the Windows device id, and PlayStation controllers report it over USB too.
const ADDRESS = /^[0-9a-f]{12}$/;

const address = (text) => (ADDRESS.test(text) ? `mac:${text}` : null);

function identityOf(device) {
  if (device.identity) return device.identity;
  const id = String(device.id || '').toLowerCase();
  const windows = /dev_([0-9a-f]{12})/.exec(id);
  if (windows) return `mac:${windows[1]}`;
  const serial = device.serialNumber === undefined ? id.split(':')[2] || '' : device.serialNumber.toLowerCase();
  return address(serial);
}

const isWindowsRoute = (id) => /^(bt|xinput):/.test(id);

// Ways to read a card, best first: a direct read beats what Windows last remembered.
function routesOf(card) {
  const routes = [{ id: card.id, driverId: card.driverId, profile: card.profile || null }, ...(card.links || [])];
  return routes.sort((a, b) => Number(isWindowsRoute(a.id)) - Number(isWindowsRoute(b.id)));
}

// The card that survives a merge keeps the user's name, then the longest history.
function keeperOf(cards) {
  const score = (c) => (c.customName ? 1e6 : 0) + (c.history || []).length;
  return cards.reduce((best, c) => (score(c) > score(best) ? c : best));
}

// Cards that are really one device: [{ keep, drop: [cards] }]
function planMerges(devices) {
  const groups = new Map();
  for (const card of Object.values(devices)) {
    const identity = identityOf(card);
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(card);
  }
  const plans = [];
  for (const cards of groups.values()) {
    if (cards.length < 2) continue;
    const keep = keeperOf(cards);
    plans.push({ keep, drop: cards.filter((c) => c !== keep) });
  }
  return plans;
}

module.exports = { identityOf, address, routesOf, planMerges };
