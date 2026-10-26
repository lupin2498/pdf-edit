'use strict';
// Electron main process for PDF Edit.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { listSystemFonts } = require('./system-fonts');

const APP_ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const ASSETS_DIR = path.join(APP_ROOT, 'src', 'assets');
const isDev = !app.isPackaged && process.env.PDFEDIT_DEV === '1';
const isTest = process.env.PDFEDIT_TEST === '1';

if (process.env.PDFEDIT_USER_DATA) app.setPath('userData', process.env.PDFEDIT_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveAppUrl(urlString) {
  const url = new URL(urlString);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let base = RENDERER_DIR;
  if (rel.startsWith('assets/')) {
    base = ASSETS_DIR;
    rel = rel.slice('assets/'.length);
  }
  const full = path.normalize(path.join(base, rel));
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

// ---------------------------------------------------------------------------
// Settings & recent files

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = null;
function loadSettings() {
  if (settings) return settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    settings = {};
  }
  settings.recent = Array.isArray(settings.recent) ? settings.recent : [];
  return settings;
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('settings save failed', e);
  }
}
function addRecent(filePath) {
  loadSettings();
  settings.recent = [filePath, ...settings.recent.filter((p) => p !== filePath)].slice(0, 20);
  saveSettings();
}

// ---------------------------------------------------------------------------
// Windows

let mainWindow = null;
const pendingFiles = [];
// Test-only queue of responses for native file dialogs (used by E2E tests).
const dialogQueue = [];

function filesFromArgv(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    if (!/\.(pdf|png|jpe?g)$/i.test(a)) continue;
    try {
      const p = path.resolve(a);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function createWindow() {
  const s = loadSettings();
  const display = screen.getPrimaryDisplay().workAreaSize;
  const bounds = s.windowBounds || { width: Math.min(1440, display.width), height: Math.min(920, display.height) };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'PDF Edit',
    backgroundColor: '#f3f4f8',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1f2a44', symbolColor: '#ffffff', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev || isTest || process.env.PDFEDIT_DEVTOOLS === '1',
    },
  });
  if (s.maximized && !isTest) mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.loadURL('app://app/index.html');
  mainWindow.once('ready-to-show', () => {
    if (!isTest || process.env.PDFEDIT_SHOW === '1') mainWindow.show();
  });
  if (isTest && process.env.PDFEDIT_SHOW !== '1') {
    mainWindow.webContents.once('did-finish-load', () => mainWindow.showInactive());
  }

  const remember = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    loadSettings();
    settings.maximized = mainWindow.isMaximized();
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) settings.windowBounds = mainWindow.getBounds();
    saveSettings();
  };
  mainWindow.on('resize', debounce(remember, 500));
  mainWindow.on('move', debounce(remember, 500));

  let allowClose = false;
  mainWindow.on('close', (e) => {
    if (allowClose || isTest) return;
    e.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });
  ipcMain.removeHandler('app:confirm-close');
  ipcMain.handle('app:confirm-close', () => {
    allowClose = true;
    remember();
    mainWindow.close();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links from documents open in the default browser (after renderer confirmation).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && (isDev || process.env.PDFEDIT_DEVTOOLS === '1')) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function sendOpenFiles(files) {
  if (!files.length) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:open-files', files);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingFiles.push(...files);
  }
}

