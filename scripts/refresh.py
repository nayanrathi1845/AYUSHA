"""Refresh live.json for A.Y.U.S.H.A. — runs on GitHub Actions.

For every mainboard IPO that is upcoming, open, or closed but not yet listed, collect every factor the model
was trained on:
  GMP and its trend, subscription by investor category, issue structure, valuation, fundamentals,
  NIFTY 50 / NIFTY Smallcap 100 / India VIX regime, and how recent IPOs listed.
Feature definitions mirror build_dataset.py in the InvestX v2 study exactly.
"""
import datetime as dt
import json, math, re, sys, time
import requests
from bs4 import BeautifulSoup

IG = "https://www.investorgain.com"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-IN,en;q=0.9"}
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TODAY = dt.datetime.now(IST).date()
S = requests.Session(); S.headers.update(UA)
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a); LOG.append(msg); print(msg, flush=True)


def get(url, tries=3, **kw):
    for i in range(tries):
        try:
            r = S.get(url, timeout=30, **kw)
            if r.status_code == 200 and len(r.text) > 500:
                return r
            log("HTTP", r.status_code, url)
        except Exception as e:
            log("ERR", e, url)
        time.sleep(3 * (i + 1))
    return None


def num(s):
    if s is None:
        return None
    m = re.search(r"-?\d[\d,]*\.?\d*", str(s).replace("₹", ""))
    if not m:
        return None
    try:
        return float(m.group().replace(",", ""))
    except ValueError:
        return None


