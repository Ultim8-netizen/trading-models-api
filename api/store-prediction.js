const { connectToDatabase } = require('../utils/mongodb-connection');

/**
 * Store prediction result in MongoDB
 * Called by predict.js after getting model prediction
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      symbol, 
      asset_class, 
      prediction, 
      class: predictionClass,
      confidence, 
      probabilities, 
      models_used, 
      inference_time_ms 
    } = req.body;

    // Validate required fields
    if (!symbol || !asset_class || prediction === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: symbol, asset_class, prediction' 
      });
    }

    // Connect to MongoDB
    const db = await connectToDatabase();

    // Create prediction document
    const predictionDoc = {
      timestamp: new Date(),
      asset_class,
      symbol,
      prediction,
      class: predictionClass || ['DOWN', 'NEUTRAL', 'UP'][prediction],
      confidence: parseFloat(confidence) || 0,
      probabilities: probabilities || {},
      models_used: parseInt(models_used) || 0,
      inference_time_ms: parseInt(inference_time_ms) || 0
    };

    // Store in predictions collection
    const result = await db.collection('predictions').insertOne(predictionDoc);

    console.log(`✓ Stored prediction: ${symbol} (ID: ${result.insertedId})`);

    // Update metadata (last prediction time)
    await db.collection('metadata').updateOne(
      { key: 'last_prediction_time' },
      { $set: { value: predictionDoc.timestamp.toISOString(), updated_at: new Date() } },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      prediction_id: result.insertedId,
      timestamp: predictionDoc.timestamp,
      message: 'Prediction stored successfully'
    });

  } catch (error) {
    console.error('❌ Storage error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};