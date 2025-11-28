/**
 * predict-crypto-handler.js - OPTIMIZED FOR VERCEL FREE TIER
 * 
 * Crypto Prediction Handler - Core Logic
 * 
 * FLOW:
 * 1. Receive raw OHLCV data from Binance/CoinGecko
 * 2. Engineer features (v7.1 BALANCED - 15 bullish + 15 bearish)
 * 3. Lazy-load models only when needed (saves memory)
 * 4. Run optimized ensemble predictions with timeout protection
 * 5. Store in MongoDB (non-blocking)
 * 6. Return result with memory stats
 * 
 * MODELS AVAILABLE:
 * - bidirectional_attention.keras
 * - hierarchical_lstm.keras
 * - hybrid_transformer.keras
 * - multiscale_transformer.keras
 * - temporal_transformer.keras
 * 
 * All models expect: 40-50 features (normalized, no missing values)
 */

const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');
const LazyModelLoader = require('../utils/lazy-model-loader');
const CryptoFeatureEngineer = require('../utils/crypto-features');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    ASSET_CLASS: 'crypto',
    MODELS_DIR: 'models/crypto',
    MODELS: [
        'bidirectional_attention',
        'hierarchical_lstm',
        'hybrid_transformer',
        'multiscale_transformer',
        'temporal_transformer'
    ],
    MIN_MODELS_REQUIRED: 3,
    PREDICTION_TIMEOUT_MS: 5000,
    STORAGE_TIMEOUT_MS: 10000, // FIXED: Increased from 3000ms to 10000ms
    MEMORY_WARNING_THRESHOLD_MB: 700,
    MEMORY_CRITICAL_THRESHOLD_MB: 900,
    MEMORY_LIMIT_MB: 1024
};

// ============================================================================
// GLOBAL SINGLETON - Persists across requests on Vercel
// ============================================================================

let globalLazyLoader = null;
let lastMemoryWarning = 0;

/**
 * Get or create global lazy loader singleton
 * Persists across Vercel function invocations for warm starts
 */
function getGlobalLazyLoader() {
    if (!globalLazyLoader) {
        globalLazyLoader = new LazyModelLoader(CONFIG.MODELS_DIR);
        console.log('[LazyLoader] Initialized global singleton');
    }
    return globalLazyLoader;
}

// ============================================================================
// MEMORY MANAGEMENT (Optimized for Vercel)
// ============================================================================

/**
 * Check TensorFlow.js memory health
 * Critical for staying within Vercel's 1024MB limit
 * 
 * @returns {Object} Memory status with health indicators
 */
function checkMemoryHealth() {
    const mem = tf.memory();
    const memMB = mem.numBytes / 1024 / 1024;
    const numTensors = mem.numTensors;
    
    const processMemory = process.memoryUsage();
    const heapUsedMB = processMemory.heapUsed / 1024 / 1024;
    const rssMB = processMemory.rss / 1024 / 1024;

    const status = {
        memMB,
        numTensors,
        heapUsedMB,
        rssMB,
        healthy: memMB < CONFIG.MEMORY_WARNING_THRESHOLD_MB,
        warning: memMB >= CONFIG.MEMORY_WARNING_THRESHOLD_MB && memMB < CONFIG.MEMORY_CRITICAL_THRESHOLD_MB,
        critical: memMB >= CONFIG.MEMORY_CRITICAL_THRESHOLD_MB
    };

    // Critical memory - force cleanup
    if (status.critical) {
        console.warn(`🚨 CRITICAL MEMORY: ${memMB.toFixed(0)}MB / Tensors: ${numTensors} / Heap: ${heapUsedMB.toFixed(0)}MB`);
        try {
            tf.disposeVariables();
            console.log('  ✓ Disposed TF variables');
        } catch (error) {
            console.error('  ✗ Failed to dispose variables:', error.message);
        }
    } 
    // Warning memory - log throttled
    else if (status.warning) {
        const now = Date.now();
        if (now - lastMemoryWarning > 5000) { // Throttle warnings to every 5s
            console.warn(`⚠️ Memory warning: ${memMB.toFixed(0)}MB / Tensors: ${numTensors} / Heap: ${heapUsedMB.toFixed(0)}MB`);
            lastMemoryWarning = now;
        }
    }

    return status;
}

