const { getHistoryStore } = require('./getHistoryStore');

async function loadTrades() {
  const store = getHistoryStore();
  return (await store.get('trades', { type: 'json' })) || [];
}

async function saveTrades(trades) {
  const store = getHistoryStore();
  await store.setJSON('trades', trades);
}

module.exports = { loadTrades, saveTrades };
