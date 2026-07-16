const { fetchCurrentPrice } = require('./_lib/fetchCurrentPrice');
const { saveCapturedOpen, todayIST } = require('./_lib/settingsStore');

// "Run it now" for testing the open-capture without waiting for 9:10am,
// or for re-capturing if the scheduled run failed. Overwrites any existing
// capture for today, unlike the scheduled job which skips if one exists.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { dayOpen, source, asOf } = await fetchCurrentPrice(false);
    if (dayOpen == null) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: `Source (${source}) did not provide today's open` }),
      };
    }
    const rec = { date: todayIST(), open: dayOpen, source, capturedAt: asOf };
    await saveCapturedOpen(rec);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, captured: rec }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
