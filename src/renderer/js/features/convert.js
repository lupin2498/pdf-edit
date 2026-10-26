// Conversions: PDF to images, text, Word and HTML.
import { h, stripExt, joinPath, dirname } from '../ui/dom.js';
import { openDialog, withBusy, alertDialog, toast } from '../ui/dialogs.js';
import { openPdfjs, makeViewport, pdfjsLib, destroyPdf } from '../pdf/pdfjs.js';
import { parsePageRanges } from '../../../core/page-ranges.js';
import { loadPdf } from '../../../core/builder.js';
import { analyzePageContent } from '../../../core/content-editor.js';
import { allImages } from '../../../core/interpreter.js';
import { buildTextBlocks } from '../doc/text-blocks.js';
import { decodeImageXObject, imageDataToBytes, canvasToBytes } from '../doc/image-tools.js';
import { buildDocx, buildHtml } from '../../../core/docx-writer.js';
import { registry } from '../pdf/fonts.js';
import { t, errorMessage } from '../i18n.js';

async function builtDocument(doc) {
  doc.overlay.commitEditing();
  const { bytes } = await doc.session.buildBytes({ security: null });
  const pdf = await openPdfjs(bytes);
  return { bytes, pdf };
}

function rangeRow(n) {
  const input = h('input', { class: 'input', placeholder: `1-${n}` });
  return { el: h('div', { class: 'form-row' }, h('label', null, t('page.range')), input, h('div', { class: 'hint' }, t('combine.rangeHint'))), get: () => parsePageRanges(input.value, n) };
}

function defaultOut(doc, ext) {
  const base = stripExt(doc.session.name);
  return doc.session.filePath ? joinPath(dirname(doc.session.filePath), `${base}.${ext}`) : `${base}.${ext}`;
}

export async function toImages(doc) {
  const n = doc.session.state.pages.length;
  const format = h('select', { class: 'input' }, h('option', { value: 'png' }, 'PNG'), h('option', { value: 'jpeg' }, 'JPG'));
  const dpi = h('select', { class: 'input' }, [72, 96, 150, 200, 300].map((d) => h('option', { value: d, selected: d === 150 }, `${d} DPI`)));
  const range = rangeRow(n);
  const res = await openDialog({
    title: t('convert.toImage'),
    content: [h('div', { class: 'form-grid' }, h('div', { class: 'form-row' }, h('label', null, t('convert.format')), format), h('div', { class: 'form-row' }, h('label', null, t('convert.resolution')), dpi)), range.el],
    buttons: [
      { label: t('common.cancel'), value: null },
      { label: t('convert.run'), primary: true, onClick: () => { try { return { idx: range.get(), format: format.value, dpi: parseInt(dpi.value, 10) }; } catch (e) { alertDialog(errorMessage(e)); return false; } } },
    ],
  }).promise;
  if (!res || !res.idx.length) return;
  const folder = await window.api.dialog.folder({ title: t('split.chooseFolder') });
  if (!folder) return;
  const base = stripExt(doc.session.name);
  try {
    await withBusy(t('convert.running'), async (busy) => {
      const { pdf } = await builtDocument(doc);
      try {
        for (let k = 0; k < res.idx.length; k++) {
          const i = res.idx[k];
          const page = await pdf.getPage(i + 1);
          const vp = makeViewport(page, { scale: res.dpi / 72, rotation: page.rotate });
          const canvas = new OffscreenCanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, canvas, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
          const bytes = await canvasToBytes(canvas, res.format === 'png' ? 'image/png' : 'image/jpeg', 0.9);
          await window.api.file.write(joinPath(folder, `${base}_${String(i + 1).padStart(3, '0')}.${res.format === 'png' ? 'png' : 'jpg'}`), bytes);
          busy.set((k + 1) / res.idx.length);
        }
      } finally {
        destroyPdf(pdf);
      }
    });
    toast(t('convert.done'), { type: 'success', action: { label: t('common.openFolder'), onClick: () => window.api.shell.openPath(folder) } });
  } catch (e) {
    alertDialog(errorMessage(e));
  }
}

function linesFromTextContent(tc) {
  const items = tc.items.filter((i) => typeof i.str === 'string');
  const lines = [];
  let cur = null;
  for (const it of items) {
    const y = it.transform[5];
    if (!cur || Math.abs(cur.y - y) > Math.max(2, (it.height || 10) * 0.5)) {
      cur = { y, parts: [] };
      lines.push(cur);
    }
    cur.parts.push(it);
  }
  return lines.map((l) => {
    l.parts.sort((a, b) => a.transform[4] - b.transform[4]);
    let s = '';
    let lastEnd = null;
    for (const p of l.parts) {
      if (lastEnd !== null && p.transform[4] - lastEnd > (p.height || 10) * 0.2 && !s.endsWith(' ') && !p.str.startsWith(' ')) s += ' ';
      s += p.str;
      lastEnd = p.transform[4] + (p.width || 0);
    }
    return s.replace(/\s+$/, '');
  });
}

