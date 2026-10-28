'use strict';
/* Detector de capete de bușteni — rulează local pe telefon, fără internet.
   Trăsăturile sunt identice cu training/feat.py (verificat cu un test de paritate).
   Model: arbori de decizie (gradient boosting) exportați din training/export_model.py. */
(function (root) {
  const LONG = 1100;          // latura mare a imaginii de lucru
  const NF = 335;             // număr de trăsături
  const SC = [0.6, 0.8, 1.0, 1.3, 1.7];

  /* ---------- imaginea de lucru: integrale pentru gri, H, S, V ---------- */
  function integralsFromRGBA(data, w, h) {
    const W1 = w + 1, n = W1 * (h + 1);
    const I = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    for (let y = 0; y < h; y++) {
      const rs = [0, 0, 0, 0];
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, r = data[o], g = data[o + 1], b = data[o + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        const V = mx, S = mx > 0 ? 255 * d / mx : 0;
        let H = 0;
        if (d > 0) {
          if (mx === r) H = 60 * (g - b) / d;
          else if (mx === g) H = 120 + 60 * (b - r) / d;
          else H = 240 + 60 * (r - g) / d;
          if (H < 0) H += 360;
          H /= 2;
        }
        rs[0] += gray; rs[1] += H; rs[2] += S; rs[3] += V;
        const i = (y + 1) * W1 + (x + 1), up = y * W1 + (x + 1);
        for (let k = 0; k < 4; k++) I[k][i] = I[k][up] + rs[k];
      }
    }
    return { I, w, h, W1 };
  }

  const rnd = (x) => Math.floor(x + 0.5);

  // media pe o grilă NxN într-un pătrat; out = Float64Array(N*N)
  const _xe = new Int32Array(33), _ye = new Int32Array(33);
  function gridAvg(ii, W1, x0, y0, side, N, out) {
    for (let i = 0; i <= N; i++) { _xe[i] = rnd(x0 + side * i / N); _ye[i] = rnd(y0 + side * i / N); }
    for (let j = 0; j < N; j++) {
      const ya = _ye[j], yb = Math.max(ya + 1, _ye[j + 1]);
      for (let i = 0; i < N; i++) {
        const xa = _xe[i], xb = Math.max(xa + 1, _xe[i + 1]);
        const A = ii[yb * W1 + xb] - ii[ya * W1 + xb] - ii[yb * W1 + xa] + ii[ya * W1 + xa];
        out[j * N + i] = A / ((yb - ya) * (xb - xa));
      }
    }
  }

  const _g = new Float64Array(1024), _p = new Float64Array(34 * 34), _hist = new Float64Array(4 * 4 * 9);
  const _c = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
  const PI = Math.PI;

  // trăsăturile unui pătrat cu centrul (cx,cy) și jumătate de latură h; false dacă iese din imagine
  function patchFeat(S, cx, cy, h, out) {
    const x0 = cx - h, y0 = cy - h, side = 2 * h;
    if (x0 < 0 || y0 < 0 || x0 + side > S.w || y0 + side > S.h || h < 3) return false;
    gridAvg(S.I[0], S.W1, x0, y0, side, 32, _g);
    // padding „edge” 1 pixel
    for (let y = 0; y < 34; y++) {
      const sy = Math.min(31, Math.max(0, y - 1));
      for (let x = 0; x < 34; x++) _p[y * 34 + x] = _g[sy * 32 + Math.min(31, Math.max(0, x - 1))];
    }
    _hist.fill(0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const gx = _p[(y + 1) * 34 + x + 2] - _p[(y + 1) * 34 + x];
        const gy = _p[(y + 2) * 34 + x + 1] - _p[y * 34 + x + 1];
        const mag = Math.hypot(gx, gy);
        let ang = Math.atan2(gy, gx);
        if (ang < 0) ang += PI;
        if (ang >= PI) ang -= PI;
        const bn = Math.min(Math.floor(ang / PI * 9), 8);
        _hist[((y >> 3) * 4 + (x >> 3)) * 9 + bn] += mag;
      }
    }
    let o = 0;
    for (let by = 0; by < 3; by++) {
      for (let bx = 0; bx < 3; bx++) {
        let ss = 0;
        const start = o;
        for (let cy2 = 0; cy2 < 2; cy2++) for (let cx2 = 0; cx2 < 2; cx2++) for (let k = 0; k < 9; k++) {
          const v = _hist[((by + cy2) * 4 + (bx + cx2)) * 9 + k];
          out[o++] = v; ss += v * v;
        }
        const nrm = Math.sqrt(ss + 1e-6);
        for (let q = start; q < o; q++) out[q] /= nrm;
      }
    }
    for (let k = 0; k < 3; k++) gridAvg(S.I[k + 1], S.W1, x0, y0, side, 8, _c[k]);
    // medii, deviații (populație) pe cele 64 celule, centru 2x2, gri std/mean
    const mean = [0, 0, 0], sd = [0, 0, 0], cen = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let s1 = 0;
      for (let i = 0; i < 64; i++) s1 += _c[k][i];
      const m = s1 / 64; mean[k] = m;
      let s2 = 0;
      for (let i = 0; i < 64; i++) { const d = _c[k][i] - m; s2 += d * d; }
      sd[k] = Math.sqrt(s2 / 64);
      cen[k] = (_c[k][3 * 8 + 3] + _c[k][3 * 8 + 4] + _c[k][4 * 8 + 3] + _c[k][4 * 8 + 4]) / 4;
    }
    let gs = 0;
    for (let i = 0; i < 1024; i++) gs += _g[i];
    const gm = gs / 1024; let gv = 0;
    for (let i = 0; i < 1024; i++) { const d = _g[i] - gm; gv += d * d; }
    for (let k = 0; k < 3; k++) out[o++] = mean[k];
    for (let k = 0; k < 3; k++) out[o++] = sd[k];
    for (let k = 0; k < 3; k++) out[o++] = cen[k];
    out[o++] = Math.sqrt(gv / 1024); out[o++] = gm;
    return true;
  }

  /* ---------- modelul: arbori de decizie ---------- */
  function predictProb(model, x) {
    let raw = model.base;
    const T = model.trees;
    for (let t = 0; t < T.length; t++) {
      const tr = T[t]; let n = 0;
      while (tr.f[n] >= 0) n = x[tr.f[n]] <= tr.t[n] ? tr.l[n] : tr.r[n];
      raw += tr.v[n];
    }
    return 1 / (1 + Math.exp(-raw));
  }

  const _x = new Float64Array(NF);
  function probAt(model, S, cx, cy, h) {
    return patchFeat(S, cx, cy, h, _x) ? predictProb(model, _x) : 0;
  }

  // Utilizatorul atinge un buștean: mărimea la care modelul e cel mai sigur
  function estimateRadius(model, S, tx, ty) {
    const scales = [], best = [];
    for (let i = 0; i < 36; i++) scales.push(Math.exp(Math.log(7) + (Math.log(150) - Math.log(7)) * i / 35));
    for (const s of scales) {
      const o = 0.3 * s; let m = 0;
      for (const [a, b] of [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]]) m = Math.max(m, probAt(model, S, tx + a, ty + b, s * 1.25));
      best.push(m);
    }
    const mx = Math.max(...best);
    let sl = 0, n = 0;
    for (let i = 0; i < scales.length; i++) if (best[i] >= 0.9 * mx) { sl += Math.log(scales[i]); n++; }
    return { r: Math.exp(sl / n), conf: mx };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  // detecția pe toată poza (sau într-un dreptunghi roi = {x0,y0,x1,y1} în px de lucru)
  async function detect(model, S, r, thr, roi, onProgress) {
    const cands = [];
    const total = SC.length; let done = 0;
    const x0 = roi ? roi.x0 : 0, y0 = roi ? roi.y0 : 0, x1 = roi ? roi.x1 : S.w, y1 = roi ? roi.y1 : S.h;
    for (const m of SC) {
      const rr = r * m, st = Math.max(6, Math.floor(rr * 0.4));
      let cnt = 0;
      for (let y = st; y < S.h - st; y += st) {
        for (let x = st; x < S.w - st; x += st) {
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const p = probAt(model, S, x, y, rr * 1.25);
          if (p >= thr) cands.push([p, x, y, rr]);
        }
        if ((++cnt & 7) === 0) await tick();
      }
      done++;
      if (onProgress) onProgress(done / total);
    }
    cands.sort((a, b) => b[0] - a[0]);
    const keep = [];
    for (const c of cands) {
      let ok = true;
      for (const k of keep) if (Math.hypot(c[1] - k[1], c[2] - k[2]) <= Math.max(c[3], k[3])) { ok = false; break; }
      if (ok) keep.push(c);
    }
    return keep;
  }

  const api = { LONG, NF, SC, integralsFromRGBA, patchFeat, predictProb, probAt, estimateRadius, detect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detector = api;
})(typeof self !== 'undefined' ? self : this);
