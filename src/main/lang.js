// The tray and notifications in the chosen language, using the same translations as the windows.
const electron = require('electron');
const store = require('./store');
const { bhTranslate, resolveLanguage } = require('../renderer/i18n-core');

function tr(text) {
  const locale = electron.app && electron.app.getLocale ? electron.app.getLocale() : '';
  return bhTranslate(text, resolveLanguage(store.getSettings().language, locale));
}

module.exports = { tr };
