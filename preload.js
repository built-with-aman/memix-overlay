const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pocket', {
  getStickers: () => ipcRenderer.invoke('get-stickers'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  listSounds: () => ipcRenderer.invoke('list-sounds'),
  setConfig: (partial) => ipcRenderer.send('set-config', partial),

  // Tells main.js the first sticker has actually painted -- only then does the window
  // reveal itself. Fixes the "invisible widget on startup" bug.
  widgetReady: () => ipcRenderer.send('widget-ready'),

  toggleLock: (locked) => ipcRenderer.send('toggle-lock', locked),
  dragWindow: (dx, dy) => ipcRenderer.send('drag-window', { dx, dy }),
  resizeWindow: (width, height, animateMs) => ipcRenderer.send('resize-window', { width, height, animateMs }),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeAfterAnimation: () => ipcRenderer.send('close-after-animation'),
  getWorkArea: () => ipcRenderer.invoke('screen-work-area'),
  onStickersUpdated: (cb) => ipcRenderer.on('stickers-updated', (e, list) => cb(list))
});