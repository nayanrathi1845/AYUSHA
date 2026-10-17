// A.Y.U.S.H.A. app: scores IPOs with the full InvestX v2 model (every factor), in the browser.
(function () {
  const E = window.AyushaEngine;
  let M = null, LIVE = null, LIVE_STATE = "loading";
  const openCards = new Set();

  const GROUP_LABEL = {
    "GMP": "GMP level", "GMP dynamics": "GMP trend", "Subscription": "Subscription",
    "Market regime": "Market (NIFTY, Smallcap, VIX)", "IPO-market heat": "Recent IPO listings",
    "Fundamentals": "Fundamentals", "Valuation & offer structure": "Valuation & offer",
  };

  // ---------- helpers ----------
  const el = (tag, c, txt) => { const e = document.createElement(tag); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const ok = (v) => v !== null && v !== undefined && v !== "" && isFinite(+v);
  const pc = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%";
  const pts = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const rs = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
  const xx = (v) => ok(v) ? (+v).toFixed(2) + "x" : "–";
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const qtl = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

  function peerResiduals(list, g) {
    let near = list.filter(([gg]) => Math.abs(gg - g) <= 7.5);
    if (near.length < 25) near = [...list].sort((a, b) => Math.abs(a[0] - g) - Math.abs(b[0] - g)).slice(0, 25);
    return near.map(([, r]) => r);
  }

  // ---------- scoring (every factor) ----------
  function score(rec) {
    const f = E.clipFeatures(M, rec.features || {});
    const g = f.gmp_pct;
    const off = E.predict(M.models.official, f);
    const r = { official: off, hasGmp: ok(g) };
    if (ok(g)) {
      const corr = E.predict(M.models.open_corr, f);
      r.gmp = g; r.open = g + corr; r.corr = corr;
      r.close = g + E.predict(M.models.close_corr, f);
      const res = peerResiduals(M.residuals.open, g);
      const outs = res.map((x) => r.open + x);
      r.lo = qtl(outs, 0.1); r.hi = qtl(outs, 0.9); r.pNeg = outs.filter((x) => x < 0).length / outs.length; r.nPeers = res.length;
      r.drivers = E.drivers(M, M.models.open_corr, f);
    } else {
      r.open = off;
      const outs = M.residuals.official.map((x) => off + x);
      r.lo = qtl(outs, 0.1); r.hi = qtl(outs, 0.9); r.pNeg = outs.filter((x) => x < 0).length / outs.length;
      r.drivers = E.drivers(M, M.models.official, f);
    }
    const used = M.features.filter((c) => ok(f[c])).length;
    r.coverage = used + " of " + M.features.length;
    r.verdict = !ok(r.open) ? ["No data", "b-none"] : (r.pNeg >= 0.35 || r.open <= 0) ? ["Red flag", "b-red"]
      : (r.open >= 15 && r.pNeg < 0.08) ? ["Strong", "b-strong"] : ["Mild", "b-mild"];
    return r;
  }

  // ---------- factor highlights ----------
  function chips(rec) {
    const f = rec.features || {}, out = [];
    const add = (t, k) => out.push([t, k || ""]);
    if (ok(rec.pe)) add("P/E " + (+rec.pe).toFixed(1), rec.pe > 60 ? "bad" : rec.pe > 0 && rec.pe < 25 ? "good" : "");
    else if (f.pe_missing_or_neg === 1) add("Loss-making or no P/E", "bad");
    if (ok(f.fin_rev_growth)) add("Revenue " + pc(f.fin_rev_growth * 100, 0) + " y/y", f.fin_rev_growth < 0 ? "bad" : f.fin_rev_growth > 0.2 ? "good" : "");
    if (ok(f.fin_pat_margin)) add("Profit margin " + (f.fin_pat_margin * 100).toFixed(0) + "%", f.fin_pat_margin < 0 ? "bad" : f.fin_pat_margin > 0.15 ? "good" : "");
    if (ok(f.fin_roe)) add("ROE " + (f.fin_roe * 100).toFixed(0) + "%", f.fin_roe < 0.08 ? "bad" : f.fin_roe > 0.2 ? "good" : "");
    if (ok(f.fin_de)) add("Debt/equity " + f.fin_de.toFixed(2), f.fin_de > 1.5 ? "bad" : f.fin_de < 0.3 ? "good" : "");
    if (ok(f.fresh_share)) add(f.fresh_share === 0 ? "100% existing holders selling" : Math.round(f.fresh_share * 100) + "% fresh issue", f.fresh_share === 0 ? "bad" : "");
    if (ok(f.qib_minus_rii) && ok(rec.sub_qib)) add(f.qib_minus_rii > 0.5 ? "QIBs keener than retail" : f.qib_minus_rii < -0.5 ? "Retail-led demand" : "Balanced demand", f.qib_minus_rii > 0.5 ? "good" : f.qib_minus_rii < -0.5 ? "bad" : "");
    if (rec.gmp_trend) add("GMP trend: " + rec.gmp_trend.toLowerCase(), rec.gmp_trend === "Downward" ? "bad" : rec.gmp_trend === "Upward" ? "good" : "");
    if (ok(f.nifty_ret30)) add("NIFTY 1-month " + pc(f.nifty_ret30 * 100), f.nifty_ret30 < -0.03 ? "bad" : f.nifty_ret30 > 0.03 ? "good" : "");
    const box = el("div", "chips");
    out.forEach(([t, k]) => box.append(el("span", "chip " + k, t)));
    return box;
  }

  // ---------- views ----------
  function rangeBar(r) {
    const box = el("div", "range");
    const vals = [r.lo, r.hi, r.open, 0];
    let a = Math.min(...vals), b = Math.max(...vals); const pad = (b - a) * 0.12 || 5; a -= pad; b += pad;
    const X = (v) => ((v - a) / (b - a)) * 100 + "%";
    box.append(el("div", "axis"));
    const band = el("div", "band"); band.style.left = X(r.lo); band.style.width = `calc(${X(r.hi)} - ${X(r.lo)})`; box.append(band);
    const z = el("div", "zero"); z.style.left = X(0); box.append(z);
    const p = el("div", "pt"); p.style.left = X(r.open); box.append(p);
    const l1 = el("div", "lab", pc(r.lo, 0)); l1.style.left = X(r.lo);
    const l2 = el("div", "lab", pc(r.hi, 0)); l2.style.left = X(r.hi);
    box.append(l1, l2);
    box.setAttribute("role", "img"); box.setAttribute("aria-label", `Likely range ${pc(r.lo, 0)} to ${pc(r.hi, 0)}`);
    return box;
  }

  function driverBlock(r) {
    const wrap = el("div", "drv");
    const max = Math.max(4, ...r.drivers.map((d) => Math.abs(d.pts)));
    const row = (label, v, total) => {
      const rw = el("div", "drv-row" + (total ? " drv-total" : ""));
      const bar = el("div", "drv-bar"); bar.append(el("div", "mid"));
      if (!total) { const f = el("div", "f " + (v >= 0 ? "pos" : "neg")); f.style.width = Math.min(50, (Math.abs(v) / max) * 50) + "%"; bar.append(f); }
      rw.append(el("span", "", label), total ? el("span") : bar, el("span", "drv-v " + cls(v), total ? pc(v) : pts(v)));
      wrap.append(rw);
    };
    if (r.hasGmp) row("GMP says", r.gmp, true);
    r.drivers.forEach((d) => row(GROUP_LABEL[d.group] || d.group, d.pts));
    const sum = r.drivers.reduce((s, d) => s + d.pts, 0);
    const rest = (r.hasGmp ? r.corr : r.open - r.drivers.reduce((s) => s, 0)) - sum;
    if (r.hasGmp && Math.abs(rest) >= 0.05) row("Interactions between factors", rest);
    row(r.hasGmp ? "Model forecast" : "Forecast without GMP", r.open, true);
    return wrap;
  }

  function detailBlock(rec, r) {
    const d = el("div", "detail");
    const big = el("div", "big");
    big.append(el("span", "num " + cls(r.open), pc(r.open)),
      el("span", "sub", `expected listing gain · about ${rs(rec.price * (1 + r.open / 100))} at open`));
    d.append(big);
    d.append(el("p", "note", r.hasGmp
      ? `8 in 10 IPOs with a similar GMP finished within this range of the model's forecast in out-of-sample tests (dot = forecast).`
      : `No GMP available, so this uses the official-data model (subscription, fundamentals, valuation, market). It is much less precise.`));
    d.append(rangeBar(r));
    const kv = el("div", "kv");
    const add = (k, v, c) => { const row = el("div"); row.append(el("span", "", k), el("span", c || "", v)); kv.append(row); };
    add("Chance of listing below issue price", Math.round(r.pNeg * 100) + "%", r.pNeg >= 0.35 ? "v down" : "");
    if (r.hasGmp) add("Listing-day close estimate", pc(r.close), "v " + cls(r.close));
    if (r.hasGmp) add("Forecast without GMP (official data only)", pc(r.official), "v " + cls(r.official));
    add("Factors available for this IPO", r.coverage);
    d.append(kv);
    d.append(el("div", "sec-h", "What's driving the forecast"));
    d.append(driverBlock(r));
    d.append(el("p", "note", "Each bar: how much the forecast moves because of that group of factors, compared with a typical past IPO. Points of listing gain."));
    d.append(el("div", "sec-h", "Key factors"), chips(rec));
    if (ok(rec.sub_total)) {
      const subs = el("div", "subs");
      const cats = [["QIB", rec.sub_qib], ["NII", rec.sub_nii], ["Retail", rec.sub_rii], ["Total", rec.sub_total]].filter(([, v]) => ok(v));
      const mx = Math.max(10, ...cats.map(([, v]) => +v));
      cats.forEach(([k, v]) => {
        const sb = el("div", "sb"); const t = el("div", "t"); const f = el("div", "f");
        f.style.width = Math.min(100, (Math.log1p(+v) / Math.log1p(mx)) * 100) + "%"; t.append(f);
        sb.append(el("span", "", k), t, el("span", "x", xx(v))); subs.append(sb);
      });
      d.append(el("div", "sec-h", "Subscription"), subs);
    }
    if (rec.status === "Open") d.append(el("p", "note warn", "Bidding is still on. GMP and subscription usually change a lot by the close; the score updates every hour."));
    if (rec.status === "Upcoming") d.append(el("p", "note warn", "Not open yet, so there is no subscription data. Early GMP is a weak signal."));
    if (rec.url) { const s = el("p", "src"); const a = el("a", "", "IPO details on investorgain.com"); a.href = rec.url; a.target = "_blank"; a.rel = "noopener"; s.append(a); d.append(s); }
    d.append(el("p", "note", `Model trained on ${M.stats.n} past mainboard IPOs. Historical patterns, not investment advice.`));
    return d;
  }

  const ORDER = [["Open", "Open for bidding"], ["Upcoming", "Upcoming"], ["Closed", "Closed, awaiting listing"]];

  function renderLive() {
    const body = document.getElementById("live-body"); body.replaceChildren();
    const fresh = document.getElementById("fresh");
    if (!M || LIVE_STATE === "loading") { body.append(el("div", "empty", "Loading live IPOs…")); return; }
    if (LIVE_STATE === "error" || !LIVE) { fresh.textContent = "Couldn't load"; body.append(el("div", "empty", "Couldn't load live IPO data. Check your connection, or use Check IPO to score an issue by hand.")); return; }
    const t = new Date(LIVE.updatedAt); const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    fresh.textContent = "Updated " + (mins < 60 ? mins + " min ago" : mins < 1440 ? Math.round(mins / 60) + " h ago" : t.toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
    const ipos = (LIVE.ipos || []).filter((i) => i && i.name);
    if (!ipos.length) { body.append(el("div", "empty", "No mainboard IPOs are open, upcoming or awaiting listing right now.")); return; }
    ORDER.forEach(([st, label]) => {
      const group = ipos.filter((i) => i.status === st); if (!group.length) return;
      const h = el("h2", "sec-h", label); h.append(el("span", "n", String(group.length))); body.append(h);
      const list = el("div", "list");
      group.forEach((rec) => {
        const r = score(rec); const card = el("article", "card");
        const btn = el("button", "card-btn"); btn.type = "button"; btn.setAttribute("aria-expanded", String(openCards.has(rec.name)));
        const r1 = el("div", "row1"); const nm = el("div");
        nm.append(el("div", "name", rec.name), el("div", "dates", [rec.sector, rec.open && "Opens " + rec.open, rec.close && "closes " + rec.close, rec.listing && "lists " + rec.listing].filter(Boolean).join(" · ")));
        r1.append(nm, el("span", "badge " + r.verdict[1], r.verdict[0]));
        const figs = el("div", "figs");
        const fig = (k, v, c) => { const f = el("div", "fig"); f.append(el("div", "k", k), el("div", "v " + (c || ""), v)); figs.append(f); };
        fig("Forecast", ok(r.open) ? pc(r.open) : "–", cls(r.open));
        fig("GMP", r.hasGmp ? pc(r.gmp) : "–", r.hasGmp ? cls(r.gmp) : "");
        fig("Subscribed", xx(rec.sub_total));
        btn.append(r1, figs); card.append(btn);
        if (openCards.has(rec.name)) card.append(detailBlock(rec, r));
        btn.addEventListener("click", () => { openCards.has(rec.name) ? openCards.delete(rec.name) : openCards.add(rec.name); renderLive(); });
        list.append(card);
      });
      body.append(list);
    });
    body.append(el("p", "note", "Mainboard IPOs only. Every factor is refreshed hourly from 8:45 am to 8:45 pm IST: GMP and its trend, subscription, financials, valuation, offer structure, NIFTY/Smallcap/VIX and recent IPO listings."));
  }

  // ---------- manual check ----------
  function manualFeatures() {
    const v = (id) => { const s = document.getElementById(id).value.trim(); return s === "" ? null : +s; };
    const price = v("f-price"), gmp = v("f-gmp");
    const L1 = (x) => (ok(x) ? Math.log1p(Math.max(0, x)) : null), LN = (x) => (ok(x) && x > 0 ? Math.log(x) : null);
    const f = {};
    f.gmp_pct = ok(gmp) && price > 0 ? (100 * gmp) / price : null;
    const subs = { sub_total: v("f-total"), sub_qib: v("f-qib"), sub_nii: v("f-nii"), sub_rii: v("f-rii") };
    for (const [k, x] of Object.entries(subs)) f["log_" + k] = L1(x);
    if (ok(f.log_sub_qib) && ok(f.log_sub_rii)) f.qib_minus_rii = f.log_sub_qib - f.log_sub_rii;
    Object.assign(f, (LIVE && LIVE.market) || {});
    f.heat_prev60_gain = LIVE ? LIVE.heat_now : null;
    f.n_ipos_prev30 = LIVE ? LIVE.n_ipos_prev30_now : null;
    const r0 = v("f-rev0"), r1 = v("f-rev1"), p0 = v("f-pat0"), p1 = v("f-pat1"), nw = v("f-nw"), debt = v("f-debt");
    if (ok(r0) && r1 > 0) f.fin_rev_growth = r0 / r1 - 1;
    if (ok(p0) && r0 > 0) f.fin_pat_margin = p0 / r0;
    if (ok(p0) && ok(p1) && p1 !== 0) f.fin_pat_growth = (p0 - p1) / Math.abs(p1);
    if (ok(p0) && nw > 0) f.fin_roe = p0 / nw;
    if (ok(debt) && nw > 0) f.fin_de = debt / nw;
    if (ok(p0)) f.fin_profitable = p0 > 0 ? 1 : 0;
    f.company_age = v("f-age");
    const pe = v("f-pe");
    f.log_pe = LN(pe); f.pe_missing_or_neg = ok(pe) ? (pe > 0 ? 0 : 1) : null;
    f.log_pb = LN(v("f-pb")); f.log_mcap = LN(v("f-mcap"));
    const size = v("f-size"), fresh = v("f-fresh");
    f.log_issue_size = LN(size);
    if (ok(fresh) && size > 0) f.fresh_share = Math.min(1, fresh / size);
    const pp = v("f-ppre"), pq = v("f-ppost");
    if (ok(pp) && ok(pq)) f.promoter_dilution = pp - pq;
    f.promoter_post = pq;
    f.log_price = LN(price);
    return { name: document.getElementById("f-name").value.trim() || "This IPO", price, status: "", pe, ...subs, features: f };
  }

  document.getElementById("calc").addEventListener("submit", (e) => {
    e.preventDefault();
    const out = document.getElementById("calc-out"); out.replaceChildren();
    if (!M) { out.append(el("div", "empty", "The model is still loading. Try again in a moment.")); return; }
    const rec = manualFeatures();
    if (!(rec.price > 0)) { out.append(el("div", "empty", "Enter the issue price in rupees.")); return; }
    const r = score(rec);
    const card = el("article", "card"); const head = el("div", "card-btn"); head.style.cursor = "default";
    const r1 = el("div", "row1"); r1.append(el("div", "name", rec.name), el("span", "badge " + r.verdict[1], r.verdict[0])); head.append(r1);
    card.append(head, detailBlock(rec, r)); out.append(card);
  });

  // ---------- about ----------
  function about() {
    const a = document.getElementById("about"); a.replaceChildren(); const s = M.stats;
    a.append(el("h2", "", "How A.Y.U.S.H.A. scores an IPO"));
    a.append(el("p", "", `The model learned from ${s.n} Indian mainboard IPOs listed between ${new Date(s.from).toLocaleDateString("en-IN", { month: "short", year: "numeric" })} and ${new Date(s.to).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}. Every forecast uses all ${M.features.length} factors from the InvestX study:`));
    const ul = el("ul");
    [
      "GMP: the grey-market premium and its trend (first quote, change, range, slope, up and down days).",
      "Subscription: QIB, small and big NII, retail and total.",
      "Market: NIFTY 50 and Smallcap 100 one- and three-month returns and volatility, India VIX level and change.",
      "Recent IPO listings: how IPOs listed in the past 60 days and how many came to market in the past 30.",
      "Fundamentals: revenue and profit growth, profit and EBITDA margins, ROE, debt to equity, company age.",
      "Valuation and offer: P/E, P/B, market cap, issue size, fresh issue vs existing holders selling, anchor and retail quotas, promoter dilution, number of lead managers.",
    ].forEach((t) => ul.append(el("li", "", t)));
    a.append(ul);
    a.append(el("p", "", `How it combines them: GMP gives a starting point, and a gradient-boosting model trained on the other factors adjusts it up or down. Tap any IPO and open "What's driving the forecast" to see each group's effect. In out-of-sample testing on 2023–26 listings this missed by ${s.mae.open_full} percentage points on average at the open (GMP alone: ${s.mae.gmp}). The extra factors mostly confirm what GMP already prices in, but they flag cases such as expensive valuations or retail-only demand.`));
    a.append(el("p", "", `Without GMP, the official-data model (subscription, fundamentals, valuation, market) is used; it misses by about ${s.mae.official_full} points. The listing-day close estimate misses by about ${s.mae.close_full} points.`));
    a.append(el("p", "", "Strong: forecast of 15% or more and almost no similar IPO listed at a loss. Red flag: forecast at or below zero, or 35%+ chance of a loss. Mild: everything in between."));
    a.append(el("p", "note", "Data: investorgain.com and NSE, refreshed hourly 8:45 am–8:45 pm IST. Historical patterns only, not investment advice. GMP is an unofficial grey-market quote."));
  }

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((o) => o.removeAttribute("aria-current")); t.setAttribute("aria-current", "page");
    ["live", "check", "about"].forEach((v) => (document.getElementById("v-" + v).hidden = v !== t.dataset.v));
    window.scrollTo(0, 0);
  }));

  // ---------- load ----------
  async function loadLive() {
    try {
      const res = await fetch("live.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      LIVE = await res.json(); LIVE_STATE = "ok";
    } catch (e) { if (!LIVE) LIVE_STATE = "error"; }
    renderLive();
  }
  renderLive();
  fetch("model.json").then((r) => r.json()).then((m) => { M = m; about(); renderLive(); loadLive(); })
    .catch(() => { document.getElementById("fresh").textContent = "Model failed to load"; });
  setInterval(() => { if (LIVE) renderLive(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && M) loadLive(); });
})();
