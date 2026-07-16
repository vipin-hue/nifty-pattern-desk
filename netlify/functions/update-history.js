const { schedule } = require('@netlify/functions');
const { runAutoFetch } = require('./_lib/runAutoFetch');

// BEST-EFFORT ONLY. Yahoo's chart endpoint is unofficial and undocumented —
// it can change shape, rate-limit, or go down without notice. That's why
// runAutoFetch() never overwrites a day that's already been logged (manual
// or auto), and why the frontend always shows when data was last confirmed
// and by what source, instead of silently trusting whatever this fetched.
//
// When you have a working Kite Connect API key, swap fetchLatestBars() in
// _lib/runAutoFetch.js for a call to Kite's historical-data endpoint — an
// official, ToS-compliant source that will be far more reliable than
// scraping Yahoo.

const handler = async function () {
  try {
    const meta = await runAutoFetch();
    console.log('update-history:', JSON.stringify(meta));
  } catch (err) {
    console.error('update-history: auto-fetch failed —', err.message);
  }
};

// 11:30 UTC = 5:00pm IST, Mon-Fri — after NSE close (3:30pm IST) with a
// buffer for the day's bar to settle. Adjust the cron if you'd rather run
// earlier/later.
exports.handler = schedule('30 11 * * 1-5', handler);
