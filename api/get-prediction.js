/**get-predictions.js */
/**
 * Get Predictions API - Fetch predictions from MongoDB
 * 
 * Updated to support:
 * - Separate crypto and forex predictions
 * - Enhanced filtering and sorting
 * - Feature balance info for crypto
 * - Storage status tracking
 * - Request ID tracking
 * - Performance metrics
 */

const { connectToDatabase } = require('../utils/mongodb-connection');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  COLLECTIONS: {
    predictions: 'predictions',
    crypto_predictions: 'crypto_predictions',
    forex_predictions: 'forex_predictions',
    metadata: 'metadata'
  }
};

// ============================================================================
// FILTERS & QUERY BUILDERS
// ============================================================================

/**
 * Build MongoDB query from parameters
 */
function buildQuery(params) {
  const query = {};

  // Asset class filter
  if (params.asset_class) {
    if (!['crypto', 'forex'].includes(params.asset_class)) {
      throw new Error('Invalid asset_class. Must be "crypto" or "forex"');
    }
    query.asset_class = params.asset_class;
  }

  // Symbol/Pair filter
  if (params.symbol) {
    query.symbol = params.symbol;
  } else if (params.pair) {
    query.pair = params.pair;
  }

  // Prediction class filter
  if (params.class) {
    const validClasses = ['DOWN', 'NEUTRAL', 'UP'];
    if (!validClasses.includes(params.class.toUpperCase())) {
      throw new Error('Invalid class. Must be DOWN, NEUTRAL, or UP');
    }
    query.class = params.class.toUpperCase();
  }

  // Confidence threshold
  if (params.min_confidence) {
    const minConf = parseFloat(params.min_confidence);
    if (isNaN(minConf) || minConf < 0 || minConf > 1) {
      throw new Error('min_confidence must be between 0 and 1');
    }
    query.confidence = { $gte: minConf };
  }

  // Date range
  if (params.since) {
    try {
      const sinceDate = new Date(params.since);
      if (query.timestamp) {
        query.timestamp.$gte = sinceDate;
      } else {
        query.timestamp = { $gte: sinceDate };
      }
    } catch (e) {
      throw new Error('Invalid since date format');
    }
  }

  if (params.until) {
    try {
      const untilDate = new Date(params.until);
      if (query.timestamp) {
        query.timestamp.$lte = untilDate;
      } else {
        query.timestamp = { $lte: untilDate };
      }
    } catch (e) {
      throw new Error('Invalid until date format');
    }
  }

  // Storage status
  if (params.stored) {
    const stored = params.stored === 'true';
    query.stored = stored;
  }

  return query;
}

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

/**
 * Format crypto prediction for response
 */
function formatCryptoPrediction(doc) {
  return {
    id: doc._id.toString(),
    timestamp: doc.timestamp ? doc.timestamp.toISOString() : null,
    asset_class: 'crypto',
    symbol: doc.symbol,
    prediction: doc.prediction,
    class: doc.class,
    confidence: (doc.confidence || 0).toFixed(4),
    probabilities: {
      down: (doc.probabilities?.down || 0).toFixed(4),
      neutral: (doc.probabilities?.neutral || 0).toFixed(4),
      up: (doc.probabilities?.up || 0).toFixed(4)
    },
    models: {
      used: doc.models_used || 0,
      failed: doc.models_failed || 0,
      total: (doc.models_used || 0) + (doc.models_failed || 0)
    },
    features: {
      total: doc.features_count || 0,
      bullish: doc.features_balance?.bullish || 0,
      bearish: doc.features_balance?.bearish || 0,
      balanced: doc.features_balance?.is_balanced || false
    },
    performance: {
      inference_time_ms: doc.inference_time_ms || 0,
      stored: doc.stored !== false,
      storage_id: doc.storage_id || null
    },
    request_id: doc.request_id || null
  };
}

/**
 * Format forex prediction for response
 */
