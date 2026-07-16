# Nifty Intraday Pattern Desk

A hosted version of the pattern-match dashboard: same design, same math, but
now the data lives on the server (Netlify Blobs) instead of inside a single
chat artifact, and a scheduled job attempts to add each new trading day
automatically.

Read this whole file before you deploy — especially **"Why an automated
free NSE feed is not something you can rely on"** below. I built this
honestly, not optimistically: the automation is a best-effort bonus, and
the app is designed to tell you clearly when it's failed rather than
quietly show you stale or wrong numbers.

## What's actually reliable here vs. what's best-effort

| Piece | Reliability |
|---|---|
| The 245-day seed history | Fixed, accurate as of 15-Jul-2026 |
| Manual "Confirm Today's Close" | **Reliable** — this is the real source of truth |
| Scheduled auto-fetch (NSE, then Yahoo Finance) | **Best-effort only** — unofficial endpoints, can break silently |
| Freshness banner | Reliable — tells you honestly which of the above actually ran |

I'd treat this as: check the dashboard each evening, and if the auto-fetch
didn't pick up the day (the banner will say so), spend 15 seconds typing in
the day's O/H/L/C yourself. That's a more durable habit than trusting
automation to never break.

## Why an automated free NSE feed is not something you can rely on

NSE's own website has no public, documented API for historical index data —
what unofficial libraries (jugaad-data, nsepython, etc.) use is the same
JSON endpoint the website's own JavaScript calls, which requires session
cookies from first loading the homepage and commonly blocks requests coming
from cloud/server IPs (including Netlify's function infrastructure). It can
work for a while and then stop without warning.

This build tries that NSE endpoint first — that's the real "pull from the
NSE website" path you asked for — and if it fails (blocked, changed shape,
times out) it automatically falls back to Yahoo Finance's unofficial chart
endpoint (`query1.finance.yahoo.com`), which tends to be more tolerant of
server-to-server requests. Yahoo is also unsupported and could change or
block at any time, it's just the second layer of a best-effort attempt, not
a guarantee.

**The durable fix, if you want real automation:** once your Kite Connect
API key is active, swap the `fetchLatestBars()` function in
`netlify/functions/_lib/runAutoFetch.js` for a call to Kite's historical
data endpoint. That's an official, ToS-compliant, authenticated source and
won't have this problem. I left a comment at that exact spot in the code.

## Project layout

```
nifty-pattern-desk/
├── netlify.toml                  # build + function routing config
├── package.json                  # @netlify/blobs, @netlify/functions
├── data/
│   └── seed-history.json         # the 245-day bootstrap dataset
├── netlify/functions/
│   ├── get-history.js            # GET  /api/get-history
│   ├── log-session.js            # POST /api/log-session   (manual confirm)
│   ├── update-history.js         # scheduled, weekdays 5pm IST (auto-fetch)
│   ├── trigger-update.js         # POST /api/trigger-update (manual "run now")
│   ├── status.js                 # GET  /api/status        (freshness info)
│   └── _lib/
│       ├── deriveFields.js       # shared OHLC → gap/range/etc math
│       └── runAutoFetch.js       # shared auto-fetch logic
└── public/
    ├── index.html
    ├── styles.css                # the dark/amber terminal theme you liked
    └── app.js
```

## Deploy to Netlify — step by step

1. **Push this folder to GitHub.** Create a new repo, put everything in
   this folder at its root, commit, push.
   ```
   cd nifty-pattern-desk
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-new-repo-url>
   git push -u origin main
   ```

2. **In Netlify:** "Add new site" → "Import an existing project" → connect
   GitHub → pick the repo.

3. **Build settings** (Netlify should auto-detect these from `netlify.toml`,
   confirm they match):
   - Build command: *(leave blank — nothing to build)*
   - Publish directory: `public`
   - Functions directory: `netlify/functions`

4. **Deploy.** First build takes a minute or two.

