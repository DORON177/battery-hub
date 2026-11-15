const test = require('node:test');
const assert = require('node:assert');
const { BH_STRINGS } = require('../src/renderer/i18n-strings');
const { bhTranslate, resolveLanguage } = require('../src/renderer/i18n-core');

test('the language follows Windows unless one is chosen', () => {
  assert.equal(resolveLanguage('system', 'es-MX'), 'es');
  assert.equal(resolveLanguage('system', 'zh-TW'), 'zh');
  assert.equal(resolveLanguage('system', 'he'), 'he');
  assert.equal(resolveLanguage('system', 'fr-FR'), 'en');
  assert.equal(resolveLanguage(undefined, 'he-IL'), 'he');
  assert.equal(resolveLanguage('es', 'he-IL'), 'es');
});

test('exact text and text with numbers or names are translated, the rest stays English', () => {
  assert.equal(bhTranslate('Settings', 'he'), 'הגדרות');
  assert.equal(bhTranslate('  Settings  ', 'es'), '  Ajustes  ', 'surrounding spaces are kept');
  assert.equal(bhTranslate('Updated 40s ago', 'es'), 'Actualizado hace 40 s');
  assert.equal(bhTranslate('~1d 16h left', 'zh'), '剩余约 1天 16小时');
  assert.equal(bhTranslate('12.0% an hour', 'he'), '12.0% בשעה');
  assert.equal(bhTranslate('MX Master 4 is at 15%. Time to charge.', 'es'), 'MX Master 4 está al 15%. Hora de cargarlo.');
  assert.equal(bhTranslate('Set up AULA F87 Pro', 'zh'), '设置 AULA F87 Pro');
  assert.equal(bhTranslate('Something new', 'he'), 'Something new');
  assert.equal(bhTranslate('Settings', 'en'), 'Settings');
});

test('every language has the same keys', () => {
  const keys = (l) => Object.keys(BH_STRINGS[l]).sort().join('|');
  assert.equal(keys('es'), keys('zh'));
  assert.equal(keys('es'), keys('he'));
});
