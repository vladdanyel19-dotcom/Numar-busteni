'use strict';
/* Numără Bușteni — v1: numărare prin atingere, offline, cu salvare locală.
   Fiecare numărătoare salvată = poză + marcaje => date bune pentru antrenarea
   unui detector automat mai târziu. */

const $ = (s) => document.querySelector(s);
const MAX_SIDE = 2400;
const TAP_RADIUS = 20;   // px pe ecran: cât de aproape de un marcaj ștergi în loc să adaugi
const MARK_R = 8;        // raza marcajului, px pe ecran
const AUTO_THR = 0.93;   // cât de sigur trebuie să fie modelul ca să marcheze un buștean

/* ---------- IndexedDB (istoric) ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('busteni', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('counts', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbDo(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction('counts', mode);
    const req = fn(t.objectStore('counts'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const dbAll = () => dbDo('readonly', (s) => s.getAll());
const dbPut = (o) => dbDo('readwrite', (s) => s.put(o));
const dbDel = (id) => dbDo('readwrite', (s) => s.delete(id));
const dbGet = (id) => dbDo('readonly', (s) => s.get(id));

/* ---------- Stare ---------- */
let cur = null;   // { id, img(canvas|bitmap), blob, marks:[{x,y,a?}], rejected:[{x,y}], undo:[], dirty, work }
let mode = null;  // null | 'pickSize' (utilizatorul alege un buștean mijlociu pentru Auto)
let busy = false;
let model = null;
const view = { s: 1, tx: 0, ty: 0 };
const cv = $('#cv');
const ctx = cv.getContext('2d');
let dpr = 1, W = 0, H = 0;

/* ---------- Utilitare UI ---------- */
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function show(which) {
  $('#home').classList.toggle('hidden', which !== 'home');
  $('#work').classList.toggle('hidden', which !== 'work');
  if (which === 'work') requestAnimationFrame(() => { resize(); fit(); });
}
function updateCount() {
  $('#countNum').textContent = cur ? cur.marks.length : 0;
  $('#btnUndo').disabled = !cur || cur.undo.length === 0;
  $('#btnClear').disabled = !cur || cur.marks.length === 0;
}

/* ---------- Încărcare poză ---------- */
function canvasToBlob(c, q = 0.9) {
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}
async function loadFile(file) {
  if (!file) return;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    toast('Nu pot deschide poza asta.');
    return;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  cur = {
    id: 'c' + Date.now(),
    img: c,
    blob: await canvasToBlob(c),
    marks: [],
    rejected: [],
    undo: [],
    dirty: false,
    work: null,
  };
  openWork();
}
async function openSaved(id) {
  const rec = await dbGet(id);
  if (!rec) return;
  const bmp = await createImageBitmap(rec.blob);
  cur = { id: rec.id, img: bmp, blob: rec.blob, marks: rec.marks.map((m) => ({ ...m })), rejected: (rec.rejected || []).slice(), undo: [], dirty: false, work: null };
  openWork();
}
function openWork() {
  mode = null;
  setHint('Atinge fiecare buștean. Atinge un marcaj ca să-l ștergi. Două degete = zoom.', false);
  $('#hint').classList.remove('off');
  updateCount();
  show('work');
}

/* ---------- Canvas: dimensiune, transformări, desen ---------- */
function resize() {
  const st = $('#stage');
  dpr = window.devicePixelRatio || 1;
  W = st.clientWidth; H = st.clientHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  draw();
}
function fit() {
  if (!cur) return;
  const iw = cur.img.width, ih = cur.img.height;
  view.s = Math.min(W / iw, H / ih);
  view.tx = (W - iw * view.s) / 2;
  view.ty = (H - ih * view.s) / 2;
  draw();
}
const toImg = (px, py) => ({ x: (px - view.tx) / view.s, y: (py - view.ty) / view.s });
const toScr = (x, y) => ({ x: x * view.s + view.tx, y: y * view.s + view.ty });

function clampView() {
  if (!cur) return;
  const iw = cur.img.width * view.s, ih = cur.img.height * view.s;
  const m = 80; // cât poate ieși poza din ecran
  view.tx = Math.min(W - m, Math.max(m - iw, view.tx));
  view.ty = Math.min(H - m, Math.max(m - ih, view.ty));
}
let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}
function paint() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!cur) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur.img, view.tx, view.ty, cur.img.width * view.s, cur.img.height * view.s);

  const showNums = view.s > 0 && cur.marks.length <= 400;
  ctx.font = 'bold 12px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  cur.marks.forEach((m, i) => {
    const p = toScr(m.x, m.y);
    if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, MARK_R, 0, Math.PI * 2);
    ctx.fillStyle = m.a ? 'rgba(61,220,132,.4)' : 'rgba(255,176,32,.5)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#06210f';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = m.a ? '#3ddc84' : '#ffb020';
    ctx.stroke();
    if (showNums && view.s > 0.35) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(String(i + 1), p.x, p.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), p.x, p.y);
    }
  });
}

