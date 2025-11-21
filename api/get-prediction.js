const { connectToDatabase } = require('../utils/mongodb-connection');

/**
 * Fetch predictions from MongoDB
 * Used by frontend to display results
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { asset_class, limit = 10, offset = 0 } = req.query;

    const db = await connectToDatabase();

    // Build query
    const query = {};
    if (asset_class && ['crypto', 'forex'].includes(asset_class)) {
      query.asset_class = asset_class;
    }

    // Fetch predictions (newest first)
    const predictions = await db
      .collection('predictions')
      .find(query)
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Get total count
    const total = await db.collection('predictions').countDocuments(query);

    // Get metadata
    const metadata = await db
      .collection('metadata')
      .findOne({ key: 'last_prediction_time' });

    return res.status(200).json({
      success: true,
      total_count: total,
      returned_count: predictions.length,
      last_update: metadata?.value || null,
      data: predictions.map(p => ({
        id: p._id.toString(),
        timestamp: p.timestamp.toISOString(),
        symbol: p.symbol,
        asset_class: p.asset_class,
        prediction: p.prediction,
        class: p.class,
        confidence: p.confidence,
        probabilities: p.probabilities,
        models_used: p.models_used,
        inference_time_ms: p.inference_time_ms
      }))
    });

  } catch (error) {
    console.error('❌ Retrieval error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};