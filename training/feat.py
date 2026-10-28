"""Trasaturi portabile (numpy) -- implementate IDENTIC in JavaScript (app.js / detector.js).
Imaginea de lucru: latura mare = 1100 px. Totul in float64, fara functii care difera intre limbaje."""
import numpy as np, cv2, math
LONG = 1100
NF = 335

def prep(bgr):
    s = LONG / max(bgr.shape[:2])
    im = cv2.resize(bgr, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return im, s

def integrals(bgr):
    b, g, r = [bgr[..., i].astype(np.float64) for i in (0, 1, 2)]
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b); d = mx - mn
    V = mx
    S = np.where(mx > 0, 255.0 * d / np.where(mx > 0, mx, 1), 0.0)
    dd = np.where(d > 0, d, 1)
    H = np.where(mx == r, 60 * (g - b) / dd, np.where(mx == g, 120 + 60 * (b - r) / dd, 240 + 60 * (r - g) / dd))
    H = np.where(d > 0, H, 0.0); H = np.where(H < 0, H + 360, H) / 2.0
    out = []
    for ch in (gray, H, S, V):
        ii = np.zeros((ch.shape[0] + 1, ch.shape[1] + 1)); ii[1:, 1:] = ch.cumsum(0).cumsum(1); out.append(ii)
    return out  # gray,H,S,V

def _rnd(x): return np.floor(x + 0.5).astype(np.int64)

def grid_avg(ii, x0, y0, side, N):
    e = x0 + side * np.arange(N + 1) / N; f = y0 + side * np.arange(N + 1) / N
    xe = _rnd(e); ye = _rnd(f)
    xa = xe[:-1]; xb = np.maximum(xa + 1, xe[1:]); ya = ye[:-1]; yb = np.maximum(ya + 1, ye[1:])
    A = ii[np.ix_(yb, xb)] - ii[np.ix_(ya, xb)] - ii[np.ix_(yb, xa)] + ii[np.ix_(ya, xa)]
    area = (yb - ya)[:, None] * (xb - xa)[None, :]
    return A / area

def patch_feat(I, cx, cy, h):
    """I = integrals; patch patrat centrat in (cx,cy), jumatate de latura h. None daca iese din imagine."""
    H_, W_ = I[0].shape[0] - 1, I[0].shape[1] - 1
    x0 = cx - h; y0 = cy - h; side = 2 * h
    if x0 < 0 or y0 < 0 or x0 + side > W_ or y0 + side > H_ or h < 3: return None
    g = grid_avg(I[0], x0, y0, side, 32)
    p = np.pad(g, 1, mode='edge')
    gx = p[1:-1, 2:] - p[1:-1, :-2]; gy = p[2:, 1:-1] - p[:-2, 1:-1]
    mag = np.hypot(gx, gy); ang = np.arctan2(gy, gx); ang = np.where(ang < 0, ang + math.pi, ang); ang = np.where(ang >= math.pi, ang - math.pi, ang)
    bn = np.minimum((ang / math.pi * 9).astype(np.int64), 8)
    hist = np.zeros((4, 4, 9))
    cy_i = (np.arange(32) // 8)[:, None] * np.ones((1, 32), int); cx_i = np.ones((32, 1), int) * (np.arange(32) // 8)[None, :]
    np.add.at(hist, (cy_i.ravel(), cx_i.ravel(), bn.ravel()), mag.ravel())
    hv = []
    for by in range(3):
        for bx in range(3):
            v = hist[by:by + 2, bx:bx + 2].ravel(); hv.append(v / math.sqrt((v * v).sum() + 1e-6))
    c = np.stack([grid_avg(I[k], x0, y0, side, 8) for k in (1, 2, 3)], -1).reshape(64, 3)
    cc = c.reshape(8, 8, 3)[3:5, 3:5].reshape(4, 3).mean(0)
    return np.concatenate([np.concatenate(hv), c.mean(0), c.std(0), cc, [g.std(), g.mean()]])
