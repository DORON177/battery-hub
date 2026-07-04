const kysona = require('./kysona');
const mchose = require('./mchose');
const generic = require('./generic');

const knownDrivers = [kysona, mchose]; // auto-detected protocols, checked in order

function detectDriver(logicalDevice) {
  return knownDrivers.find((d) => d.matches(logicalDevice)) || null;
}

module.exports = { kysona, mchose, generic, detectDriver };
