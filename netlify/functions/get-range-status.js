const { getSettings, getRangeLog } = require('./_lib/settingsStore');
const { getFullHistory } = require('./_lib/getFullHistory');
const { computeATR, computeADR } = require('./_lib/volatility');

exports.handler = async function () {
  try {
    const settings = await getSettings();
    const log = await getRangeLog();
    const hist = await getFullHistory();
    const atr14 = computeATR(hist, 14);
    const adr20 = computeADR(hist, 20);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rangeAlertEnabled: !!settings.rangeAlertEnabled,
        atr14,
        adr20,
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
