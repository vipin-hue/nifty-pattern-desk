const { getStore } = require('@netlify/blobs');

// Netlify is supposed to auto-inject Blobs credentials into every function's
// environment. On some sites/deploys that auto-detection doesn't kick in,
// and getStore('name') alone throws "environment has not been configured".
// The documented fix is to pass siteID + token explicitly. We read those
// from environment variables you set in the Netlify dashboard
// (Project configuration → Environment variables):
//
//   BLOBS_SITE_ID   — Project configuration → General → Site details → Site ID
//   BLOBS_TOKEN     — a Personal Access Token: User settings (top-right avatar)
//                     → Applications → Personal access tokens → New access token
//
// If those two variables aren't set, we still try the automatic method first
// so this keeps working on sites where auto-detection does work fine.

function getHistoryStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({
      name: 'nifty-history',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });
  }
  return getStore('nifty-history');
}

module.exports = { getHistoryStore };