/* ---------- Marcaje ---------- */
function tapAt(px, py) {
  if (!cur || busy) return;
  if (mode === 'pickSize') { runAuto(px, py); return; }
  // marcaj apropiat? => șterge
  let best = -1, bd = TAP_RADIUS;
  cur.marks.forEach((m, i) => {
    const p = toScr(m.x, m.y);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0) {
    const [mk] = cur.marks.splice(best, 1);
    if (mk.a) cur.rejected.push({ x: mk.x, y: mk.y });   // detecție greșită: bună ca exemplu negativ la antrenare
    cur.undo.push({ t: 'del', i: best, m: mk, rej: !!mk.a });
  } else {
    const q = toImg(px, py);
    if (q.x < 0 || q.y < 0 || q.x > cur.img.width || q.y > cur.img.height) return;
    cur.marks.push({ x: Math.round(q.x), y: Math.round(q.y) });
    cur.undo.push({ t: 'add' });
  }
  cur.dirty = true;
  $('#hint').classList.add('off');
  if (navigator.vibrate) navigator.vibrate(8);
  updateCount();
  draw();
}
function undo() {
  if (!cur || !cur.undo.length) return;
  const a = cur.undo.pop();
  if (a.t === 'add') cur.marks.pop();
  else if (a.t === 'batch') cur.marks.splice(cur.marks.length - a.n, a.n);
  else if (a.t === 'all') cur.marks = a.marks;
  else { cur.marks.splice(a.i, 0, a.m); if (a.rej) cur.rejected.pop(); }
  cur.dirty = true;
  updateCount();
  draw();
}

/* ---------- Gesturi (pan, pinch, tap) ---------- */
const ptrs = new Map();
let g = null; // { moved, t0, startDist, startS, cx, cy }
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect();
  ptrs.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX - r.left, sy: e.clientY - r.top });
  if (ptrs.size === 1) g = { moved: false, t0: performance.now(), multi: false };
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    g.multi = true; g.moved = true;
    g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    g.startS = view.s;
    g.cx = (a.x + b.x) / 2; g.cy = (a.y + b.y) / 2;
    g.anchor = toImg(g.cx, g.cy);
  }
});
cv.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p || !g) return;
  const r = cv.getBoundingClientRect();
  const nx = e.clientX - r.left, ny = e.clientY - r.top;
  if (ptrs.size === 1) {
    if (!g.moved && Math.hypot(nx - p.sx, ny - p.sy) > 10) g.moved = true;
    if (g.moved) {
      view.tx += nx - p.x; view.ty += ny - p.y;
      clampView(); draw();
    }
  } else if (ptrs.size === 2) {
    p.x = nx; p.y = ny;
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const minS = Math.min(W / cur.img.width, H / cur.img.height) * 0.8;
    view.s = Math.min(12, Math.max(minS, g.startS * d / g.startDist));
    view.tx = cx - g.anchor.x * view.s;
    view.ty = cy - g.anchor.y * view.s;
    clampView(); draw();
  }
  p.x = nx; p.y = ny;
});
function endPtr(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (g && !g.moved && !g.multi && ptrs.size === 0 && e.type === 'pointerup'
      && performance.now() - g.t0 < 600) {
    tapAt(p.sx, p.sy);
  }
  if (ptrs.size === 0) g = null;
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const a = toImg(px, py);
  view.s = Math.min(12, Math.max(0.05, view.s * Math.exp(-e.deltaY * 0.0015)));
  view.tx = px - a.x * view.s; view.ty = py - a.y * view.s;
  clampView(); draw();
}, { passive: false });
window.addEventListener('resize', () => { if (cur) { resize(); } });

/* ---------- Salvare / partajare ---------- */
async function thumbOf(img) {
  const k = 160 / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
async function save() {
  if (!cur) return;
  await dbPut({
    id: cur.id,
    date: Date.now(),
    count: cur.marks.length,
    marks: cur.marks,
    rejected: cur.rejected,
    blob: cur.blob,
    w: cur.img.width, h: cur.img.height,
    thumb: await thumbOf(cur.img),
  });
  cur.dirty = false;
  toast(`Salvat: ${cur.marks.length} bușteni`);
}
function annotationJSON(rec) {
  return JSON.stringify({
    id: rec.id, date: new Date(rec.date).toISOString(),
    width: rec.w, height: rec.h, count: rec.count,
    points: rec.marks, // centrul fiecărui buștean, în pixeli ai pozei; a:1 = găsit automat și păstrat
    rejected: rec.rejected || [], // detecții automate pe care le-ai șters (nu sunt bușteni)
  }, null, 1);
}
async function share(id) {
  const rec = await dbGet(id);
  if (!rec) return;
  const base = 'busteni-' + new Date(rec.date).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const img = new File([rec.blob], base + '.jpg', { type: 'image/jpeg' });
  const js = new File([annotationJSON(rec)], base + '.json', { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [img, js] })) {
      await navigator.share({ files: [img, js], title: `${rec.count} bușteni` });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  for (const f of [img, js]) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  toast('Fișierele au fost descărcate.');
}

/* ---------- Istoric ---------- */
async function renderHistory() {
  const list = await dbAll();
  list.sort((a, b) => b.date - a.date);
  const ul = $('#histList');
  ul.innerHTML = '';
  $('#histEmpty').classList.toggle('hidden', list.length > 0);
  for (const r of list) {
    const li = document.createElement('li');
    const d = new Date(r.date);
    li.innerHTML = `<img alt=""><div class="meta"><div class="n"></div><div class="d"></div></div>
      <button data-a="share" aria-label="Trimite">↗</button><button data-a="del" aria-label="Șterge">✕</button>`;
    li.querySelector('img').src = r.thumb;
    li.querySelector('.n').textContent = r.count + ' bușteni';
    li.querySelector('.d').textContent = d.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
    li.addEventListener('click', async (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'share') return share(r.id);
      if (a === 'del') {
        if (confirm('Ștergi această numărătoare?')) { await dbDel(r.id); renderHistory(); }
        return;
      }
      openSaved(r.id);
    });
    ul.appendChild(li);
  }
}

