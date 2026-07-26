const { getHistoryStore } = require('./_lib/getHistoryStore');
const { getFullHistory } = require('./_lib/getFullHistory');
const { getFetchLog } = require('./_lib/fetchLog');
const { getVixLog, getTodaysChainSnapshot, todayIST } = require('./_lib/settingsStore');

// One place to answer "is this thing actually working." Checks:
//   - when the daily history last updated, and how many calendar days ago
//   - whether today's VIX has a reading, if VIX tracking is being used
//   - whether today's option chain was ever loaded
//   - whether the last 10 trading days in history have any gaps
//   - the last 10 fetch log entries, so recent failures are visible
// This is read-only and inspects existing state, it never fetches
// anything itself.

function weekdaysBetween(fromStr, toStr) {
  // Simple count of Mon-Fri calendar dates strictly between two ISO dates,
  // used to sanity check for missing sessions. Does not account for market
  // holidays, so a holiday gap will show up as "missing" here, worth
  // knowing before treating this as a hard alarm.
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  const days = [];
  const cur = new Date(from);
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur < to) {
    const wd = cur.getUTCDay();
    if (wd >= 1 && wd <= 5) days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

exports.handler = async function () {
  try {
    const store = getHistoryStore();
    const hist = await getFullHistory();
    const meta = (await store.get('meta', { type: 'json' })) || null;
    const fetchLog = await getFetchLog();
    const vixLog = await getVixLog();
    const chainSnapshot = await getTodaysChainSnapshot();

    const lastDate = hist.length ? hist[hist.length - 1].d : null;
    const today = todayIST();
    const daysSinceLastClose = lastDate
      ? Math.round((new Date(today) - new Date(lastDate)) / 86400000)
      : null;

    const recentLog = fetchLog.slice(-10).reverse();
    const recentFailures = fetchLog.slice(-30).filter((e) => !e.success);

    // Missing-session check across the last 10 calendar-weekdays of history
    let missingSessions = [];
    if (hist.length >= 2) {
      const checkFrom = hist[Math.max(0, hist.length - 15)].d;
      const expected = weekdaysBetween(checkFrom, lastDate);
      const known = new Set(hist.map((r) => r.d));
      missingSessions = expected.filter((d) => !known.has(d));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        checkedAt: new Date().toISOString(),
        history: {
          lastDate,
          daysSinceLastClose,
          totalSessions: hist.length,
          lastSource: meta ? meta.source : null,
          lastAutoError: meta ? meta.lastAutoError : null,
        },
        vix: {
          hasTodaysReading: !!(vixLog && vixLog.readings && vixLog.readings.length),
          readingCount: vixLog && vixLog.readings ? vixLog.readings.length : 0,
        },
        optionChain: {
          loadedToday: !!chainSnapshot,
          loadedAt: chainSnapshot ? chainSnapshot.asOf : null,
        },
        missingSessions,
        recentFailureCount: recentFailures.length,
        recentLog,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