5. **Netlify Blobs** should work automatically for any site deployed on
   Netlify. If it doesn't (you'll see an error like *"The environment has
   not been configured to use Netlify Blobs"* when you visit
   `/api/get-history`), fix it with manual credentials:

   a. In your Netlify dashboard: **Project configuration → General → Site
      details**, copy the **Site ID**.
   b. Click your avatar (top-right) → **User settings → Applications →
      Personal access tokens → New access token**. Give it any name, copy
      the token it shows you (you only see it once).
   c. Back in your site: **Project configuration → Environment variables →
      Add a variable**, and add two:
      - `BLOBS_SITE_ID` = the Site ID from step (a)
      - `BLOBS_TOKEN` = the token from step (b)
   d. Trigger a new deploy so the function picks up the new variables:
      **Deploys tab → Trigger deploy → Deploy site**.
   e. Revisit `/api/get-history` — it should now return your 245+ rows
      instead of an error.

   This code already knows to look for these two variables and use them if
   present (see `netlify/functions/_lib/getHistoryStore.js`), so you don't
   need to change any code — just add the two variables and redeploy.

6. **Scheduled functions**: Netlify should detect the `schedule(...)` wrapper
   in `update-history.js` automatically and run it on the cron
   (`30 11 * * 1-5` = 5:00pm IST, Mon–Fri). Check your site's Functions tab
   to confirm it's listed as scheduled. Scheduled functions have historically
   been available on Netlify's free tier, but confirm current plan limits at
   `https://docs.netlify.com/functions/scheduled-functions/` since pricing
   and limits are exactly the kind of thing that changes after this was
   written.

7. **Test it:**
   - Visit `https://<your-site>.netlify.app` — you should see 245 rows and
     the dashboard.
   - Click "Run auto-fetch now" to test the Yahoo path immediately rather
     than waiting for the schedule.
   - Try "Confirm Today's Close" with a made-up value, confirm it appears
     in the History table with source `manual`, then delete it later by
     editing the same date again if needed (there's no delete button in
     this version — re-saving the same date overwrites it).

## A note on running this locally before you deploy

`netlify dev` (from the Netlify CLI) is the right way to test this on your
own machine with working Blobs and function routing — plain
`node public/app.js` or opening `index.html` directly won't work since the
frontend depends on `/api/*` routes that only exist under Netlify's
function runtime or `netlify dev`.

```
npm install -g netlify-cli
cd nifty-pattern-desk
netlify dev
```

## Extending the history further back

`data/seed-history.json` only goes back to 16-Jul-2025. If you want more
history, the cleanest way is to build a new seed file with the same field
names (`d, wd, o, h, l, c, pc, gap, intra, rangePts, rangePct, col`) and
swap it in — ask me to generate one from an updated CSV if you get more
NSE data.

## Trade plans and level alerts (new)

Beyond the daily pattern match, the dashboard now has a **Trade Plan &
Levels** panel: build a plan with multiple levels — Entry, Target(s),
Stop, and a "Flip" level for switching from a one-sided position to a
strangle/condor — each with a note describing what to actually do. A
scheduled function (`watch-trades.js`) checks all pending levels every 30
minutes during market hours, but **only when at least one plan has a
pending level** — no active plan, no price fetch, no extra load on
NSE/Yahoo.

Two hard boundaries, on purpose:
- **It watches the NIFTY 50 index level only.** There's no free live
  options-chain feed, so it can't check option premium, delta, or real
  P&L — only the spot price against the levels you set.
- **It only ever alerts — it never places, modifies, or closes a real
  order.** No broker connection exists in this build. If you wire up Kite
  Connect later for real automation, treat that as a separate, carefully
  guarded project — not something to bolt onto this alerting tool.

Alerts show as an in-page banner + a short beep, and only reach you while
the dashboard tab is open — there's no push-notification setup here, so a
closed tab means you'll see the alert next time you open the page, not
the instant it happened.

One usage note: set "above" levels above the current price and "below"
levels below it. A level already on the wrong side of the last known
close will fire on the very next check instead of on a real future move —
the app warns you before saving if that looks like the case, but it's
worth setting levels deliberately either way.

