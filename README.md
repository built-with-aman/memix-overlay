# Memix Overlay

A transparent, always-on-top desktop widget for streamers and creators.  
It loops through animated stickers, memes, GIFs and images with handcrafted per-emotion motion, smooth transitions between them, a shatter-into-fragments close animation, and a full dashboard when maximized.

Built with Electron because true transparency, always-on-top, and click-through only exist at the OS/window-manager level — a browser tab can't do those.

## Run it

```bash
npm install
npm start
```

Requires Node.js. First launch drops the widget in the bottom-right corner of your screen with the stickers already present in `assets/stickers/`.

## Add your own stickers

Drop transparent `.png`, `.webp`, `.svg`, `.gif`, `.jpg` (or video) files into `assets/stickers/`.  
No code changes, no restart — the app watches that folder and picks up new files immediately. Every new sticker automatically inherits the animation/transition system.

**Naming controls the animation.** The filename is scanned for a keyword and mapped to an emotion category, which decides the idle animation:

| keyword in filename          | category | idle animation     |
|------------------------------|----------|--------------------|
| laugh, lol, haha, funny      | laugh    | bounce             |
| shock, surprise, gasp, wow   | shock    | quick vibration    |
| happy, joy, smile, yay       | happy    | soft floating      |
| dance, groove, party         | dance    | rhythmic movement  |
| angry, mad, rage             | angry    | tiny shake         |
| sleep, tired, yawn, zzz      | sleep    | gentle breathing   |
| cute, kawaii, adorable, uwu  | cute     | squash & stretch   |
| think, hmm, ponder, confused | think    | subtle rotation    |

No match? The file still gets a category — it's picked deterministically from a hash of the filename, so the same file always lands on the same animation.

## Add sound effects

Drop `.mp3` files into `assets/sounds/` named to match a category's cue:  
`boing` (think), `pop` (happy), `bonk` (angry), `ding` (shock), `whoosh` (dance), `giggle` (laugh), `squeak` (cute), `bubble` (sleep).  
Volume and on/off live in the Settings and Sound Effects panels — nothing plays until you add files.

## Live AI Features

All of these are active (not placeholders):

- **Voice Recognition** — say “set funny”, “thank you”, or “roast” to switch modes (local, no internet)
- **Emotion Detection** — uses microphone energy; loud/excited speech triggers Shock or Laugh reactions
- **Context Awareness** — quick buttons for Victory / Fail / Funny / Hype / Chill (or auto later)
- **Chat Reactions** — type messages in the AI panel (or later wire real Twitch/YouTube chat) to trigger stickers by keyword

## What's here

```
main.js          Electron main process: transparent/frameless/always-on-top window,
                 sticker folder scanning + hot-reload watcher, IPC
preload.js       Safe bridge exposing window.memix.* to the renderer
config.json      Loop speed, start corner, lock, sound — editable from Settings, persisted to disk
src/index.html   Widget shell + full dashboard markup
src/styles.css   Design tokens, idle-animation keyframes, transition keyframes,
                 hover/shatter/dashboard styling
src/renderer.js  Sticker loop, transition orchestration, hover tilt, shatter open/close,
                 window control wiring
src/dashboard.js Library / categories / favorites / wishlist / playlists / settings / AI panels
src/eventBus.js  Tiny pub-sub used by voice, emotion, chat and future modules
assets/stickers/ Your sticker / meme library
assets/sounds/   Your sound effects (empty by default — add your own)
```

## Interaction model

- **Hover** the widget: it tilts toward your cursor first, *then* an outline and the close / minimize / maximize buttons stagger in.
- **Maximize** shrinks the widget away and grows the window into the dashboard — Home, Sticker Library, Videos, Categories, Favorites, Wishlist, Playlists, Settings, Animations, Sound Effects, AI Features, Backup & Restore.
- **Close** shatters the widget into a checkerboard of tiles that fly up and fade — the same tile system runs in reverse when the widget first opens.
- **Drag** anywhere on the widget body to move it; toggle **Lock position** in Settings to stop that.

## Notes

- The stickers in `assets/stickers/` are provided as examples. Swap them for your own art any time.
- `assets/sounds/` ships empty; the sound system is fully wired but silent until you add files.
- All AI features run locally. Mic permission is only requested when you enable Voice or Emotion Detection.
