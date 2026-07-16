const { getHistoryStore } = require('./getHistoryStore');
const seed = require('../../../data/seed-history.json');

async function getFullHistory() {
  const store = getHistoryStore();
  const extra = (await store.get('extra-days', { type: 'json' })) || [];

  const map = new Map();
  for (const r of seed) map.set(r.d, { ...r, source: r.source || 'seed' });
  for (const r of extra) map.set(r.d, r);

  return Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
}

module.exports = { getFullHistory };
