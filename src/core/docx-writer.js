// Minimal DOCX (Office Open XML) writer for PDF-to-Word conversion.
import { zipSync, strToU8 } from 'fflate';

const EMU_PER_PT = 12700;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hex(c) {
  return (c || [0, 0, 0]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * pages: [{ width, height, items: [ {kind:'paragraph', text, size, bold, italic, color, align, font, spaceBefore} | {kind:'image', bytes, ext:'png'|'jpeg', width, height (pt)} ] }]
 */
export function buildDocx(pages, { title = '', author = 'PDF Edit' } = {}) {
  const media = [];
  let imageId = 0;
  const body = [];
  pages.forEach((page, pi) => {
    for (const it of page.items) {
      if (it.kind === 'image') {
        imageId++;
        const name = `image${imageId}.${it.ext === 'jpeg' ? 'jpeg' : 'png'}`;
        media.push({ name, bytes: it.bytes, rid: `rIdImg${imageId}` });
        const maxW = (page.width - 72 * 1.5) * EMU_PER_PT;
        let cx = Math.round(it.width * EMU_PER_PT);
        let cy = Math.round(it.height * EMU_PER_PT);
        if (cx > maxW) {
          cy = Math.round((cy * maxW) / cx);
          cx = Math.round(maxW);
        }
        body.push(
          `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="Picture ${imageId}"/>` +
            `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
            `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
            `<pic:blipFill><a:blip r:embed="rIdImg${imageId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
            `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
            `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        );
      } else {
        const sz = Math.max(2, Math.round((it.size || 11) * 2));
        const rPr = [
          it.font ? `<w:rFonts w:ascii="${esc(it.font)}" w:hAnsi="${esc(it.font)}" w:cs="${esc(it.font)}"/>` : '',
          it.bold ? '<w:b/>' : '',
          it.italic ? '<w:i/>' : '',
          it.color && hex(it.color) !== '000000' ? `<w:color w:val="${hex(it.color)}"/>` : '',
          `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
        ].join('');
        const jc = it.align === 'center' ? 'center' : it.align === 'right' ? 'right' : it.align === 'justify' ? 'both' : 'left';
        const before = Math.max(0, Math.round((it.spaceBefore || 0) * 20));
        const runs = String(it.text || '')
          .split('\n')
          .map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
          .join('');
        body.push(`<w:p><w:pPr><w:spacing w:before="${before}" w:after="80"/><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`);
      }
    }
    if (pi < pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
  const first = pages[0] || { width: 595, height: 842 };
  const pgW = Math.round(first.width * 20);
  const pgH = Math.round(first.height * 20);
  const sect = `<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"${first.width > first.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body.join('')}${sect}</w:body></w:document>`;
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('') +
    '</Relationships>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const files = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'docProps/core.xml': strToU8(core),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(styles),
    'word/_rels/document.xml.rels': strToU8(rels),
  };
  for (const m of media) files[`word/media/${m.name}`] = [m.bytes, { level: 0 }];
  return zipSync(files, { level: 6 });
}

export function buildHtml(pages, { title = '' } = {}) {
  const toB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const parts = [];
  pages.forEach((page, i) => {
    parts.push(`<section class="page" id="page-${i + 1}">`);
    for (const it of page.items) {
      if (it.kind === 'image') {
        parts.push(`<p><img src="data:image/${it.ext};base64,${toB64(it.bytes)}" width="${Math.round(it.width * 1.333)}" alt=""></p>`);
      } else {
        const style = [`font-size:${(it.size || 11).toFixed(1)}pt`, it.bold ? 'font-weight:bold' : '', it.italic ? 'font-style:italic' : '', it.align && it.align !== 'left' ? `text-align:${it.align}` : '', it.color ? `color:#${hex(it.color)}` : ''].filter(Boolean).join(';');
        parts.push(`<p style="${style}">${esc(it.text).replace(/\n/g, '<br>')}</p>`);
      }
    }
    parts.push('</section>');
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,'Liberation Sans',sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}.page{border-bottom:1px dashed #bbb;padding:12px 0 24px;margin-bottom:24px}img{max-width:100%;height:auto}</style></head><body>${parts.join('\n')}</body></html>`;
}
