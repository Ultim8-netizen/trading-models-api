/**
 * Store Predictions API - Save predictions to MongoDB
 * 
 * Enhanced with comprehensive diagnostics and logging
 * 
 * Features:
 * - Separate crypto and forex predictions
 * - Enhanced metadata tracking
 * - Feature engineering details
 * - Model performance metrics
 * - Request ID tracking
 * - Batch insertions
 * - Statistics aggregation
 * - Detailed diagnostic logging
 * - Step-by-step execution tracking
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
 * Validate prediction data with detailed logging
 */
function validatePredictionData(data) {
  const errors = [];

  console.log('[Validate] ═══════════════════════════════════════════════════');
  console.log('[Validate] Starting validation...');
  console.log('[Validate] Data received:', JSON.stringify(data, null, 2));

  // Required fields
  if (!data.asset_class) {
    errors.push('asset_class is required');
  } else if (!['crypto', 'forex'].includes(data.asset_class)) {
    errors.push('asset_class must be "crypto" or "forex"');
  } else {
    console.log('[Validate] ✓ asset_class valid:', data.asset_class);
  }

  if (!data.symbol && !data.pair) {
    errors.push('symbol (crypto) or pair (forex) is required');
  } else {
    console.log('[Validate] ✓ symbol/pair valid:', data.symbol || data.pair);
  }

  if (data.prediction === undefined || data.prediction === null) {
    errors.push('prediction is required (0, 1, or 2)');
  } else if (![0, 1, 2].includes(data.prediction)) {
    errors.push('prediction must be 0 (DOWN), 1 (NEUTRAL), or 2 (UP)');
  } else {
    console.log('[Validate] ✓ prediction valid:', data.prediction);
  }

  if (data.class === undefined) {
    errors.push('class is required (DOWN, NEUTRAL, or UP)');
  } else if (!['DOWN', 'NEUTRAL', 'UP'].includes(data.class)) {
    errors.push('class must be DOWN, NEUTRAL, or UP');
  } else {
    console.log('[Validate] ✓ class valid:', data.class);
  }

  // Optional but validated fields
  if (data.confidence !== undefined) {
    const conf = parseFloat(data.confidence);
    if (isNaN(conf) || conf < CONFIG.VALIDATION.MIN_CONFIDENCE || conf > CONFIG.VALIDATION.MAX_CONFIDENCE) {
      errors.push(`confidence must be between ${CONFIG.VALIDATION.MIN_CONFIDENCE} and ${CONFIG.VALIDATION.MAX_CONFIDENCE}`);
    } else {
      console.log('[Validate] ✓ confidence valid:', conf);
    }
  }

  if (data.models_used !== undefined) {
    const models = parseInt(data.models_used);
    if (isNaN(models) || models < CONFIG.VALIDATION.MIN_MODELS_USED || models > CONFIG.VALIDATION.MAX_MODELS_USED) {
      errors.push(`models_used must be between ${CONFIG.VALIDATION.MIN_MODELS_USED} and ${CONFIG.VALIDATION.MAX_MODELS_USED}`);
    } else {
      console.log('[Validate] ✓ models_used valid:', models);
    }
  }

  if (data.inference_time_ms !== undefined) {
    const time = parseInt(data.inference_time_ms);
    if (isNaN(time) || time < 0) {
      errors.push('inference_time_ms must be a non-negative number');
    } else {
      console.log('[Validate] ✓ inference_time_ms valid:', time);
    }
  }

  if (data.probabilities) {
    if (typeof data.probabilities !== 'object') {
      errors.push('probabilities must be an object');
    } else {
      console.log('[Validate] ✓ probabilities valid:', data.probabilities);
    }
  }

  console.log('[Validate] Validation result:', errors.length === 0 ? 'PASS ✓' : 'FAIL ❌');
  if (errors.length > 0) {
    console.error('[Validate] ❌ Validation errors found:', errors);
  }
  console.log('[Validate] ═══════════════════════════════════════════════════');

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// DOCUMENT BUILDERS
// ============================================================================

/**
 * Build prediction document for storage with detailed logging
 */
function buildPredictionDocument(data) {
  console.log('[Build] ═══════════════════════════════════════════════════');
  console.log('[Build] Building document...');
  console.log('[Build] Asset class:', data.asset_class);
  console.log('[Build] Symbol/Pair:', data.symbol || data.pair);
  
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
    console.log('[Build] ✓ Crypto document built');
    console.log('[Build]   - Symbol:', doc.symbol);
    console.log('[Build]   - Features count:', doc.features_count);
    console.log('[Build]   - Features balance:', doc.features_balance);
  } else if (data.asset_class === 'forex') {
    doc.pair = data.pair;
    doc.features_count = parseInt(data.features_count) || 0;
    console.log('[Build] ✓ Forex document built');
    console.log('[Build]   - Pair:', doc.pair);
    console.log('[Build]   - Features count:', doc.features_count);
  }

  const docSize = JSON.stringify(doc).length;
  console.log('[Build] Document size:', docSize, 'bytes');
  console.log('[Build] Document preview:', JSON.stringify(doc, null, 2).substring(0, 200) + '...');
  console.log('[Build] ═══════════════════════════════════════════════════');

  return doc;
}

