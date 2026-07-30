const { getCapturedOpen } = require('./_lib/settingsStore');

// Fetch endpoint that returns today's captured open to the frontend.
// Called by app.js loadCapturedOpen() to auto-fill the Open field.
// Returns { captured: { date, open, source, capturedAt } } or { captured: null }
// if no capture exists for today.

const handler = async function (req, res) {
  try {
    const rec = await getCapturedOpen();
    res.status(200).json({ captured: rec });
  } catch (err) {
    console.error('get-captured-open: failed:', err.message);
    res.status(500).json({ error: err.message, captured: null });
  }
};

exports.handler = handler;