/**
 * Force garbage collection and tensor cleanup
 * Use sparingly - mainly for error recovery
 */
function forceCleanup() {
    try {
        console.log('[Memory] Forcing cleanup...');
        
        // Dispose TF variables
        tf.disposeVariables();
        
        // Trigger GC if available
        if (global.gc) {
            global.gc();
            console.log('  ✓ GC triggered');
        }
        
        const mem = checkMemoryHealth();
        console.log(`  Memory after cleanup: ${mem.memMB.toFixed(0)}MB`);
        
    } catch (error) {
        console.error('[Memory] Cleanup error:', error.message);
    }
}

// ============================================================================
// LEGACY MODEL CACHE (for backward compatibility)
// ============================================================================

class ModelCache {
    constructor() {
        this.models = {};
        this.stats = {
            loaded: 0,
            failed: 0,
            reused: 0
        };
    }

    async loadModel(modelName) {
        // Check cache first
        if (this.models[modelName]) {
            this.stats.reused++;
            return this.models[modelName];
        }

        try {
            const modelPath = path.join(process.cwd(), `${CONFIG.MODELS_DIR}/${modelName}.keras`);

            // Check file exists
            if (!fs.existsSync(modelPath)) {
                throw new Error(`Model file not found: ${modelPath}`);
            }

            console.log(`  Loading: ${modelName}...`);

            const model = await tf.loadLayersModel(`file://${modelPath}`);

            // Verify model structure
            if (!model || !model.predict) {
                throw new Error(`Invalid model structure: ${modelName}`);
            }

            this.models[modelName] = model;
            this.stats.loaded++;

            console.log(`    ✓ ${modelName} loaded`);
            return model;

        } catch (error) {
            this.stats.failed++;
            console.error(`    ✗ ${modelName}: ${error.message}`);
            throw error;
        }
    }

    async loadAllModels() {
        console.log(`\n[Models] Loading ${CONFIG.MODELS.length} models...`);

        const loadPromises = CONFIG.MODELS.map(modelName =>
            this.loadModel(modelName)
                .then(model => ({ name: modelName, model, success: true }))
                .catch(error => ({
                    name: modelName,
                    model: null,
                    success: false,
                    error: error.message
                }))
        );

        const results = await Promise.all(loadPromises);

        const loaded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        console.log(`[Models] Loaded: ${loaded.length}/${CONFIG.MODELS.length}`);

        if (failed.length > 0) {
            console.warn(`[Models] Failed (${failed.length}):`);
            failed.forEach(f => console.warn(`  - ${f.name}: ${f.error}`));
        }

        return loaded.map(r => r.model);
    }

    getStats() {
        return this.stats;
    }

    clear() {
        Object.keys(this.models).forEach(key => {
            if (this.models[key] && this.models[key].dispose) {
                try {
                    this.models[key].dispose();
                } catch (e) {
                    console.warn(`Failed to dispose ${key}: ${e.message}`);
                }
            }
        });
        this.models = {};
    }
}

const modelCache = new ModelCache();

// ============================================================================
// FEATURE ENGINEERING (Optimized)
// ============================================================================

/**
 * Engineer features from raw OHLCV data
 * 
 * @param {Object} rawData - Raw price data (1h, 4h, 1d timeframes)
 * @param {String} symbol - Crypto pair (for logging)
 * @returns {Object} Engineered data and feature list
 */
function engineCryptoFeatures(rawData, symbol) {
    console.log(`\n[Features] Engineering for ${symbol}...`);

    try {
        const engineer = new CryptoFeatureEngineer();

        // Engineer features
        const engineeredData = engineer.engineerFeatures(rawData, symbol);
        const featureList = engineer.getFeatureList();
        const categories = engineer.getFeatureCategories ? engineer.getFeatureCategories() : null;
        const balance = engineer.getBalanceReport ? engineer.getBalanceReport() : { 
            bullish_count: 0, 
            bearish_count: 0, 
            is_balanced: true 
        };

        if (!featureList || featureList.length === 0) {
            throw new Error('No features engineered');
        }

        console.log(`  Total features: ${featureList.length}`);
        
        if (balance.bullish_count !== undefined) {
            console.log(`  Balance: ${balance.bullish_count} bullish, ${balance.bearish_count} bearish`);
            
            if (!balance.is_balanced) {
                console.warn(`  ⚠️ Features imbalanced (may affect predictions)`);
            }
        }

        return {
            engineeredData,
            featureList,
            categories,
            balance,
            success: true
        };

    } catch (error) {
        console.error(`[Features] Error: ${error.message}`);
        return { 
            success: false, 
            error: error.message 
        };
    }
}