function formatForexPrediction(doc) {
  return {
    id: doc._id.toString(),
    timestamp: doc.timestamp ? doc.timestamp.toISOString() : null,
    asset_class: 'forex',
    pair: doc.pair,
    prediction: doc.prediction,
    class: doc.class,
    confidence: (doc.confidence || 0).toFixed(4),
    probabilities: {
      down: (doc.probabilities?.down || 0).toFixed(4),
      neutral: (doc.probabilities?.neutral || 0).toFixed(4),
      up: (doc.probabilities?.up || 0).toFixed(4)
    },
    models: {
      used: doc.models_used || 0,
      failed: doc.models_failed || 0,
      total: (doc.models_used || 0) + (doc.models_failed || 0)
    },
    features: {
      total: doc.features_count || 0,
      type: 'conservative',
      validated: true
    },
    performance: {
      inference_time_ms: doc.inference_time_ms || 0,
      stored: doc.stored !== false,
      storage_id: doc.storage_id || null
    },
    request_id: doc.request_id || null
  };
}

/**
 * Format generic prediction
 */
function formatPrediction(doc) {
  if (doc.asset_class === 'crypto') {
    return formatCryptoPrediction(doc);
  } else if (doc.asset_class === 'forex') {
    return formatForexPrediction(doc);
  }

  // Fallback
  return {
    id: doc._id.toString(),
    timestamp: doc.timestamp ? doc.timestamp.toISOString() : null,
    asset_class: doc.asset_class,
    symbol: doc.symbol || doc.pair,
    prediction: doc.prediction,
    class: doc.class,
    confidence: (doc.confidence || 0).toFixed(4),
    probabilities: doc.probabilities,
    models_used: doc.models_used || 0,
    inference_time_ms: doc.inference_time_ms || 0
  };
}

// ============================================================================
// STATISTICS CALCULATION
// ============================================================================

/**
 * Calculate statistics from predictions
 */
