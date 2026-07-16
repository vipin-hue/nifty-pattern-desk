const { schedule } = require('@netlify/functions');
const { fetchCurrentPrice } = require('./_lib/fetchCurrentPrice');
const { getCapturedOpen, saveCapturedOpen, todayIST } = require('./_lib/settingsStore');

// Runs once at 9:10am IST (3:40am UTC), Mon-Fri — right after NSE's
// pre-open session (9:00-9:15am) has done most of its price discovery.
//
// Honest caveat, worth repeating wherever this value shows up: pre-open
// matching can still be settling at 9:10, so this can occasionally differ
// slightly from the official 9:15am regular-session open. It's a
// convenience pre-fill, not a guaranteed-final print — the dashboard lets
// you override it manually either way.
//
// Runs unconditionally (unlike watch-trades.js) since it's a single fixed
// daily event, not a repeated condition-based check — same pattern as the
// once-daily close capture in update-history.js.

const handler = async function () {
  try {
    const existing = await getCapturedOpen();
    if (existing) {
      console.log('capture-open: already captured today, skipping.');
      return;
    }

    const { dayOpen, source, asOf } = await fetchCurrentPrice(false);
    if (dayOpen == null) {
      throw new Error(`Source (${source}) did not provide today's open`);
    }

    await saveCapturedOpen({
      date: todayIST(),
      open: dayOpen,
      source,
      capturedAt: asOf,
    });
    console.log(`capture-open: captured ${dayOpen} via ${source} at ${asOf}`);
  } catch (err) {
    console.error('capture-open: failed —', err.message);
    // No fallback value written — an absent capture just means the
    // dashboard's Open field stays blank for manual entry, same as before
    // this feature existed.
  }
};

exports.handler = schedule('40 3 * * 1-5', handler);