/**
 * Extract feature vector from engineered data
 * Last row is most recent data
 * 
 * @param {Object} engineeredData - Engineered data object
 * @param {Array<String>} featureList - Feature names in order
 * @returns {Array} Feature vector ready for model
 */
function extractFeatureVector(engineeredData, featureList) {
    try {
        // Find last row index
        const firstKey = Object.keys(engineeredData).find(
            k => Array.isArray(engineeredData[k])
        );

        if (!firstKey) {
            throw new Error('No array columns in engineered data');
        }

        const lastRowIndex = engineeredData[firstKey].length - 1;
        
        if (lastRowIndex < 0) {
            throw new Error('No data rows available');
        }

        // Extract features in exact order
        const features = [];
        const issues = [];

        for (let i = 0; i < featureList.length; i++) {
            const featureName = featureList[i];

            if (!(featureName in engineeredData)) {
                features.push(0);
                issues.push(`${featureName}=missing`);
                continue;
            }

            const value = engineeredData[featureName][lastRowIndex];

            // Validate value
            if (value === null || value === undefined) {
                features.push(0);
                issues.push(`${featureName}=null`);
            } else if (!isFinite(value)) {
                features.push(0);
                issues.push(`${featureName}=${value}`);
            } else {
                features.push(parseFloat(value));
            }
        }

        console.log(`  Extracted ${features.length} features`);

        if (issues.length > 0) {
            console.warn(`  ⚠️ Feature issues (${issues.length}): ${issues.slice(0, 3).join(', ')}${issues.length > 3 ? '...' : ''}`);
        }

        return features;

    } catch (error) {
        console.error(`[FeatureExtraction] Error: ${error.message}`);
        throw error;
    }
}

// Alias for backward compatibility
const extractCryptoFeatureVector = extractFeatureVector;

// ============================================================================
// OPTIMIZED MODEL INFERENCE
// ============================================================================

/**
 * Run single model prediction with timeout protection
 * 
 * @param {Object} model - TensorFlow model
 * @param {Array<Number>} features - Feature vector
 * @param {String} modelName - Model name (for logging)
 * @returns {Promise<Array>} Prediction probabilities [down, neutral, up]
 */
