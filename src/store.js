// Local persistence. For the prototype everything lives in this browser's localStorage.
// Each device therefore has its own history; a synced database comes in the next phase.

const KEY = 'learningApp.v1';

export const COLORS = ['#4f6df5', '#e0457b', '#2a9d8f', '#f08a24', '#8e5bd6', '#3a9ad9'];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultState() {
  return { v: 1, profiles: [], banks: [], sessions: [], pinHash: null, lastProfileId: null };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* private mode or corrupted data: start fresh */ }
  return defaultState();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// The PIN only guards against accidental changes; it is not strong security.
export async function hashPin(pin) {
  const text = 'learningApp:' + pin;
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* fall through */ }
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return 'x' + (h >>> 0).toString(16);
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
