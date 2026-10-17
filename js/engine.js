// A.Y.U.S.H.A. model engine: evaluates the exported gradient-boosting trees on one IPO's features.
(function (root) {
  function tree(t, x) {
    let i = 0;
    for (;;) {
      const n = t[i];
      if (n.length === 1) return n[0];
      const v = x[n[0]];
      i = (v === null || v === undefined || Number.isNaN(v)) ? (n[2] ? n[3] : n[4]) : (v <= n[1] ? n[3] : n[4]);
    }
  }
  function predict(model, feat) {
    const x = model.features.map((f) => (feat[f] === undefined || feat[f] === null || !isFinite(feat[f]) ? NaN : feat[f]));
    let y = model.baseline;
    for (const t of model.trees) y += tree(t, x);
    return y;
  }
  function clipFeatures(M, feat) {
    const o = { ...feat };
    for (const [c, [lo, hi]] of Object.entries(M.clip)) if (o[c] != null && isFinite(o[c])) o[c] = Math.min(hi, Math.max(lo, o[c]));
    return o;
  }
  // Contribution of each data group = prediction minus prediction with that group set to the training median.
  function drivers(M, model, feat) {
    const base = predict(model, feat), out = [];
    for (const [g, cols] of Object.entries(M.groups)) {
      const used = cols.filter((c) => model.features.includes(c));
      if (!used.length) continue;
      const f2 = { ...feat };
      used.forEach((c) => { f2[c] = M.median[c] == null ? NaN : M.median[c]; });
      out.push({ group: g, pts: base - predict(model, f2) });
    }
    return out.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  }
  root.AyushaEngine = { predict, clipFeatures, drivers };
})(typeof window !== "undefined" ? window : globalThis);
