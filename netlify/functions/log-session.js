const { getHistoryStore } = require('./_lib/getHistoryStore');
const { deriveFields } = require('./_lib/deriveFields');
const seed = require('../../data/seed-history.json');

// This is the reliable path: you type in the day's actual O/H/L/C (from your
// broker terminal or NSE's own site) and it's saved permanently. Treat the
// scheduled auto-update as a bonus, not the source of truth.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const { d, o, h, l, c, pc } = body;

    if (!d || o == null || h == null || l == null || c == null) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'date (d), open (o), high (h), low (l) and close (c) are required' }),
      };
    }

    const store = getHistoryStore();
    const existing = (await store.get('extra-days', { type: 'json' })) || [];

    // work out previous close if not supplied: most recent day before d
    let prevClose = pc;
    if (prevClose == null) {
      const all = [...seed, ...existing].filter((r) => r.d < d).sort((a, b) => a.d.localeCompare(b.d));
      prevClose = all.length ? all[all.length - 1].c : null;
    }

    const record = deriveFields({ d, o, h, l, c }, prevClose, 'manual');
    const filtered = existing.filter((r) => r.d !== d);
    filtered.push(record);
    filtered.sort((a, b) => a.d.localeCompare(b.d));

    await store.setJSON('extra-days', filtered);
    await store.setJSON('meta', {
      lastUpdated: new Date().toISOString(),
      lastDate: filtered[filtered.length - 1].d,
      source: 'manual',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, record }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
