const { getHistoryStore } = require('./getHistoryStore');
const { deriveFields } = require('./deriveFields');
const seed = require('../../../data/seed-history.json');

// TWO-SOURCE WATERFALL, both free, neither needs an API key or signup.
//
// 1) NSE's own site first — nseindia.com has no *documented* public API, but
//    its own webpage calls a JSON endpoint under the hood, which is what
//    every "free NSE data" Python library (jugaad-data, nsepython, etc.)
//    actually does too. It requires visiting the homepage first to pick up
//    session cookies, then reusing those cookies on the data request — NSE
//    rejects requests without them. NSE also actively rate-limits and
//    blocks addresses it sees as automated traffic, including cloud/
//    datacenter IPs (which is exactly what a Netlify function runs from),
//    so this can simply stop working some days for reasons that have
//    nothing to do with this code.
//
// 2) Yahoo Finance second, as the fallback — an unofficial but widely used
//    endpoint that tends to tolerate server-to-server requests better than
//    NSE does.
//
// If both fail, runAutoFetch() records the failure and leaves the day for
// manual entry — it never fabricates or guesses a number.

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

function formatNseDate(d) {
  // DD-MM-YYYY, what NSE's own historical-data endpoint expects
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

async function fetchFromNSE() {
  // Step 1: load the homepage to get session cookies. NSE's API rejects
  // requests that arrive without a valid cookie from a prior page load.
  const homeRes = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS });
  if (!homeRes.ok) throw new Error(`NSE homepage returned ${homeRes.status}`);

  const cookies =
    typeof homeRes.headers.getSetCookie === 'function'
      ? homeRes.headers.getSetCookie()
      : [homeRes.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) throw new Error('NSE gave no session cookie — likely blocked this request');
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const url =
    `https://www.nseindia.com/api/historical/indicesHistory?indexType=${encodeURIComponent('NIFTY 50')}` +
    `&from=${formatNseDate(from)}&to=${formatNseDate(to)}`;

  const dataRes = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookieHeader } });
  if (!dataRes.ok) throw new Error(`NSE data endpoint returned ${dataRes.status}`);
  const json = await dataRes.json();
  const rows = json?.data?.indexCloseOnlineRecords || json?.data?.indexTimeSeries || json?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Unexpected response shape from NSE');

  // NSE's own field names have varied across API revisions — read defensively.
  return rows
    .map((r) => {
      const dateStr = r.EOD_TIMESTAMP || r.HistoricalDate || r.TIMESTAMP;
      const o = r.EOD_OPEN_INDEX_VAL ?? r.OPEN;
      const h = r.EOD_HIGH_INDEX_VAL ?? r.HIGH;
      const l = r.EOD_LOW_INDEX_VAL ?? r.LOW;
      const c = r.EOD_CLOSE_INDEX_VAL ?? r.CLOSE;
      if (!dateStr || o == null || h == null || l == null || c == null) return null;
      const d = new Date(dateStr);
      if (isNaN(d)) return null;
      return { d: d.toISOString().slice(0, 10), o: Number(o), h: Number(h), l: Number(l), c: Number(c) };
    })
    .filter(Boolean);
}

async function fetchFromYahoo() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=5d&interval=1d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NiftyPatternDesk/1.0)' } });
  if (!res.ok) throw new Error(`Yahoo fetch returned ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp) throw new Error('Unexpected response shape from Yahoo');

  const ts = result.timestamp;
  const q = result.indicators.quote[0];
  return ts
    .map((t, i) => ({
      d: new Date(t * 1000).toISOString().slice(0, 10),
      o: q.open[i],
      h: q.high[i],
      l: q.low[i],
      c: q.close[i],
    }))
    .filter((r) => r.o != null && r.h != null && r.l != null && r.c != null);
}

async function fetchLatestBars() {
  try {
    const rows = await fetchFromNSE();
    return { rows, source: 'auto-nse' };
  } catch (nseErr) {
    console.warn('NSE fetch failed, falling back to Yahoo:', nseErr.message);
    try {
      const rows = await fetchFromYahoo();
      return { rows, source: 'auto-yahoo' };
    } catch (yahooErr) {
      throw new Error(`Both sources failed — NSE: ${nseErr.message} | Yahoo: ${yahooErr.message}`);
    }
  }
}

async function runAutoFetch() {
  const store = getHistoryStore();
  try {
    const existing = (await store.get('extra-days', { type: 'json' })) || [];
    const known = new Map();
    for (const r of seed) known.set(r.d, r);
    for (const r of existing) known.set(r.d, r);

    const { rows: fresh, source } = await fetchLatestBars();
    let added = 0;

    for (const day of fresh) {
      if (known.has(day.d)) continue; // never overwrite seed, manual, or a prior auto entry

      const priorDates = [...known.values()]
        .filter((r) => r.d < day.d)
        .sort((a, b) => a.d.localeCompare(b.d));
      const prevClose = priorDates.length ? priorDates[priorDates.length - 1].c : null;

      const record = deriveFields(day, prevClose, source);
      known.set(day.d, record);
      added++;
    }

    const merged = [...known.values()]
      .filter((r) => !seed.find((s) => s.d === r.d))
      .sort((a, b) => a.d.localeCompare(b.d));

    await store.setJSON('extra-days', merged);
    const meta = {
      lastUpdated: new Date().toISOString(),
      lastDate: merged.length ? merged[merged.length - 1].d : (seed[seed.length - 1]?.d ?? null),
      source: added > 0 ? source : `${source}-no-new-data`,
      addedCount: added,
    };
    await store.setJSON('meta', meta);
    return meta;
  } catch (err) {
    const meta = {
      lastUpdated: new Date().toISOString(),
      lastAutoError: err.message,
      source: 'auto-failed',
    };
    try {
      await store.setJSON('meta', meta);
    } catch (e) {
      /* best effort */
    }
    throw err;
  }
}

module.exports = { runAutoFetch };
