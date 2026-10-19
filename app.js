'use strict';

const $ = (s) => document.querySelector(s);
const audio = $('#audio');

// ---------- Storage: songs live in IndexedDB (on this device only) ----------

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('audio_app', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('songs', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', mode);
    const req = fn(tx.objectStore('songs'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function loadSetting(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ---------- State ----------

let library = [];                       // [{ id, name }]
// Each queue entry gets its own key so the same song can appear many times.
let queue = loadSetting('queue', []).map((songId) => ({ key: newId(), songId }));
let currentKey = null;
let currentUrl = null;
let speed = loadSetting('speed', 1);
let keepPitch = loadSetting('keepPitch', false);
let repeat = loadSetting('repeat', false);
let seeking = false;

const curIndex = () => queue.findIndex((q) => q.key === currentKey);
const songName = (id) => (library.find((s) => s.id === id) || {}).name || '(missing)';
const saveQueue = () => saveSetting('queue', queue.map((q) => q.songId));

// ---------- Library ----------

async function refreshLibrary() {
  const all = await store('readonly', (s) => s.getAll());
  library = all.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  // Drop queue entries whose song no longer exists.
  const ids = new Set(library.map((s) => s.id));
  queue = queue.filter((q) => ids.has(q.songId));
  saveQueue();
  render();
}

$('#files').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    await store('readwrite', (s) => s.put({ id: newId(), name, blob: file }));
  }
  e.target.value = '';
  // Ask the browser not to evict our stored songs when space is low.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  refreshLibrary();
});

async function deleteSong(id) {
  if (!confirm(`Delete "${songName(id)}" from the library?`)) return;
  if (queue.some((q) => q.key === currentKey && q.songId === id)) stop();
  await store('readwrite', (s) => s.delete(id));
  refreshLibrary();
}

function addToQueue(songId) {
  queue.push({ key: newId(), songId });
  saveQueue();
  render();
}

$('#addAll').addEventListener('click', () => library.forEach((s) => addToQueue(s.id)));

// ---------- Queue ----------

function moveItem(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= queue.length) return;
  [queue[i], queue[j]] = [queue[j], queue[i]];
  saveQueue();
  render();
}

function removeItem(i) {
  if (queue[i].key === currentKey) stop();
  queue.splice(i, 1);
  saveQueue();
  render();
}

$('#clearQueue').addEventListener('click', () => {
  if (!queue.length || !confirm('Clear the whole playlist?')) return;
  stop();
  queue = [];
  saveQueue();
  render();
});

// ---------- Playback ----------

function applySpeed() {
  audio.defaultPlaybackRate = speed;
  audio.playbackRate = speed;
  audio.preservesPitch = keepPitch;
  audio.webkitPreservesPitch = keepPitch;
  audio.mozPreservesPitch = keepPitch;
  updatePositionState();
}

async function playIndex(i) {
  const item = queue[i];
  if (!item) return stop();
  const rec = await store('readonly', (s) => s.get(item.songId));
  if (!rec) return stop();

  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(rec.blob);
  currentKey = item.key;
  audio.src = currentUrl;
  applySpeed();
  render();
  try { await audio.play(); } catch (err) { console.warn('play() failed', err); }
}

function stop() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  currentKey = null;
  render();
}

function togglePlay() {
  if (!currentKey) {
    if (queue.length) playIndex(0);
  } else if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

function next() {
  const i = curIndex();
  if (i + 1 < queue.length) playIndex(i + 1);
  else if (repeat && queue.length) playIndex(0);
  else stop();
}

function prev() {
  const i = curIndex();
  // Like most players: if we're a few seconds in, restart the song instead.
  if (audio.currentTime > 3 || i <= 0) audio.currentTime = 0;
  else playIndex(i - 1);
}

function skip(seconds) {
  if (!currentKey) return;
  const end = isFinite(audio.duration) ? audio.duration : Infinity;
  audio.currentTime = Math.max(0, Math.min(end - 0.1, audio.currentTime + seconds));
}

audio.addEventListener('ended', next);
// Some browsers reset the rate when a new file loads, so re-apply it.
audio.addEventListener('loadedmetadata', () => { applySpeed(); renderTime(); });
audio.addEventListener('play', () => { applySpeed(); renderPlayState(); });
audio.addEventListener('pause', renderPlayState);
audio.addEventListener('timeupdate', renderTime);
audio.addEventListener('ratechange', updatePositionState);

$('#play').addEventListener('click', togglePlay);
$('#next').addEventListener('click', next);
$('#prev').addEventListener('click', prev);
$('#back10').addEventListener('click', () => skip(-10));
$('#fwd10').addEventListener('click', () => skip(10));

const seekBar = $('#seek');
seekBar.addEventListener('input', () => { seeking = true; $('#elapsed').textContent = fmt(seekBar.value); });
seekBar.addEventListener('change', () => {
  seeking = false;
  if (currentKey) audio.currentTime = Number(seekBar.value);
});

// ---------- Speed & options ----------

const speedBar = $('#speed');
function setSpeed(v) {
  speed = Math.round(Number(v) * 100) / 100;
  speedBar.value = speed;
  $('#speedVal').textContent = speed.toFixed(2) + '×';
  saveSetting('speed', speed);
  applySpeed();
}
speedBar.addEventListener('input', () => setSpeed(speedBar.value));
$('#speedReset').addEventListener('click', () => setSpeed(1));

$('#keepPitch').checked = keepPitch;
$('#keepPitch').addEventListener('change', (e) => {
  keepPitch = e.target.checked;
  saveSetting('keepPitch', keepPitch);
  applySpeed();
});

$('#repeat').checked = repeat;
$('#repeat').addEventListener('change', (e) => {
  repeat = e.target.checked;
  saveSetting('repeat', repeat);
});

// ---------- Lock screen / notification controls (Media Session API) ----------

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const item = queue[curIndex()];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item ? songName(item.songId) : 'Audio App',
    artist: item ? `Track ${curIndex() + 1} of ${queue.length}` : '',
    album: 'Audio App',
    artwork: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}

