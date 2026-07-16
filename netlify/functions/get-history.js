const { getHistoryStore } = require('./_lib/getHistoryStore');
const { getFullHistory } = require('./_lib/getFullHistory');

exports.handler = async function () {
  try {
    const store = getHistoryStore();
    const rows = await getFullHistory();
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
