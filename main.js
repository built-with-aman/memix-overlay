const { app, BrowserWindow, ipcMain, screen } = require('electron');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ---------- paths & constants ----------
const STICKERS_DIR = path.join(__dirname, 'assets', 'stickers');
const SOUNDS_DIR   = path.join(__dirname, 'assets', 'sounds');
const CONFIG_PATH  = path.join(__dirname, 'config.json');
const VALID_EXT = ['.png', '.webp', '.svg', '.gif', '.jpg', '.jpeg',
                   '.mp4', '.webm', '.mov', '.mkv', '.avi'];

// Frozen so nothing accidentally mutates the defaults at runtime.
const DEFAULT_CONFIG = Object.freeze({
  stickerIntervalMs: 7000,
  startCorner: 'bottom-right',
  widgetSize: 220,
  alwaysOnTop: true,
  locked: false,
  sound:    { enabled: true, volume: 0.5 },
  captions: { enabled: false, voicePreference: 'female' },
  transitions: ['dissolveParticles', 'paperFold', 'liquidMorph', 'squashPop',
                'bounceSwap', 'floatingSmoke', 'elasticSlide', 'spinDisappear',
                'comicBurst', 'softFade'],
});

let win = null;
let stickerWatcher = null;
let config = loadConfig();

// ---------- single-instance lock (issue #3) ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------- tiny debounce util ----------
function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.flush  = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  return d;
}

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
  catch (err) { console.error('[memix] mkdir failed for', dir, err); }
}

// ---------- config load + save (issue #1 + upgrade safety) ----------
function loadConfig() {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    delete loaded.clickThrough;                   // legacy field, ignore
    return {
      ...DEFAULT_CONFIG,
      ...loaded,
      sound:    { ...DEFAULT_CONFIG.sound,    ...(loaded.sound    || {}) },
      captions: { ...DEFAULT_CONFIG.captions, ...(loaded.captions || {}) },
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function writeConfigNow() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }
  catch (err) { console.error('[memix] save config failed:', err); }
}
// Safe to call from every slider tick — collapses to one write per 250ms.
const saveConfig = debounce(writeConfigNow, 250);

// ---------- categorize (unchanged, kept for clarity) ----------
function categorize(filename) {
  const name = filename.toLowerCase();
  const map = {
    laugh: ['laugh', 'lol', 'haha', 'funny'],
    shock: ['shock', 'surprise', 'gasp', 'wow'],
    happy: ['happy', 'joy', 'smile', 'yay'],
    dance: ['dance', 'groove', 'party'],
    angry: ['angry', 'mad', 'rage'],
    sleep: ['sleep', 'tired', 'yawn', 'zzz'],
    cute:  ['cute', 'kawaii', 'adorable', 'uwu'],
    think: ['think', 'hmm', 'ponder', 'confused'],
  };
  for (const [cat, keys] of Object.entries(map)) {
    if (keys.some((k) => name.includes(k))) return cat;
  }
  const categories = Object.keys(map);
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return categories[hash % categories.length];
}

// ---------- scan (issue: skip dirs & symlinks) ----------
function scanStickers() {
  ensureDir(STICKERS_DIR);
  let entries = [];
  try {
    entries = fs.readdirSync(STICKERS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('[memix] scan failed:', err);
    return [];
  }
  return entries
    .filter((e) => e.isFile() && VALID_EXT.includes(path.extname(e.name).toLowerCase()))
    .map((e) => ({
      file: e.name,
      path: path.join(STICKERS_DIR, e.name).replace(/\\/g, '/'),
      category: categorize(e.name),
    }));
}

// ---------- watcher (issue #2 + #4) ----------
function startStickerWatcher() {
  stopStickerWatcher();
  ensureDir(STICKERS_DIR);

  // Collapse editor-save bursts (rename+change+change) into a single notify.
  const notify = debounce(() => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('stickers-updated', scanStickers());
    }
  }, 180);

  try {
    stickerWatcher = fs.watch(STICKERS_DIR, { persistent: true }, notify);
    stickerWatcher.on('error', (err) => {
      console.error('[memix] watcher error:', err);
      stopStickerWatcher();
    });
  } catch (err) {
    console.error('[memix] could not start watcher:', err);
  }
}

function stopStickerWatcher() {
  if (stickerWatcher) {
    try { stickerWatcher.close(); } catch { /* ignore */ }
    stickerWatcher = null;
  }
}

// ---------- window geometry ----------
function cornerPosition(corner, size, workArea) {
  const margin = 24;
  const w = size, h = size;
  switch (corner) {
    case 'top-left':    return { x: workArea.x + margin,                       y: workArea.y + margin };
    case 'top-right':   return { x: workArea.x + workArea.width  - w - margin, y: workArea.y + margin };
    case 'bottom-left': return { x: workArea.x + margin,                       y: workArea.y + workArea.height - h - margin };
    default:            return { x: workArea.x + workArea.width  - w - margin, y: workArea.y + workArea.height - h - margin };
  }
}

// ---------- window ----------
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const size = config.widgetSize;
  const pos = cornerPosition(config.startCorner, size, display.workArea);

  win = new BrowserWindow({
    width: size,
    height: size,
    x: pos.x,
    y: pos.y,
    minWidth: 120,
    minHeight: 120,
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // keep sticker loop smooth when unfocused
    },
  });

  win.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
  win.setMovable(!config.locked);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.on('closed', () => {
    stopStickerWatcher();
    win = null;
  });

  startStickerWatcher();
}

