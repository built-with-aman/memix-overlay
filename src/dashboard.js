import bus from './eventBus.js';

const CATEGORY_LABEL = {
  laugh: 'Laugh · bounce', shock: 'Shock · vibration', happy: 'Happy · float',
  dance: 'Dance · rhythm', angry: 'Angry · shake', sleep: 'Sleep · breathing',
  cute: 'Cute · squash & stretch', think: 'Think · rotation'
};
const CATEGORY_SOUND = {
  laugh: 'giggle', shock: 'ding', happy: 'pop', dance: 'whoosh',
  angry: 'bonk', sleep: 'bubble', cute: 'squeak', think: 'boing'
};

const TRANSITION_OPTIONS = [
  { id: 'dissolveParticles', label: 'Dissolve & particles' },
  { id: 'paperFold',         label: 'Paper fold' },
  { id: 'liquidMorph',       label: 'Liquid morph' },
  { id: 'squashPop',         label: 'Squash & pop' },
  { id: 'bounceSwap',        label: 'Bounce swap' },
  { id: 'floatingSmoke',     label: 'Floating smoke' },
  { id: 'elasticSlide',      label: 'Elastic slide' },
  { id: 'spinDisappear',     label: 'Spin disappear' },
  { id: 'comicBurst',        label: 'Comic burst' },
  { id: 'softFade',          label: 'Soft fade' }
];

const MOOD_GROUPS = {
  funny: ['laugh', 'dance', 'happy'],
  thankyou: ['cute', 'happy'],
  roast: ['angry', 'shock']
};
const MOOD_LABEL = { funny: 'Funny mode', thankyou: 'Thank-you mode', roast: 'Roast mode' };
const VOICE_PHRASES = [
  { moodKey: 'funny', patterns: [/set\s*funny/i, /funny\s*mode/i] },
  { moodKey: 'thankyou', patterns: [/thank\s*you/i, /set\s*cute/i, /thankyou\s*mode/i] },
  { moodKey: 'roast', patterns: [/roast/i, /savage/i] }
];

const store = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

function uid() { return Math.random().toString(36).slice(2, 9); }

export function getActiveLoop() { return store.get('activeLoop', { type: 'all' }); }
export function setActiveLoop(payload) {
  store.set('activeLoop', payload);
  bus.emit('active-loop-changed', payload);
}
export { MOOD_GROUPS, MOOD_LABEL };

export function getCaption(file) {
  return store.get('captions', {})[file] || '';
}

export function getPlaylistOrderedFiles(playlistId) {
  const pl = store.get('playlists', []).find((p) => p.id === playlistId);
  return pl ? pl.items.slice() : [];
}

// ---- Text-to-speech ----
let cachedVoices = [];
if ('speechSynthesis' in window) {
  const refreshVoices = () => { cachedVoices = window.speechSynthesis.getVoices(); };
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}
export function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const femalePattern = /female|zira|samantha|victoria|susan|karen|moira|tessa|fiona|allison|ava|serena|kate|women/i;
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  const voice =
    voices.find((v) => femalePattern.test(v.name)) ||
    voices.find((v) => v.lang && v.lang.startsWith('en')) ||
    voices[0];
  if (voice) utter.voice = voice;
  utter.pitch = 1.05;
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

// ---- Auto-queue engine ----
let queueTimer = null;
function getQueue() { return store.get('queue', { enabled: false, items: [], index: 0 }); }
function setQueue(q) { store.set('queue', q); bus.emit('queue-changed'); }

function restartQueueEngine() {
  clearTimeout(queueTimer);
  const q = getQueue();
  if (!q.enabled || !q.items.length) return;
  const current = q.items[q.index % q.items.length];
  const minutes = Math.max(1, Number(current.minutes) || 5);
  queueTimer = setTimeout(() => {
    const q2 = getQueue();
    if (!q2.enabled || !q2.items.length) return;
    q2.index = (q2.index + 1) % q2.items.length;
    store.set('queue', q2);
    const next = q2.items[q2.index];
    setActiveLoop({ type: 'playlist', playlistId: next.playlistId });
    restartQueueEngine();
  }, minutes * 60 * 1000);
}

