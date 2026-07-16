const { getHistoryStore } = require('./getHistoryStore');

async function getSettings() {
  const store = getHistoryStore();
  return (await store.get('settings', { type: 'json' })) || { rangeAlertEnabled: false, vixAlertEnabled: false };
}

async function saveSettings(settings) {
  const store = getHistoryStore();
  await store.setJSON('settings', settings);
}

function todayIST() {
  // IST = UTC+5:30. Good enough for "which trading day is this" bucketing.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

async function getRangeLog() {
  const store = getHistoryStore();
  const log = await store.get('rangeAlertLog', { type: 'json' });
  const today = todayIST();
  if (!log || log.date !== today) {
    return { date: today, firedThresholds: [], events: [] };
  }
  return log;
}

async function saveRangeLog(log) {
  const store = getHistoryStore();
  await store.setJSON('rangeAlertLog', log);
}

async function getVixLog() {
  const store = getHistoryStore();
  const log = await store.get('vixLog', { type: 'json' });
  const today = todayIST();
  if (!log || log.date !== today) {
    return { date: today, openVix: null, readings: [], firedThresholds: [], events: [] };
  }
  return log;
}

async function saveVixLog(log) {
  const store = getHistoryStore();
  await store.setJSON('vixLog', log);
}

async function getCapturedOpen() {
  const store = getHistoryStore();
  const rec = await store.get('capturedOpen', { type: 'json' });
  if (!rec || rec.date !== todayIST()) return null; // stale from a prior day
  return rec;
}

async function saveCapturedOpen(rec) {
  const store = getHistoryStore();
  await store.setJSON('capturedOpen', rec);
}

module.exports = {
  getSettings, saveSettings,
  getRangeLog, saveRangeLog,
  getVixLog, saveVixLog,
  getCapturedOpen, saveCapturedOpen,
  todayIST,
};

