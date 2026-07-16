const { getSettings, getVixLog } = require('./_lib/settingsStore');

exports.handler = async function () {
  try {
    const settings = await getSettings();
    const log = await getVixLog();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vixAlertEnabled: !!settings.vixAlertEnabled,
        log,
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