async function calculateStats(db, query) {
  try {
    const collection = db.collection(CONFIG.COLLECTIONS.predictions);

    // Count by prediction class
    const classCounts = await collection
      .aggregate([
        { $match: query },
        {
          $group: {
            _id: '$class',
            count: { $sum: 1 }
          }
        }
      ])
      .toArray();

    const stats = {
      total: 0,
      down: 0,
      neutral: 0,
      up: 0
    };

    classCounts.forEach(item => {
      stats[item._id.toLowerCase()] = item.count;
      stats.total += item.count;
    });

    // Average confidence
    const confidenceStats = await collection
      .aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            avg_confidence: { $avg: '$confidence' },
            max_confidence: { $max: '$confidence' },
            min_confidence: { $min: '$confidence' }
          }
        }
      ])
      .toArray();

    const confidence = confidenceStats[0] || {
      avg_confidence: 0,
      max_confidence: 0,
      min_confidence: 0
    };

    // Average models used
    const modelStats = await collection
      .aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            avg_models: { $avg: '$models_used' },
            avg_inference_time: { $avg: '$inference_time_ms' }
          }
        }
      ])
      .toArray();

    const models = modelStats[0] || {
      avg_models: 0,
      avg_inference_time: 0
    };

    return {
      distribution: {
        down: stats.down,
        neutral: stats.neutral,
        up: stats.up,
        total: stats.total
      },
      confidence: {
        average: (confidence.avg_confidence || 0).toFixed(4),
        max: (confidence.max_confidence || 0).toFixed(4),
        min: (confidence.min_confidence || 0).toFixed(4)
      },
      performance: {
        avg_models_used: (models.avg_models || 0).toFixed(1),
        avg_inference_time_ms: (models.avg_inference_time || 0).toFixed(1)
      }
    };
  } catch (error) {
    console.warn('Stats calculation error:', error.message);
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Main API handler
 * GET /api/get-predictions
 * 
 * Query parameters:
 * - asset_class: 'crypto' or 'forex' (optional)
 * - symbol: 'BTC/USDT' or similar (optional, crypto only)
 * - pair: 'EURUSD' or similar (optional, forex only)
 * - class: 'UP', 'DOWN', 'NEUTRAL' (optional)
 * - min_confidence: 0.0-1.0 (optional)
 * - since: ISO date string (optional)
 * - until: ISO date string (optional)
 * - stored: 'true' or 'false' (optional)
 * - limit: 1-100 (default 10)
 * - offset: 0+ (default 0)
 * - include_stats: 'true' or 'false' (default false)
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
    });
  }

  const startTime = Date.now();

  try {
    // Parse parameters
    const {
      asset_class,
      symbol,
      pair,
      class: predClass,
      min_confidence,
      since,
      until,
      stored,
      limit = CONFIG.DEFAULT_LIMIT,
      offset = 0,
      include_stats = 'false',
      sort = '-timestamp'
    } = req.query;

    // Validate limits
    const parsedLimit = Math.min(parseInt(limit) || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);

    if (parsedLimit < 1 || parsedLimit > CONFIG.MAX_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `limit must be between 1 and ${CONFIG.MAX_LIMIT}`
      });
    }

    // Build query
    const query = buildQuery({
      asset_class,
      symbol,
      pair,
      class: predClass,
      min_confidence,
      since,
      until,
      stored
    });

    const db = await connectToDatabase();
    const collection = db.collection(CONFIG.COLLECTIONS.predictions);

    // Build sort
    const sortObj = {};
    if (sort === '-timestamp' || sort === 'timestamp') {
      sortObj.timestamp = sort === '-timestamp' ? -1 : 1;
    } else if (sort === '-confidence' || sort === 'confidence') {
      sortObj.confidence = sort === '-confidence' ? -1 : 1;
    } else if (sort === '-inference_time' || sort === 'inference_time') {
      sortObj.inference_time_ms = sort === '-inference_time' ? -1 : 1;
    } else {
      sortObj.timestamp = -1; // Default
    }

    // Fetch predictions
    const predictions = await collection
      .find(query)
      .sort(sortObj)
      .skip(parsedOffset)
      .limit(parsedLimit)
      .toArray();

    // Get total count
    const total = await collection.countDocuments(query);

    // Calculate stats if requested
    let stats = null;
    if (include_stats === 'true') {
      stats = await calculateStats(db, query);
    }

    // Format response
    const formattedData = predictions.map(formatPrediction);

    const elapsed = Date.now() - startTime;

    console.log(
      `✓ Retrieved ${predictions.length}/${total} predictions (${elapsed}ms)`
    );

    return res.status(200).json({
      success: true,
      pagination: {
        total_count: total,
        returned_count: predictions.length,
        limit: parsedLimit,
        offset: parsedOffset,
        has_more: parsedOffset + parsedLimit < total
      },
      filters_applied: {
        asset_class: asset_class || null,
        symbol: symbol || null,
        pair: pair || null,
        class: predClass || null,
        min_confidence: min_confidence || null,
        date_range: {
          since: since || null,
          until: until || null
        },
        stored: stored || null
      },
      data: formattedData,
      stats: stats,
      metadata: {
        query_time_ms: elapsed,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Retrieval error:', error.message);

    // Determine error type
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Invalid') || error.message.includes('Must be')) {
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Health check endpoint
 * GET /api/get-predictions?health=true
 */
module.exports.health = async (req, res) => {
  if (req.query.health !== 'true') {
    return res.status(404).end();
  }

  try {
    const db = await connectToDatabase();

    // Check collection exists
    const collections = await db.listCollections().toArray();
    const hasCollection = collections.some(
      c => c.name === CONFIG.COLLECTIONS.predictions
    );

    if (!hasCollection) {
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Predictions collection not found',
        timestamp: new Date().toISOString()
      });
    }

    // Count documents
    const count = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments();

    return res.status(200).json({
      status: 'healthy',
      service: 'get-predictions',
      database: 'connected',
      collection: CONFIG.COLLECTIONS.predictions,
      document_count: count,
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