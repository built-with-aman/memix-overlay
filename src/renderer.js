import { initDashboard, initBackupPanel, CATEGORY_SOUND, getCaption, speak, getActiveLoop, MOOD_GROUPS } from './dashboard.js';
import bus from './eventBus.js';

const stage = document.getElementById('sticker-stage');
const widgetCard = document.getElementById('widget-card');
const dragLayer = document.getElementById('drag-layer');
const widgetView = document.getElementById('widget-view');
const dashboardView = document.getElementById('dashboard-view');
const shatterLayer = document.getElementById('shatter-layer');
const captionBubble = document.getElementById('caption-bubble');
const resizeSlider = document.getElementById('resize-slider');
const resizeSliderWrap = document.getElementById('resize-slider-wrap');
const btnResize = document.getElementById('btn-resize');

const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
function isVideoFile(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXT.includes(filename.slice(dot).toLowerCase());
}

function toMediaSrc(p) {
  if (!p) return '';
  if (p.startsWith('file://') || p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
    return p;
  }
  const normalized = String(p).replace(/\\/g, '/');
  return 'file://' + (normalized.startsWith('/') ? normalized : '/' + normalized);
}

let stickers = [];
let config = {};
let currentIndex = 0;
let loopTimer = null;
let widgetSize = 220;
let activeLoop = getActiveLoop();
let isTransitioning = false;

// ---------------- Recent stickers tracking ----------------
const RECENT_LIMIT = 10;
function getRecent() {
  try { return JSON.parse(localStorage.getItem('recent')) || []; } catch { return []; }
}
function setRecent(files) {
  localStorage.setItem('recent', JSON.stringify(files));
}
function addRecent(file) {
  const recent = getRecent();
  const idx = recent.indexOf(file);
  if (idx >= 0) recent.splice(idx, 1);
  recent.unshift(file);
  if (recent.length > RECENT_LIMIT) recent.pop();
  setRecent(recent);
  bus.emit('recent-changed');
}

// ---------------- boot ----------------
async function boot() {
  try {
    config = await window.pocket.getConfig();
    stickers = await window.pocket.getStickers();
    widgetSize = config.widgetSize;
    if (resizeSlider) resizeSlider.value = widgetSize;
    if (dragLayer) dragLayer.classList.toggle('locked', !!config.locked);

    if (!stickers || !stickers.length) {
      stage.innerHTML = `<div style="font-family:var(--font-body);font-size:11px;color:#fff;text-align:center;opacity:.8">Drop stickers into<br/>assets/stickers</div>`;
      window.pocket.widgetReady();
      return;
    }

    const { list } = resolveLoop();
    if (!list || !list.length) {
      stage.innerHTML = `<div style="font-family:var(--font-body);font-size:11px;color:#fff;text-align:center;opacity:.8">No stickers found</div>`;
      window.pocket.widgetReady();
      return;
    }

    const firstSticker = list[0];
    const first = makeStickerImg(firstSticker);
    stage.appendChild(first);
    window.pocket.widgetReady();
    await runShatter('in', toMediaSrc(firstSticker.path));
    scheduleNext();

    window.pocket.onStickersUpdated((list) => { 
      stickers = list; 
    });
  } catch (err) {
    console.error('Boot error:', err);
  }
}

function makeStickerImg(sticker) {
  if (!sticker) return document.createElement('div');
  const src = toMediaSrc(sticker.path);
  if (isVideoFile(sticker.file)) {
    const vid = document.createElement('video');
    vid.src = src;
    vid.className = `sticker-img idle-${sticker.category}`;
    vid.dataset.category = sticker.category;
    vid.dataset.file = sticker.file;
    vid.autoplay = true;
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    return vid;
  }
  const img = document.createElement('img');
  img.src = src;
  img.className = `sticker-img idle-${sticker.category}`;
  img.dataset.category = sticker.category;
  img.dataset.file = sticker.file;
  return img;
}