/* ---------- Auto-detectare ---------- */
function setHint(text, persist) {
  const h = $('#hint');
  h.textContent = text;
  h.classList.toggle('strong', !!persist);
  h.classList.remove('off');
}
function setBusy(text) {
  busy = !!text;
  const b = $('#busy');
  b.classList.toggle('hidden', !text);
  if (text) $('#busyTxt').textContent = text;
}
async function loadModel() {
  if (model) return model;
  const r = await fetch('model.json');
  if (!r.ok) throw new Error('model');
  model = await r.json();
  return model;
}
function workImage() {
  if (cur.work) return cur.work;
  const k = Detector.LONG / Math.max(cur.img.width, cur.img.height);
  const w = Math.round(cur.img.width * k), h = Math.round(cur.img.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(cur.img, 0, 0, w, h);
  const S = Detector.integralsFromRGBA(cx.getImageData(0, 0, w, h).data, w, h);
  cur.work = { S, k };
  return cur.work;
}
function startAuto() {
  if (!cur || busy) return;
  if (mode === 'pickSize') {
    mode = null;
    setHint('Atinge fiecare buștean. Atinge un marcaj ca să-l ștergi. Două degete = zoom.', false);
    return;
  }
  mode = 'pickSize';
  $('#btnAuto').classList.add('on');
  setHint('Atinge mijlocul unui capăt de buștean de mărime medie.', true);
}
async function runAuto(px, py) {
  mode = null;
  $('#btnAuto').classList.remove('on');
  const q = toImg(px, py);
  setBusy('Pregătesc…');
  try {
    await loadModel();
    await new Promise((r) => setTimeout(r, 30));
    const { S, k } = workImage();
    const est = Detector.estimateRadius(model, S, q.x * k, q.y * k);
    if (est.conf < 0.4) {
      setBusy(null);
      setHint('Nu recunosc un buștean acolo. Încearcă din nou, atingând exact mijlocul unui capăt.', false);
      return;
    }
    const dets = await Detector.detect(model, S, est.r, AUTO_THR, null,
      (f) => setBusy(`Caut bușteni… ${Math.round(f * 100)}%`));
    // nu dubla marcajele existente sau pe cele pe care le-ai șters deja
    const near = (list, x, y, r) => list.some((m) => Math.hypot(m.x * k - x, m.y * k - y) < 0.8 * r);
    const added = [];
    for (const d of dets) {
      const [, x, y, r] = d;
      if (near(cur.marks, x, y, r) || near(cur.rejected, x, y, r)) continue;
      added.push({ x: Math.round(x / k), y: Math.round(y / k), a: 1 });
    }
    cur.marks.push(...added);
    if (added.length) cur.undo.push({ t: 'batch', n: added.length });
    cur.dirty = true;
    updateCount(); draw();
    setHint(`Am găsit ${added.length} bușteni (verzi). Șterge ce e greșit, adaugă ce lipsește (portocaliu).`, false);
  } catch (e) {
    setHint('Auto-detectarea nu a mers. Poți număra manual.', false);
  } finally {
    setBusy(null);
  }
}

/* ---------- Butoane ---------- */
$('#btnAuto').addEventListener('click', startAuto);
$('#inCam').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#inGal').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#btnUndo').addEventListener('click', undo);
$('#btnFit').addEventListener('click', fit);
$('#btnClear').addEventListener('click', () => {
  if (!cur || !cur.marks.length) return;
  if (!confirm('Ștergi toate marcajele?')) return;
  cur.undo.push({ t: 'all', marks: cur.marks });
  cur.marks = [];
  cur.dirty = true; updateCount(); draw();
});
$('#btnSave').addEventListener('click', async () => { await save(); });
$('#btnBack').addEventListener('click', async () => {
  if (cur && cur.dirty && cur.marks.length && !confirm('Ieși fără să salvezi?')) return;
  cur = null;
  mode = null;
  $('#btnAuto').classList.remove('on');
  show('home');
  renderHistory();
});

/* ---------- Pornire ---------- */
renderHistory();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