def ddmon(s, ref=TODAY):
    """'21-Oct' or '21-Oct-26' or '19-10-2026' -> date"""
    s = (s or "").strip()
    for fmt in ("%d-%m-%Y", "%d-%b-%y", "%d-%b-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    m = re.match(r"(\d{1,2})-([A-Za-z]{3})", s)
    if not m:
        return None
    d = dt.datetime.strptime(f"{m.group(1)}-{m.group(2)}-{ref.year}", "%d-%b-%Y").date()
    if (d - ref).days > 200:
        d = d.replace(year=ref.year - 1)
    elif (ref - d).days > 200:
        d = d.replace(year=ref.year + 1)
    return d


def cells(tr):
    return {td.get("data-label", "").replace("&#128293;", ""): td for td in tr.find_all("td")}


# ---------------------------------------------------------------- live lists
def live_gmp():
    r = get(IG + "/report/live-ipo-gmp/331/", allow_redirects=True)
    soup = BeautifulSoup(r.text, "html.parser")
    out = []
    for tr in soup.select("table tbody tr"):
        a = tr.find("a", href=re.compile(r"^/gmp/"))
        if not a:
            continue
        c = cells(tr)
        badges = [b.get_text(strip=True) for b in c["Name"].select("span.badge")]
        if "IPO" not in badges:          # SME issues carry 'BSE SME' / 'NSE SME'
            continue
        status = next((b for b in badges if b in ("U", "O", "C", "L")), None)
        if status not in ("U", "O", "C"):
            continue
        gtxt = c["GMP"].get_text(" ", strip=True)
        g_rs = num(c["GMP"].find("b").get_text()) if c["GMP"].find("b") else None
        g_pc = num(re.search(r"\((-?[\d.]+)%\)", gtxt).group(1)) if re.search(r"\((-?[\d.]+)%\)", gtxt) else None
        out.append({"name": a.get("title") or a.get_text(strip=True), "href": a["href"],
                    "status": {"U": "Upcoming", "O": "Open", "C": "Closed"}[status],
                    "gmp": g_rs, "gmp_pct_site": g_pc,
                    "price": num(c.get("Price (₹)").get_text()), "size_cr": num(c["IPO Size"].get_text()),
                    "open": c["Open"].get_text(" ", strip=True).split(" ")[0],
                    "close": c["Close"].get_text(" ", strip=True).split(" ")[0],
                    "listing": c["Listing"].get_text(" ", strip=True).split(" ")[0]})
    return out


def live_subs():
    r = get(IG + "/report/ipo-subscription-live/333/ipo/")
    soup = BeautifulSoup(r.text, "html.parser") if r else None
    out = {}
    for tr in (soup.select("table tbody tr") if soup else []):
        a = tr.find("a", href=re.compile(r"^/subscription/"))
        if not a:
            continue
        c = cells(tr)
        tot = c["Total"].find("b")
        key = a["href"].rstrip("/").split("/")[-1]  # numeric id
        out[key] = {"sub_total": num(tot.get_text() if tot else c["Total"].get_text()),
                    "sub_qib": num(c["QIB"].get_text()), "sub_snii": num(c["SHNI"].get_text()),
                    "sub_bnii": num(c["BHNI"].get_text()), "sub_nii": num(c["NII"].get_text()),
                    "sub_rii": num(c["RII"].get_text()), "pe_site": num(c["P/E"].get_text())}
    return out


def tracker_rows():
    rows = []
    for yr in (TODAY.year, TODAY.year - 1):
        r = get(f"{IG}/report/ipo-gmp-performance-tracker/377/ipo/?year={yr}")
        if not r:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        for tr in soup.select("table tbody tr"):
            c = cells(tr)
            if "Listing Dt" not in c:
                continue
            d = ddmon(c["Listing Dt"].get_text(strip=True))
            m = re.search(r"\((-?[\d.]+)%\)", c["Listing Price"].get_text(" ", strip=True))
            if d and m:
                rows.append((d, float(m.group(1))))
    return rows


# ---------------------------------------------------------------- per-IPO detail
def unesc(s):
    return s.replace('\\"', '"').replace("\\\\", "\\")


def extract_obj(raw):
    s = unesc(raw)
    i = s.find('"timetable_boa_dt"')
    if i < 0:
        return {}
    depth, j = 0, i
    while j > 0:
        ch = s[j]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                break
            depth -= 1
        j -= 1
    d2, k = 0, j
    while k < len(s):
        ch = s[k]
        if ch == "{":
            d2 += 1
        elif ch == "}":
            d2 -= 1
            if d2 == 0:
                break
        k += 1
    try:
        return json.loads(s[j:k + 1])
    except Exception as e:
        log("obj parse fail", e)
        return {}


def clean_text(raw):
    t = raw.replace("\\u003c", "<").replace("\\u003e", ">").replace("\\u0026", "&").replace('\\"', '"')
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"\\[nrt]", " ", t).replace("&#8377;", "₹")
    return re.sub(r"\s+", " ", t)


def financials(text):
    i = text.find("Period Ended")
    if i < 0:
        return {}
    t = text[i:].split("Amount in")[0]
    per = re.findall(r"\d{1,2} \w{3} \d{4}", t)
    fy = [k for k, p in enumerate(per) if p.startswith("31 Mar")][:2]
    if not fy:
        return {}

    def row(label):
        m = re.search(label + r"((?:\s+-?[\d,]+\.?\d*)+)", t, re.I)
        if not m:
            return [None, None]
        a = [float(x.replace(",", "")) for x in m.group(1).split()]
        return [a[k] if k < len(a) else None for k in fy] + [None] * (2 - len(fy))

    inc = row("Total Income")
    if inc[0] is None:
        inc = row("Revenue")
    return {"rev0": inc[0], "rev1": inc[1], "pat0": row("Profit After Tax")[0], "pat1": row("Profit After Tax")[1],
            "nw0": row("NET Worth")[0], "debt0": row("Total Borrowing")[0], "ebitda0": row("EBITDA")[0],
            "fy_end": per[fy[0]]}