// ---- Voice commands ----
let recognizer = null;
function startVoiceCommands() {
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) { console.warn('Speech recognition not available in this build of Electron/Chromium.'); return; }
  if (recognizer) return;
  recognizer = new SpeechRecognitionImpl();
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';
  recognizer.onresult = (e) => {
    const said = e.results[e.results.length - 1][0].transcript.trim();
    for (const { moodKey, patterns } of VOICE_PHRASES) {
      if (patterns.some((re) => re.test(said))) {
        setActiveLoop({ type: 'mood', moodKey });
        bus.emit('voice-command', { phrase: said, moodKey });
        speak(`${MOOD_LABEL[moodKey]} on.`);
        break;
      }
    }
  };
  recognizer.onerror = () => {};
  recognizer.onend = () => { if (recognizer) { try { recognizer.start(); } catch {} } };
  try { recognizer.start(); } catch {}
}
function stopVoiceCommands() {
  if (!recognizer) return;
  const r = recognizer;
  recognizer = null;
  r.onend = null;
  r.stop();
}

// Helper functions
function isVideoFile(filename) {
  const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXT.includes(filename.slice(dot).toLowerCase());
}

function mediaTag(s, extraClass = '', extraAttrs = '') {
  if (isVideoFile(s.file)) {
    return `<video src="${s.path}" class="${extraClass}" ${extraAttrs}
              autoplay loop muted playsinline
              style="width:100%;height:64px;object-fit:contain;border-radius:8px"></video>`;
  }
  return `<img src="${s.path}" alt="${s.file}" class="${extraClass}" ${extraAttrs}
            style="width:100%;height:64px;object-fit:contain" />`;
}

function stickerTileHTML(s) {
  const favorites = new Set(store.get('favorites', []));
  const captions = store.get('captions', {});
  const caption = captions[s.file] || '';
  const isFav = favorites.has(s.file);
  return `
    <div class="sticker-tile" data-file="${s.file}">
      <div class="sticker-tile-img-wrap" data-hover-caption="${s.file}">
        ${mediaTag(s)}
      </div>
      <div class="sticker-tile-row">
        <span class="tag">${s.category}</span>
        <button class="fav-btn" data-fav="${s.file}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '★' : '☆'}</button>
      </div>
      <input class="caption-input" data-caption="${s.file}" placeholder="Caption for TTS…" value="${caption.replace(/"/g, '&quot;')}" />
    </div>`;
}

function wireStickerTiles(container, captionsEnabled) {
  container.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const file = btn.dataset.fav;
      const favs = new Set(store.get('favorites', []));
      favs.has(file) ? favs.delete(file) : favs.add(file);
      store.set('favorites', [...favs]);
      bus.emit('favorites-changed');
      render();
    });
  });
  container.querySelectorAll('[data-caption]').forEach((input) => {
    input.addEventListener('change', () => {
      const captions = store.get('captions', {});
      captions[input.dataset.caption] = input.value.trim();
      store.set('captions', captions);
    });
  });
  if (captionsEnabled) {
    container.querySelectorAll('[data-hover-caption]').forEach((wrap) => {
      wrap.addEventListener('mouseenter', () => {
        const text = getCaption(wrap.dataset.hoverCaption);
        if (text) speak(text);
      });
    });
  }
}

