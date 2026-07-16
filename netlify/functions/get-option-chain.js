const { fetchOptionChain } = require('./_lib/fetchOptionChain');

exports.handler = async function () {
  try {
    const summary = await fetchOptionChain('NIFTY');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ...summary }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