def gmp_trend(text):
    m = re.search(r"Trend Direction ?(\w+) ?First GMP ?₹?(-?[\d.,]+) ?Latest GMP ?₹?(-?[\d.,]+) ?GMP Change ?([+\-]?₹?-?[\d.,]+)"
                  r" ?GMP Range ?₹?(-?[\d.,]+) ?Positive Sessions ?([\d.]+)% ?Negative Sessions ?([\d.]+)% ?Trend Slope ?(-?[\d.]+)", text)
    if not m:
        return {}
    g = m.groups()
    return {"trend": g[0], "first": num(g[1]), "change": num(g[3].replace("+", "")), "range": num(g[4]),
            "pos": float(g[5]), "neg": float(g[6]), "slope": float(g[7])}


# ---------------------------------------------------------------- market (NSE, same source as training)
def nse_series():
    out = {}
    try:
        S.get("https://www.nseindia.com/", timeout=20)
        hdr = {"Accept": "application/json", "Referer": "https://www.nseindia.com/"}
        f = lambda d: d.strftime("%d-%m-%Y")
        wins = [(TODAY - dt.timedelta(days=150), TODAY - dt.timedelta(days=91)),
                (TODAY - dt.timedelta(days=90), TODAY - dt.timedelta(days=31)), (TODAY - dt.timedelta(days=30), TODAY)]
        for name, base in [("nifty", "/api/historicalOR/indicesHistory?indexType=NIFTY%2050"),
                           ("small", "/api/historicalOR/indicesHistory?indexType=NIFTY%20SMALLCAP%20100"),
                           ("vix", "/api/historicalOR/vixhistory?x=1")]:
            pts = {}
            for a, b in wins:
                r = S.get(f"https://www.nseindia.com{base}&from={f(a)}&to={f(b)}", headers=hdr, timeout=30)
                for d in r.json().get("data", []):
                    pts[dt.datetime.strptime(d["EOD_TIMESTAMP"], "%d-%b-%Y").date()] = float(d["EOD_CLOSE_INDEX_VAL"])
                time.sleep(1)
            out[name] = sorted(pts.items())
            log("NSE", name, len(pts))
    except Exception as e:
        log("NSE failed", e)
    if len(out.get("nifty", [])) < 64 or len(out.get("vix", [])) < 22:   # fallback: Yahoo
        for name, sym in [("nifty", "%5ENSEI"), ("vix", "%5EINDIAVIX")]:
            try:
                j = S.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=6mo&interval=1d", timeout=30).json()
                res = j["chart"]["result"][0]
                ts, cl = res["timestamp"], res["indicators"]["quote"][0]["close"]
                out[name] = [(dt.datetime.fromtimestamp(t, IST).date(), c) for t, c in zip(ts, cl) if c is not None]
                log("Yahoo", name, len(out[name]))
            except Exception as e:
                log("Yahoo failed", name, e)
    return out


def market_feats(series, cd):
    f = {}
    for k in ("nifty", "small"):
        h = [v for d, v in series.get(k, []) if d <= cd]
        if len(h) >= 64:
            lr = [math.log(h[i] / h[i - 1]) for i in range(len(h) - 21, len(h))]
            mu = sum(lr) / len(lr)
            f[f"{k}_ret30"] = h[-1] / h[-22] - 1
            f[f"{k}_ret90"] = h[-1] / h[-64] - 1
            f[f"{k}_vol30"] = math.sqrt(sum((x - mu) ** 2 for x in lr) / (len(lr) - 1)) * math.sqrt(252)
    v = [x for d, x in series.get("vix", []) if d <= cd]
    if len(v) >= 22:
        f["vix"], f["vix_avg30"], f["vix_chg30"] = v[-1], sum(v[-21:]) / 21, v[-1] - v[-22]
    return f


# ---------------------------------------------------------------- features (mirror build_dataset.py)
L1P = lambda v: math.log1p(max(0.0, v)) if v is not None else None
LOG = lambda v: math.log(v) if v and v > 0 else None


