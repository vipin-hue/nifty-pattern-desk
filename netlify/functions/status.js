const { getHistoryStore } = require('./_lib/getHistoryStore');

exports.handler = async function () {
  try {
    const store = getHistoryStore();
    const meta = (await store.get('meta', { type: 'json' })) || {};
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    };
  }
};
