# A.Y.U.S.H.A.

Listing-gain forecaster for Indian mainboard IPOs, on your phone.

**Open the app:** https://nayanrathi1845.github.io/AYUSHA/  (Chrome menu → Add to Home screen to install it)

## What it does
- **Live IPOs**: open, upcoming and closed-not-yet-listed mainboard IPOs, each scored on every factor and tagged Strong / Mild / Red flag. Tap one for:
  - the forecast listing gain and price at open
  - the range 8 in 10 similar past IPOs landed in, and the chance of listing below issue price
  - **What's driving the forecast**: how much each factor group (GMP trend, subscription, market, recent IPO listings, fundamentals, valuation & offer) moves the forecast
  - key factors at a glance (P/E, revenue growth, margins, ROE, debt, fresh issue vs OFS, QIB vs retail demand, GMP trend)
  - a listing-day close estimate and a forecast from official data only
- **Check IPO**: score any IPO by hand. Price, GMP and subscription, plus optional company details (financials, valuation, offer structure). The current market and IPO-market conditions are filled in automatically.

## The model
InvestX v2: 453 Indian mainboard IPOs (Sep 2020 – Oct 2026), 48 factors in 7 groups, tested walk-forward on 2023–2026 listings.
GMP gives the starting point; a gradient-boosting model trained on all the other factors adjusts it.
Out-of-sample average miss at the open: 8.75 points (GMP alone 8.60); without GMP 15.75. The models run in the browser (`model.json`, `js/engine.js`).

## Data
A GitHub Actions job (`.github/workflows/refresh.yml` → `scripts/refresh.py`) rebuilds `live.json` every hour from 8:45 am to 8:45 pm IST:
investorgain.com (GMP, GMP history, subscription by category, IPO details and financials) and NSE (NIFTY 50, NIFTY Smallcap 100, India VIX).

Historical patterns only, not investment advice. GMP is an unofficial grey-market quote.
