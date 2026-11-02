const HID = require('node-hid');

// A single physical product shows up as several HID "collections" (interfaces).
// Group them by vendor+product+serial so the rest of the app deals with one
// logical device that has several usage-page "channels" underneath it.
async function listLogicalDevices() {
  const raw = await HID.devicesAsync();
  const groups = new Map();

  for (const info of raw) {
    const key = `${info.vendorId}:${info.productId}:${info.serialNumber || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        vendorId: info.vendorId,
        productId: info.productId,
        product: (info.product || 'Unknown device').replace(/_/g, ' '),
        manufacturer: info.manufacturer || '',
        serialNumber: info.serialNumber || '',
        channels: [],
      });
    }
    groups.get(key).channels.push({
      path: info.path,
      usagePage: info.usagePage,
      usage: info.usage,
      interface: info.interface,
    });
  }

  return Array.from(groups.values());
}

// Several collections can share a usage page (a mouse has keyboard, mouse and system-control
// collections on page 0x01), so match on usage as well when it's known. Profiles saved before
// usage was recorded fall back to the first collection on the page.
function findChannel(logicalDevice, usagePage, usage) {
  const onPage = logicalDevice.channels.filter((c) => c.usagePage === usagePage);
  return onPage.find((c) => c.usage === usage) || onPage[0];
}

module.exports = { listLogicalDevices, findChannel };
