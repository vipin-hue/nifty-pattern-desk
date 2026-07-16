// Mirrors public/app.js's computeATR/computeADR exactly, so the number the
// range-alert compares against is the same one you see on the dashboard.

function trueRange(row) {
  if (row.pc == null) return row.h - row.l;
  return Math.max(row.h - row.l, Math.abs(row.h - row.pc), Math.abs(row.l - row.pc));
}

function computeATR(rows, period) {
  if (rows.length < period) return null;
  const tr = rows.map(trueRange);
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function computeADR(rows, period) {
  if (rows.length < period) return null;
  const recent = rows.slice(-period);
  return recent.reduce((a, r) => a + (r.rangePts != null ? r.rangePts : r.h - r.l), 0) / period;
}

module.exports = { computeATR, computeADR };
