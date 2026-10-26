'use strict';
// Exposes a minimal, explicit API to the renderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  info: () => invoke('app:info'),
  initialFiles: () => invoke('app:initial-files'),
  confirmClose: () => invoke('app:confirm-close'),
  tempPath: () => invoke('app:temp-path'),
  onOpenFiles: (cb) => ipcRenderer.on('app:open-files', (_e, files) => cb(files)),
  onRequestClose: (cb) => ipcRenderer.on('app:request-close', () => cb()),
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  recent: {
    get: () => invoke('recent:get'),
    add: (p) => invoke('recent:add', p),
    remove: (p) => invoke('recent:remove', p),
    clear: () => invoke('recent:clear'),
  },
  dialog: {
    open: (opts) => invoke('dialog:open', opts),
    save: (opts) => invoke('dialog:save', opts),
    folder: (opts) => invoke('dialog:folder', opts),
  },
  file: {
    read: (p) => invoke('file:read', p),
    write: (p, data) => invoke('file:write', p, data),
    exists: (p) => invoke('file:exists', p),
    stat: (p) => invoke('file:stat', p),
  },
  shell: {
    show: (p) => invoke('shell:show', p),
    openPath: (p) => invoke('shell:open-path', p),
    openExternal: (url) => invoke('shell:open-external', url),
  },
  fonts: {
    list: () => invoke('fonts:list'),
    read: (file) => invoke('fonts:read', file),
  },
  print: (opts) => invoke('print:page', opts),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  test: {
    queueDialog: (items) => invoke('test:queue-dialog', items),
  },
  window: {
    setTitle: (t) => invoke('window:set-title', t),
    setOverlay: (c) => invoke('window:set-overlay', c),
  },
});
