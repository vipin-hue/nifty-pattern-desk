const { getStore } = require('@netlify/blobs');

// API endpoint to return top movers data to the frontend.
// Called by app.js every 30 mins to display gainers/losers with % moves.
// Returns { gainers: [...], losers: [...], fetchedAt: timestamp }
// or { error: '...' } if not available.

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

const handler = async function (req, res) {
  try {
    const store = getHistoryStore();
    let data = null;
    try {
      data = await store.get('topMovers', { type: 'json' });
    } catch (e) {
      // Blobs might not have the key yet, return empty gracefully
      console.log('topMovers not in Blobs yet');
    }
    
    if (!data) {
      res.status(200).json({ gainers: [], losers: [], fetchedAt: null, message: 'No movers data yet, check back after market opens' });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('api/get-top-movers: failed', err.message);
    res.status(200).json({ error: err.message, gainers: [], losers: [] });
  }
};

exports.handler = handler;
