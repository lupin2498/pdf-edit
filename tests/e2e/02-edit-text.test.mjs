import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, ensureFixtures, FIXTURES, OUT, queueDialog, docState, waitToast, pageBox, appErrors } from './launch.mjs';
import { pdfText, hasPoppler } from '../unit/helpers.mjs';

const ACTIVE = '.doc-view:not(.hidden)';
let ctx;
before(async () => {
  await ensureFixtures();
  ctx = await launchApp({ files: [path.join(FIXTURES, 'unicode.pdf')] });
  await ctx.page.waitForSelector(`${ACTIVE} .page canvas`, { timeout: 20000 });
});
after(async () => {
  await ctx?.app.close();
});

async function clickBlock(page, prefix, where = 'end') {
  const b = await page.evaluate(
    ([sel, p]) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.title.startsWith(p));
      return el ? el.getBoundingClientRect().toJSON() : null;
    },
    [`${ACTIVE} .edit-block`, prefix],
  );
  assert.ok(b, `block "${prefix}" not found`);
  const x = where === 'end' ? b.x + b.width - 3 : b.x + 3;
  await page.mouse.click(x, b.y + b.height / 2);
  await page.waitForSelector('.text-editor', { timeout: 5000 });
}

const blockTitles = (page) => page.$$eval(`${ACTIVE} .edit-block`, (els) => els.map((e) => e.title));

test('edit mode groups lines into paragraphs', async () => {
  const { page } = ctx;
  await page.click('.ribbon-tab[data-rtab="edit"]');
  await page.waitForSelector(`${ACTIVE} .edit-block`, { timeout: 15000 });
  const titles = await blockTitles(page);
  assert.ok(titles.includes('Tiêu đề tài liệu'), titles.join('|'));
  assert.ok(titles.some((t) => t.startsWith('Xin chào thế giới.') && t.includes('Dòng thứ hai') && t.includes('Dòng thứ ba')), titles.join('|'));
});

test('line mode makes every line a separate block', async () => {
  const { page } = ctx;
  await page.click(`${ACTIVE} .props-panel .seg button:nth-child(2)`);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.title.startsWith('Dòng thứ hai')), `${ACTIVE} .edit-block`, { timeout: 10000 });
  const titles = await blockTitles(page);
  assert.equal(titles.length, 4, titles.join('|'));
});

test('replaces the text of an existing line', async () => {
  const { page } = ctx;
  await clickBlock(page, 'Dòng thứ hai');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Dòng thứ hai đã được sửa đổi.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const s = await docState(page);
  const p = s.pages[0];
  assert.equal(p.removals.length, 1);
  const texts = p.objects.filter((o) => o.type === 'text').map((o) => o.text);
  assert.deepEqual(texts, ['Dòng thứ hai đã được sửa đổi.']);
});

test('appends text to an existing line', async () => {
  const { page } = ctx;
  await clickBlock(page, 'Xin chào thế giới');
  await page.keyboard.press('End');
  await page.keyboard.type(' Thêm câu mới.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const s = await docState(page);
  const texts = s.pages[0].objects.filter((o) => o.type === 'text').map((o) => o.text);
  assert.ok(texts.some((t) => t.endsWith('tiếng Việt. Thêm câu mới.')), texts.join('|'));
});

test('adds a new text box', async () => {
  const { page } = ctx;
  await page.click('.rb-btn[data-cmd="addText"]');
  const pb = await pageBox(page);
  await page.mouse.click(pb.x + 120, pb.y + pb.height * 0.6);
  await page.waitForSelector('.text-editor', { timeout: 5000 });
  await page.keyboard.type('Văn bản mới thêm vào');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const s = await docState(page);
  assert.ok(s.pages[0].objects.some((o) => o.type === 'text' && o.text === 'Văn bản mới thêm vào'));
});

test('undo and redo a text edit', async () => {
  const { page } = ctx;
  const count = async () => (await docState(page)).pages[0].objects.length;
  const n = await count();
  await page.focus(`${ACTIVE} .viewer`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.equal(await count(), n - 1);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(200);
  assert.equal(await count(), n);
});

test('saves the edited text into the PDF', { skip: !hasPoppler() && 'poppler not installed' }, async () => {
  const { page } = ctx;
  const out = path.join(OUT, '02-unicode-edited.pdf');
  fs.rmSync(out, { force: true });
  await queueDialog(page, out);
  await page.keyboard.press('Control+Shift+S');
  await waitToast(page, /02-unicode-edited/);
  const text = pdfText(fs.readFileSync(out));
  assert.match(text, /Dòng thứ hai đã được sửa đổi\./);
  assert.match(text, /tiếng Việt\. Thêm câu mới\./);
  assert.match(text, /Văn bản mới thêm vào/);
  assert.doesNotMatch(text, /CẦNXÓA/);
  assert.equal(text.match(/Xin chào thế giới/g).length, 1);
  assert.equal(text.match(/Dòng thứ ba giữ nguyên/g).length, 1);
  assert.equal((await docState(page)).dirty, false);
});

test('edits a paragraph of a LibreOffice document', { skip: !fs.existsSync(path.join(FIXTURES, 'libreoffice.pdf')) && 'fixture missing' }, async () => {
  const { page } = ctx;
  await queueDialog(page, [path.join(FIXTURES, 'libreoffice.pdf')]);
  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => window.__app.activeDoc?.session.name === 'libreoffice.pdf', null, { timeout: 20000 });
  await page.click('.ribbon-tab[data-rtab="edit"]');
  await page.waitForSelector(`${ACTIVE} .edit-block`, { timeout: 15000 });
  await clickBlock(page, 'Đoạn văn đầu tiên');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ĐÃ CHỈNH SỬA.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  if (!hasPoppler()) return;
  const out = path.join(OUT, '02-libreoffice-edited.pdf');
  fs.rmSync(out, { force: true });
  await queueDialog(page, out);
  await page.keyboard.press('Control+Shift+S');
  await waitToast(page, /02-libreoffice-edited/);
  const text = pdfText(fs.readFileSync(out)).replace(/\s+/g, ' ');
  assert.match(text, /chức năng chỉnh sửa văn bản trong PDF\. ĐÃ CHỈNH SỬA\./);
  assert.equal(text.match(/Đoạn văn đầu tiên/g).length, 1);
  assert.match(text, /Second paragraph in English/);
});

test('no errors were logged', () => {
  assert.deepEqual(appErrors(ctx.logs), []);
});
