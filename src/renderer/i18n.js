// Shows a window in the chosen language. The code writes English; this swaps each piece of text
// on screen for its translation as it appears (bhTranslate in i18n-core.js), and keeps the English
// so the language can change without reloading. Hebrew turns the window right to left.
// Load after i18n-strings.js and i18n-core.js, before the window's own scripts.
(function () {
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
  let lang = 'en';

  // Text the user typed or the device reported (names) is marked data-no-translate.
  const skipped = (el) => !el || SKIP.has(el.nodeName) || (el.closest && el.closest('[data-no-translate]'));

  function text(node) {
    if (skipped(node.parentElement)) return;
    // Code wrote new text into this node since we last translated it: that is the new English.
    if (node.nodeValue !== node.bhOut) node.bhEn = node.nodeValue;
    const out = bhTranslate(node.bhEn, lang);
    node.bhOut = out;
    if (node.nodeValue !== out) node.nodeValue = out;
  }

  function attrs(el) {
    if (skipped(el)) return;
    el.bhAttrs = el.bhAttrs || {};
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value == null) continue;
      const seen = el.bhAttrs[name];
      if (!seen || value !== seen.out) el.bhAttrs[name] = { en: value };
      const out = bhTranslate(el.bhAttrs[name].en, lang);
      el.bhAttrs[name].out = out;
      if (value !== out) el.setAttribute(name, out);
    }
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) { text(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) attrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) text(node);
      else attrs(node);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') text(r.target);
      else if (r.type === 'attributes') attrs(r.target);
      else r.addedNodes.forEach(walk);
    }
  });

  function apply(next) {
    lang = next;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    walk(document.body);
    document.querySelectorAll('template').forEach((t) => walk(t.content));
  }

  window.bhSetLanguage = (setting) => apply(resolveLanguage(setting, navigator.language));
  window.bhLanguage = () => lang;

  const start = async () => {
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    let setting = 'system';
    try { if (window.batteryHub && window.batteryHub.getSettings) setting = (await window.batteryHub.getSettings()).language; } catch (_) {}
    window.bhSetLanguage(setting);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
