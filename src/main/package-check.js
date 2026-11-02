// Tests an installed copy against a list of hashes written when it was built, so a damaged or
// altered install can be told apart from a bug. This finds corruption; it is not a security check,
// because the list ships in the same folder as the files it describes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST = 'package-manifest.json';

async function listFiles(root, folder = '') {
  const found = [];
  for (const entry of await fs.promises.readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(root, relative));
    else if (relative !== MANIFEST) found.push(relative);
  }
  return found;
}

async function hashFile(file) {
  return crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
}

// One short value that stands for the whole package, for comparing two installs.
function fingerprint(files) {
  const lines = Object.keys(files).sort().map((name) => `${name} ${files[name]}`).join('\n');
  return crypto.createHash('sha256').update(lines).digest('hex').slice(0, 16);
}

async function writeManifest(root, version) {
  const files = {};
  for (const name of (await listFiles(root)).sort()) files[name] = await hashFile(path.join(root, name));
  await fs.promises.writeFile(path.join(root, MANIFEST), JSON.stringify({ version, files }));
  return Object.keys(files).length;
}

// { total, missing: [names], changed: [names], fingerprint }, or null if there is no list to test.
async function verify(root) {
  let expected;
  try {
    expected = Object.entries(JSON.parse(await fs.promises.readFile(path.join(root, MANIFEST), 'utf8')).files);
  } catch (_) {
    return null;
  }
  const missing = [];
  const changed = [];
  const actual = {};
  for (const [name, hash] of expected) {
    try {
      actual[name] = await hashFile(path.join(root, name));
      if (actual[name] !== hash) changed.push(name);
    } catch (_) {
      missing.push(name);
    }
  }
  return { total: expected.length, missing, changed, fingerprint: fingerprint(actual) };
}

module.exports = { writeManifest, verify, fingerprint, MANIFEST };