def build_features(ipo, obj, fin, tr, subs, mkt, heat, n30):
    P = ipo["price"]
    f = {}
    g = ipo.get("gmp")
    f["gmp_pct"] = 100 * g / P if g is not None and P else None
    if tr:
        f["gmp_first_pct"] = 100 * tr["first"] / P if tr.get("first") is not None else None
        f["gmp_change_pct"] = 100 * tr["change"] / P if tr.get("change") is not None else None
        f["gmp_range_pct"] = 100 * tr["range"] / P if tr.get("range") is not None else None
        f["gmp_slope_pct"] = 100 * tr["slope"] / P
        f["gmp_pos_sessions"], f["gmp_neg_sessions"] = tr["pos"], tr["neg"]
        f["gmp_volatile"] = 1.0 if tr["trend"] == "Volatile" else 0.0
    for c in ("sub_qib", "sub_nii", "sub_bnii", "sub_snii", "sub_rii", "sub_total"):
        f["log_" + c] = L1P(subs.get(c))
    if f.get("log_sub_qib") is not None and f.get("log_sub_rii") is not None:
        f["qib_minus_rii"] = f["log_sub_qib"] - f["log_sub_rii"]
    f.update(mkt)
    f["heat_prev60_gain"], f["n_ipos_prev30"] = heat, n30
    # fundamentals
    pos = lambda x: x if x is not None and x > 0 else None
    r0, r1, p0, p1, nw, debt, eb = (fin.get(k) for k in ("rev0", "rev1", "pat0", "pat1", "nw0", "debt0", "ebitda0"))
    f["fin_rev_growth"] = r0 / pos(r1) - 1 if r0 is not None and pos(r1) else None
    f["fin_pat_margin"] = p0 / pos(r0) if p0 is not None and pos(r0) else None
    f["fin_pat_growth"] = (p0 - p1) / abs(p1) if p0 is not None and p1 not in (None, 0) else None
    f["fin_roe"] = p0 / pos(nw) if p0 is not None and pos(nw) else None
    f["fin_de"] = debt / pos(nw) if debt is not None and pos(nw) else None
    f["fin_ebitda_margin"] = eb / pos(r0) if eb is not None and pos(r0) else None
    f["fin_profitable"] = (1.0 if p0 > 0 else 0.0) if p0 is not None else None
    f["kpi_roe"], f["kpi_de"] = num(obj.get("kpi_roe")), num(obj.get("kpi_debt_equity"))
    inc = num(obj.get("company_incorporation"))
    lst = ddmon(ipo.get("listing")) or TODAY
    f["company_age"] = lst.year - inc if inc and 1850 <= inc <= TODAY.year else None
    # valuation & offer structure
    pe = num(obj.get("pe_ratio"))
    if pe is None:
        pe = subs.get("pe_site")
    f["log_pe"], f["pe_missing_or_neg"] = LOG(pe), 0.0 if pe and pe > 0 else 1.0
    f["log_pb"] = LOG(num(obj.get("price_to_book_value")))
    f["log_mcap"] = LOG(num(obj.get("market_cap")))
    f["log_issue_size"] = LOG(ipo.get("size_cr"))
    fresh, ofs = num(obj.get("issue_size_fresh_in_amt")), num(obj.get("issue_size_ofs_in_amt"))
    fresh = fresh / 1e7 if fresh is not None else None
    ofs = ofs / 1e7 if ofs is not None else None
    tot = (fresh or 0) + (ofs or 0)
    f["fresh_share"] = fresh / tot if fresh is not None and tot > 0 else None
    st = num(obj.get("shares_offered_total"))
    an, ri = num(obj.get("shares_offered_anchor_investor")), num(obj.get("shares_offered_rii"))
    f["anchor_share"] = an / st if an is not None and st else None
    f["retail_quota"] = ri / st if ri is not None and st else None
    pp, pq = num(obj.get("promoter_shareholding_pre_issue")), num(obj.get("promoter_shareholding_post_issue"))
    f["promoter_dilution"] = pp - pq if pp is not None and pq is not None else None
    f["promoter_post"] = pq
    lm = obj.get("lead_managers")
    f["n_lead_managers"] = float(len([x for x in str(lm).split(",") if x.strip()])) if lm else None
    f["log_price"] = LOG(P)
    return {k: (None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(v, 6)) for k, v in f.items()}


