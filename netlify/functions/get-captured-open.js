const { getCapturedOpen } = require('./_lib/settingsStore');

exports.handler = async function () {
  try {
    const rec = await getCapturedOpen();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captured: rec }), // null if nothing captured yet today
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