// ---------------- which stickers are in rotation right now ----------------
function currentLoopStickers() {
  // Favorites mode
  if (activeLoop.type === 'favorites') {
    let favs = [];
    try { favs = JSON.parse(localStorage.getItem('favorites')) || []; } catch { /* ignore */ }
    const favSet = new Set(favs);
    const list = stickers.filter((s) => favSet.has(s.file));
    return list.length ? list : stickers;
  }
  
  // Mood mode
  if (activeLoop.type === 'mood') {
    const cats = new Set(MOOD_GROUPS[activeLoop.moodKey] || []);
    const list = stickers.filter((s) => cats.has(s.category));
    return list.length ? list : stickers;
  }
  
  // Playlist mode
  if (activeLoop.type === 'playlist') {
    let playlists = [];
    try { 
      playlists = JSON.parse(localStorage.getItem('playlists')) || []; 
    } catch { /* ignore */ }
    
    const pl = playlists.find((p) => p.id === activeLoop.playlistId);
    if (pl && pl.items && pl.items.length > 0) {
      const ordered = pl.items
        .map((f) => stickers.find((s) => s.file === f))
        .filter(Boolean);
      
      if (ordered.length > 0) {
        return { list: ordered, ordered: true };
      }
    }
    // If playlist is empty or deleted, fall back to all stickers
    return stickers;
  }
  
  // Default: all stickers
  return stickers;
}

function resolveLoop() {
  const r = currentLoopStickers();
  if (r && typeof r === 'object' && 'list' in r && 'ordered' in r) {
    return r;
  }
  return { list: r || [], ordered: false };
}

// ---------------- sticker loop + transitions ----------------
function scheduleNext() {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(advance, config.stickerIntervalMs || 4000);
}

function advance() {
  if (isTransitioning) {
    scheduleNext();
    return;
  }
  
  const { list, ordered } = resolveLoop();
  
  if (!list || list.length === 0) {
    if (activeLoop.type !== 'all') {
      import('./dashboard.js').then(({ setActiveLoop }) => {
        setActiveLoop({ type: 'all' });
      });
    }
    scheduleNext();
    return;
  }
  
  if (list.length === 1) {
    scheduleNext();
    return;
  }

  let next;
  const outgoing = stage.querySelector('.sticker-img');
  const outgoingFile = outgoing?.dataset?.file;

  if (ordered) {
    // Playlist mode - go in order
    if (currentIndex === -1 || currentIndex >= list.length) {
      currentIndex = 0;
    }
    if (outgoingFile) {
      const currentIdx = list.findIndex(s => s.file === outgoingFile);
      if (currentIdx >= 0) {
        currentIndex = (currentIdx + 1) % list.length;
      } else {
        currentIndex = 0;
      }
    } else {
      currentIndex = 0;
    }
    next = list[currentIndex];
  } else {
    // Shuffle mode - pick random, avoid immediate repeat
    let pick;
    let attempts = 0;
    const maxAttempts = list.length * 3;
    do {
      pick = list[Math.floor(Math.random() * list.length)];
      attempts++;
    } while (list.length > 1 && pick.file === outgoingFile && attempts < maxAttempts);
    next = pick;
  }

  if (!next) {
    scheduleNext();
    return;
  }

  const incoming = makeStickerImg(next);
  const type = pickTransition();

  isTransitioning = true;
  addRecent(next.file);

  incoming.classList.add(`t-in-${type}`);
  if (outgoing) outgoing.classList.add(`t-out-${type}`);
  stage.appendChild(incoming);

  if (type === 'dissolveParticles' || type === 'comicBurst') spawnParticles();
  playSound(next.category);

  const duration = 640;
  setTimeout(() => {
    if (outgoing) outgoing.remove();
    incoming.classList.remove(`t-in-${type}`);
    isTransitioning = false;
    scheduleNext();
  }, duration);
}

function restartLoopNow() {
  clearTimeout(loopTimer);
  currentIndex = -1;
  isTransitioning = false;
  const { list } = resolveLoop();
  if (list && list.length > 0) {
    const current = stage.querySelector('.sticker-img');
    if (current) current.remove();
    const first = makeStickerImg(list[0]);
    stage.appendChild(first);
  }
  advance();
}

bus.on('active-loop-changed', (payload) => {
  activeLoop = payload;
  currentIndex = -1;
  restartLoopNow();
});

function pickTransition() {
  const list = config.transitions?.length ? config.transitions : ['dissolveParticles'];
  return list[Math.floor(Math.random() * list.length)];
}

