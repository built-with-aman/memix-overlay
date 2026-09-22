const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memix', {
  getStickers: () => ipcRenderer.invoke('get-stickers'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  listSounds: () => ipcRenderer.invoke('list-sounds'),
  setConfig: (partial) => ipcRenderer.send('set-config', partial),

  // Tells main.js the first sticker has actually painted -- only then does the window
  // reveal itself. Fixes the "invisible widget on startup" bug.
  widgetReady: () => ipcRenderer.send('widget-ready'),

  toggleLock: (locked) => ipcRenderer.send('toggle-lock', locked),
  dragWindow: (dx, dy) => ipcRenderer.send('drag-window', { dx, dy }),
  resizeWindow: (width, height, animateMs, x, y) => ipcRenderer.send('resize-window', { width, height, animateMs, x, y }),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeAfterAnimation: () => ipcRenderer.send('close-after-animation'),
  getWorkArea: () => ipcRenderer.invoke('screen-work-area'),
  onStickersUpdated: (cb) => ipcRenderer.on('stickers-updated', (e, list) => cb(list)),

  // Download helpers
  downloadSticker: (url, suggestedName) => ipcRenderer.invoke('download-sticker', url, suggestedName),
  downloadSound: (url, suggestedName) => ipcRenderer.invoke('download-sound', url, suggestedName),
  deleteSticker: (filename) => ipcRenderer.invoke('delete-sticker', filename),
});
