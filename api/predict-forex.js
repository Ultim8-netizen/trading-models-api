/**predict-forex.js */
/**
 * Forex Prediction Endpoint - Main Handler
 * 
 * Vercel Serverless Function
 * POST /api/predict-forex
 * 
 * REQUEST:
 * {
 *   "pair": "EURUSD",
 *   "data": {
 *     "1h_open": [...],
 *     "1h_high": [...],
 *     "1h_low": [...],
 *     "1h_close": [...],
 *     "1h_volume": [...],
 *     "4h_open": [...],
 *     "4h_close": [...],
 *     "1d_close": [...]
 *   }
 * }
 * 
 * RESPONSE:
 * {
 *   "success": true,
 *   "pair": "EURUSD",
 *   "prediction": 1,
 *   "class": "NEUTRAL",
 *   "confidence": 0.52,
 *   "probabilities": {
 *     "down": 0.28,
 *     "neutral": 0.52,
 *     "up": 0.20
 *   },
 *   "models_used": 4,
 *   "inference_time_ms": 189,
 *   "timestamp": "2024-01-15T10:30:00Z",
 *   "stored": true
 * }
 */

const {
  forexModelCache,
  CONFIG,
  engineForexFeatures,
  extractForexFeatureVector,
  runForexEnsemblePredictions,
  ensembleForexPredictions,
  storeForexPrediction
} = require('./predict-forex-handler');

// ============================================================================
// REQUEST HANDLER
// ============================================================================

module.exports = async (req, res) => {
  // CORS
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
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[${requestId}] FOREX PREDICTION REQUEST`);
  console.log(`${'='.repeat(70)}`);
  
  try {
    // ====== STEP 1: VALIDATE INPUT ======
    const { pair, data } = req.body;
    
    if (!pair || !data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: pair, data',
        example: {
          pair: 'EURUSD',
          data: '{ 1h_open, 1h_high, 1h_low, 1h_close, 1h_volume, 4h_*, 1d_* }'
        }
      });
    }
    
    console.log(`[${requestId}] Pair: ${pair}`);
    console.log(`[${requestId}] Data points: ${data['1h_close']?.length || 0}`);
    
    // ====== STEP 2: ENGINE FEATURES ======
    const featureResult = engineForexFeatures(data, pair);
    
    if (!featureResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Feature engineering failed',
        details: featureResult.error
      });
    }
    
    const featureVector = extractForexFeatureVector(
      featureResult.engineeredData,
      featureResult.featureList
    );
    
    console.log(`[${requestId}] Features: ${featureVector.length} extracted`);
    
    // ====== STEP 3: LOAD MODELS ======
    console.log(`[${requestId}] Loading models...`);
    
    let models = [];
    try {
      models = await forexModelCache.loadAllModels();
    } catch (error) {
      console.error(`[${requestId}] Model loading failed: ${error.message}`);
    }
    
    if (models.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'No models available',
        details: 'Could not load any prediction models'
      });
    }
    
    if (models.length < CONFIG.MIN_MODELS_REQUIRED) {
      console.warn(`[${requestId}] Only ${models.length}/${CONFIG.MIN_MODELS_REQUIRED} models loaded`);
    }
    
    console.log(`[${requestId}] Models ready: ${models.length} loaded`);
    
    // ====== STEP 4: RUN PREDICTIONS ======
    const predictionResult = await runForexEnsemblePredictions(models, featureVector);
    
    const validPredictions = predictionResult.predictions;
    
    if (validPredictions.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'All model predictions failed',
        modelResults: predictionResult.results
      });
    }
    
    console.log(`[${requestId}] Predictions: ${validPredictions.length}/${models.length} succeeded`);
    
    // ====== STEP 5: ENSEMBLE ======
    const ensembleResult = ensembleForexPredictions(validPredictions);
    
    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] Inference time: ${elapsed}ms`);
    
    // ====== STEP 6: STORE IN MONGODB ======
    const predictionData = {
      asset_class: 'forex',
      pair,
      prediction: ensembleResult.class,
      class: ensembleResult.className,
      confidence: ensembleResult.confidence,
      probabilities: ensembleResult.probabilities,
      models_used: ensembleResult.modelsUsed,
      inference_time_ms: elapsed,
      timestamp: new Date().toISOString(),
      request_id: requestId,
      features_count: featureVector.length
    };
    
    // Non-blocking storage
    let storageResult = { success: false };
    storeForexPrediction(predictionData, req)
      .then(result => {
        storageResult = result;
        console.log(`[${requestId}] Storage: ${result.success ? 'success' : 'failed'}`);
      })
      .catch(error => {
        console.warn(`[${requestId}] Storage error: ${error.message}`);
      });
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${requestId}] SUCCESS (${elapsed}ms)`);
    console.log(`${'='.repeat(70)}\n`);
    
    // ====== RETURN RESPONSE ======
    return res.status(200).json({
      success: true,
      pair,
      asset_class: 'forex',
      prediction: ensembleResult.class,
      class: ensembleResult.className,
      confidence: ensembleResult.confidence,
      probabilities: ensembleResult.probabilities,
      models_used: ensembleResult.modelsUsed,
      models_failed: models.length - ensembleResult.modelsUsed,
      inference_time_ms: elapsed,
      timestamp: predictionData.timestamp,
      request_id: requestId,
      stored: storageResult.success,
      storage_id: storageResult.id || null,
      features: {
        total: featureVector.length,
        type: 'conservative',
        validated: true
      }
    });
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    
    console.error(`\n[${requestId}] ERROR: ${error.message}`);
    console.log(`${'='.repeat(70)}\n`);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      error_type: error.constructor.name,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString(),
      request_id: requestId
    });
  }
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Health check endpoint
 * GET /api/predict-forex?health=true
 */
module.exports.health = async (req, res) => {
  if (req.query.health !== 'true') {
    return res.status(404).end();
  }
  
  const stats = forexModelCache.getStats();
  
  return res.status(200).json({
    status: 'healthy',
    service: 'forex-predictions',
    asset_class: 'forex',
    available_models: CONFIG.MODELS.length,
    model_cache: {
      loaded: stats.loaded,
      failed: stats.failed,
      reused: stats.reused
    },
    uptime: process.uptime(),
    memory_used_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
    timestamp: new Date().toISOString()
  });
};

/**
 * Status endpoint
 * GET /api/predict-forex?status=true
 */
module.exports.status = async (req, res) => {
  if (req.query.status !== 'true') {
    return res.status(404).end();
  }
  
  const stats = forexModelCache.getStats();
  
  return res.status(200).json({
    service: 'forex-predictions',
    models: CONFIG.MODELS,
    config: {
      min_models_required: CONFIG.MIN_MODELS_REQUIRED,
      prediction_timeout_ms: CONFIG.PREDICTION_TIMEOUT_MS,
      storage_timeout_ms: CONFIG.STORAGE_TIMEOUT_MS
    },
    cache_stats: stats,
    timestamp: new Date().toISOString()
  });
};