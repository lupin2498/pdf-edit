'use strict';
// Enumerates installed TrueType/OpenType fonts by reading their name and
// OS/2 tables. Results are cached in the user data folder.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function fontDirs() {
  if (process.platform === 'win32') {
    const win = process.env.WINDIR || 'C:\\Windows';
    const dirs = [path.join(win, 'Fonts')];
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
    return dirs;
  }
  if (process.platform === 'darwin') {
    return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')];
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')];
}

async function walk(dir, out, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out, depth + 1);
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(full);
  }
}

async function readAt(fh, offset, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

function decodeName(buf, platformID, encodingID) {
  if (platformID === 3 || platformID === 0) {
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    return s;
  }
  return buf.toString('latin1');
}

function parseNameTable(buf) {
  const count = buf.readUInt16BE(2);
  const strOffset = buf.readUInt16BE(4);
  const best = {};
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = buf.readUInt16BE(rec);
    const encodingID = buf.readUInt16BE(rec + 2);
    const languageID = buf.readUInt16BE(rec + 4);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const offset = buf.readUInt16BE(rec + 10);
    if (![1, 2, 4, 6].includes(nameID)) continue;
    let score = 0;
    if (platformID === 3 && (encodingID === 1 || encodingID === 0)) score = languageID === 0x409 ? 4 : 3;
    else if (platformID === 0) score = 2;
    else if (platformID === 1 && encodingID === 0) score = languageID === 0 ? 1 : 0;
    else continue;
    if (best[nameID] && best[nameID].score >= score) continue;
    const start = strOffset + offset;
    const raw = buf.subarray(start, start + length);
    best[nameID] = { score, value: decodeName(raw, platformID, encodingID) };
  }
  const get = (id) => (best[id] ? best[id].value.replace(/\0/g, '').trim() : '');
  return { family: get(1), subfamily: get(2), full: get(4), postscript: get(6) };
}

async function parseFontAt(fh, offset) {
  const header = await readAt(fh, offset, 12);
  if (header.length < 12) return null;
  const numTables = header.readUInt16BE(4);
  if (numTables > 200) return null;
  const dir = await readAt(fh, offset + 12, numTables * 16);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = i * 16;
    if (rec + 16 > dir.length) break;
    const tag = dir.toString('latin1', rec, rec + 4);
    tables[tag] = { offset: dir.readUInt32BE(rec + 8), length: dir.readUInt32BE(rec + 12) };
  }
  if (!tables.name || !tables.cmap) return null;
  const nameBuf = await readAt(fh, tables.name.offset, Math.min(tables.name.length, 512 * 1024));
  const names = parseNameTable(nameBuf);
  let weight = 400;
  let fsSelection = 0;
  let fsType = 0;
  if (tables['OS/2']) {
    const os2 = await readAt(fh, tables['OS/2'].offset, Math.min(tables['OS/2'].length, 96));
    if (os2.length >= 64) {
      weight = os2.readUInt16BE(4);
      fsType = os2.readUInt16BE(8);
      fsSelection = os2.readUInt16BE(62);
    }
  }
  const sub = (names.subfamily || '').toLowerCase();
  const italic = (fsSelection & 1) !== 0 || /italic|oblique/.test(sub);
  const bold = (fsSelection & 32) !== 0 || /bold/.test(sub) || weight >= 700;
  // fsType bit 1: restricted license embedding.
  const embeddable = (fsType & 0x000f) !== 0x0002;
  const isCff = !!tables['CFF '] && !tables.glyf;
  return { ...names, bold, italic, embeddable, cff: isCff };
}

async function parseFontFile(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = await readAt(fh, 0, 16);
    if (head.length < 12) return [];
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      const num = Math.min(head.readUInt32BE(8), 64);
      const offs = await readAt(fh, 12, num * 4);
      const out = [];
      for (let i = 0; i < num; i++) {
        const info = await parseFontAt(fh, offs.readUInt32BE(i * 4));
        if (info) out.push({ ...info, index: i });
      }
      return out;
    }
    const info = await parseFontAt(fh, 0);
    return info ? [{ ...info, index: 0 }] : [];
  } finally {
    await fh.close();
  }
}

async function listSystemFonts(cacheDir) {
  const cacheFile = path.join(cacheDir, 'font-cache.json');
  let cache = {};
  try {
    cache = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }
  const files = [];
  for (const d of fontDirs()) await walk(d, files);
  const result = [];
  const newCache = {};
  for (const file of files) {
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      continue;
    }
    const key = `${file}|${st.size}|${Math.round(st.mtimeMs)}`;
    let faces = cache[key];
    if (!faces) {
      try {
        faces = await parseFontFile(file);
      } catch {
        faces = [];
      }
    }
    newCache[key] = faces;
    for (const f of faces) {
      if (!f.family || !f.embeddable) continue;
      const style = f.bold && f.italic ? 'bolditalic' : f.bold ? 'bold' : f.italic ? 'italic' : 'regular';
      result.push({ family: f.family, style, file, index: f.index, postscript: f.postscript, cff: !!f.cff });
    }
  }
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(newCache));
  } catch {
    /* ignore */
  }
  return result;
}

module.exports = { listSystemFonts, parseFontFile };