// ---------------------------------------------------------------------------
// IPC

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    locale: app.getLocale(),
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    isTest,
  }));
  ipcMain.handle('app:initial-files', () => {
    const files = pendingFiles.splice(0);
    return files;
  });
  ipcMain.handle('settings:get', () => {
    const s = loadSettings();
    return { ...s, windowBounds: undefined };
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    loadSettings();
    Object.assign(settings, patch || {});
    saveSettings();
    if (patch && patch.theme) nativeTheme.themeSource = patch.theme === 'dark' ? 'dark' : patch.theme === 'light' ? 'light' : 'system';
    return true;
  });
  ipcMain.handle('recent:get', async () => {
    loadSettings();
    const out = [];
    for (const p of settings.recent) {
      try {
        const st = await fsp.stat(p);
        out.push({ path: p, name: path.basename(p), size: st.size, mtime: st.mtimeMs });
      } catch {
        /* missing file */
      }
    }
    return out;
  });
  ipcMain.handle('recent:add', (_e, p) => {
    addRecent(p);
    try {
      app.addRecentDocument(p);
    } catch {
      /* ignore */
    }
    return true;
  });
  ipcMain.handle('recent:remove', (_e, p) => {
    loadSettings();
    settings.recent = settings.recent.filter((x) => x !== p);
    saveSettings();
    return true;
  });
  ipcMain.handle('recent:clear', () => {
    loadSettings();
    settings.recent = [];
    saveSettings();
    return true;
  });

  ipcMain.handle('test:queue-dialog', (_e, items) => {
    if (isTest) dialogQueue.push(...items);
    return isTest;
  });
  ipcMain.handle('dialog:open', async (_e, opts = {}) => {
    if (isTest && dialogQueue.length) {
      const v = dialogQueue.shift();
      return v === null ? [] : Array.isArray(v) ? v : [v];
    }
    const filters = opts.filters || [{ name: 'PDF', extensions: ['pdf'] }];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: opts.title,
      defaultPath: opts.defaultPath,
      properties: ['openFile', ...(opts.multiple ? ['multiSelections'] : [])],
      filters,
    });
    return res.canceled ? [] : res.filePaths;
  });
  ipcMain.handle('dialog:save', async (_e, opts = {}) => {
    if (isTest && dialogQueue.length) return dialogQueue.shift();
    const res = await dialog.showSaveDialog(mainWindow, {
      title: opts.title,
      defaultPath: opts.defaultPath,
      filters: opts.filters || [{ name: 'PDF', extensions: ['pdf'] }],
    });
    return res.canceled ? null : res.filePath;
  });
  ipcMain.handle('dialog:folder', async (_e, opts = {}) => {
    if (isTest && dialogQueue.length) return dialogQueue.shift();
    const res = await dialog.showOpenDialog(mainWindow, {
      title: opts.title,
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('file:read', async (_e, p) => {
    const buf = await fsp.readFile(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('file:stat', async (_e, p) => {
    try {
      const st = await fsp.stat(p);
      return { size: st.size, mtime: st.mtimeMs, isFile: st.isFile() };
    } catch {
      return null;
    }
  });
  ipcMain.handle('file:write', async (_e, p, data) => {
    const dir = path.dirname(p);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.tmp`);
    const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
    await fsp.writeFile(tmp, buf);
    try {
      await fsp.rename(tmp, p);
    } catch (err) {
      // Fallback for files locked against rename (e.g. on Windows).
      try {
        await fsp.writeFile(p, buf);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
      if (err && err.code !== 'EPERM' && err.code !== 'EXDEV' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
    }
    return true;
  });
  ipcMain.handle('file:exists', async (_e, p) => {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('shell:show', (_e, p) => {
    if (!isTest) shell.showItemInFolder(p);
    return true;
  });
  ipcMain.handle('shell:open-path', (_e, p) => (isTest ? '' : shell.openPath(p)));
  ipcMain.handle('shell:open-external', async (_e, url) => {
    if (!/^(https?|mailto):/i.test(url)) return false;
    if (isTest) return true;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('fonts:list', async () => {
    try {
      return await listSystemFonts(app.getPath('userData'));
    } catch (e) {
      console.error('font scan failed', e);
      return [];
    }
  });
  ipcMain.handle('fonts:read', async (_e, file) => {
    if (!/\.(ttf|otf|ttc)$/i.test(file)) throw new Error('Not a font file');
    const buf = await fsp.readFile(file);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('print:page', async (e, opts = {}) => {
    const wc = e.sender;
    if (isTest) {
      const data = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
      if (process.env.PDFEDIT_PRINT_OUT) await fsp.writeFile(process.env.PDFEDIT_PRINT_OUT, data);
      return { success: true, test: true, size: data.length };
    }
    return new Promise((resolve) => {
      wc.print({ silent: false, printBackground: true, margins: { marginType: 'none' }, ...opts }, (success, reason) => resolve({ success, reason }));
    });
  });
  ipcMain.handle('window:set-title', (_e, title) => {
    if (mainWindow) mainWindow.setTitle(title);
    return true;
  });
  ipcMain.handle('window:set-overlay', (_e, colors) => {
    try {
      if (mainWindow && mainWindow.setTitleBarOverlay) mainWindow.setTitleBarOverlay(colors);
    } catch {
      /* unsupported */
    }
    return true;
  });
  ipcMain.handle('app:temp-path', () => app.getPath('temp'));
}

// ---------------------------------------------------------------------------
// Startup

const gotLock = isTest ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingFiles.push(...filesFromArgv(process.argv));
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    sendOpenFiles(files);
  });
  app.on('open-file', (e, p) => {
    e.preventDefault();
    sendOpenFiles([p]);
  });

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const file = resolveAppUrl(request.url);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        const data = await fsp.readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    const s = loadSettings();
    if (s.theme) nativeTheme.themeSource = s.theme === 'dark' ? 'dark' : s.theme === 'light' ? 'light' : 'system';
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { resolveAppUrl, filesFromArgv, pathToFileURL };
