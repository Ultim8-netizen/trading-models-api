/**
 * Store Predictions API - Save predictions to MongoDB
 * 
 * Updated to handle:
 * - Separate crypto and forex predictions
 * - Enhanced metadata tracking
 * - Feature engineering details
 * - Model performance metrics
 * - Request ID tracking
 * - Batch insertions
 * - Statistics aggregation
 * 
 * Called by:
 * - predict-crypto.js
 * - predict-forex.js
 */

const { connectToDatabase } = require('../utils/mongodb-connection');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  COLLECTIONS: {
    predictions: 'predictions',
    crypto_stats: 'crypto_stats',
    forex_stats: 'forex_stats',
    metadata: 'metadata'
  },
  VALIDATION: {
    MIN_CONFIDENCE: 0,
    MAX_CONFIDENCE: 1,
    MIN_MODELS_USED: 1,
    MAX_MODELS_USED: 10
  }
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate prediction data
 */
function validatePredictionData(data) {
  const errors = [];

  // Required fields
  if (!data.asset_class) {
    errors.push('asset_class is required');
  } else if (!['crypto', 'forex'].includes(data.asset_class)) {
    errors.push('asset_class must be "crypto" or "forex"');
  }

  if (!data.symbol && !data.pair) {
    errors.push('symbol (crypto) or pair (forex) is required');
  }

  if (data.prediction === undefined || data.prediction === null) {
    errors.push('prediction is required (0, 1, or 2)');
  } else if (![0, 1, 2].includes(data.prediction)) {
    errors.push('prediction must be 0 (DOWN), 1 (NEUTRAL), or 2 (UP)');
  }

  if (data.class === undefined) {
    errors.push('class is required (DOWN, NEUTRAL, or UP)');
  } else if (!['DOWN', 'NEUTRAL', 'UP'].includes(data.class)) {
    errors.push('class must be DOWN, NEUTRAL, or UP');
  }

  // Optional but validated fields
  if (data.confidence !== undefined) {
    const conf = parseFloat(data.confidence);
    if (isNaN(conf) || conf < CONFIG.VALIDATION.MIN_CONFIDENCE || conf > CONFIG.VALIDATION.MAX_CONFIDENCE) {
      errors.push(`confidence must be between ${CONFIG.VALIDATION.MIN_CONFIDENCE} and ${CONFIG.VALIDATION.MAX_CONFIDENCE}`);
    }
  }

  if (data.models_used !== undefined) {
    const models = parseInt(data.models_used);
    if (isNaN(models) || models < CONFIG.VALIDATION.MIN_MODELS_USED || models > CONFIG.VALIDATION.MAX_MODELS_USED) {
      errors.push(`models_used must be between ${CONFIG.VALIDATION.MIN_MODELS_USED} and ${CONFIG.VALIDATION.MAX_MODELS_USED}`);
    }
  }

  if (data.inference_time_ms !== undefined) {
    const time = parseInt(data.inference_time_ms);
    if (isNaN(time) || time < 0) {
      errors.push('inference_time_ms must be a non-negative number');
    }
  }

  if (data.probabilities) {
    if (typeof data.probabilities !== 'object') {
      errors.push('probabilities must be an object');
    } else if (!data.probabilities.down !== undefined && !data.probabilities.neutral !== undefined && !data.probabilities.up !== undefined) {
      // At least some probabilities should be defined
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// DOCUMENT BUILDERS
// ============================================================================

/**
 * Build prediction document for storage
 */
function buildPredictionDocument(data) {
  const timestamp = new Date();

  const doc = {
    timestamp,
    asset_class: data.asset_class,
    prediction: data.prediction,
    class: data.class,
    confidence: parseFloat(data.confidence) || 0,
    probabilities: data.probabilities || {
      down: 0,
      neutral: 0,
      up: 0
    },
    models_used: parseInt(data.models_used) || 0,
    models_failed: parseInt(data.models_failed) || 0,
    inference_time_ms: parseInt(data.inference_time_ms) || 0,
    stored: data.stored !== false,
    storage_id: data.storage_id || null,
    request_id: data.request_id || null
  };

  // Asset class specific fields
  if (data.asset_class === 'crypto') {
    doc.symbol = data.symbol;
    doc.features_count = parseInt(data.features_count) || 0;
    doc.features_balance = data.features_balance || {
      bullish: 0,
      bearish: 0,
      is_balanced: false
    };
  } else if (data.asset_class === 'forex') {
    doc.pair = data.pair;
    doc.features_count = parseInt(data.features_count) || 0;
  }

  return doc;
}

// ============================================================================
// STATISTICS AGGREGATION
// ============================================================================

/**
 * Update statistics for asset class
 */
async function updateStatistics(db, assetClass, predictionClass) {
  const collectionName = assetClass === 'crypto'
    ? CONFIG.COLLECTIONS.crypto_stats
    : CONFIG.COLLECTIONS.forex_stats;

  const collection = db.collection(collectionName);

  // Update count and timestamps
  await collection.updateOne(
    { type: 'daily_summary', date: new Date().toISOString().split('T')[0] },
    {
      $inc: {
        total: 1,
        [predictionClass.toLowerCase()]: 1
      },
      $set: {
        last_updated: new Date()
      }
    },
    { upsert: true }
  );
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Main API handler
 * POST /api/store-prediction
 * 
 * Request body (Crypto):
 * {
 *   "asset_class": "crypto",
 *   "symbol": "BTC/USDT",
 *   "prediction": 2,
 *   "class": "UP",
 *   "confidence": 0.87,
 *   "probabilities": { "down": 0.05, "neutral": 0.08, "up": 0.87 },
 *   "models_used": 5,
 *   "models_failed": 0,
 *   "inference_time_ms": 234,
 *   "stored": true,
 *   "storage_id": "mongodb_doc_id",
 *   "request_id": "1234567890-abc123def",
 *   "features_count": 45,
 *   "features_balance": { "bullish": 15, "bearish": 15, "is_balanced": true }
 * }
 * 
 * Request body (Forex):
 * {
 *   "asset_class": "forex",
 *   "pair": "EURUSD",
 *   "prediction": 1,
 *   "class": "NEUTRAL",
 *   "confidence": 0.52,
 *   "probabilities": { "down": 0.28, "neutral": 0.52, "up": 0.20 },
 *   "models_used": 4,
 *   "models_failed": 0,
 *   "inference_time_ms": 189,
 *   "stored": true,
 *   "storage_id": "mongodb_doc_id",
 *   "request_id": "1234567890-xyz789ijk",
 *   "features_count": 40
 * }
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  const startTime = Date.now();

  try {
    // Extract data
    const data = req.body;

    // Validate
    const validation = validatePredictionData(data);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors
      });
    }

    // Connect to database
    const db = await connectToDatabase();

    // Build document
    const predictionDoc = buildPredictionDocument(data);

    // Store in main predictions collection
    const result = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .insertOne(predictionDoc);

    if (!result.insertedId) {
      throw new Error('Failed to insert prediction document');
    }

    console.log(`✓ Stored ${data.asset_class} prediction: ${data.symbol || data.pair} (ID: ${result.insertedId})`);

    // Update statistics (async, non-blocking)
    updateStatistics(db, data.asset_class, data.class).catch(err => {
      console.warn(`Warning: Statistics update failed: ${err.message}`);
    });

    // Update metadata - last prediction time
    await db.collection(CONFIG.COLLECTIONS.metadata).updateOne(
      { key: 'last_prediction_time' },
      {
        $set: {
          value: predictionDoc.timestamp.toISOString(),
          updated_at: new Date(),
          asset_class: data.asset_class,
          symbol: data.symbol || data.pair
        }
      },
      { upsert: true }
    ).catch(err => {
      console.warn(`Warning: Metadata update failed: ${err.message}`);
    });

    // Update metadata - prediction counts
    await db.collection(CONFIG.COLLECTIONS.metadata).updateOne(
      { key: `total_${data.asset_class}_predictions` },
      {
        $inc: { value: 1 },
        $set: { updated_at: new Date() }
      },
      { upsert: true }
    ).catch(err => {
      console.warn(`Warning: Count update failed: ${err.message}`);
    });

    const elapsed = Date.now() - startTime;

    console.log(`✓ Storage complete (${elapsed}ms)`);

    return res.status(200).json({
      success: true,
      id: result.insertedId.toString(),
      asset_class: data.asset_class,
      symbol: data.symbol || data.pair,
      class: data.class,
      timestamp: predictionDoc.timestamp.toISOString(),
      inserted_at: new Date().toISOString(),
      storage_time_ms: elapsed,
      message: 'Prediction stored successfully'
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error(`❌ Storage error (${elapsed}ms): ${error.message}`);

    // Determine error type
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Validation')) {
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      error_type: error.constructor.name,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString()
    });
  }
};

