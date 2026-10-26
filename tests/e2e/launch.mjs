// Helpers to launch the Electron app under Playwright.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function launchApp({ files = [], userData = null, show = false } = {}) {
  const dataDir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'pdfedit-e2e-'));
  const app = await electron.launch({
    args: [ROOT, ...files, '--no-sandbox'],
    env: { ...process.env, PDFEDIT_TEST: '1', PDFEDIT_USER_DATA: dataDir, PDFEDIT_SHOW: show ? '1' : '0', ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  return { app, page, logs, dataDir };
}
