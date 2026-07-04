const HID = require('node-hid');

// A single physical product shows up as several HID "collections" (interfaces).
// Group them by vendor+product+serial so the rest of the app deals with one
// logical device that has several usage-page "channels" underneath it.
function listLogicalDevices() {
  const raw = HID.devices();
  const groups = new Map();

  for (const info of raw) {
    const key = `${info.vendorId}:${info.productId}:${info.serialNumber || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        vendorId: info.vendorId,
        productId: info.productId,
        product: info.product || 'Unknown device',
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

function findChannel(logicalDevice, usagePage) {
  return logicalDevice.channels.find((c) => c.usagePage === usagePage);
}

module.exports = { listLogicalDevices, findChannel };