async function runSinglePrediction(model, features, modelName) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout for ${modelName}`));
        }, CONFIG.PREDICTION_TIMEOUT_MS);

        try {
            // Create tensor
            const inputTensor = tf.tensor2d([features]);

            // Run prediction
            const outputTensor = model.predict(inputTensor);

            // Convert to array
            outputTensor.data().then(data => {
                clearTimeout(timeout);

                const result = Array.from(data);

                // Cleanup immediately to free memory
                inputTensor.dispose();
                outputTensor.dispose();

                resolve(result);
            }).catch(error => {
                clearTimeout(timeout);
                inputTensor.dispose();
                if (outputTensor && outputTensor.dispose) {
                    outputTensor.dispose();
                }
                reject(error);
            });

        } catch (error) {
            clearTimeout(timeout);
            reject(error);
        }
    });
}

/**
 * OPTIMIZED: Run inference with memory-efficient sequential execution
 * Loads only 3 models instead of 5 to save memory
 * 
 * @param {Array<Object>} models - Loaded model objects
 * @param {Array<Number>} features - Feature vector
 * @param {String} symbol - Symbol for logging
 * @returns {Promise<Object>} Predictions and results
 */
async function runOptimizedInference(models, features, symbol) {
    console.log(`\n[Inference] Running ${models.length} models for ${symbol}...`);

    if (models.length === 0) {
        throw new Error('No models available for inference');
    }

    const predictions = [];
    const results = [];

    // Sequential execution to control memory usage
    for (let i = 0; i < models.length; i++) {
        try {
            console.log(`  [${i + 1}/${models.length}] Running model...`);

            const inputTensor = tf.tensor2d([features]);

            // Single prediction with race timeout
            const outputTensor = await Promise.race([
                (async () => {
                    const output = models[i].predict(inputTensor);
                    return output;
                })(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Prediction timeout')), 3000)
                )
            ]);

            const pred = await outputTensor.data();
            const predArray = Array.from(pred);

            predictions.push(predArray);
            results.push({ 
                model: CONFIG.MODELS[i] || `model_${i}`,
                success: true, 
                prediction: predArray 
            });

            // Cleanup immediately
            inputTensor.dispose();
            outputTensor.dispose();

            console.log(`    ✓ Model ${i + 1} complete`);

        } catch (error) {
            console.warn(`    ✗ Model ${i + 1} failed: ${error.message}`);
            results.push({ 
                model: CONFIG.MODELS[i] || `model_${i}`,
                success: false, 
                error: error.message 
            });
        }
    }

    if (predictions.length === 0) {
        throw new Error(`All ${models.length} model predictions failed`);
    }

    console.log(`[Inference] Success rate: ${predictions.length}/${models.length} models`);

    return { predictions, results };
}

/**
 * LEGACY: Run predictions across multiple models (backward compatible)
 * 
 * @param {Array<Object>} models - Loaded model objects
 * @param {Array<Number>} features - Feature vector
 * @returns {Promise<Object>} Predictions and results
 */
async function runEnsemblePredictions(models, features) {
    console.log(`\n[Inference] Running ${models.length} models...`);

    const predictions = [];
    const results = [];

    for (let i = 0; i < models.length; i++) {
        try {
            console.log(`  [${i + 1}/${models.length}] ${CONFIG.MODELS[i]}...`);

            const pred = await runSinglePrediction(models[i], features, CONFIG.MODELS[i]);

            predictions.push(pred);
            results.push({
                model: CONFIG.MODELS[i],
                success: true,
                prediction: pred
            });

            console.log(`    ✓ Completed`);

        } catch (error) {
            results.push({
                model: CONFIG.MODELS[i],
                success: false,
                error: error.message
            });
            console.warn(`    ✗ Failed: ${error.message}`);
        }
    }

    if (predictions.length === 0) {
        throw new Error(`All ${models.length} predictions failed`);
    }

    console.log(`  Success rate: ${predictions.length}/${models.length}`);

    return { predictions, results };
}

// ============================================================================
// ENSEMBLE & DECISION
// ============================================================================

/**
 * Ensemble multiple predictions using weighted averaging
 * 
 * @param {Array<Array>} predictions - Array of prediction arrays
 * @returns {Object} Ensemble result with class and confidence
 */
function ensembleCryptoPredictions(predictions) {
    if (predictions.length === 0) {
        throw new Error('No predictions to ensemble');
    }

    console.log(`\n[Ensemble] Averaging ${predictions.length} predictions...`);

    const numClasses = 3; // DOWN, NEUTRAL, UP
    const ensemble = [0, 0, 0];

    // Simple average across all models
    for (const pred of predictions) {
        for (let i = 0; i < numClasses; i++) {
            ensemble[i] += (pred[i] || 0);
        }
    }

    // Average
    for (let i = 0; i < numClasses; i++) {
        ensemble[i] /= predictions.length;
    }

    // Normalize to ensure valid probabilities sum to 1.0
    const sum = ensemble.reduce((a, b) => a + b, 0);
    const normalized = ensemble.map(p => p / sum);

    // Get predicted class (argmax)
    const predictedClass = normalized.indexOf(Math.max(...normalized));
    const confidence = normalized[predictedClass];

    const classNames = ['DOWN', 'NEUTRAL', 'UP'];

    console.log(`  Predicted: ${classNames[predictedClass]}`);
    console.log(`  Confidence: ${(confidence * 100).toFixed(1)}%`);
    console.log(`  Probabilities: DOWN=${(normalized[0] * 100).toFixed(1)}%, NEUTRAL=${(normalized[1] * 100).toFixed(1)}%, UP=${(normalized[2] * 100).toFixed(1)}%`);

    return {
        class: predictedClass,
        className: classNames[predictedClass],
        confidence,
        probabilities: {
            down: normalized[0],
            neutral: normalized[1],
            up: normalized[2]
        },
        modelsUsed: predictions.length
    };
}
// ============================================================================
// MONGODB STORAGE (FIXED - Enhanced Error Handling & Timeout)
// ============================================================================

/**
 * OPTIMIZED & FIXED: Store prediction in MongoDB (non-blocking with proper timeout)
 * Uses async pattern - doesn't block response
 * 
 * FIXES:
 * - Uses localhost for same-process API calls (faster, more reliable)
 * - Increased timeout from 3s to 10s
 * - Enhanced error logging with stack traces
 * - Proper response validation and error text extraction
 * - AbortSignal for timeout instead of Promise.race
 * 
 * @param {Object} predictionData - Prediction to store
 * @param {Object} req - Request object
 * @returns {Promise<Object>} Storage result
 */
async function storeCryptoPredictionAsync(predictionData, req) {
    try {
        // FIXED: Use localhost for same-process calls (more reliable on Vercel)
        const apiUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}/api/store-prediction`
            : 'http://localhost:3000/api/store-prediction';

        console.log(`[Storage] Storing to MongoDB (timeout: ${CONFIG.STORAGE_TIMEOUT_MS}ms)...`);
        console.log(`[Storage] Target URL: ${apiUrl}`);

        // FIXED: Create AbortController for proper timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.STORAGE_TIMEOUT_MS);

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'CryptoPredictions/2.0'
                },
                body: JSON.stringify(predictionData),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // FIXED: Check response status and extract error details
            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`  ✗ Storage failed: HTTP ${response.status}`);
                console.warn(`  Error details: ${errorText.substring(0, 200)}`);
                return { 
                    success: false, 
                    error: `HTTP ${response.status}`,
                    details: errorText.substring(0, 200)
                };
            }

            const result = await response.json();
            console.log(`  ✓ Stored successfully (ID: ${result.id})`);
            return { success: true, id: result.id };

        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            // Handle timeout vs other errors
            if (fetchError.name === 'AbortError') {
                console.warn(`  ✗ Storage timeout after ${CONFIG.STORAGE_TIMEOUT_MS}ms`);
                return { 
                    success: false, 
                    error: 'Storage timeout',
                    timeout: true 
                };
            }
            
            throw fetchError;
        }

    } catch (error) {
        // FIXED: Enhanced error logging with stack trace
        console.error(`[Storage] Error: ${error.message}`);
        console.error(`[Storage] Stack: ${error.stack}`);
        
        return { 
            success: false, 
            error: error.message,
            stack: error.stack
        };
    }
}

