const { NSE_HEADERS, nseSession } = require('./nseSession');

// NSE's option-chain-indices endpoint is free and unofficial, same session
// pattern as everything else scraped from NSE in this project — and the
// same caveats apply, likely more so: it's a much larger payload than
// allIndices, so more likely to trip whatever automated-traffic detection
// NSE runs. This is why it's a manual "Load option chain" action in the
// UI rather than something the scheduled watcher pulls automatically.

async function fetchOptionChain(symbol = 'NIFTY') {
  const cookieHeader = await nseSession();
  const res = await fetch(`https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`, {
    headers: { ...NSE_HEADERS, Cookie: cookieHeader },
  });
  if (!res.ok) throw new Error(`NSE option-chain returned ${res.status}`);
  const json = await res.json();

  const records = json.records;
  if (!records || !Array.isArray(records.data) || !records.data.length) {
    throw new Error('Unexpected response shape from NSE option-chain (no records.data)');
  }

  const spot = records.underlyingValue;
  const nearestExpiry = records.expiryDates && records.expiryDates[0];
  if (!nearestExpiry) throw new Error('No expiry dates in NSE option-chain response');

  // Keep only rows for the nearest expiry — that's what "this week's plan"
  // actually needs; further expiries would need their own summary.
  const rows = records.data.filter((r) => r.expiryDate === nearestExpiry);

  let totalCallOI = 0, totalPutOI = 0;
  let callWall = { strike: null, oi: -1 };
  let putWall = { strike: null, oi: -1 };
  const strikes = [];

  for (const r of rows) {
    const strike = r.strikePrice;
    strikes.push(strike);
    if (r.CE) {
      totalCallOI += r.CE.openInterest || 0;
      if ((r.CE.openInterest || 0) > callWall.oi) callWall = { strike, oi: r.CE.openInterest };
    }
    if (r.PE) {
      totalPutOI += r.PE.openInterest || 0;
      if ((r.PE.openInterest || 0) > putWall.oi) putWall = { strike, oi: r.PE.openInterest };
    }
  }

  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : null;

  // ATM strike/IV: nearest strike to spot, average of CE+PE IV there
  // (fall back to whichever side has a value if one side is missing).
  let atmRow = null, atmDist = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.strikePrice - spot);
    if (d < atmDist) { atmDist = d; atmRow = r; }
  }
  let atmIV = null;
  if (atmRow) {
    const ceIV = atmRow.CE && atmRow.CE.impliedVolatility;
    const peIV = atmRow.PE && atmRow.PE.impliedVolatility;
    if (ceIV && peIV) atmIV = (ceIV + peIV) / 2;
    else atmIV = ceIV || peIV || null;
  }

  // Max Pain: the strike where option WRITERS' total payout is smallest —
  // i.e. where the most option value would expire worthless. Standard
  // definition: for each candidate settlement strike S, sum over every
  // strike K of (call OI at K * max(0, S-K)) + (put OI at K * max(0, K-S)),
  // then take the S that minimizes that sum.
  const uniqueStrikes = [...new Set(strikes)].sort((a, b) => a - b);
  const callOIByStrike = new Map(), putOIByStrike = new Map();
  for (const r of rows) {
    if (r.CE) callOIByStrike.set(r.strikePrice, r.CE.openInterest || 0);
    if (r.PE) putOIByStrike.set(r.strikePrice, r.PE.openInterest || 0);
  }
  let maxPain = null, minPayout = Infinity;
  for (const S of uniqueStrikes) {
    let payout = 0;
    for (const K of uniqueStrikes) {
      const callOI = callOIByStrike.get(K) || 0;
      const putOI = putOIByStrike.get(K) || 0;
      payout += callOI * Math.max(0, S - K);
      payout += putOI * Math.max(0, K - S);
    }
    if (payout < minPayout) { minPayout = payout; maxPain = S; }
  }

  return {
    spot,
    expiry: nearestExpiry,
    pcr,
    atmStrike: atmRow ? atmRow.strikePrice : null,
    atmIV,
    callWall: callWall.strike,
    callWallOI: callWall.oi,
    putWall: putWall.strike,
    putWallOI: putWall.oi,
    maxPain,
    totalCallOI,
    totalPutOI,
    strikeCount: uniqueStrikes.length,
    asOf: new Date().toISOString(),
  };
}

module.exports = { fetchOptionChain };
