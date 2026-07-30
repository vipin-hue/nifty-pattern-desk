const handler = async function (req, res) {
  try {
    // For now, just return empty movers data
    // The scheduled function will populate this when it runs
    res.status(200).json({ 
      gainers: [], 
      losers: [], 
      fetchedAt: null, 
      message: 'Market movers data will be available during market hours' 
    });
  } catch (err) {
    console.error('get-top-movers-api: error', err.message);
    res.status(200).json({ 
      gainers: [], 
      losers: [], 
      error: err.message 
    });
  }
};

exports.handler = handler;
