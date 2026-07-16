const { getSettings, saveSettings } = require('./_lib/settingsStore');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const settings = await getSettings();
    if (typeof body.vixAlertEnabled === 'boolean') {
      settings.vixAlertEnabled = body.vixAlertEnabled;
    }
    await saveSettings(settings);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, settings }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