// ============================================================================
// STATISTICS AGGREGATION
// ============================================================================

/**
 * Update statistics for asset class with logging
 */
async function updateStatistics(db, assetClass, predictionClass) {
  console.log('[Stats] Updating statistics...');
  console.log('[Stats] Asset class:', assetClass);
  console.log('[Stats] Prediction class:', predictionClass);

  const collectionName = assetClass === 'crypto'
    ? CONFIG.COLLECTIONS.crypto_stats
    : CONFIG.COLLECTIONS.forex_stats;

  console.log('[Stats] Target collection:', collectionName);

  const collection = db.collection(collectionName);
  const today = new Date().toISOString().split('T')[0];

  console.log('[Stats] Date:', today);

  // Update count and timestamps
  const result = await collection.updateOne(
    { type: 'daily_summary', date: today },
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

  console.log('[Stats] ✓ Statistics updated:', {
    matched: result.matchedCount,
    modified: result.modifiedCount,
    upserted: result.upsertedCount
  });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Main API handler with comprehensive diagnostics
 * POST /api/store-prediction
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('[Store] OPTIONS request received');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('[Store] ❌ Invalid method:', req.method);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  const startTime = Date.now();
  const requestId = req.body?.request_id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log('\n');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Store] NEW PREDICTION STORAGE REQUEST');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Store] Request ID:', requestId);
  console.log('[Store] Timestamp:', new Date().toISOString());
  console.log('[Store] Method:', req.method);
  console.log('[Store] Content-Type:', req.headers['content-type']);
  console.log('[Store] Body keys:', Object.keys(req.body).join(', '));
  console.log('[Store] Body size:', JSON.stringify(req.body).length, 'bytes');

  try {
    // Extract data
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 1: Extract data');
    const data = req.body;
    console.log('[Store] ✓ Data extracted successfully');

    // Validate
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 2: Validate data');
    const validation = validatePredictionData(data);
    
    if (!validation.valid) {
      console.error('[Store] ❌ Validation failed!');
      console.error('[Store] Errors:', validation.errors);
      console.error('[Store] Data:', JSON.stringify(data, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors,
        request_id: requestId
      });
    }
    console.log('[Store] ✓ Validation passed');

    // Connect to database
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 3: Connect to MongoDB');
    const dbStartTime = Date.now();
    const db = await connectToDatabase();
    const dbConnectTime = Date.now() - dbStartTime;
    console.log('[Store] ✓ MongoDB connected successfully');
    console.log('[Store] Connection time:', dbConnectTime + 'ms');

    // Build document
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 4: Build prediction document');
    const predictionDoc = buildPredictionDocument(data);
    console.log('[Store] ✓ Document built successfully');

    // Store in main predictions collection
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 5: Insert into MongoDB');
    console.log('[Store] Target collection:', CONFIG.COLLECTIONS.predictions);
    
    const insertStartTime = Date.now();
    const result = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .insertOne(predictionDoc);
    const insertTime = Date.now() - insertStartTime;

    if (!result.insertedId) {
      throw new Error('Failed to insert prediction document - no ID returned');
    }

    console.log('[Store] ✓ Document inserted successfully');
    console.log('[Store] Inserted ID:', result.insertedId.toString());
    console.log('[Store] Insert time:', insertTime + 'ms');
    console.log('[Store] Document details:');
    console.log('[Store]   - Asset:', data.asset_class);
    console.log('[Store]   - Symbol/Pair:', data.symbol || data.pair);
    console.log('[Store]   - Class:', data.class);
    console.log('[Store]   - Confidence:', data.confidence);

    // Update statistics (async, non-blocking)
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 6: Update statistics (async)');
    updateStatistics(db, data.asset_class, data.class).catch(err => {
      console.warn('[Store] ⚠ Statistics update failed:', err.message);
      console.warn('[Store] ⚠ Stack:', err.stack);
    });

    // Update metadata - last prediction time
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 7: Update metadata (last prediction time)');
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
    ).then(() => {
      console.log('[Store] ✓ Last prediction time updated');
    }).catch(err => {
      console.warn('[Store] ⚠ Metadata update failed:', err.message);
    });

    // Update metadata - prediction counts
    console.log('[Store] ─────────────────────────────────────────────────────────');
    console.log('[Store] STEP 8: Update metadata (prediction counts)');
    await db.collection(CONFIG.COLLECTIONS.metadata).updateOne(
      { key: `total_${data.asset_class}_predictions` },
      {
        $inc: { value: 1 },
        $set: { updated_at: new Date() }
      },
      { upsert: true }
    ).then(() => {
      console.log('[Store] ✓ Prediction count updated');
    }).catch(err => {
      console.warn('[Store] ⚠ Count update failed:', err.message);
    });

    const elapsed = Date.now() - startTime;

    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Store] ✓ STORAGE COMPLETE');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Store] Total time:', elapsed + 'ms');
    console.log('[Store] Breakdown:');
    console.log('[Store]   - DB Connect:', dbConnectTime + 'ms');
    console.log('[Store]   - Insert:', insertTime + 'ms');
    console.log('[Store]   - Other:', (elapsed - dbConnectTime - insertTime) + 'ms');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('\n');

    return res.status(200).json({
      success: true,
      id: result.insertedId.toString(),
      asset_class: data.asset_class,
      symbol: data.symbol || data.pair,
      class: data.class,
      timestamp: predictionDoc.timestamp.toISOString(),
      inserted_at: new Date().toISOString(),
      storage_time_ms: elapsed,
      request_id: requestId,
      performance: {
        db_connect_ms: dbConnectTime,
        insert_ms: insertTime,
        total_ms: elapsed
      },
      message: 'Prediction stored successfully'
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Store] ❌ STORAGE ERROR');
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Store] Request ID:', requestId);
    console.error('[Store] Error occurred after:', elapsed + 'ms');
    console.error('[Store] Error type:', error.constructor.name);
    console.error('[Store] Error message:', error.message);
    console.error('[Store] ─────────────────────────────────────────────────────────');
    console.error('[Store] Stack trace:');
    console.error(error.stack);
    console.error('[Store] ─────────────────────────────────────────────────────────');
    console.error('[Store] Request body:');
    console.error(JSON.stringify(req.body, null, 2));
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('\n');

    // Determine error type and status code
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Validation') || error.message.includes('validation')) {
      statusCode = 400;
      errorMessage = `Validation error: ${error.message}`;
    } else if (error.message.includes('database') || error.message.includes('MongoDB') || error.message.includes('connection')) {
      statusCode = 503;
      errorMessage = `Database error: ${error.message}`;
    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      statusCode = 504;
      errorMessage = `Timeout error: ${error.message}`;
    } else if (error.message.includes('ECONNREFUSED')) {
      statusCode = 503;
      errorMessage = `Connection refused: ${error.message}`;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      error_type: error.constructor.name,
      error_code: error.code || null,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString(),
      request_id: requestId
    });
  }
};
// ============================================================================
// BATCH STORAGE (OPTIONAL)
// ============================================================================

