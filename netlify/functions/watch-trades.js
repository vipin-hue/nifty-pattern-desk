const { schedule } = require('@netlify/functions');
const { fetchCurrentPrice } = require('./_lib/fetchCurrentPrice');
const { loadTrades, saveTrades } = require('./_lib/tradeStore');
const { getSettings, getVixLog, saveVixLog } = require('./_lib/settingsStore');

// Runs every 30 minutes, Mon-Fri, across NSE market hours (9:15am-3:30pm
// IST = 3:45am-10:00am UTC — see cron at the bottom).
//
// Only fetches a price if there's something that actually needs it:
//   - a trade with an eligible pending level, OR
//   - the VIX-alert toggle is on
// (VIX is opt-in specifically because it means fetching even with no
// trade plan active — today's VIX exists regardless of whether you're
// tracking a trade, so it doesn't fit the "only fetch when a plan needs
// it" rule the trade watcher uses).
// Neither active = no fetch, no extra load on NSE/Yahoo.
//
// LEVEL WATCH: a trade can carry several levels (entry, target 1, target 2,
// stop, flip to the other side, etc), optionally chained with dependsOn so
// a later level only becomes checkable once an earlier one has actually
// been hit. Each eligible pending level is checked independently
// otherwise — one trade can progress through several alerts over the day
// without closing itself, you close it manually once done.
//
// VIX WATCH: tracks India VIX readings through the day and alerts once if
// it moves ±10% from today's open — a common informal "notable move"
// threshold, not a statistically derived one. NSE's allIndices response
// already includes VIX alongside NIFTY 50 in the same call, so this adds
// no extra NSE load when NSE succeeds; only the Yahoo fallback needs a
// second, separate call.
//
// Both only ever watch published index levels and alert you — this
// never places, modifies, or closes a real order, and there's no live
// option-premium feed, so no P&L is calculated anywhere here.

function isEligible(trade, lvl) {
  if (lvl.status !== 'pending') return false;
  if (!lvl.dependsOn) return true;
  const dep = (trade.levels || []).find((l) => l.id === lvl.dependsOn);
  return dep ? dep.status === 'hit' : true; // fail open if the dependency vanished somehow
}

async function checkLevels(price, asOf) {
  const trades = await loadTrades();
  const active = trades.filter((t) => t.status === 'active');
  let changed = false;
  for (const trade of active) {
    for (const lvl of trade.levels || []) {
      if (!isEligible(trade, lvl)) continue;
      const crossed =
        (lvl.direction === 'above' && price >= lvl.price) ||
        (lvl.direction === 'below' && price <= lvl.price);
      if (crossed) {
        lvl.status = 'hit';
        lvl.hitAt = asOf;
        lvl.hitPrice = price;
        lvl.acknowledged = false;
        changed = true;
        console.log(`watch-trades: LEVEL HIT "${trade.label}" [${lvl.type}] ${lvl.direction} ${lvl.price} — price ${price}`);
      }
    }
  }
  if (changed) await saveTrades(trades);
}

const VIX_MOVE_THRESHOLD_PCT = 10; // informal "notable move" heuristic, not statistically derived

async function checkVix(vix, vixOpenFromSource, asOf) {
  if (vix == null) {
    console.log('watch-trades: VIX-alert on, but source did not provide a VIX reading this check.');
    return;
  }
  const log = await getVixLog();
  if (log.openVix == null) {
    log.openVix = vixOpenFromSource != null ? vixOpenFromSource : vix; // first reading of the day is the fallback "open"
  }
  log.readings.push({ at: asOf, vix });

  const pctChange = ((vix - log.openVix) / log.openVix) * 100;
  let changed = true; // readings array always grows

  if (!log.firedThresholds.includes('spike_up') && pctChange >= VIX_MOVE_THRESHOLD_PCT) {
    log.firedThresholds.push('spike_up');
    log.events.push({ direction: 'up', pctChange: Math.round(pctChange * 10) / 10, vix, openVix: log.openVix, at: asOf });
    console.log(`watch-trades: VIX ALERT — up ${pctChange.toFixed(1)}% from today's open (${log.openVix} -> ${vix})`);
  }
  if (!log.firedThresholds.includes('spike_down') && pctChange <= -VIX_MOVE_THRESHOLD_PCT) {
    log.firedThresholds.push('spike_down');
    log.events.push({ direction: 'down', pctChange: Math.round(pctChange * 10) / 10, vix, openVix: log.openVix, at: asOf });
    console.log(`watch-trades: VIX ALERT — down ${pctChange.toFixed(1)}% from today's open (${log.openVix} -> ${vix})`);
  }

  if (changed) await saveVixLog(log);
}

const handler = async function () {
  try {
    const trades = await loadTrades();
    const active = trades.filter((t) => t.status === 'active');
    const hasEligibleLevel = active.some((t) => (t.levels || []).some((l) => isEligible(t, l)));

    const settings = await getSettings();
    const vixAlertOn = !!settings.vixAlertEnabled;

    if (!hasEligibleLevel && !vixAlertOn) {
      console.log('watch-trades: nothing to watch, skipping price fetch.');
      return;
    }

    const { price, vix, vixOpen, source, asOf } = await fetchCurrentPrice(vixAlertOn);
    console.log(`watch-trades: current price ${price} (via ${source}) at ${asOf}${vix != null ? `, VIX ${vix}` : ''}`);

    if (hasEligibleLevel) await checkLevels(price, asOf);
    if (vixAlertOn) await checkVix(vix, vixOpen, asOf);
  } catch (err) {
    console.error('watch-trades: price fetch failed —', err.message);
    // Deliberately not written into trade/vix records — a failed
    // price check should never look like "nothing happened." The
    // freshness banner covers overall fetch health separately.
  }
};

exports.handler = schedule('15,45 3-9 * * 1-5', handler);
