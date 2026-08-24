# Pocket — a living sticker overlay

A transparent, always-on-top desktop widget for streamers. It loops through animated
transparent stickers with handcrafted per-emotion motion, magical transitions between
them, a shatter-into-fragments close animation, and a full dashboard when maximized.

Built with Electron because true transparency, always-on-top, and click-through only
exist at the OS/window-manager level — a browser tab can't do those.

## Run it

```bash
npm install
npm start
```

Requires Node.js and will pull down Electron on install. First launch drops the widget
in the bottom-right corner of your screen with 8 demo stickers already loaded.

## Add your own stickers

Drop transparent `.png`, `.webp`, `.svg`, or `.gif` files into `assets/stickers/`.
No code changes, no restart — the app watches that folder and picks up new files
immediately, and every new sticker automatically inherits the animation/transition system.

**Naming controls the animation.** The filename is scanned for a keyword and mapped to
an emotion category, which decides the idle animation:

| keyword in filename         | category | idle animation      |
|---|---|---|
| laugh, lol, haha, funny     | laugh    | bounce               |
| shock, surprise, gasp, wow  | shock    | quick vibration      |
| happy, joy, smile, yay      | happy    | soft floating        |
| dance, groove, party        | dance    | rhythmic movement    |
| angry, mad, rage            | angry    | tiny shake           |
| sleep, tired, yawn, zzz     | sleep    | gentle breathing     |
| cute, kawaii, adorable, uwu | cute     | squash & stretch     |
| think, hmm, ponder, confused| think    | subtle rotation      |

No match? The file still gets a category — it's picked deterministically from a hash of
the filename, so the same file always lands on the same animation, and you never end up
with a plain, un-animated sticker.

## Add sound effects

Drop `.mp3` files into `assets/sounds/` named to match a category's cue:
`boing` (think), `pop` (happy), `bonk` (angry), `ding` (shock), `whoosh` (dance),
`giggle` (laugh), `squeak` (cute), `bubble` (sleep). Volume and on/off live in the
Settings and Sound Effects panels — nothing plays until you add files.

## What's here

```
main.js         Electron main process: transparent/frameless/always-on-top window,
                 sticker folder scanning + hot-reload watcher, IPC
preload.js      Safe bridge exposing window.pocket.* to the renderer
config.json     Loop speed, start corner, click-through, lock, sound — editable from
                 Settings, persisted to disk
src/index.html  Widget shell + full dashboard markup
src/styles.css  Design tokens, idle-animation keyframes, transition keyframes,
                 hover/shatter/dashboard styling
src/renderer.js Sticker loop, transition orchestration, hover tilt, shatter open/close,
                 window control wiring
src/dashboard.js Library/categories/favorites/wishlist/playlists/settings panels
src/eventBus.js  Tiny pub-sub — the seam future AI features plug into
assets/stickers/ Your sticker library (8 demo blobs included)
assets/sounds/   Your sound effects (empty — add your own)
```

## Interaction model

- **Hover** the widget: it tilts toward your cursor first, *then* an outline and the
  close/minimize/maximize buttons stagger in.
- **Maximize** shrinks the widget away and grows the window into the dashboard —
  Home, Sticker Library, Categories, Favorites, Wishlist, Playlists, Settings,
  Animations, Sound Effects, and Future AI Features.
- **Close** shatters the widget into a checkerboard of tiles that fly up and fade —
  the same tile system runs in reverse when the widget first opens.
- **Drag** anywhere on the widget body to move it; toggle **Lock position** in
  Settings to stop that. Toggle **click-through** to let mouse clicks pass through to
  your game underneath.

## Extending with AI later

`src/eventBus.js` is the whole integration seam. A future voice-recognition or
emotion-detection module just needs to call:

```js
import bus from './eventBus.js';
bus.emit('trigger-category', 'laugh');   // or 'trigger-sticker' with a filename
```

`renderer.js` already listens for `trigger-category` and jumps the loop to a matching
sticker — no architecture changes needed to wire in a real model later.

## Notes on this build

- The 8 stickers in `assets/stickers/` are simple original SVG "blob" characters made
  for this demo so the animation system has something to show off out of the box —
  swap in your own art any time.
- `assets/sounds/` ships empty; the sound system is fully wired but silent until you
  add files, so nothing plays an unexpected sound on first run.
