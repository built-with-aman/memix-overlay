// A minimal event bus. This is the seam future AI/voice features hang off of.
//
// Events used across the app:
//   'trigger-category'      payload: category string  (jump loop to one sticker in that category, once)
//   'trigger-sticker'       payload: filename          (jump loop to one specific sticker, once)
//   'active-loop-changed'   payload: { type: 'all' | 'favorites' | 'playlist' | 'mood', playlistId?, moodKey? }
//   'favorites-changed'     payload: none              (favorites set was edited)
//   'playlists-changed'     payload: none              (a playlist was created/edited/deleted/reordered)
//   'queue-changed'         payload: none              (auto-queue config edited)
//   'voice-command'         payload: { phrase, moodKey } (raw + resolved voice command, for UI feedback/logging)
class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event).delete(cb);
  }
  once(event, cb) {
    const off = this.on(event, (payload) => { off(); cb(payload); });
    return off;
  }
  emit(event, payload) {
    (this.listeners.get(event) || []).forEach((cb) => cb(payload));
  }
}

const bus = new EventBus();
export default bus;

// ---- Future AI feature stubs ----
// import bus from './eventBus.js';
//
// voiceRecognition.js (see dashboard.js `initVoiceCommands`) calls:
//   bus.emit('active-loop-changed', { type: 'mood', moodKey: 'funny' });
//
// emotionDetection.js would call:
//   bus.emit('trigger-category', 'shock');
//
// chatReactions.js would call:
//   bus.emit('trigger-sticker', 'dance_blob.svg');
