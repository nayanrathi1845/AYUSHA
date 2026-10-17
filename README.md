# A.Y.U.S.H.A.

Listing-gain checker for Indian mainboard IPOs, on your phone.

**Open the app:** https://nayanrathi1845.github.io/AYUSHA/  (Chrome menu → Add to Home screen to install it)

## What it does
- **Live IPOs** – open, upcoming and closed-not-yet-listed mainboard IPOs with price, GMP and subscription, tagged Strong / Mild / Red flag. Tap one for:
  - expected listing gain (GMP-implied) and price at open
  - the range 8 in 10 past IPOs with a similar GMP landed in, and their chance of listing below issue price
  - a listing-day close estimate
  - an estimate from subscription alone, for when GMP is missing
- **Check IPO** – score any IPO by typing its price, GMP and subscription.

## The model
Built on the InvestX v2 study: 453 Indian mainboard IPOs (Sep 2020 – Oct 2026), tested walk-forward on 2023–2026 listings.
The grey market premium alone beat every model that added subscription, fundamentals, valuation or market data
(average miss 8.6 percentage points at the open). The app therefore starts from GMP and adds what history says about similar IPOs.

## Data
`live.json` is refreshed automatically about three times a day (≈9:45, 13:45, 19:45 IST) from investorgain.com's live GMP and subscription pages.

Historical patterns only – not investment advice. GMP is an unofficial grey-market quote.