**"Suggest a full plan"** auto-fills Entry / Target 1 / Target 2 / Stop /
Flip / bearish target from standard floor pivots off the previous
session's high/low/close (same formula as classic pivot-point trading:
P = (H+L+C)/3, R1 = 2P-L, R2 = P+(H-L), S1 = 2P-H, S2 = P-(H-L)), plus the
real win-rate and sample size from the pattern match above baked into the
Entry note. The Flip level and the bearish target after it are chained
with "Depends on" so they only become checkable once the level before them
has actually been hit — mirrors "only flip to the call side after price
has tested resistance and rejected it," not a flat list of independent
thresholds. Review every price and note before saving; it's a starting
point, not a locked plan.

## ATR and ADR

A standalone Volatility panel near the top shows ATR(14) — Wilder's
smoothing on True Range, which accounts for gaps (`max(H-L, |H-prevClose|,
|L-prevClose|)`), not just a plain High-Low average — alongside ADR at 5,
10, and 20-day lookbacks so you can see whether the recent range is
expanding or settling relative to the longer average. ATR(14) also shows
up as its own row inside the Expected Range & Strike Context tiers, next
to the percentile-based ones, since it's the more standard input for
sizing how far OTM to sell.

**Range alert** (opt-in toggle, same panel): when on, the scheduled
watcher also fetches today's running High/Low every 30 minutes — even
with no trade plan active, which is why it's a separate toggle rather than
always-on — and alerts you once when today's actual range crosses ADR(20),
and once more if it crosses ATR(14). Each alert also reports how far into
the session it happened (NSE's 9:15am-3:30pm window) — hitting the daily
average range by 11am is a materially different situation than hitting it
at 3:15pm, even at the same point total, so the alert says so explicitly
rather than treating every crossing the same. This is a different kind of
signal than the trade-level alerts: not "price hit X," but "today is
behaving like an above-average, and possibly unusually fast, volatility
session." Resets automatically each trading day (IST).

## India VIX

A separate panel shows India VIX's current level, today's open, and %
change since open — live-ish, same NSE-then-Yahoo waterfall as everything
else. NSE's `allIndices` response already includes VIX in the same call
used for the NIFTY 50 price, so tracking VIX costs nothing extra when NSE
succeeds; only the Yahoo fallback needs one additional request.

An opt-in toggle alerts you once if VIX moves ±10% from today's open —
an informal "notable move" heuristic, not a statistically derived
threshold, and worth treating as exactly that.

**What's not built:** full historical VIX pattern analysis (weekday
stats, VIX-vs-NIFTY correlation) — that needs a year of daily VIX history
the way `data/seed-history.json` has for NIFTY, and I don't currently have
a way to pull that automatically. If you can download it (NSE's historical
data section, or Yahoo Finance's `^INDIAVIX` history page has a Download
button) and share the CSV, I can build the same weekday/gap analysis for
VIX that already exists for NIFTY.

## Refined trading suggestions

"Suggest a full plan" now pulls together every signal the app tracks
instead of pivots alone. A **Plan Context** block appears above the level
list, showing:

- **Weekday stats** — win rate, avg move, sample size for that weekday
- **Gap-bucket stats** — same, for that day's gap size/direction
- **Streak** — current consecutive up/down-day count (close vs prior
  close, matching the original workbook's definition exactly) alongside
  the historical max in each direction, for context only — not framed as
  a reversal or continuation signal
- **ATR check** — compares the Entry-to-Stop distance against ATR(14) and
  flags it when the stop sits inside ~30% of a typical day's range, since
  a normal-volatility session could round-trip through both levels
  without any real directional move
- **VIX** — current level and % change since today's open, when VIX
  tracking is switched on

Every number here is computed live from the same data the rest of the
dashboard uses — nothing is invented for this summary. The level prices
themselves are still driven by objective pivot math (not adjusted based on
these signals); the extra context only enriches the notes and flags
things worth a second look before you save the plan.

**Two real bugs fixed while building this:** the "Suggest a full plan"
button had never actually been wired to a click handler in the previous
version — clicking it did nothing. Caught it while extending the function
and fixed the listener. Also fixed a repeat of an earlier apostrophe-
escaping typo that would have broken the whole page on load.

## Not financial advice

Same as the artifact version: everything this shows is descriptive
historical statistics, never a prediction, and the app has no idea what
today's news is — that's what the manual "elevated event risk" toggle in
the range panel is for. Confirm live prices and current headlines before
you place anything.
