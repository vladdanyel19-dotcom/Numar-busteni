import json, sys, numpy as np, time
from lib import *
D = json.load(open(sys.argv[1])); L = [load(d) for d in D]
folds = [[0, 4], [1, 5], [2, 6], [3, 7]]; THR = 0.93; tot = dict(G=0, N=0, T=0); rows = []
for fo in folds:
    clf = fit([L[i] for i in range(len(L)) if i not in fo])
    for i in fo:
        l = L[i]; dd, _ = cKDTree(l['P']).query(l['P'], k=2); j = int(np.argmin(abs(dd[:, 1] * .5 - l['r'])))  # un buștean „mijlociu”
        rh, conf = est_radius(clf, l['I'], *l['P'][j]); k = detect(clf, l['I'], l['shape'], rh, THR); tp = score(k, l['P'], l['r'])
        rows.append((i, len(l['P']), len(k), tp, round(l['r'], 1), round(rh, 1)))
        print(f"img{i}: real={len(l['P'])} gasit={len(k)} corecte={tp}  r_real={l['r']:.1f} r_estimat={rh:.1f}", flush=True)
G = sum(r[1] for r in rows); N = sum(r[2] for r in rows); T = sum(r[3] for r in rows)
print(f"TOTAL real={G} gasit={N} precizie={T/N:.2f} recall={T/G:.2f}  eroare_medie_pe_poza={np.mean([abs(r[2]-r[1])/r[1] for r in rows]):.2f}")
