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

## Not financial advice

Same as the artifact version: everything this shows is descriptive
historical statistics, never a prediction, and the app has no idea what
today's news is — that's what the manual "elevated event risk" toggle in
the range panel is for. Confirm live prices and current headlines before
you place anything.
