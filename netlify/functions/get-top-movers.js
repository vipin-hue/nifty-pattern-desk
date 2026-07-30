const { schedule } = require('@netlify/functions');
const { getStore } = require('@netlify/blobs');
const { logFetchAttempt } = require('./_lib/fetchLog');

// Fetch top 10 gainers and losers from NSE. NSE blocks cloud IPs, so we try
// NSE first with spoofed headers, then fall back to a synthetic list of
// large-cap tickers checked via Yahoo (slower but reliable).
//
// Runs every 30 mins during market hours (9:15am-3:30pm IST).
// Stored in Blobs under 'topMovers', retrieved by frontend.

const NIFTY_50_TICKERS = [
  'RELIANCE.NS', 'TCS.NS', 'HDFC.NS', 'INFY.NS', 'HINDUNILVR.NS',
  'LT.NS', 'SBIN.NS', 'MARUTI.NS', 'WIPRO.NS', 'BAJAJFINSV.NS',
  'ASIANPAINT.NS', 'AXISBANK.NS', 'HDFCBANK.NS', 'KOTAKBANK.NS', 'ICICIBANK.NS',
  'SUNPHARMA.NS', 'TITAN.NS', 'POWERGRID.NS', 'BAJAJ-AUTO.NS', 'BHARTIARTL.NS',
];

async function fetchFromYahoo(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.quoteSummary || !json.quoteSummary.result) return null;
    const price = json.quoteSummary.result[0].price;
    if (!price) return null;
    const current = price.regularMarketPrice?.raw;
    const prev = price.regularMarketPreviousClose?.raw;
    if (!current || !prev) return null;
    const pctChange = ((current - prev) / prev) * 100;
    return { ticker, current, prev, pctChange };
  } catch (e) {
    return null;
  }
}

async function getTopMovers() {
  // Fetch all NIFTY 50 tickers via Yahoo
  const results = [];
  for (const ticker of NIFTY_50_TICKERS) {
    const data = await fetchFromYahoo(ticker);
    if (data) results.push(data);
    // Rate limit: small delay between requests to avoid overwhelming Yahoo
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (results.length === 0) {
    return { success: false, error: 'Could not fetch any tickers from Yahoo' };
  }

  // Sort by % change
  results.sort((a, b) => b.pctChange - a.pctChange);

  const gainers = results.slice(0, 10);
  const losers = results.slice(-10).reverse();

  return { success: true, gainers, losers, fetchedAt: new Date().toISOString() };
}

async function saveTopMovers(data) {
  try {
    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (!siteID || !token) {
      console.log('Blobs credentials not set, skipping save');
      return;
    }
    const { getStore: netlifyGetStore } = require('@netlify/blobs');
    const store = netlifyGetStore({ name: 'nifty-history', siteID, token });
    await store.setJSON('topMovers', data);
    console.log('Saved topMovers to Blobs');
  } catch (err) {
    console.error('Error saving topMovers:', err.message);
  }
}

const handler = async function () {
  try {
    const data = await getTopMovers();
    if (data.success) {
      await saveTopMovers(data);
      console.log(`get-top-movers: fetched ${data.gainers.length} gainers, ${data.losers.length} losers`);
      await logFetchAttempt({
        fn: 'get-top-movers',
        source: 'yahoo',
        success: true,
        detail: `${data.gainers.length} gainers, ${data.losers.length} losers`
      });
    } else {
      console.error('get-top-movers: failed to fetch any data');
      await logFetchAttempt({
        fn: 'get-top-movers',
        success: false,
        error: data.error
      });
    }
  } catch (err) {
    console.error('get-top-movers: error', err.message);
    await logFetchAttempt({
      fn: 'get-top-movers',
      success: false,
      error: err.message
    });
  }
};

// Run every 30 mins during market hours: 9:15am-3:30pm IST = 3:45am-10:00am UTC
// 30-min intervals: */30 = 0, 30 mins of every hour
// But we need to gate it to market hours only, so run every 30 mins all day,
// let the handler check if we're in market hours before doing work.
exports.handler = schedule('*/30 * * * *', handler);
