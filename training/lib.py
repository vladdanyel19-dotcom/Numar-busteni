import cv2, json, numpy as np, math
from scipy.spatial import cKDTree
from sklearn.ensemble import HistGradientBoostingClassifier
import feat
SC = [0.6, 0.8, 1.0, 1.3, 1.7]

def load(d):
    bgr = cv2.imread(d['img']); im, s = feat.prep(bgr)
    P = np.array(d['points'], float) * s
    dd, _ = cKDTree(P).query(P, k=2); r = float(np.median(dd[:, 1]) * 0.5)
    return dict(I=feat.integrals(im), shape=im.shape, P=P, r=r, im=im)

def samples(L, rng):
    I, P, r = L['I'], L['P'], L['r']; H, W = L['shape'][:2]; t = cKDTree(P); X = []; y = []
    for p in P:
        for _ in range(3):
            j = rng.normal(0, 0.12 * r, 2); f = feat.patch_feat(I, p[0] + j[0], p[1] + j[1], r * rng.uniform(.9, 1.15) * 1.25)
            if f is not None: X.append(f); y.append(1)
    n = 0
    while n < len(P) * 14:
        x = rng.uniform(0, W); yy = rng.uniform(0, H); s = r * rng.choice(SC)
        d, _ = t.query([x, yy])
        if d < 0.45 * r and abs(s / r - 1) < 0.2: continue
        f = feat.patch_feat(I, x, yy, s * 1.25)
        if f is None: continue
        X.append(f); y.append(0); n += 1
    return X, y

def fit(Ls, seed=0):
    rng = np.random.default_rng(seed); X = []; y = []
    for L in Ls:
        a, b = samples(L, rng); X += a; y += b
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=0).fit(np.array(X), y)

def prob(clf, I, xs, ys, hs):
    F = [feat.patch_feat(I, x, y, h) for x, y, h in zip(xs, ys, hs)]
    ok = [i for i, f in enumerate(F) if f is not None]
    p = np.zeros(len(F))
    if ok: p[ok] = clf.predict_proba(np.array([F[i] for i in ok]))[:, 1]
    return p

def est_radius(clf, I, tx, ty):
    """Utilizatorul atinge un buștean: caut mărimea la care modelul e cel mai sigur."""
    scales = np.exp(np.linspace(math.log(7), math.log(150), 36)); best = []
    for s in scales:
        o = 0.3 * s; pts = [(0, 0), (o, 0), (-o, 0), (0, o), (0, -o)]
        pr = prob(clf, I, [tx + a for a, b in pts], [ty + b for a, b in pts], [s * 1.25] * 5); best.append(pr.max())
    best = np.array(best); m = best.max()
    sel = scales[best >= 0.9 * m]
    return float(np.exp(np.mean(np.log(sel)))), float(m)

def detect(clf, I, shape, r, thr):
    H, W = shape[:2]; cands = []
    for m in SC:
        rr = r * m; st = max(6, int(rr * 0.4))
        xs, ys = np.meshgrid(np.arange(st, W - st, st), np.arange(st, H - st, st)); xs = xs.ravel().astype(float); ys = ys.ravel().astype(float)
        pr = prob(clf, I, xs, ys, [rr * 1.25] * len(xs))
        for i in np.where(pr >= thr)[0]: cands.append((pr[i], xs[i], ys[i], rr))
    cands.sort(reverse=True); keep = []
    for p, x, y, rr in cands:
        if all(math.hypot(x - a, y - b) > max(rr, c) for _, a, b, c in keep): keep.append((p, x, y, rr))
    return keep

def score(keep, P, r):
    if not keep: return 0
    pts = np.array([[k[1], k[2]] for k in keep]); d, idx = cKDTree(P).query(pts); used = set(); tp = 0
    for i in np.argsort(d):
        if d[i] < 0.6 * r and idx[i] not in used: used.add(idx[i]); tp += 1
    return tp
