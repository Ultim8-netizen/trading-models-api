/**
 * predict-crypto.js - OPTIMIZED FOR VERCEL FREE TIER
 * 
 * Crypto Prediction Endpoint - Main Handler
 * 
 * Vercel Serverless Function
 * POST /api/predict-crypto
 * 
 * REQUEST:
 * {
 *   "symbol": "BTC/USDT",
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
 *   "symbol": "BTC/USDT",
 *   "asset_class": "crypto",
 *   "prediction": 2,
 *   "class": "UP",
 *   "confidence": 0.87,
 *   "probabilities": { "down": 0.05, "neutral": 0.08, "up": 0.87 },
 *   "models_used": 5,
 *   "inference_time_ms": 234,
 *   "timestamp": "2024-01-15T10:30:00Z",
 *   "request_id": "1234567890-abc123"
 * }
 */

const {
    getGlobalLazyLoader,
    checkMemoryHealth,
    engineCryptoFeatures,
    extractFeatureVector,
    runOptimizedInference,
    ensembleCryptoPredictions,
    storeCryptoPredictionAsync,
    CONFIG
} = require('./predict-crypto-handler');

// ============================================================================
// REQUEST HANDLER
// ============================================================================

module.exports = async (req, res) => {
    // ====== CORS HEADERS ======
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
    console.log(`[${requestId}] CRYPTO PREDICTION REQUEST`);
    console.log(`${'='.repeat(70)}`);

    try {
        // ====== STEP 1: INPUT VALIDATION ======
        const { symbol, data } = req.body;

        if (!symbol || !data) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: symbol, data',
                example: {
                    symbol: 'BTC/USDT',
                    data: '{ 1h_open, 1h_high, 1h_low, 1h_close, 1h_volume, 4h_*, 1d_* }'
                }
            });
        }

        console.log(`[${requestId}] Symbol: ${symbol}`);
        console.log(`[${requestId}] Data points: ${data['1h_close']?.length || 0}`);

        // ====== STEP 2: MEMORY CHECK (BEFORE) ======
        const memBefore = checkMemoryHealth();
        console.log(`[${requestId}] Memory: ${memBefore.memMB.toFixed(0)}MB / Tensors: ${memBefore.numTensors}`);

        // ====== STEP 3: FEATURE ENGINEERING ======
        console.log(`[${requestId}] Engineering features...`);
        const featureResult = engineCryptoFeatures(data, symbol);

        if (!featureResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Feature engineering failed',
                details: featureResult.error
            });
        }

        const featureVector = extractFeatureVector(
            featureResult.engineeredData,
            featureResult.featureList
        );

        console.log(`[${requestId}] Features: ${featureVector.length} extracted`);

        // ====== STEP 4: MODEL LOADING (LAZY - Only when needed) ======
        console.log(`[${requestId}] Loading models (lazy)...`);
        const loader = getGlobalLazyLoader();
        const models = await loader.loadAvailableModels([
            'temporal_transformer',
            'hybrid_transformer',
            'hierarchical_lstm'
        ]);

        if (models.length === 0) {
            return res.status(503).json({
                success: false,
                error: 'No models available for prediction',
                details: 'Could not load any prediction models'
            });
        }

        if (models.length < (CONFIG?.MIN_MODELS_REQUIRED || 3)) {
            console.warn(`[${requestId}] Only ${models.length} models loaded (minimum recommended: ${CONFIG?.MIN_MODELS_REQUIRED || 3})`);
        }

        console.log(`[${requestId}] Models loaded: ${models.length}`);

        // ====== STEP 5: INFERENCE (OPTIMIZED) ======
        console.log(`[${requestId}] Running inference...`);
        const { predictions, results } = await runOptimizedInference(
            models,
            featureVector,
            symbol
        );

        if (predictions.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'All model predictions failed',
                modelResults: results
            });
        }

        console.log(`[${requestId}] Predictions: ${predictions.length}/${models.length} succeeded`);

        // ====== STEP 6: ENSEMBLE PREDICTIONS ======
        const ensembleResult = ensembleCryptoPredictions(predictions);
        const elapsed = Date.now() - startTime;

        console.log(`[${requestId}] Inference time: ${elapsed}ms`);

        // ====== STEP 7: MEMORY CHECK (AFTER) ======
        const memAfter = checkMemoryHealth();
        console.log(`[${requestId}] Memory after: ${memAfter.memMB.toFixed(0)}MB / Tensors: ${memAfter.numTensors}`);

        // ====== STEP 8: PREPARE PREDICTION DATA ======
        const predictionData = {
            asset_class: 'crypto',
            symbol,
            prediction: ensembleResult.class,
            class: ensembleResult.className,
            confidence: ensembleResult.confidence,
            probabilities: ensembleResult.probabilities,
            models_used: ensembleResult.modelsUsed,
            models_failed: models.length - ensembleResult.modelsUsed,
            inference_time_ms: elapsed,
            timestamp: new Date().toISOString(),
            request_id: requestId,
            features_count: featureVector.length,
            features_balance: {
                bullish: featureResult.balance?.bullish_count || 0,
                bearish: featureResult.balance?.bearish_count || 0,
                is_balanced: featureResult.balance?.is_balanced || false
            },
            memory_stats: {
                before_mb: memBefore.memMB,
                after_mb: memAfter.memMB,
                tensors_before: memBefore.numTensors,
                tensors_after: memAfter.numTensors
            }
        };

        // ====== STEP 9: NON-BLOCKING STORAGE ======
        console.log(`[${requestId}] Queuing storage...`);
        let storageResult = { success: false, id: null };
        
        storeCryptoPredictionAsync(predictionData, req)
            .then(result => {
                storageResult = result;
                console.log(`[${requestId}] Storage: ${result.success ? 'success' : 'failed'}`);
            })
            .catch(err => {
                console.warn(`[${requestId}] Storage failed: ${err.message}`);
            });

        console.log(`\n${'='.repeat(70)}`);
        console.log(`[${requestId}] SUCCESS (${elapsed}ms)`);
        console.log(`${'='.repeat(70)}\n`);

        // ====== STEP 10: RETURN RESPONSE ======
        return res.status(200).json({
            success: true,
            symbol,
            asset_class: 'crypto',
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
            storage_id: storageResult.id,
            features: {
                total: featureVector.length,
                bullish: featureResult.balance?.bullish_count || 0,
                bearish: featureResult.balance?.bearish_count || 0,
                balanced: featureResult.balance?.is_balanced || false
            }
        });

    } catch (error) {
        const elapsed = Date.now() - startTime;

        console.error(`\n[${requestId}] ERROR: ${error.message}`);
        console.error(`[${requestId}] Stack: ${error.stack}`);
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
/**
 * predict-crypto.js (Part 2)
 * Health Check and Status Endpoints
 * 
 * This section is appended to the main handler file
 */

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

/**
 * Health check endpoint
 * GET /api/predict-crypto?health=true
 * 
 * Returns service health status, model availability, and memory usage
 */
module.exports.health = async (req, res) => {
    if (req.query.health !== 'true') {
        return res.status(404).end();
    }

    try {
        const { getGlobalLazyLoader, checkMemoryHealth, CONFIG } = require('./predict-crypto-handler');
        
        const loader = getGlobalLazyLoader();
        const stats = loader.getStats ? loader.getStats() : { loaded: 0, failed: 0, reused: 0 };
        const memStats = checkMemoryHealth();

        return res.status(200).json({
            status: 'healthy',
            service: 'crypto-predictions',
            asset_class: 'crypto',
            available_models: CONFIG?.MODELS?.length || 0,
            model_cache: {
                loaded: stats.loaded || 0,
                failed: stats.failed || 0,
                reused: stats.reused || 0
            },
            memory: {
                used_mb: memStats.memMB.toFixed(2),
                tensors: memStats.numTensors,
                rss_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
                heap_used_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
                heap_total_mb: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)
            },
            uptime_seconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            node_version: process.version,
            platform: process.platform
        });
    } catch (error) {
        return res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// ============================================================================
// STATUS ENDPOINT
// ============================================================================

/**
 * Status endpoint
 * GET /api/predict-crypto?status=true
 * 
 * Returns detailed service configuration and statistics
 */
module.exports.status = async (req, res) => {
    if (req.query.status !== 'true') {
        return res.status(404).end();
    }

    try {
        const { getGlobalLazyLoader, CONFIG } = require('./predict-crypto-handler');
        
        const loader = getGlobalLazyLoader();
        const stats = loader.getStats ? loader.getStats() : { loaded: 0, failed: 0, reused: 0 };

        return res.status(200).json({
            service: 'crypto-predictions',
            asset_class: 'crypto',
            version: '2.0.0-optimized',
            models: CONFIG?.MODELS || [],
            config: {
                min_models_required: CONFIG?.MIN_MODELS_REQUIRED || 3,
                prediction_timeout_ms: CONFIG?.PREDICTION_TIMEOUT_MS || 8000,
                storage_timeout_ms: CONFIG?.STORAGE_TIMEOUT_MS || 3000,
                lazy_loading: true,
                memory_optimization: true
            },
            cache_stats: stats,
            features: {
                lazy_loading: 'enabled',
                memory_tracking: 'enabled',
                optimized_inference: 'enabled',
                non_blocking_storage: 'enabled',
                feature_balancing: 'enabled'
            },
            environment: {
                node_version: process.version,
                platform: process.platform,
                arch: process.arch
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            service: 'crypto-predictions',
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// ============================================================================
// MODELS ENDPOINT
// ============================================================================

/**
 * Models information endpoint
 * GET /api/predict-crypto?models=true
 * 
 * Returns available models and their status
 */
module.exports.models = async (req, res) => {
    if (req.query.models !== 'true') {
        return res.status(404).end();
    }

    try {
        const { getGlobalLazyLoader, CONFIG } = require('./predict-crypto-handler');
        
        const loader = getGlobalLazyLoader();
        const stats = loader.getStats ? loader.getStats() : {};

        return res.status(200).json({
            service: 'crypto-predictions',
            total_models: CONFIG?.MODELS?.length || 0,
            models: CONFIG?.MODELS || [],
            cache_stats: stats,
            loading_strategy: 'lazy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// ============================================================================
// EXPORT ALL HANDLERS
// ============================================================================

// Main prediction endpoint is the default export (already exported above)
// Health, status, and models endpoints are named exports