const { getHistoryStore } = require('./getHistoryStore');

// Append-only log of every fetch attempt across the app, capped to avoid
// unbounded growth. This is what "did auto-fetch actually run, how often
// does it succeed" gets answered from, distinct from meta, which only
// ever holds the single most recent status.

const MAX_LOG_ENTRIES = 300;

async function logFetchAttempt({ fn, source, success, error, detail }) {
  const store = getHistoryStore();
  let log = (await store.get('fetchLog', { type: 'json' })) || [];
  log.push({
    at: new Date().toISOString(),
    fn,
    source: source || null,
    success: !!success,
    error: error || null,
    detail: detail || null,
  });
  if (log.length > MAX_LOG_ENTRIES) {
    log = log.slice(log.length - MAX_LOG_ENTRIES);
  }
  await store.setJSON('fetchLog', log);
}

async function getFetchLog() {
  const store = getHistoryStore();
  return (await store.get('fetchLog', { type: 'json' })) || [];
}

module.exports = { logFetchAttempt, getFetchLog };