def main():
    rows = live_gmp()
    if not rows:
        log("No rows from live GMP page; keeping old live.json"); return 1
    subs = live_subs()
    trk = tracker_rows()
    series = nse_series()
    ipos = []
    for ipo in rows:
        slug_id = ipo["href"].strip("/").split("/")[1:]
        obj, fin, tr = {}, {}, {}
        rd = get(f"{IG}/ipo/{slug_id[0]}/{slug_id[1]}/")
        if rd:
            obj, fin = extract_obj(rd.text), financials(clean_text(rd.text))
        rg = get(IG + ipo["href"])
        if rg:
            tr = gmp_trend(clean_text(rg.text))
        sb = subs.get(slug_id[1], {})
        cd = ddmon(ipo["close"]) or TODAY
        asof = min(cd, TODAY)
        mkt = market_feats(series, asof)
        prev = [g for d, g in trk if cd - dt.timedelta(days=60) <= d < cd]
        heat = sum(prev) / len(prev) if len(prev) >= 2 else None
        n30 = sum(1 for d, _ in trk if cd - dt.timedelta(days=30) <= d - dt.timedelta(days=5) < cd) + \
              sum(1 for o in rows if o is not ipo and ddmon(o["close"]) and cd - dt.timedelta(days=30) <= ddmon(o["close"]) < cd)
        if ipo.get("gmp") is None and ipo.get("gmp_pct_site") is not None and ipo["price"]:
            ipo["gmp"] = round(ipo["price"] * ipo["gmp_pct_site"] / 100, 2)
        feats = build_features(ipo, obj, fin, tr, sb, mkt, heat, n30)
        rec = {k: ipo[k] for k in ("name", "status", "price", "gmp", "size_cr", "open", "close", "listing")}
        rec.update({k: sb.get(k) for k in ("sub_total", "sub_qib", "sub_snii", "sub_bnii", "sub_nii", "sub_rii")})
        rec.update({"sector": obj.get("company_sector"), "pe": num(obj.get("pe_ratio")) or sb.get("pe_site"),
                    "mcap_cr": num(obj.get("market_cap")), "fy_end": fin.get("fy_end"),
                    "revenue_cr": fin.get("rev0"), "pat_cr": fin.get("pat0"), "gmp_trend": tr.get("trend"),
                    "url": IG + ipo["href"], "features": feats})
        ipos.append(rec)
        log("ok", ipo["name"], "| features", sum(v is not None for v in feats.values()), "/", len(feats))
        time.sleep(1)
    order = {"Open": 0, "Upcoming": 1, "Closed": 2}
    ipos.sort(key=lambda r: (order[r["status"]], r["close"]))
    latest = market_feats(series, TODAY)
    out = {"updatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "investorgain.com (GMP, subscription, IPO details) + NSE (NIFTY 50, Smallcap 100, India VIX)",
           "market": {k: (round(v, 5) if v is not None else None) for k, v in latest.items()},
           "heat_now": (lambda p: sum(p) / len(p) if len(p) >= 2 else None)([g for d, g in trk if TODAY - dt.timedelta(days=60) <= d < TODAY]),
           "n_ipos_prev30_now": sum(1 for d, _ in trk if TODAY - dt.timedelta(days=30) <= d - dt.timedelta(days=5) < TODAY),
           "ipos": ipos, "log": LOG[-40:]}
    json.dump(out, open("live.json", "w"), indent=1, ensure_ascii=False)
    log("wrote", len(ipos), "IPOs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
