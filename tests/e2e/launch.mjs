// Helpers to launch the Electron app under Playwright.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function launchApp({ files = [], userData = null, show = false, env = {} } = {}) {
  const dataDir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'pdfedit-e2e-'));
  const app = await electron.launch({
    args: [ROOT, ...files, '--no-sandbox'],
    env: { ...process.env, PDFEDIT_TEST: '1', PDFEDIT_USER_DATA: dataDir, PDFEDIT_SHOW: show ? '1' : '0', ELECTRON_ENABLE_LOGGING: '1', ...env },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.waitForLoadState('domcontentloaded');
  // Log error stacks and unhandled rejections so failures are diagnosable.
  await page.evaluate(() => {
    const orig = console.error.bind(console);
    console.error = (...a) => orig(...a.map((x) => (x && x.stack ? x.stack : x)));
    window.addEventListener('unhandledrejection', (e) => orig('[unhandledrejection]', e.reason && (e.reason.stack || e.reason)));
  });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  return { app, page, logs, dataDir };
}

export const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'generated');
export const OUT = path.join(ROOT, 'tests', 'output', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

export async function ensureFixtures() {
  if (!fs.existsSync(path.join(FIXTURES, 'ten-pages.pdf'))) {
    const mod = await import('../fixtures/make-fixtures.mjs');
    await mod.makeFixtures();
  }
}

// Answers the next native file dialogs with the given results (in order).
export const queueDialog = (page, ...results) => page.evaluate((r) => window.api.test.queueDialog(r), results);

export const pageBox = async (page, i = 0) => (await page.$$('.page'))[i].boundingBox();

export const docState = (page) =>
  page.evaluate(() => {
    const d = window.__app.activeDoc;
    if (!d) return null;
    return JSON.parse(JSON.stringify({ name: d.session.name, dirty: d.session.dirty, pages: d.session.state.pages, outline: d.session.state.outline }));
  });

export async function waitToast(page, re = null, timeout = 20000) {
  await page.waitForFunction(
    ([src, flags]) => {
      const rx = src ? new RegExp(src, flags) : null;
      return [...document.querySelectorAll('.toast.success')].some((t) => !rx || rx.test(t.textContent));
    },
    [re ? re.source : null, re ? re.flags : ''],
    { timeout },
  );
}

export async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
}

// Console errors that indicate a bug in the app (ignores Chromium noise).
export function appErrors(logs) {
  return logs.filter((l) => /^\[(pageerror|error)\]/.test(l) && !/Autofill|DevTools|Electron Security Warning/.test(l));
}
