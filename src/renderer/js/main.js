// Renderer entry point.
import { App } from './app.js';
import { loadSettings, settings } from './settings.js';
import { setLanguage } from './i18n.js';
import { installTooltips } from './ui/dialogs.js';
import { loadSystemFonts } from './pdf/fonts.js';

async function main() {
  await loadSettings();
  let lang = settings.language;
  if (!lang) {
    try {
      const info = await window.api.info();
      lang = /^vi/i.test(info.locale) ? 'vi' : 'en';
    } catch {
      lang = 'vi';
    }
  }
  setLanguage(lang);
  document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('hide-form-highlight', settings.showFormHighlight === false);
  installTooltips();
  const app = new App(document.getElementById('app'));
  window.__app = app;
  await app.init();
  // Enumerate installed fonts in the background.
  setTimeout(() => loadSystemFonts(), 1500);
}

main().catch((e) => {
  console.error(e);
  document.body.textContent = `Startup error: ${e && e.message ? e.message : e}`;
});