/**
 * Store multiple predictions at once with detailed logging
 * POST /api/store-predictions (plural)
 */
module.exports.batch = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('[Batch] OPTIONS request received');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('[Batch] ❌ Invalid method:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  const startTime = Date.now();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log('\n');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Batch] NEW BATCH STORAGE REQUEST');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Batch] Batch ID:', batchId);
  console.log('[Batch] Timestamp:', new Date().toISOString());

  try {
    const predictions = req.body.predictions || [];

    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 1: Validate batch request');
    console.log('[Batch] Predictions count:', predictions.length);

    if (!Array.isArray(predictions)) {
      console.error('[Batch] ❌ Predictions is not an array');
      return res.status(400).json({
        success: false,
        error: 'predictions must be an array',
        batch_id: batchId
      });
    }

    if (predictions.length === 0) {
      console.error('[Batch] ❌ No predictions provided');
      return res.status(400).json({
        success: false,
        error: 'At least one prediction is required',
        batch_id: batchId
      });
    }

    if (predictions.length > 100) {
      console.error('[Batch] ❌ Too many predictions:', predictions.length);
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 predictions per batch',
        received: predictions.length,
        batch_id: batchId
      });
    }

    console.log('[Batch] ✓ Batch size valid:', predictions.length);

    // Validate all predictions
    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 2: Validate all predictions');
    
    const validationStartTime = Date.now();
    const validationResults = predictions.map((p, idx) => {
      console.log(`[Batch] Validating prediction ${idx + 1}/${predictions.length}...`);
      return validatePredictionData(p);
    });
    const validationTime = Date.now() - validationStartTime;

    const invalid = validationResults
      .map((v, i) => ({ ...v, index: i }))
      .filter(v => !v.valid);

    if (invalid.length > 0) {
      console.error('[Batch] ❌ Validation failed for', invalid.length, 'predictions');
      console.error('[Batch] Failed indices:', invalid.map(v => v.index).join(', '));
      
      return res.status(400).json({
        success: false,
        error: `${invalid.length} predictions failed validation`,
        total_predictions: predictions.length,
        failed_count: invalid.length,
        details: invalid.map(v => ({
          index: v.index,
          errors: v.errors
        })),
        batch_id: batchId
      });
    }

    console.log('[Batch] ✓ All predictions valid');
    console.log('[Batch] Validation time:', validationTime + 'ms');

    // Build documents
    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 3: Build documents');
    
    const buildStartTime = Date.now();
    const documents = predictions.map((p, idx) => {
      console.log(`[Batch] Building document ${idx + 1}/${predictions.length}...`);
      return buildPredictionDocument(p);
    });
    const buildTime = Date.now() - buildStartTime;

    console.log('[Batch] ✓ All documents built');
    console.log('[Batch] Build time:', buildTime + 'ms');
    console.log('[Batch] Total document size:', JSON.stringify(documents).length, 'bytes');

    // Connect to database
    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 4: Connect to MongoDB');
    
    const dbStartTime = Date.now();
    const db = await connectToDatabase();
    const dbConnectTime = Date.now() - dbStartTime;

    console.log('[Batch] ✓ MongoDB connected');
    console.log('[Batch] Connection time:', dbConnectTime + 'ms');

    // Insert all documents
    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 5: Insert all documents');
    console.log('[Batch] Target collection:', CONFIG.COLLECTIONS.predictions);
    
    const insertStartTime = Date.now();
    const result = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .insertMany(documents, { ordered: false });
    const insertTime = Date.now() - insertStartTime;

    console.log('[Batch] ✓ Batch insert complete');
    console.log('[Batch] Inserted count:', Object.keys(result.insertedIds).length);
    console.log('[Batch] Insert time:', insertTime + 'ms');
    console.log('[Batch] Average time per document:', (insertTime / predictions.length).toFixed(2) + 'ms');

    // Update statistics for each prediction (async)
    console.log('[Batch] ─────────────────────────────────────────────────────────');
    console.log('[Batch] STEP 6: Update statistics (async)');
    
    predictions.forEach(p => {
      updateStatistics(db, p.asset_class, p.class).catch(err => {
        console.warn('[Batch] ⚠ Stats update failed for', p.asset_class, p.symbol || p.pair, ':', err.message);
      });
    });

    const elapsed = Date.now() - startTime;

    // Calculate distribution
    const distribution = {
      crypto: documents.filter(d => d.asset_class === 'crypto').length,
      forex: documents.filter(d => d.asset_class === 'forex').length,
      up: documents.filter(d => d.class === 'UP').length,
      neutral: documents.filter(d => d.class === 'NEUTRAL').length,
      down: documents.filter(d => d.class === 'DOWN').length
    };

    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Batch] ✓ BATCH STORAGE COMPLETE');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Batch] Total time:', elapsed + 'ms');
    console.log('[Batch] Breakdown:');
    console.log('[Batch]   - Validation:', validationTime + 'ms');
    console.log('[Batch]   - Build:', buildTime + 'ms');
    console.log('[Batch]   - DB Connect:', dbConnectTime + 'ms');
    console.log('[Batch]   - Insert:', insertTime + 'ms');
    console.log('[Batch] Distribution:');
    console.log('[Batch]   - Crypto:', distribution.crypto);
    console.log('[Batch]   - Forex:', distribution.forex);
    console.log('[Batch]   - UP:', distribution.up);
    console.log('[Batch]   - NEUTRAL:', distribution.neutral);
    console.log('[Batch]   - DOWN:', distribution.down);
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('\n');

    return res.status(200).json({
      success: true,
      batch_id: batchId,
      inserted_count: Object.keys(result.insertedIds).length,
      ids: Object.values(result.insertedIds).map(id => id.toString()),
      distribution,
      performance: {
        validation_ms: validationTime,
        build_ms: buildTime,
        db_connect_ms: dbConnectTime,
        insert_ms: insertTime,
        total_ms: elapsed,
        avg_per_document_ms: parseFloat((elapsed / predictions.length).toFixed(2))
      },
      storage_time_ms: elapsed,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Batch] ❌ BATCH STORAGE ERROR');
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Batch] Batch ID:', batchId);
    console.error('[Batch] Error occurred after:', elapsed + 'ms');
    console.error('[Batch] Error type:', error.constructor.name);
    console.error('[Batch] Error message:', error.message);
    console.error('[Batch] ─────────────────────────────────────────────────────────');
    console.error('[Batch] Stack trace:');
    console.error(error.stack);
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('\n');

    return res.status(500).json({
      success: false,
      error: error.message,
      error_type: error.constructor.name,
      batch_id: batchId,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString()
    });
  }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Health check endpoint with detailed diagnostics
 * GET /api/store-prediction?health=true
 */
