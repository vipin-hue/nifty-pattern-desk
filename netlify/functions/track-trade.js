const { loadTrades, saveTrades } = require('./_lib/tradeStore');

// Body: { label, levels: [{ type, direction, price, note, dependsOnIndex }] }
//
//   type            — 'entry' | 'target' | 'stop' | 'flip' | 'note' (cosmetic only)
//   direction       — 'above' | 'below' — which way price crosses to trigger it
//   price           — the NIFTY 50 index level to watch
//   note            — what to actually do when it's hit, e.g.
//                     "Sell 24250 CE / buy 24350 CE hedge"
//   dependsOnIndex  — optional 0-based index into this same levels array;
//                     this level is only checked once that one has been hit
//                     (e.g. a "flip to CE" level that depends on "Target 2"
//                     having been reached first) — mirrors the sequencing a
//                     real plan needs, not just a flat list of thresholds.
//
// This only ever watches the index level and alerts you — it never places,
// modifies, or closes a real order. No live option-premium feed exists, so
// there's no P&L calculated here, only spot-level tracking.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const { label, levels } = body;

    if (!label || !Array.isArray(levels) || levels.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'label and at least one level are required' }),
      };
    }
    for (const lvl of levels) {
      if (lvl.price == null || !['above', 'below'].includes(lvl.direction)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'each level needs a price and a direction of "above" or "below"' }),
        };
      }
      if (
        lvl.dependsOnIndex != null &&
        (!Number.isInteger(lvl.dependsOnIndex) || lvl.dependsOnIndex < 0 || lvl.dependsOnIndex >= levels.length)
      ) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'dependsOnIndex must point at another level in the same plan' }),
        };
      }
    }

    // Assign ids first, then resolve dependsOnIndex -> the actual sibling id.
    const withIds = levels.map((lvl, i) => ({
      id: `lvl_${i}_${Math.random().toString(36).slice(2, 6)}`,
      type: lvl.type || 'note',
      direction: lvl.direction,
      price: Number(lvl.price),
      note: lvl.note || '',
      dependsOnIndex: lvl.dependsOnIndex != null ? lvl.dependsOnIndex : null,
      status: 'pending', // pending | hit
      hitAt: null,
      hitPrice: null,
    }));
    const finalLevels = withIds.map((lvl) => ({
      ...lvl,
      dependsOn: lvl.dependsOnIndex != null ? withIds[lvl.dependsOnIndex].id : null,
      dependsOnIndex: undefined,
    }));

    const trades = await loadTrades();
    const trade = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label,
      levels: finalLevels,
      status: 'active', // active | closed
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    trades.push(trade);
    await saveTrades(trades);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, trade }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
