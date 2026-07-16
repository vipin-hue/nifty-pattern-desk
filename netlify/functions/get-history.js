const { getHistoryStore } = require('./_lib/getHistoryStore');
const seed = require('../../data/seed-history.json');

exports.handler = async function () {
  try {
    const store = getHistoryStore();
    const extra = (await store.get('extra-days', { type: 'json' })) || [];

    // Manual and auto entries override the seed only if the same date
    // appears in both (shouldn't normally happen since seed stops 15-Jul-26).
    const map = new Map();
    for (const r of seed) map.set(r.d, { ...r, source: r.source || 'seed' });
    for (const r of extra) map.set(r.d, r);

    const rows = Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
    const meta = (await store.get('meta', { type: 'json' })) || null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows,
        count: rows.length,
        lastDate: rows.length ? rows[rows.length - 1].d : null,
        meta,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
