const { runAutoFetch } = require('./_lib/runAutoFetch');

// Manual "run it now" button for testing the auto-fetch without waiting for
// the schedule, and for triggering a catch-up fetch after a day it missed.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const meta = await runAutoFetch();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, meta }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
