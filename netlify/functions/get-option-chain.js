const { fetchOptionChain } = require('./_lib/fetchOptionChain');
const { saveTodaysChainSnapshot, todayIST } = require('./_lib/settingsStore');
const { logFetchAttempt } = require('./_lib/fetchLog');

// Persists today's snapshot (PCR, Max Pain, OI walls, ATM IV) so the daily
// close capture can merge it into that session's permanent record, per the
// data model, one row per session with all context fields, not scattered
// across separate stores that only hold "right now."

exports.handler = async function () {
  try {
    const summary = await fetchOptionChain('NIFTY');
    await saveTodaysChainSnapshot({ date: todayIST(), ...summary });
    await logFetchAttempt({ fn: 'get-option-chain', source: 'nse', success: true, detail: `PCR ${summary.pcr}` });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ...summary }),
    };
  } catch (err) {
    await logFetchAttempt({ fn: 'get-option-chain', source: 'nse', success: false, error: err.message });
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