function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch {}
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => (currentKey ? audio.play() : togglePlay()),
    pause: () => audio.pause(),
    stop: () => audio.pause(),
    previoustrack: prev,
    nexttrack: next,
    seekbackward: (d) => skip(-(d.seekOffset || 10)),
    seekforward: (d) => skip(d.seekOffset || 10),
    seekto: (d) => { audio.currentTime = d.seekTime; updatePositionState(); },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  }
}

// ---------- Keyboard shortcuts (desktop) ----------

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-10); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); skip(10); }
});

// ---------- Rendering ----------

function fmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderTime() {
  const dur = isFinite(audio.duration) ? audio.duration : 0;
  seekBar.max = dur;
  if (!seeking) {
    seekBar.value = audio.currentTime || 0;
    $('#elapsed').textContent = fmt(audio.currentTime);
  }
  $('#duration').textContent = fmt(dur);
}

let lastPositionUpdate = 0;
audio.addEventListener('timeupdate', () => {
  // Keep the lock-screen progress bar roughly in sync without spamming it.
  if (Date.now() - lastPositionUpdate > 5000) { lastPositionUpdate = Date.now(); updatePositionState(); }
});

function renderPlayState() {
  const playing = currentKey && !audio.paused;
  $('#play').textContent = playing ? '⏸' : '▶';
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = currentKey ? (playing ? 'playing' : 'paused') : 'none';
}

function render() {
  const ci = curIndex();
  const item = queue[ci];
  $('#title').textContent = item ? songName(item.songId) : 'Nothing yet';
  $('#position').textContent = item ? `Track ${ci + 1} of ${queue.length}` : queue.length ? 'Press ▶ to start the playlist' : '';
  renderPlayState();
  renderTime();

  const q = $('#queue');
  q.replaceChildren();
  if (!queue.length) q.append(el('li', { className: 'empty', textContent: 'Empty. Add songs from the library below.' }));
  queue.forEach((entry, i) => {
    q.append(el('li', { className: i === ci ? 'current' : '' },
      el('span', { className: 'num', textContent: i + 1 }),
      el('span', { className: 'name', textContent: songName(entry.songId), onclick: () => playIndex(i) }),
      el('button', { textContent: '↑', title: 'Move up', disabled: i === 0, onclick: () => moveItem(i, -1) }),
      el('button', { textContent: '↓', title: 'Move down', disabled: i === queue.length - 1, onclick: () => moveItem(i, 1) }),
      el('button', { className: 'del', textContent: '✕', title: 'Remove from playlist', onclick: () => removeItem(i) }),
    ));
  });

  const lib = $('#library');
  lib.replaceChildren();
  if (!library.length) lib.append(el('li', { className: 'empty', textContent: 'No songs yet.' }));
  library.forEach((song) => {
    lib.append(el('li', {},
      el('span', { className: 'name', textContent: song.name, onclick: () => addToQueue(song.id) }),
      el('button', { textContent: '+', title: 'Add to playlist', onclick: () => addToQueue(song.id) }),
      el('button', { className: 'del', textContent: '🗑', title: 'Delete from library', onclick: () => deleteSong(song.id) }),
    ));
  });

  updateMediaSession();
}

// ---------- Start ----------

setSpeed(speed);
refreshLibrary();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
}