export async function toText(doc) {
  const out = await window.api.dialog.save({ defaultPath: defaultOut(doc, 'txt'), filters: [{ name: t('filter.text'), extensions: ['txt'] }] });
  if (!out) return;
  try {
    await withBusy(t('convert.running'), async (busy) => {
      const { pdf } = await builtDocument(doc);
      try {
        const parts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          parts.push(linesFromTextContent(tc).join('\r\n'));
          busy.set(i / pdf.numPages);
        }
        await window.api.file.write(out, new TextEncoder().encode('﻿' + parts.join('\r\n\f\r\n')));
      } finally {
        destroyPdf(pdf);
      }
    });
    toast(t('common.savedTo', { path: out }), { type: 'success', action: { label: t('common.open'), onClick: () => window.api.shell.openPath(out) } });
  } catch (e) {
    alertDialog(errorMessage(e));
  }
}

async function extractFlow(doc, busy) {
  const { bytes, pdf } = await builtDocument(doc);
  const lib = await loadPdf(bytes);
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const analysis = analyzePageContent(lib, lib.getPage(i - 1));
      const blocks = buildTextBlocks(tc, { mode: 'paragraph', analysis }).filter((b) => !b.invisible && b.orientation === 0);
      const items = [];
      for (const b of blocks) {
        const family = b.font ? registry.matchFamily(b.font.name, b.font) : 'Arial';
        items.push({ kind: 'paragraph', top: b.rect[3], left: b.rect[0], text: b.lineTexts.length > 1 && b.align !== 'left' ? b.lineTexts.join('\n') : b.text, size: Math.round(b.size * 2) / 2, bold: b.font?.bold, italic: b.font?.italic, color: b.color, align: b.align, font: family.replace(/^Liberation Sans$/, 'Arial').replace(/^Liberation Serif$/, 'Times New Roman').replace(/^Liberation Mono$/, 'Courier New') });
      }
      for (const { image } of allImages(analysis)) {
        const w = image.bbox[2] - image.bbox[0];
        const hgt = image.bbox[3] - image.bbox[1];
        if (w < 12 || hgt < 12 || !image.stream) continue;
        try {
          const { imageData, jpeg } = await decodeImageXObject(lib.context, image.stream);
          const imgBytes = jpeg ? image.stream.contents : await imageDataToBytes(imageData, 'image/png');
          items.push({ kind: 'image', top: image.bbox[3], left: image.bbox[0], bytes: imgBytes, ext: jpeg ? 'jpeg' : 'png', width: w, height: hgt });
        } catch {
          /* unsupported image */
        }
      }
      items.sort((a, b) => b.top - a.top || a.left - b.left);
      let prevBottom = null;
      for (const it of items) {
        if (it.kind === 'paragraph' && prevBottom !== null) it.spaceBefore = Math.min(24, Math.max(0, prevBottom - it.top - (it.size || 11) * 0.6));
        prevBottom = it.kind === 'image' ? it.top - it.height : it.top - (it.size || 11) * 1.2;
      }
      const [x0, y0, x1, y1] = page.view;
      const rotated = page.rotate % 180 !== 0;
      pages.push({ width: rotated ? y1 - y0 : x1 - x0, height: rotated ? x1 - x0 : y1 - y0, items });
      if (busy) busy.set(i / pdf.numPages);
    }
  } finally {
    destroyPdf(pdf);
  }
  return pages;
}

export async function toWord(doc) {
  const out = await window.api.dialog.save({ defaultPath: defaultOut(doc, 'docx'), filters: [{ name: 'Word', extensions: ['docx'] }] });
  if (!out) return;
  try {
    await withBusy(t('convert.running'), async (busy) => {
      const pages = await extractFlow(doc, busy);
      const bytes = buildDocx(pages, { title: stripExt(doc.session.name) });
      await window.api.file.write(out, bytes);
    });
    toast(t('common.savedTo', { path: out }), { type: 'success', action: { label: t('common.open'), onClick: () => window.api.shell.openPath(out) } });
  } catch (e) {
    console.error(e);
    alertDialog(errorMessage(e));
  }
}

export async function toHtml(doc) {
  const out = await window.api.dialog.save({ defaultPath: defaultOut(doc, 'html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (!out) return;
  try {
    await withBusy(t('convert.running'), async (busy) => {
      const pages = await extractFlow(doc, busy);
      await window.api.file.write(out, new TextEncoder().encode(buildHtml(pages, { title: stripExt(doc.session.name) })));
    });
    toast(t('common.savedTo', { path: out }), { type: 'success', action: { label: t('common.open'), onClick: () => window.api.shell.openPath(out) } });
  } catch (e) {
    alertDialog(errorMessage(e));
  }
}