/**
 * LEGACY: Store prediction in MongoDB (synchronous pattern)
 * For backward compatibility
 * 
 * @param {Object} predictionData - Prediction to store
 * @param {Object} req - Request object
 * @returns {Promise<Object>} Storage result
 */
async function storeCryptoPrediction(predictionData, req) {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;

        const apiUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}/api/store-prediction`
            : `${protocol}://${host}/api/store-prediction`;

        console.log(`\n[Storage] Storing to MongoDB...`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'CryptoPredictions/1.0'
            },
            body: JSON.stringify(predictionData)
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`  ✓ Stored (ID: ${result.id})`);
            return { success: true, id: result.id };
        } else {
            const errorText = await response.text();
            console.warn(`  ✗ HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            return { 
                success: false, 
                error: `HTTP ${response.status}`,
                details: errorText.substring(0, 100)
            };
        }

    } catch (error) {
        console.warn(`  ✗ Error: ${error.message}`);
        console.warn(`  Stack: ${error.stack}`);
        return { 
            success: false, 
            error: error.message,
            stack: error.stack
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Configuration
    CONFIG,
    
    // Global singleton
    getGlobalLazyLoader,
    
    // Memory management
    checkMemoryHealth,
    forceCleanup,
    
    // Legacy cache (for backward compatibility)
    modelCache,
    
    // Feature engineering
    engineCryptoFeatures,
    extractFeatureVector,
    extractCryptoFeatureVector, // Alias
    
    // Model inference
    runSinglePrediction,
    runOptimizedInference, // NEW: Optimized version
    runEnsemblePredictions, // LEGACY: For compatibility
    
    // Ensemble
    ensembleCryptoPredictions,
    
    // Storage (FIXED)
    storeCryptoPredictionAsync, // NEW: Fixed async version with proper timeout
    storeCryptoPrediction // LEGACY: Updated with better error handling
};