export function initDashboard({ getStickers, getConfig, setConfig, listSounds, toggleLock }) {
  const navItems = document.querySelectorAll('.dash-nav-item');
  const panels = document.querySelectorAll('.dash-panel');

  function showPanel(name) {
    navItems.forEach((n) => n.classList.toggle('active', n.dataset.panel === name));
    panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  }
  navItems.forEach((n) => n.addEventListener('click', () => showPanel(n.dataset.panel)));
  document.querySelectorAll('[data-goto]').forEach((btn) =>
    btn.addEventListener('click', () => showPanel(btn.dataset.goto))
  );

  let captionsEnabled = false;
  let lastStickers = [];
  const expandedPlaylists = new Set();

  function nowPlayingLabel(active, playlists) {
    if (active.type === 'favorites') return 'Favorites only';
    if (active.type === 'mood') return MOOD_LABEL[active.moodKey] || 'All stickers';
    if (active.type === 'playlist') {
      const pl = playlists.find((p) => p.id === active.playlistId);
      return pl ? `Playlist · ${pl.name}` : 'All stickers';
    }
    return 'All stickers';
  }

  function renderGlobalNowPlaying() {
    const el = document.getElementById('global-nowplaying');
    if (!el) return;
    const active = getActiveLoop();
    const playlists = store.get('playlists', []);
    if (active.type === 'all') { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="global-bar">
        <span class="global-bar-dot"></span>
        <span>Looping: <strong>${nowPlayingLabel(active, playlists)}</strong></span>
        <button id="global-reset-btn">← Back to all stickers</button>
      </div>`;
    document.getElementById('global-reset-btn').addEventListener('click', () => {
      setActiveLoop({ type: 'all' });
    });
  }
  bus.on('active-loop-changed', renderGlobalNowPlaying);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (expandedPlaylists.size) { expandedPlaylists.clear(); renderPlaylists(); }
    if (getActiveLoop().type !== 'all') setActiveLoop({ type: 'all' });
  });

  async function render() {
    const stickers = await getStickers();
    lastStickers = stickers;
    const config = await getConfig();
    captionsEnabled = !!config.captions?.enabled;
    const favorites = new Set(store.get('favorites', []));
    const playlists = store.get('playlists', []);
    const active = getActiveLoop();
    renderGlobalNowPlaying();

    const byCat = {};
    stickers.forEach((s) => (byCat[s.category] = (byCat[s.category] || 0) + 1));
    document.getElementById('home-stats').innerHTML = `
      <div class="stat-card"><div class="stat-num">${stickers.length}</div><div class="stat-label">Stickers loaded</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(byCat).length}</div><div class="stat-label">Categories active</div></div>
      <div class="stat-card"><div class="stat-num">${(config.stickerIntervalMs / 1000).toFixed(1)}s</div><div class="stat-label">Loop speed</div></div>
      <div class="stat-card"><div class="stat-num">${favorites.size}</div><div class="stat-label">Favorites</div></div>
      <div class="stat-card"><div class="stat-num">${playlists.length}</div><div class="stat-label">Playlists</div></div>
      <div class="stat-card"><div class="stat-num">${active.type === 'all' ? 'All' : active.type}</div><div class="stat-label">Current mode</div></div>
    `;

    // ---- Library ----
    const libraryGrid = document.getElementById('library-grid');
    libraryGrid.innerHTML = stickers.map(stickerTileHTML).join('') ||
      '<p class="dash-sub">Drop stickers into assets/stickers to see them here.</p>';
    wireStickerTiles(libraryGrid, captionsEnabled);

    // ---- Categories ----
    document.getElementById('category-list').innerHTML = Object.entries(byCat).map(([cat, count]) => `
      <div class="category-pill">
        <span>${CATEGORY_LABEL[cat] || cat}</span>
        <span class="tag" style="background:transparent;border:1px solid var(--card-border)">${count}</span>
      </div>`).join('') || '<p class="dash-sub">No stickers yet.</p>';

    // ---- Favorites ----
    const favList = stickers.filter((s) => favorites.has(s.file));
    const favGrid = document.getElementById('favorites-grid');
    favGrid.innerHTML = favList.map(stickerTileHTML).join('') ||
      '<p class="dash-sub">Star stickers from the library to pin them here.</p>';
    wireStickerTiles(favGrid, captionsEnabled);

    const favPlayBtn = document.getElementById('favorites-play-btn');
    if (favPlayBtn) {
      const isPlayingFavs = active.type === 'favorites';
      favPlayBtn.textContent = isPlayingFavs ? '● Playing favorites — click to stop' : '▶ Loop favorites only';
      favPlayBtn.classList.toggle('is-active', isPlayingFavs);
      favPlayBtn.disabled = !favList.length && !isPlayingFavs;
      favPlayBtn.onclick = () => {
        setActiveLoop({ type: isPlayingFavs ? 'all' : 'favorites' });
        render();
      };
    }

    // ---- Animations preview ----
    document.getElementById('animations-grid').innerHTML = stickers.map((s) => `
      <div class="sticker-tile">
        ${mediaTag(s, `idle-${s.category}`, `style="animation-play-state:paused" onmouseenter="this.style.animationPlayState='running'" onmouseleave="this.style.animationPlayState='paused'"`)}
        <div><span class="tag">${s.category}</span></div>
      </div>`).join('');

    // ---- Sounds ----
    const sounds = await listSounds();
    const soundNames = [...new Set(Object.values(CATEGORY_SOUND))];
    document.getElementById('sounds-list').innerHTML = soundNames.map((name) => {
      const found = sounds.some((p) => p.toLowerCase().includes(name));
      return `<div class="category-pill"><span>${name}.mp3</span><span class="tag" style="background:${found ? 'var(--sage)' : 'transparent'};border:1px solid var(--card-border)">${found ? 'loaded' : 'missing'}</span></div>`;
    }).join('');

    // ---- Settings ----
    document.getElementById('setting-interval').value = config.stickerIntervalMs;
    document.getElementById('setting-corner').value = config.startCorner;
    document.getElementById('setting-volume').value = config.sound.volume;
    setToggle('setting-lock', config.locked);
    setToggle('setting-ontop', config.alwaysOnTop);
    setToggle('setting-sound', config.sound.enabled);
    setToggle('setting-captions', captionsEnabled);
    setToggle('setting-voice', store.get('voiceCommandsEnabled', false));
    renderTransitionPicker(config.transitions || []);

    renderPlaylists();
  }

  function renderTransitionPicker(activeList) {
    const el = document.getElementById('setting-transitions');
    if (!el) return;
    const active = new Set(activeList && activeList.length ? activeList : TRANSITION_OPTIONS.map((t) => t.id));
    el.innerHTML = TRANSITION_OPTIONS.map((t) => `
      <button type="button" class="transition-chip ${active.has(t.id) ? 'active' : ''}" data-transition="${t.id}">
        <span class="chip-dot"></span>
        <span>${t.label}</span>
      </button>`).join('');
    el.querySelectorAll('[data-transition]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.transition;
        const next = new Set(active);
        if (next.has(id)) {
          if (next.size <= 1) return;
          next.delete(id);
        } else {
          next.add(id);
        }
        const arr = TRANSITION_OPTIONS.map((t) => t.id).filter((x) => next.has(x));
        setConfig({ transitions: arr });
        renderTransitionPicker(arr);
      });
    });
  }

  function setToggle(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!on);
  }
  function wireToggle(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      onChange(next);
    });
  }

  wireToggle('setting-lock', (v) => { toggleLock(v); setConfig({ locked: v }); });
  wireToggle('setting-ontop', (v) => setConfig({ alwaysOnTop: v }));
  wireToggle('setting-sound', (v) => getConfig().then((c) => setConfig({ sound: { ...c.sound, enabled: v } })));
  wireToggle('setting-captions', (v) => {
    captionsEnabled = v;
    getConfig().then((c) => setConfig({ captions: { ...c.captions, enabled: v } }));
    if (v) speak('Captions are now on. I will read out any sticker that has text attached.');
    render();
  });
  wireToggle('setting-voice', (v) => {
    store.set('voiceCommandsEnabled', v);
    if (v) startVoiceCommands(); else stopVoiceCommands();
  });

  if (store.get('voiceCommandsEnabled', false)) startVoiceCommands();

  const groqKeyInput = document.getElementById('setting-groq-key');
  if (groqKeyInput) {
    groqKeyInput.value = store.get('groqApiKey', '');
    groqKeyInput.addEventListener('change', () => {
      store.set('groqApiKey', groqKeyInput.value.trim());
    });
  }

  document.getElementById('setting-captions-test')?.addEventListener('click', () => {
    speak('Hi there! This is how I will read your sticker captions out loud.');
  });

  document.getElementById('setting-interval').addEventListener('input', (e) =>
    setConfig({ stickerIntervalMs: Number(e.target.value) }));
  document.getElementById('setting-corner').addEventListener('change', (e) =>
    setConfig({ startCorner: e.target.value }));
  document.getElementById('setting-volume').addEventListener('input', (e) =>
    getConfig().then((c) => setConfig({ sound: { ...c.sound, volume: Number(e.target.value) } })));

  // ---- Wishlist ----
  function renderWishlist() {
    const items = store.get('wishlist', []);
    document.getElementById('wishlist-list').innerHTML = items.map((t, i) => `
      <div class="category-pill"><span>${t}</span><button class="fav-btn" data-remove="${i}">✕</button></div>`
    ).join('') || '<p class="dash-sub">Nothing here yet.</p>';
    document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const items = store.get('wishlist', []);
      items.splice(Number(b.dataset.remove), 1);
      store.set('wishlist', items);
      renderWishlist();
    }));
  }
  document.getElementById('wishlist-add').addEventListener('click', () => {
    const input = document.getElementById('wishlist-input');
    if (!input.value.trim()) return;
    const items = store.get('wishlist', []);
    items.push(input.value.trim());
    store.set('wishlist', items);
    input.value = '';
    renderWishlist();
  });

  // ---- Playlists ----
  function playlistPickerHTML(pl) {
    if (!expandedPlaylists.has(pl.id)) return '';
    const memberSet = new Set(pl.items);
    return `
      <div class="playlist-picker">
        <p class="dash-sub" style="margin:0 0 8px">Tap stickers to add or remove them from this playlist.</p>
        <div class="picker-grid">
          ${lastStickers.map((s) => `
            <button class="picker-tile ${memberSet.has(s.file) ? 'selected' : ''}" data-pick="${pl.id}|${s.file}">
              ${mediaTag(s)}
              ${memberSet.has(s.file) ? '<span class="picker-check">✓</span>' : ''}
            </button>`).join('')}
        </div>
      </div>`;
  }

  function renderPlaylists() {
    const playlists = store.get('playlists', []);
    const sorted = [...playlists].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const active = getActiveLoop();
    const queue = getQueue();

    document.getElementById('playlist-list').innerHTML = sorted.map((p) => {
      const items = p.items.map((f) => lastStickers.find((s) => s.file === f)).filter(Boolean);
      const isActive = active.type === 'playlist' && active.playlistId === p.id;
      const inQueue = queue.items.some((q) => q.playlistId === p.id);
      return `
        <div class="playlist-card ${isActive ? 'is-playing' : ''} ${p.pinned ? 'is-pinned' : ''}">
          <div class="playlist-card-head">
            <div>
              <div class="playlist-name">${p.pinned ? '<span class="pin-badge" title="Pinned">📌</span> ' : ''}${p.name}</div>
              <div class="playlist-count">${items.length} sticker${items.length === 1 ? '' : 's'}</div>
            </div>
            <div class="playlist-actions">
              <button class="fav-btn" data-pin="${p.id}" title="${p.pinned ? 'Unpin' : 'Pin to top'}">${p.pinned ? '📌' : '📍'}</button>
              <button class="btn-primary btn-small" data-play="${p.id}" ${items.length ? '' : 'disabled'}>${isActive ? '● Playing' : '▶ Play'}</button>
              <button class="btn-secondary btn-small" data-toggle-pick="${p.id}">${expandedPlaylists.has(p.id) ? 'Done' : '＋ Add stickers'}</button>
              <button class="btn-secondary btn-small" data-toggle-queue="${p.id}">${inQueue ? '✓ In queue' : '+ Queue'}</button>
              <button class="fav-btn" data-delpl="${p.id}" title="Delete playlist">🗑</button>
            </div>
          </div>
          <div class="playlist-thumbs" data-dropzone="${p.id}">
            ${items.map((s) => `
              <div class="playlist-thumb" draggable="true" data-drag="${p.id}|${s.file}">
                ${mediaTag(s, '', 'style="width:100%;height:100%;object-fit:contain"')}
                <button data-rmitem="${p.id}|${s.file}" title="Remove from playlist">✕</button>
              </div>`).join('') ||
              '<span class="dash-sub" style="margin:0">Nothing yet — click "＋ Add stickers" above. Drag thumbnails here to reorder.</span>'}
          </div>
          ${playlistPickerHTML(p)}
        </div>`;
    }).join('') || '<p class="dash-sub">Create a themed loop, like "clutch moments" — you\'ll be able to pick stickers for it right after.</p>';

    document.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
      const already = getActiveLoop();
      const isSame = already.type === 'playlist' && already.playlistId === b.dataset.play;
      setActiveLoop(isSame ? { type: 'all' } : { type: 'playlist', playlistId: b.dataset.play });
      render();
    }));
    document.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => {
      const pls = store.get('playlists', []);
      const pl = pls.find((p) => p.id === b.dataset.pin);
      if (pl) pl.pinned = !pl.pinned;
      store.set('playlists', pls);
      bus.emit('playlists-changed');
      renderPlaylists();
    }));
    document.querySelectorAll('[data-toggle-pick]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.togglePick;
      expandedPlaylists.has(id) ? expandedPlaylists.delete(id) : expandedPlaylists.add(id);
      renderPlaylists();
    }));
    document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const [plId, file] = b.dataset.pick.split('|');
      const pls = store.get('playlists', []);
      const pl = pls.find((p) => p.id === plId);
      if (pl) {
        const i = pl.items.indexOf(file);
        i >= 0 ? pl.items.splice(i, 1) : pl.items.push(file);
      }
      store.set('playlists', pls);
      bus.emit('playlists-changed');
      renderPlaylists();
    }));
    document.querySelectorAll('[data-toggle-queue]').forEach((b) => b.addEventListener('click', () => {
      const plId = b.dataset.toggleQueue;
      const q = getQueue();
      const idx = q.items.findIndex((it) => it.playlistId === plId);
      if (idx >= 0) q.items.splice(idx, 1);
      else q.items.push({ playlistId: plId, minutes: 5 });
      setQueue(q);
      restartQueueEngine();
      renderQueue();
      renderPlaylists();
    }));
    document.querySelectorAll('[data-delpl]').forEach((b) => b.addEventListener('click', () => {
      let pls = store.get('playlists', []);
      const activeNow = getActiveLoop();
      pls = pls.filter((p) => p.id !== b.dataset.delpl);
      store.set('playlists', pls);
      if (activeNow.type === 'playlist' && activeNow.playlistId === b.dataset.delpl) setActiveLoop({ type: 'all' });
      const q = getQueue();
      q.items = q.items.filter((it) => it.playlistId !== b.dataset.delpl);
      setQueue(q);
      bus.emit('playlists-changed');
      render();
    }));
    document.querySelectorAll('[data-rmitem]').forEach((b) => b.addEventListener('click', () => {
      const [plId, file] = b.dataset.rmitem.split('|');
      const pls = store.get('playlists', []);
      const pl = pls.find((p) => p.id === plId);
      if (pl) pl.items = pl.items.filter((f) => f !== file);
      store.set('playlists', pls);
      bus.emit('playlists-changed');
      renderPlaylists();
    }));

    let dragSrc = null;
    document.querySelectorAll('[data-drag]').forEach((el) => {
      el.addEventListener('dragstart', () => { dragSrc = el.dataset.drag; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragSrc = null; });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragSrc) return;
        const [srcPl, srcFile] = dragSrc.split('|');
        const [dstPl, dstFile] = el.dataset.drag.split('|');
        if (srcPl !== dstPl || srcFile === dstFile) return;
        const pls = store.get('playlists', []);
        const pl = pls.find((p) => p.id === srcPl);
        if (!pl) return;
        const from = pl.items.indexOf(srcFile);
        const to = pl.items.indexOf(dstFile);
        if (from < 0 || to < 0) return;
        pl.items.splice(from, 1);
        pl.items.splice(to, 0, srcFile);
        store.set('playlists', pls);
        bus.emit('playlists-changed');
        renderPlaylists();
      });
    });
  }

  document.getElementById('playlist-add').addEventListener('click', () => {
    const input = document.getElementById('playlist-input');
    if (!input.value.trim()) return;
    const items = store.get('playlists', []);
    const pl = { id: uid(), name: input.value.trim(), items: [], pinned: false };
    items.push(pl);
    store.set('playlists', items);
    input.value = '';
    expandedPlaylists.add(pl.id);
    bus.emit('playlists-changed');
    renderPlaylists();
  });

  // ---- Auto-queue ----
  function renderQueue() {
    const el = document.getElementById('queue-section');
    if (!el) return;
    const q = getQueue();
    const playlists = store.get('playlists', []);
    el.innerHTML = `
      <div class="queue-card">
        <div class="queue-head">
          <div>
            <p class="eyebrow" style="margin:0 0 4px">Auto-queue</p>
            <p class="dash-sub" style="margin:0">Automatically switch to the next playlist after N minutes.</p>
          </div>
          <div class="toggle" id="queue-enable"><div class="knob"></div></div>
        </div>
        <div class="queue-items">
          ${q.items.map((it, i) => {
            const pl = playlists.find((p) => p.id === it.playlistId);
            return `
              <div class="queue-chip">
                <span>${i + 1}. ${pl ? pl.name : '(deleted playlist)'}</span>
                <input type="number" min="1" class="queue-minutes" data-qmin="${it.playlistId}" value="${it.minutes}" /> min
                <button data-qremove="${it.playlistId}">✕</button>
              </div>`;
          }).join('') || '<p class="dash-sub">Use "+ Queue" on any playlist below to add it here.</p>'}
        </div>
      </div>`;
    document.getElementById('queue-enable').classList.toggle('on', q.enabled);
    document.getElementById('queue-enable').addEventListener('click', () => {
      const q2 = getQueue();
      q2.enabled = !q2.enabled;
      setQueue(q2);
      restartQueueEngine();
      renderQueue();
    });
    document.querySelectorAll('[data-qmin]').forEach((inp) => inp.addEventListener('change', () => {
      const q2 = getQueue();
      const it = q2.items.find((x) => x.playlistId === inp.dataset.qmin);
      if (it) it.minutes = Math.max(1, Number(inp.value) || 5);
      setQueue(q2);
      restartQueueEngine();
    }));
    document.querySelectorAll('[data-qremove]').forEach((b) => b.addEventListener('click', () => {
      const q2 = getQueue();
      q2.items = q2.items.filter((x) => x.playlistId !== b.dataset.qremove);
      setQueue(q2);
      restartQueueEngine();
      renderQueue();
      renderPlaylists();
    }));
  }

  restartQueueEngine();
  renderWishlist();
  render();
  renderQueue();
  return { refresh: render };
}

export { CATEGORY_SOUND };

// ============================================================
//  Backup & Restore — self-contained panel
//  Call initBackupPanel() once, after the dashboard has mounted.
// ============================================================
export function initBackupPanel() {
  const sidebar = document.getElementById('dash-sidebar');
  const content = document.getElementById('dash-content');
  if (!sidebar || !content) return;
  if (document.querySelector('.dash-nav-item[data-panel="backup"]')) return; // already mounted

  // Every localStorage key this app owns. Add to this list if you add features.
  const KEYS = [
    'favorites', 'playlists', 'wishlist', 'recent',
    'captions', 'activeLoop', 'transitions', 'pinnedPlaylist',
    'playlistQueue', 'ttsEnabled', 'voiceCmdEnabled',
    'widgetSize', 'stickerIntervalMs', 'soundEnabled', 'soundVolume',
  ];

  // ---------- inject nav item (before the "Back to widget" button) ----------
  const backBtn = document.getElementById('dash-close');
  const navItem = document.createElement('button');
  navItem.className = 'dash-nav-item';
  navItem.dataset.panel = 'backup';
  navItem.innerHTML = '<span class="nav-ic">⇅</span>Backup &amp; Restore';
  sidebar.insertBefore(navItem, backBtn);

  // ---------- inject panel ----------
  const panel = document.createElement('div');
  panel.className = 'dash-panel';
  panel.dataset.panel = 'backup';
  panel.innerHTML = `
    <p class="eyebrow">Portable data</p>
    <h1 class="dash-h1">Backup &amp; Restore</h1>
    <p class="dash-sub">
      Save every favorite, playlist, caption, and setting as one file. Nothing leaves your device — it's just a local download you can email yourself or move to another machine.
    </p>

    <div id="backup-summary" class="backup-grid"></div>

    <div class="backup-actions">
      <button class="btn-primary" id="backup-export">
        <span class="backup-ic">↓</span> Export to file
      </button>
      <label class="btn-primary backup-import-btn">
        <span class="backup-ic">↑</span> Import from file
        <input type="file" id="backup-import-input" accept="application/json,.json" hidden />
      </label>
      <button class="btn-secondary" id="backup-clear">Clear all data</button>
    </div>

    <p id="backup-status" class="backup-status"></p>
  `;
  content.appendChild(panel);

  // ---------- helpers ----------
  const readAll = () => {
    const data = {};
    for (const k of KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
    return data;
  };

  const safeLen = (key, fallback = '[]') => {
    try { return JSON.parse(localStorage.getItem(key) || fallback).length ?? 0; }
    catch { return 0; }
  };
  const safeKeys = (key) => {
    try { return Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).length; }
    catch { return 0; }
  };

  const renderSummary = () => {
    const summary = document.getElementById('backup-summary');
    if (!summary) return;
    const counts = [
      ['Favorites', safeLen('favorites')],
      ['Playlists', safeLen('playlists')],
      ['Wishlist',  safeLen('wishlist')],
      ['Captions',  safeKeys('captions')],
    ];
    summary.innerHTML = counts.map(([label, n]) => `
      <div class="stat-card">
        <div class="stat-num">${n}</div>
        <div class="stat-label">${label}</div>
      </div>
    `).join('');
  };

  const setStatus = (msg, tone = 'ok') => {
    const el = document.getElementById('backup-status');
    if (!el) return;
    el.textContent = msg;
    el.dataset.tone = tone;
    if (msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => {
        if (el.textContent === msg) el.textContent = '';
      }, 4500);
    }
  };

  // ---------- export ----------
  panel.querySelector('#backup-export').addEventListener('click', () => {
    try {
      const payload = {
        app: 'pocket',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: readAll(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pocket-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${Object.keys(payload.data).length} keys.`);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, 'err');
    }
  });

  // ---------- import ----------
  panel.querySelector('#backup-import-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.app !== 'pocket' || !parsed.data || typeof parsed.data !== 'object') {
          throw new Error('Not a valid Pocket backup file.');
        }
        const ok = confirm('This will overwrite your current favorites, playlists, wishlist, captions, and settings. Continue?');
        if (!ok) { e.target.value = ''; return; }
        let applied = 0;
        for (const [k, v] of Object.entries(parsed.data)) {
          if (KEYS.includes(k) && typeof v === 'string') {
            localStorage.setItem(k, v);
            applied++;
          }
        }
        renderSummary();
        setStatus(`Restored ${applied} keys. Reload the app to see everything.`);
        // Best-effort: nudge the rest of the app
        import('./eventBus.js').then((m) => m.default?.emit?.('backup-restored')).catch(() => {});
      } catch (err) {
        setStatus(`Import failed: ${err.message}`, 'err');
      } finally {
        e.target.value = '';
      }
    };
    reader.onerror = () => setStatus('Could not read that file.', 'err');
    reader.readAsText(file);
  });

  // ---------- clear (double-confirm) ----------
  panel.querySelector('#backup-clear').addEventListener('click', () => {
    if (!confirm('Erase all Pocket data on this device?')) return;
    if (!confirm('Really? This cannot be undone unless you exported first.')) return;
    for (const k of KEYS) localStorage.removeItem(k);
    renderSummary();
    setStatus('All local data cleared. Reload the app.');
  });

  // ---------- nav click wiring (works regardless of how other nav items are wired) ----------
  navItem.addEventListener('click', () => {
    document.querySelectorAll('.dash-nav-item').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.dash-panel').forEach((el) => el.classList.remove('active'));
    navItem.classList.add('active');
    panel.classList.add('active');
    renderSummary();
  });

  renderSummary();
}


