"""Antrenează pe TOATE pozele marcate și exportă model.json pentru aplicație.
Folosire:  python3 train_final.py data.json ../model.json
data.json = [{"img": "cale/poza.jpg", "points": [[x,y],...]}, ...]  (puncte în pixeli ai pozei)"""
import json, sys, numpy as np
from lib import *

def export(clf, path):
    base = float(np.ravel(clf._baseline_prediction)[0]); trees = []
    for it in clf._predictors:
        nd = it[0].nodes; n = len(nd); f = []; t = []; l = []; r = []; v = []
        for i in range(n):
            leaf = bool(nd['is_leaf'][i])
            f.append(-1 if leaf else int(nd['feature_idx'][i])); t.append(0 if leaf else round(float(nd['num_threshold'][i]), 6))
            l.append(int(nd['left'][i])); r.append(int(nd['right'][i])); v.append(round(float(nd['value'][i]), 6))
        trees.append(dict(f=f, t=t, l=l, r=r, v=v))
    json.dump(dict(base=round(base, 6), trees=trees, nf=feat.NF, sc=SC, long=feat.LONG), open(path, 'w'), separators=(',', ':'))

if __name__ == '__main__':
    D = json.load(open(sys.argv[1])); L = [load(d) for d in D]
    clf = fit(L); export(clf, sys.argv[2])
    import pickle; pickle.dump(clf, open('clf.pkl', 'wb'))
    print('antrenat pe', len(L), 'poze,', sum(len(l['P']) for l in L), 'bușteni ->', sys.argv[2])
