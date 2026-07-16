const { loadTrades, saveTrades } = require('./_lib/tradeStore');

// Body: { id, action, levelId? }
//   action "close"            — stop watching the whole trade
//   action "ack-level"        — mark one hit level as seen (needs levelId)
//   action "reopen-level"     — put a hit level back to pending (rare, for corrections)

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const { id, action, levelId } = body;
    if (!id || !['close', 'ack-level', 'reopen-level'].includes(action)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'id and a valid action are required' }),
      };
    }

    const trades = await loadTrades();
    const trade = trades.find((t) => t.id === id);
    if (!trade) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'trade not found' }) };
    }

    if (action === 'close') {
      trade.status = 'closed';
      trade.closedAt = new Date().toISOString();
    } else {
      const lvl = (trade.levels || []).find((l) => l.id === levelId);
      if (!lvl) {
        return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'level not found' }) };
      }
      if (action === 'ack-level') lvl.acknowledged = true;
      if (action === 'reopen-level') {
        lvl.status = 'pending';
        lvl.hitAt = null;
        lvl.hitPrice = null;
        lvl.acknowledged = false;
      }
    }

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
