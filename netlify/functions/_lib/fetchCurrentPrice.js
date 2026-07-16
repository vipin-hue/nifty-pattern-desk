// Live-ish current price, today's running high/low, AND India VIX, for the
// trade-watch, range-alert, and VIX-tracking features. Same honesty rules
// as the daily fetch: try NSE first, fall back to Yahoo, never fabricate a
// number if both fail. Yahoo's free quotes are typically 15-20 minutes
// delayed — this is a heads-up tool, not a live tape.
//
// NSE's allIndices endpoint returns EVERY index in one response, so NIFTY
// 50 and India VIX come from a single HTTP call when NSE succeeds — VIX
// tracking costs nothing extra in that case. Only the Yahoo fallback path
// needs a second, separate call for VIX (^INDIAVIX is a different symbol
// than ^NSEI, Yahoo doesn't bundle them).

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

async function nseSession() {
  const homeRes = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS });
  if (!homeRes.ok) throw new Error(`NSE homepage returned ${homeRes.status}`);
  const cookies =
    typeof homeRes.headers.getSetCookie === 'function'
      ? homeRes.headers.getSetCookie()
      : [homeRes.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) throw new Error('NSE gave no session cookie — likely blocked this request');
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function fetchFromNSE() {
  const cookieHeader = await nseSession();
  const res = await fetch('https://www.nseindia.com/api/allIndices', {
    headers: { ...NSE_HEADERS, Cookie: cookieHeader },
  });
  if (!res.ok) throw new Error(`NSE allIndices returned ${res.status}`);
  const json = await res.json();
  const rows = json.data || [];

  const niftyRow = rows.find((r) => r.index === 'NIFTY 50');
  if (!niftyRow || niftyRow.last == null) throw new Error('NIFTY 50 not found in NSE allIndices response');

  // NSE has listed VIX under slightly different names historically —
  // match defensively rather than assuming one exact string.
  const vixRow = rows.find((r) => /india\s*vix/i.test(r.index || ''));

  return {
    price: Number(niftyRow.last),
    dayHigh: niftyRow.dayHigh != null ? Number(niftyRow.dayHigh) : null,
    dayLow: niftyRow.dayLow != null ? Number(niftyRow.dayLow) : null,
    dayOpen: niftyRow.open != null ? Number(niftyRow.open) : null,
    vix: vixRow && vixRow.last != null ? Number(vixRow.last) : null,
    vixOpen: vixRow && vixRow.open != null ? Number(vixRow.open) : null,
    source: 'nse',
    asOf: new Date().toISOString(),
  };
}

async function fetchNiftyFromYahoo() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1m&range=1d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NiftyPatternDesk/1.0)' } });
  if (!res.ok) throw new Error(`Yahoo fetch returned ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('Unexpected response shape from Yahoo (no regularMarketPrice)');

  // meta doesn't reliably carry today's open, but the first minute bar's
  // "open" value is today's actual session open.
  const opens = result?.indicators?.quote?.[0]?.open || [];
  const firstOpen = opens.find((v) => v != null);

  return {
    price: Number(meta.regularMarketPrice),
    dayHigh: meta.regularMarketDayHigh != null ? Number(meta.regularMarketDayHigh) : null,
    dayLow: meta.regularMarketDayLow != null ? Number(meta.regularMarketDayLow) : null,
    dayOpen: firstOpen != null ? Number(firstOpen) : null,
  };
}

async function fetchVixFromYahoo() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1m&range=1d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NiftyPatternDesk/1.0)' } });
  if (!res.ok) throw new Error(`Yahoo VIX fetch returned ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('Unexpected response shape from Yahoo VIX (no regularMarketPrice)');
  return {
    vix: Number(meta.regularMarketPrice),
    vixOpen: meta.regularMarketDayHigh != null ? null : null, // Yahoo doesn't give a reliable "day open" field here either
  };
}

async function fetchFromYahoo(needVix) {
  const nifty = await fetchNiftyFromYahoo();
  let vix = null, vixOpen = null;
  if (needVix) {
    try {
      const v = await fetchVixFromYahoo();
      vix = v.vix;
      vixOpen = v.vixOpen;
    } catch (vixErr) {
      console.warn('Yahoo VIX fetch failed (Nifty price still used):', vixErr.message);
    }
  }
  return { ...nifty, vix, vixOpen, source: 'yahoo', asOf: new Date().toISOString() };
}

async function fetchCurrentPrice(needVix = false) {
  try {
    return await fetchFromNSE();
  } catch (nseErr) {
    try {
      return await fetchFromYahoo(needVix);
    } catch (yahooErr) {
      throw new Error(`Both sources failed — NSE: ${nseErr.message} | Yahoo: ${yahooErr.message}`);
    }
  }
}

module.exports = { fetchCurrentPrice };
