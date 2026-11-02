// electron-builder afterPack hook: records a hash of every file in the app, so Settings > Help can
// test an installed copy against what was shipped.
const path = require('path');
const { writeManifest } = require('../src/main/package-check');

exports.default = async function writePackageManifest(context) {
  const root = path.join(context.appOutDir, 'resources', 'app');
  const count = await writeManifest(root, context.packager.appInfo.version);
  console.log(`  • package manifest written for ${count} files`);
};
