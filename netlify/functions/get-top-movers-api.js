// Simple API endpoint for market movers
// Returns gainers/losers data to the frontend

const handler = async (req, res) => {
  try {
    // For now, return empty data structure
    // Will be populated by scheduled function later
    res.status(200).json({
      gainers: [],
      losers: [],
      fetchedAt: null,
      message: 'Market movers will be available during market hours'
    });
  } catch (err) {
    res.status(200).json({
      gainers: [],
      losers: [],
      fetchedAt: null,
      error: err.message
    });
  }
};

exports.handler = handler;