// ============================================================================
// BATCH STORAGE (OPTIONAL)
// ============================================================================

/**
 * Store multiple predictions at once
 * POST /api/store-predictions (plural)
 */
module.exports.batch = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const predictions = req.body.predictions || [];

    if (!Array.isArray(predictions)) {
      return res.status(400).json({
        success: false,
        error: 'predictions must be an array'
      });
    }

    if (predictions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one prediction is required'
      });
    }

    if (predictions.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 predictions per batch'
      });
    }

    // Validate all
    const validationResults = predictions.map(p => validatePredictionData(p));
    const invalid = validationResults.filter(v => !v.valid);

    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${invalid.length} predictions failed validation`,
        details: invalid.map((v, i) => ({
          index: i,
          errors: v.errors
        }))
      });
    }

    // Build documents
    const documents = predictions.map(buildPredictionDocument);

    // Insert all
    const db = await connectToDatabase();
    const result = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .insertMany(documents);

    console.log(`✓ Batch stored: ${result.insertedIds.length} predictions`);

    const elapsed = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      inserted_count: result.insertedIds.length,
      ids: result.insertedIds.map(id => id.toString()),
      storage_time_ms: elapsed,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error(`❌ Batch storage error: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: error.message,
      elapsed_ms: elapsed
    });
  }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Health check endpoint
 * GET /api/store-prediction?health=true
 */
module.exports.health = async (req, res) => {
  if (req.query.health !== 'true') {
    return res.status(404).end();
  }

  try {
    const db = await connectToDatabase();

    // Check collection exists
    const collections = await db.listCollections().toArray();
    const hasPredictions = collections.some(
      c => c.name === CONFIG.COLLECTIONS.predictions
    );

    if (!hasPredictions) {
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Predictions collection not found',
        timestamp: new Date().toISOString()
      });
    }

    // Get stats
    const predictionCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments();

    const latestPrediction = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .findOne({}, { sort: { timestamp: -1 } });

    return res.status(200).json({
      status: 'healthy',
      service: 'store-prediction',
      database: 'connected',
      collection: CONFIG.COLLECTIONS.predictions,
      total_predictions: predictionCount,
      latest_prediction_time: latestPrediction
        ? latestPrediction.timestamp.toISOString()
        : null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};