// ---------- app lifecycle (issue #5) ----------
app.whenReady().then(createWindow);

app.on('activate', () => {
  // macOS: clicking dock icon after close should reopen the widget
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  saveConfig.flush();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  saveConfig.flush();
  stopStickerWatcher();
});

// ---------- IPC handlers ----------
ipcMain.handle('get-stickers',     () => scanStickers());
ipcMain.handle('get-config',       () => config);
ipcMain.handle('screen-work-area', () => {
  // Use the display where the window currently is (multi-monitor safe)
  if (win && !win.isDestroyed()) {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return display.workArea;
  }
  return screen.getPrimaryDisplay().workArea;
});

ipcMain.handle('list-sounds', () => {
  ensureDir(SOUNDS_DIR);
  try {
    return fs
      .readdirSync(SOUNDS_DIR, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(SOUNDS_DIR, e.name).replace(/\\/g, '/'));
  } catch (err) {
    console.error('[memix] list-sounds failed:', err);
    return [];
  }
});

// ---------- download from URL into stickers or sounds ----------
function downloadToFolder(url, folder, suggestedName) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      let filename = suggestedName || path.basename(parsed.pathname).split('?')[0] || `download-${Date.now()}`;
      // sanitize
      let safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_').slice(0, 100);
      if (!safeName || safeName === '.' || safeName === '..') {
        safeName = `download-${Date.now()}.gif`;
      }
      // always make unique so second download of same name works
      const ext = path.extname(safeName) || '.gif';
      const base = path.basename(safeName, ext).slice(0, 80) || 'meme';
      safeName = `${base}-${Date.now()}${ext}`;

      ensureDir(folder);
      const dest = path.join(folder, safeName);

      const file = fs.createWriteStream(dest);
      const request = lib.get(url, { headers: { 'User-Agent': 'MemixOverlay/1.0' } }, (res) => {
        // follow one redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          return downloadToFolder(res.headers.location, folder, safeName).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve({ path: dest.replace(/\\/g, '/'), name: safeName });
        });
      });
      request.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
      request.setTimeout(20000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    } catch (err) {
      reject(err);
    }
  });
}

ipcMain.handle('download-sticker', async (_e, url, suggestedName) => {
  try {
    const result = await downloadToFolder(url, STICKERS_DIR, suggestedName);
    // Force a rescan so UI updates immediately
    if (win && !win.isDestroyed()) {
      win.webContents.send('stickers-updated', scanStickers());
    }
    return { ok: true, ...result };
  } catch (err) {
    console.error('[memix] download-sticker failed:', err);
    return { ok: false, error: String(err.message || err) };
  }
});


ipcMain.handle('delete-sticker', async (_e, filename) => {
  try {
    if (!filename || typeof filename !== 'string') {
      return { ok: false, error: 'Invalid filename' };
    }
    // prevent path traversal
    const base = path.basename(filename);
    const full = path.join(STICKERS_DIR, base);
    if (!full.startsWith(STICKERS_DIR)) {
      return { ok: false, error: 'Invalid path' };
    }
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('stickers-updated', scanStickers());
    }
    return { ok: true, file: base };
  } catch (err) {
    console.error('[memix] delete-sticker failed:', err);
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('download-sound', async (_e, url, suggestedName) => {
  try {
    const result = await downloadToFolder(url, SOUNDS_DIR, suggestedName);
    return { ok: true, ...result };
  } catch (err) {
    console.error('[memix] download-sound failed:', err);
    return { ok: false, error: String(err.message || err) };
  }
});


ipcMain.on('widget-ready', () => {
  if (win && !win.isDestroyed() && !win.isVisible()) win.show();
});

ipcMain.on('set-config', (_e, partial) => {
  if (!partial || typeof partial !== 'object') return;
  config = { ...config, ...partial };
  if ('alwaysOnTop' in partial && win && !win.isDestroyed()) {
    win.setAlwaysOnTop(!!partial.alwaysOnTop, 'screen-saver');
  }
  saveConfig();     // debounced
});

ipcMain.on('toggle-lock', (_e, locked) => {
  config.locked = !!locked;
  if (win && !win.isDestroyed()) win.setMovable(!locked);
  saveConfig();
});

ipcMain.on('drag-window', (_e, { dx, dy } = {}) => {
  if (!win || win.isDestroyed()) return;
  if (typeof dx !== 'number' || typeof dy !== 'number') return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('resize-window', (_e, { width, height, animateMs = 0, x, y } = {}) => {
  if (!win || win.isDestroyed()) return;
  const w = Math.max(120, Math.round(Number(width)  || 0));
  const h = Math.max(120, Math.round(Number(height) || 0));
  if (!w || !h) return;
  win.setResizable(true);
  // If x/y provided, move + resize together (dashboard full-ish screen)
  if (typeof x === 'number' && typeof y === 'number') {
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h }, !!animateMs);
  } else {
    win.setSize(w, h, !!animateMs);
  }
});

ipcMain.on('minimize-window', () => {
  if (win && !win.isDestroyed()) win.minimize();
});

// New: pair for the "close" button — closes the window without quitting on macOS
ipcMain.on('close-window', () => {
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.on('close-after-animation', () => {
  saveConfig.flush();
  app.quit();
});

// New: paired with the Backup & Restore panel — full reset
ipcMain.handle('reset-config', () => {
  config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  writeConfigNow();
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(!!config.alwaysOnTop, 'screen-saver');
    win.setMovable(!config.locked);
  }
  return config;
});