function spawnParticles() {
  const field = document.createElement('div');
  field.className = 'particle-field';
  const colors = ['var(--coral)', 'var(--butter)', 'var(--sky)', 'var(--blush)'];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 4 + Math.random() * 6;
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `calc(50% - ${size / 2}px)`;
    p.style.top = `calc(50% - ${size / 2}px)`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--px', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--py', `${Math.sin(angle) * dist}px`);
    p.style.setProperty('--pdur', `${500 + Math.random() * 300}ms`);
    field.appendChild(p);
  }
  stage.appendChild(field);
  setTimeout(() => field.remove(), 900);
}

// Sound
const audioCache = new Map();
async function playSound(category) {
  if (!config.sound?.enabled) return;
  const name = CATEGORY_SOUND[category];
  if (!name) return;
  try {
    const sounds = await window.pocket.listSounds();
    const match = sounds.find((p) => p.toLowerCase().includes(name));
    if (!match) return;
    let audio = audioCache.get(match);
    if (!audio) {
      audio = new Audio(toMediaSrc(match));
      audioCache.set(match, audio);
    }
    audio.volume = config.sound.volume ?? 0.5;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch { /* no sounds folder yet, fine */ }
}

// ---------------- hover life ----------------
let hideTimer = null;
let isHovering = false;

function cancelHide() {
  clearTimeout(hideTimer);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (isHovering) return;
    widgetCard.classList.remove('hover-tilt', 'show-controls');
    stage.style.transform = '';
    hideCaptionBubble();
    if (resizeSliderWrap) resizeSliderWrap.classList.remove('active');
  }, 180);
}

function showControls() {
  isHovering = true;
  cancelHide();
  widgetCard.classList.add('hover-tilt', 'show-controls');
  showCaptionBubble();
}

function hideControls() {
  isHovering = false;
  scheduleHide();
}

// More reliable hover for Electron transparent windows
widgetCard.addEventListener('mouseenter', showControls);
widgetCard.addEventListener('mousemove', (e) => {
  showControls();

  // tilt effect
  const rect = widgetCard.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width - 0.5;
  const relY = (e.clientY - rect.top) / rect.height - 0.5;
  stage.style.transform = `perspective(600px) rotateY(${relX * 14}deg) rotateX(${-relY * 14}deg) translate(${relX * 6}px, ${relY * 6}px)`;
});

widgetCard.addEventListener('mouseleave', hideControls);

// Keep controls alive when mouse is on the buttons
document.getElementById('controls')?.addEventListener('mouseenter', cancelHide);
document.getElementById('controls')?.addEventListener('mouseleave', scheduleHide);

if (resizeSliderWrap) {
  resizeSliderWrap.addEventListener('mouseenter', cancelHide);
  resizeSliderWrap.addEventListener('mouseleave', scheduleHide);
}



// ---------------- custom resize slider ----------------
const resizeClose = document.getElementById('resize-close');

if (btnResize && resizeSliderWrap) {
  // Open / toggle the vertical resize bar
  btnResize.addEventListener('click', (e) => {
    e.stopPropagation();
    cancelHide();
    resizeSliderWrap.classList.toggle('active');
  });

  // Close button on the bar
  if (resizeClose) {
    resizeClose.addEventListener('click', (e) => {
      e.stopPropagation();
      resizeSliderWrap.classList.remove('active');
    });
  }

  // Keep controls visible while interacting with the slider
  resizeSliderWrap.addEventListener('mouseenter', cancelHide);
  resizeSliderWrap.addEventListener('mouseleave', scheduleHide);

  // Actual resizing
  if (resizeSlider) {
    resizeSlider.addEventListener('mousedown', cancelHide);
    resizeSlider.addEventListener('input', (e) => {
      cancelHide();
      const size = Number(e.target.value);
      widgetSize = size;
      window.pocket.resizeWindow(size, size);
      window.pocket.setConfig({ widgetSize: size });
    });
  }
}

