import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, ensureFixtures, FIXTURES, OUT, appErrors } from './launch.mjs';

let ctx;
let closed = false;
before(async () => {
  await ensureFixtures();
  ctx = await launchApp({ files: [path.join(FIXTURES, 'standard.pdf')], env: { PDFEDIT_CLOSE_GUARD: '1' } });
  ctx.app.on('close', () => (closed = true));
  await ctx.page.waitForSelector('.doc-view:not(.hidden) .page canvas', { timeout: 20000 });
});
after(async () => {
  if (!closed) await ctx?.app.close().catch(() => {});
});

const closeWindow = () => ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());

test('closing the window with unsaved changes asks first and can be cancelled', async () => {
  const { page } = ctx;
  await page.evaluate(() => {
    const d = window.__app.activeDoc;
    d.session.rotatePages([d.session.state.pages[0].uid], 90);
  });
  await closeWindow();
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.click('.modal .btn >> nth=0');
  await page.waitForTimeout(500);
  assert.equal(closed, false);
  assert.ok(await page.evaluate(() => window.__app.activeDoc.session.dirty));
});

test('choosing save writes the file and closes the app', async () => {
  const { page } = ctx;
  assert.deepEqual(appErrors(ctx.logs), []);
  const out = path.join(OUT, '07-saved-on-close.pdf');
  fs.rmSync(out, { force: true });
  await closeWindow();
  await page.waitForSelector('.modal', { timeout: 5000 });
  // Point the document at a scratch path so saving does not touch the fixture.
  await page.evaluate((p) => {
    window.__app.activeDoc.session.filePath = p;
  }, out);
  await page.click('.modal .btn.primary');
  for (let i = 0; i < 50 && !closed; i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(closed, true);
  assert.ok(fs.existsSync(out));
});
