// Shared math used by both the manual-entry endpoint and the scheduled
// auto-update function, so a manually logged day and an auto-fetched day
// always carry identical derived fields.

function weekdayShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// NSE moved Nifty weekly options expiry from Thursday to Tuesday effective
// 1-Sep-2025. This flags every session that falls on the expiry weekday for
// its regime, a simplification, actual expiry sometimes shifts a day for
// exchange holidays, which this does not account for.
const EXPIRY_REGIME_CHANGE_DATE = '2025-09-02';
function isExpiryDay(dateStr, weekday) {
  const expiryWeekday = dateStr < EXPIRY_REGIME_CHANGE_DATE ? 'Thu' : 'Tue';
  return weekday === expiryWeekday;
}

// Plain-language data quality tag, distinct from the raw source string, for
// display in the history table and system health check.
function dataQualityTag(source) {
  if (source === 'manual') return 'manual_confirmed';
  if (source === 'auto-nse') return 'fetched_auto';
  if (source === 'auto-yahoo') return 'fetched_fallback';
  if (source === 'seed') return 'seed';
  return 'unknown';
}

function deriveFields({ d, o, h, l, c }, prevClose, source) {
  const gap = prevClose != null ? ((o - prevClose) / prevClose) * 100 : null;
  const intra = ((c - o) / o) * 100;
  const rangePts = h - l;
  const rangePct = (rangePts / o) * 100;
  const col = c >= o ? 'G' : 'R';
  const wd = weekdayShort(d);
  return {
    d,
    wd,
    o: Number(o),
    h: Number(h),
    l: Number(l),
    c: Number(c),
    pc: prevClose != null ? Number(prevClose) : null,
    gap: gap != null ? Number(gap.toFixed(3)) : null,
    intra: Number(intra.toFixed(3)),
    rangePts: Number(rangePts.toFixed(2)),
    rangePct: Number(rangePct.toFixed(3)),
    col,
    source, // 'seed' | 'manual' | 'auto-nse' | 'auto-yahoo'
    dataQuality: dataQualityTag(source),
    isExpiryDay: isExpiryDay(d, wd),
    // Enriched separately if available same day, null otherwise. Kept on
    // the record rather than a separate table per the build spec: one row
    // per session with all context fields.
    vix: null,
    pcr: null,
    maxPain: null,
    callWall: null,
    putWall: null,
  };
}

module.exports = { deriveFields, weekdayShort, isExpiryDay, dataQualityTag, EXPIRY_REGIME_CHANGE_DATE };