// ---------------- shatter open/close ----------------
function runShatter(mode, imgSrc, gridN = 6) {
  return new Promise((resolve) => {
    shatterLayer.innerHTML = '';
    shatterLayer.classList.add('active');
    const rect = widgetCard.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const tileSize = size / gridN;
    const tiles = [];
    const bgSrc = toMediaSrc(imgSrc);

    for (let row = 0; row < gridN; row++) {
      for (let col = 0; col < gridN; col++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.style.width = `${tileSize}px`;
        tile.style.height = `${tileSize}px`;
        tile.style.left = `${col * tileSize}px`;
        tile.style.top = `${row * tileSize}px`;
        tile.style.backgroundImage = `url(${bgSrc})`;
        tile.style.backgroundSize = `${size}px ${size}px`;
        tile.style.backgroundPosition = `-${col * tileSize}px -${row * tileSize}px`;
        shatterLayer.appendChild(tile);
        tiles.push(tile);
      }
    }

    const animations = tiles.map((tile) => {
      const dx = (Math.random() - 0.5) * 160;
      const dy = -60 - Math.random() * 140;
      const rot = (Math.random() - 0.5) * 120;
      const delay = Math.random() * 160;
      const outFrames = [
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(0.25)`, opacity: 0 }
      ];
      const inFrames = [
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(0.25)`, opacity: 0 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 }
      ];
      return tile.animate(mode === 'out' ? outFrames : inFrames, {
        duration: 620 + Math.random() * 160,
        delay,
        easing: mode === 'out' ? 'cubic-bezier(0.4,0,0.7,0.3)' : 'cubic-bezier(0.16,1,0.3,1)',
        fill: 'forwards'
      }).finished;
    });

    if (mode === 'out') stage.style.opacity = '0';
    if (mode === 'in') stage.style.opacity = '0';

    Promise.all(animations).then(() => {
      shatterLayer.classList.remove('active');
      shatterLayer.innerHTML = '';
      if (mode === 'in') stage.style.opacity = '1';
      resolve();
    });
  });
}

// ---------------- window controls ----------------
document.getElementById('btn-minimize').addEventListener('click', () => window.pocket.minimizeWindow());

document.getElementById('btn-close').addEventListener('click', async () => {
  const current = stage.querySelector('.sticker-img');
  const src = current ? current.src : (stickers[currentIndex] || {}).path;
  clearTimeout(loopTimer);
  await runShatter('out', src || '');
  window.pocket.closeAfterAnimation();
});

document.getElementById('btn-maximize').addEventListener('click', async () => {
  widgetView.style.transition = 'opacity .25s ease, transform .25s ease';
  widgetView.style.opacity = '0';
  widgetView.style.transform = 'scale(0.92)';
  const width = 900, height = 620;
  window.pocket.resizeWindow(width, height, 300);
  setTimeout(() => {
    widgetView.style.display = 'none';
    dashboardView.classList.add('active');
    dashboardView.animate(
      [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(0.16,1,0.3,1)' }
    );
  }, 220);
});

document.getElementById('dash-close').addEventListener('click', () => {
  dashboardView.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }],
    { duration: 260, easing: 'ease' }
  ).finished.then(() => {
    dashboardView.classList.remove('active');
    window.pocket.resizeWindow(widgetSize, widgetSize, 300);
    widgetView.style.display = 'flex';
    requestAnimationFrame(() => {
      widgetView.style.opacity = '1';
      widgetView.style.transform = 'scale(1)';
    });
  });
});

// ---------------- future-AI event bus hookup ----------------
bus.on('trigger-category', (category) => {
  const match = stickers.filter((s) => s.category === category);
  if (!match.length) return;
  currentIndex = stickers.indexOf(match[Math.floor(Math.random() * match.length)]) - 1;
  clearTimeout(loopTimer);
  isTransitioning = false;
  advance();
});

bus.on('trigger-sticker', (file) => {
  const sticker = stickers.find(s => s.file === file);
  if (!sticker) return;
  const current = stage.querySelector('.sticker-img');
  const incoming = makeStickerImg(sticker);
  const type = pickTransition();
  incoming.classList.add(`t-in-${type}`);
  if (current) current.classList.add(`t-out-${type}`);
  stage.appendChild(incoming);
  addRecent(sticker.file);
  const duration = 640;
  setTimeout(() => {
    if (current) current.remove();
    incoming.classList.remove(`t-in-${type}`);
  }, duration);
});

// ---------------- dashboard wiring ----------------
initDashboard({
  getStickers: () => window.pocket.getStickers(),
  getConfig: () => window.pocket.getConfig(),
  setConfig: (partial) => {
    window.pocket.setConfig(partial);
    Object.assign(config, partial);
    if ('stickerIntervalMs' in partial) scheduleNext();
  },
  listSounds: () => window.pocket.listSounds(),
  toggleLock: (v) => {
    window.pocket.toggleLock(v);
    if (dragLayer) dragLayer.classList.toggle('locked', !!v);
  }
});

initBackupPanel();

boot();