module.exports.health = async (req, res) => {
  if (req.query.health !== 'true') {
    return res.status(404).end();
  }

  const startTime = Date.now();

  console.log('\n');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Health] HEALTH CHECK REQUEST');
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('[Health] Timestamp:', new Date().toISOString());

  try {
    // Connect to database
    console.log('[Health] ─────────────────────────────────────────────────────────');
    console.log('[Health] STEP 1: Connect to MongoDB');
    
    const dbStartTime = Date.now();
    const db = await connectToDatabase();
    const dbConnectTime = Date.now() - dbStartTime;

    console.log('[Health] ✓ MongoDB connected');
    console.log('[Health] Connection time:', dbConnectTime + 'ms');

    // Check collections exist
    console.log('[Health] ─────────────────────────────────────────────────────────');
    console.log('[Health] STEP 2: Check collections');
    
    const collections = await db.listCollections().toArray();
    console.log('[Health] Found', collections.length, 'collections');

    const collectionNames = collections.map(c => c.name);
    console.log('[Health] Collections:', collectionNames.join(', '));

    const hasPredictions = collectionNames.includes(CONFIG.COLLECTIONS.predictions);
    const hasCryptoStats = collectionNames.includes(CONFIG.COLLECTIONS.crypto_stats);
    const hasForexStats = collectionNames.includes(CONFIG.COLLECTIONS.forex_stats);
    const hasMetadata = collectionNames.includes(CONFIG.COLLECTIONS.metadata);

    console.log('[Health] Predictions collection:', hasPredictions ? '✓' : '❌');
    console.log('[Health] Crypto stats collection:', hasCryptoStats ? '✓' : '❌');
    console.log('[Health] Forex stats collection:', hasForexStats ? '✓' : '❌');
    console.log('[Health] Metadata collection:', hasMetadata ? '✓' : '❌');

    if (!hasPredictions) {
      console.error('[Health] ❌ Predictions collection not found!');
      
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Predictions collection not found',
        collections_found: collectionNames,
        timestamp: new Date().toISOString()
      });
    }

    // Get statistics
    console.log('[Health] ─────────────────────────────────────────────────────────');
    console.log('[Health] STEP 3: Gather statistics');

    const statsStartTime = Date.now();

    const predictionCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments();

    const cryptoCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments({ asset_class: 'crypto' });

    const forexCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments({ asset_class: 'forex' });

    const latestPrediction = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .findOne({}, { sort: { timestamp: -1 } });

    const oldestPrediction = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .findOne({}, { sort: { timestamp: 1 } });

    // Get class distribution
    const upCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments({ class: 'UP' });

    const neutralCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments({ class: 'NEUTRAL' });

    const downCount = await db
      .collection(CONFIG.COLLECTIONS.predictions)
      .countDocuments({ class: 'DOWN' });

    const statsTime = Date.now() - statsStartTime;

    console.log('[Health] ✓ Statistics gathered');
    console.log('[Health] Stats time:', statsTime + 'ms');
    console.log('[Health] Total predictions:', predictionCount);
    console.log('[Health] Crypto predictions:', cryptoCount);
    console.log('[Health] Forex predictions:', forexCount);
    console.log('[Health] UP predictions:', upCount);
    console.log('[Health] NEUTRAL predictions:', neutralCount);
    console.log('[Health] DOWN predictions:', downCount);

    const elapsed = Date.now() - startTime;

    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Health] ✓ HEALTH CHECK COMPLETE');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('[Health] Status: HEALTHY ✓');
    console.log('[Health] Total time:', elapsed + 'ms');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('\n');

    return res.status(200).json({
      status: 'healthy',
      service: 'store-prediction',
      database: {
        status: 'connected',
        connection_time_ms: dbConnectTime
      },
      collections: {
        predictions: hasPredictions,
        crypto_stats: hasCryptoStats,
        forex_stats: hasForexStats,
        metadata: hasMetadata
      },
      statistics: {
        total_predictions: predictionCount,
        crypto_predictions: cryptoCount,
        forex_predictions: forexCount,
        distribution: {
          up: upCount,
          neutral: neutralCount,
          down: downCount
        }
      },
      latest_prediction: latestPrediction ? {
        timestamp: latestPrediction.timestamp.toISOString(),
        asset_class: latestPrediction.asset_class,
        symbol: latestPrediction.symbol || latestPrediction.pair,
        class: latestPrediction.class
      } : null,
      oldest_prediction: oldestPrediction ? {
        timestamp: oldestPrediction.timestamp.toISOString()
      } : null,
      performance: {
        db_connect_ms: dbConnectTime,
        stats_gather_ms: statsTime,
        total_ms: elapsed
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Health] ❌ HEALTH CHECK FAILED');
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('[Health] Error after:', elapsed + 'ms');
    console.error('[Health] Error type:', error.constructor.name);
    console.error('[Health] Error message:', error.message);
    console.error('[Health] Stack trace:');
    console.error(error.stack);
    console.error('═════════════════════════════════════════════════════════════════');
    console.error('\n');

    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      error_type: error.constructor.name,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString()
    });
  }
};