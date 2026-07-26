const { getVixLog, getTodaysChainSnapshot, todayIST } = require('./settingsStore');

// Merges whatever same-day context is available (VIX close, PCR, Max Pain,
// OI walls) into a freshly derived session record. Only applies when the
// record's date is actually today, IST, since VIX/chain snapshots are
// always keyed to "today," not to whatever historical date might be getting
// confirmed. Silently leaves the fields null if nothing was captured that
// day, this is enrichment, not a requirement, a session still saves fine
// with none of it.

async function enrichSessionRecord(record) {
  if (record.d !== todayIST()) return record; // nothing to merge for a past date

  try {
    const vixLog = await getVixLog();
    if (vixLog && vixLog.readings && vixLog.readings.length) {
      record.vix = vixLog.readings[vixLog.readings.length - 1].vix;
    }
  } catch (e) {
    /* enrichment is best-effort */
  }

  try {
    const chain = await getTodaysChainSnapshot();
    if (chain) {
      record.pcr = chain.pcr != null ? chain.pcr : null;
      record.maxPain = chain.maxPain != null ? chain.maxPain : null;
      record.callWall = chain.callWall != null ? chain.callWall : null;
      record.putWall = chain.putWall != null ? chain.putWall : null;
    }
  } catch (e) {
    /* enrichment is best-effort */
  }

  return record;
}

module.exports = { enrichSessionRecord };
