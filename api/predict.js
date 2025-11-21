/**
 * Trading Models API - Production Prediction Handler
 * 
 * CRITICAL FLOW:
 * 1. Receive raw OHLCV data
 * 2. Engineer features using crypto-features.js or forex-features.js
 * 3. Load trained Keras model
 * 4. Run prediction
 * 5. Store prediction in MongoDB (NEW)
 * 6. Return result
 * 
 * IMPORTANT: Models expect features in the EXACT format they were trained with
 * Do NOT skip feature engineering or features will mismatch
 */

const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs');

// Your feature engineering modules
// These MUST match the feature scripts you used during training
const CryptoFeatureEngineer = require('../utils/crypto-features');
const ForexFeatureEngineer = require('../utils/forex-features');

// ============================================================================
// Model Cache (Vercel keeps in memory between requests)
// ============================================================================

let modelsCache = {};
let featureEngineersCache = {};

/**
 * Load single model with error handling
 */
async function loadModel(assetClass, modelName) {
  const cacheKey = `${assetClass}/${modelName}`;

  if (modelsCache[cacheKey]) {
    return modelsCache[cacheKey];
  }

  // ✅ FIXED: Use process.cwd() instead of __dirname for Vercel compatibility
  const modelPath = path.join(process.cwd(), `models/${assetClass}/${modelName}.keras`);

  const fileUrl = `file://${modelPath}`;

  try {
    const model = await tf.loadLayersModel(fileUrl);
    modelsCache[cacheKey] = model;
    console.log(`✓ Model loaded: ${assetClass}/${modelName}`);
    return model;
  } catch (error) {
    console.error(`❌ Failed to load model ${cacheKey}:`, error.message);
    throw new Error(`Model load failed: ${modelName}`);
  }
}

/**
 * Get or create feature engineer
 */
function getFeatureEngineer(assetClass) {
  if (featureEngineersCache[assetClass]) {
    return featureEngineersCache[assetClass];
  }

  let engineer;

  if (assetClass === 'crypto') {
    engineer = new CryptoFeatureEngineer();
  } else if (assetClass === 'forex') {
    engineer = new ForexFeatureEngineer();
  } else {
    throw new Error(`Unknown asset class: ${assetClass}`);
  }

  featureEngineersCache[assetClass] = engineer;
  return engineer;
}

// ============================================================================
// Feature Engineering Pipeline
// ============================================================================

/**
 * Engineer features from raw OHLCV data
 * 
 * @param {Object} rawData - Raw price data with columns like:
 *   {
 *     '1h_open': [...],
 *     '1h_high': [...],
 *     '1h_low': [...],
 *     '1h_close': [...],
 *     '1h_volume': [...],
 *     '4h_open': [...], etc.
 *   }
 * @param {string} assetClass - 'crypto' or 'forex'
 * @returns {Array} Engineered features for prediction
 */
function engineFeatures(rawData, assetClass) {
  try {
    const engineer = getFeatureEngineer(assetClass);

    // Engineer features using the appropriate script
    // These MUST match your training pipeline exactly
    const engineeredData = engineer.engineerFeatures(rawData);

    // Get feature list (engineered_data has these columns)
    const featureList = engineer.getFeatureList();

    if (!featureList || featureList.length === 0) {
      throw new Error('No features engineered');
    }

    console.log(`✓ Engineered ${featureList.length} features for ${assetClass}`);

    return engineeredData;
  } catch (error) {
    console.error(`❌ Feature engineering failed: ${error.message}`);
    throw error;
  }
}

/**
 * Extract feature values from engineered data
 * 
 * @param {Object} engineeredData - DataFrame-like object with engineered features
 * @param {string} assetClass - 'crypto' or 'forex'
 * @returns {Array} Flat array of feature values for model input
 */
function extractFeatureValues(engineeredData, assetClass) {
  try {
    const engineer = getFeatureEngineer(assetClass);
    const featureList = engineer.getFeatureList();

    // Get the last row of engineered data (most recent)
    // Most recent data is at the end of the engineered DataFrame
    const lastRowIndex = engineeredData[Object.keys(engineeredData)[0]].length - 1;

    // Extract values in the EXACT order they were in during training
    const features = [];

    for (const featureName of featureList) {
      if (!(featureName in engineeredData)) {
        console.warn(`⚠️ Feature missing: ${featureName}`);
        features.push(0); // Default to 0 if missing
      } else {
        const value = engineeredData[featureName][lastRowIndex];
        // Handle NaN and infinite values
        const cleanValue = isFinite(value) ? value : 0;
        features.push(cleanValue);
      }
    }

    console.log(`✓ Extracted ${features.length} feature values`);
    return features;
  } catch (error) {
    console.error(`❌ Feature extraction failed: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Model Selection
// ============================================================================

/**
 * Select best model for this asset class
 * Uses ensemble of all available models
 */
function selectModel(assetClass) {
  const modelMap = {
    crypto: [
      'bidirectional_attention',
      'hierarchical_lstm',
      'hybrid_transformer',
      'multiscale_transformer',
      'temporal_transformer',
    ],
    forex: [
      'hierarchical_lstm',
      'hybrid_transformer',
      'multiscale_transformer',
      'temporal_transformer',
    ],
  };

  if (!modelMap[assetClass]) {
    throw new Error(`Unknown asset class: ${assetClass}`);
  }

  return modelMap[assetClass];
}

// ============================================================================
// Prediction Engine
// ============================================================================

/**
 * Run prediction on a single model
 * 
 * @param {Object} model - Loaded TensorFlow model
 * @param {Array} features - Feature vector
 * @returns {Promise<Array>} Prediction probabilities [down, neutral, up]
 */
async function runPrediction(model, features) {
  try {
    // Create input tensor (add batch dimension)
    const inputTensor = tf.tensor2d([features]);

    // Run prediction
    const prediction = model.predict(inputTensor);

    // Convert to array
    const predictionArray = await prediction.data();
    const result = Array.from(predictionArray);

    // Cleanup tensors
    inputTensor.dispose();
    prediction.dispose();

    return result;
  } catch (error) {
    console.error('❌ Prediction failed:', error.message);
    throw error;
  }
}

/**
 * Ensemble predictions from multiple models
 * 
 * @param {Array} predictions - Array of prediction arrays
 * @returns {Object} Ensemble result with class and confidence
 */
function ensemblePredictions(predictions) {
  if (predictions.length === 0) {
    throw new Error('No predictions to ensemble');
  }

  const numClasses = predictions[0].length;
  const ensemble = new Array(numClasses).fill(0);

  // Average all predictions
  for (const pred of predictions) {
    for (let i = 0; i < numClasses; i++) {
      ensemble[i] += pred[i];
    }
  }

  for (let i = 0; i < numClasses; i++) {
    ensemble[i] /= predictions.length;
  }

  // Get predicted class
  const predictedClass = ensemble.indexOf(Math.max(...ensemble));
  const confidence = ensemble[predictedClass];

  return {
    class: predictedClass,
    confidence: confidence,
    probabilities: {
      down: ensemble[0],
      neutral: ensemble[1],
      up: ensemble[2],
    },
  };
}

// ============================================================================
// MongoDB Storage Integration (NEW)
// ============================================================================

/**
 * Store prediction in MongoDB via internal API
 * Non-blocking - doesn't fail the request if storage fails
 * 
 * @param {Object} predictionData - Prediction data to store
 * @param {Object} req - Request object for base URL
 */
async function storePrediction(predictionData, req) {
  try {
    // Determine base URL
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    // Use Vercel URL if available, otherwise construct from headers
    const apiUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/store-prediction`
      : `${baseUrl}/api/store-prediction`;

    console.log('  → Storing prediction to MongoDB...');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'TradingModels-Internal/1.0'
      },
      body: JSON.stringify(predictionData),
      timeout: 3000 // 3 second timeout
    });

    if (response.ok) {
      const result = await response.json();
      console.log('  ✓ Prediction stored in MongoDB:', result.id || 'success');
      return { success: true, id: result.id };
    } else {
      const errorText = await response.text();
      console.warn('  ⚠️ MongoDB storage failed:', response.status, errorText);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.warn('  ⚠️ MongoDB storage error:', error.message);
    return { success: false, error: error.message };
  }
}
// ============================================================================
// Main Handler (CONTINUED)
// ============================================================================

/**
 * Vercel Serverless Function Handler
 * 
 * POST /api/predict
 * 
 * Request body:
 * {
 *   "asset_class": "crypto" | "forex",
 *   "symbol": "BTC/USDT",
 *   "data": {
 *     "1h_open": [...],
 *     "1h_high": [...],
 *     "1h_low": [...],
 *     "1h_close": [...],
 *     "1h_volume": [...],
 *     "4h_open": [...],
 *     "4h_high": [...],
 *     "4h_low": [...],
 *     "4h_close": [...],
 *     "4h_volume": [...],
 *     "1d_open": [...],
 *     "1d_high": [...],
 *     "1d_low": [...],
 *     "1d_close": [...],
 *     "1d_volume": [...]
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "prediction": 0|1|2,
 *   "class": "DOWN" | "NEUTRAL" | "UP",
 *   "confidence": 0.95,
 *   "probabilities": {
 *     "down": 0.05,
 *     "neutral": 0.10,
 *     "up": 0.85
 *   },
 *   "models_used": 5,
 *   "inference_time_ms": 123,
 *   "timestamp": "2024-01-15T10:30:00Z",
 *   "stored": true
 * }
 */
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const startTime = Date.now();

  try {
    // Parse request
    const { asset_class, symbol, data } = req.body;

    console.log(`\n📊 Processing prediction for ${symbol} (${asset_class})`);

    // Validate inputs
    if (!asset_class || !data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: asset_class, data',
      });
    }

    if (!['crypto', 'forex'].includes(asset_class)) {
      return res.status(400).json({
        success: false,
        error: 'asset_class must be "crypto" or "forex"',
      });
    }

    // Step 1: Engineer features
    console.log('  [1/5] Engineering features...');
    const engineeredData = engineFeatures(data, asset_class);
    const featureVector = extractFeatureValues(engineeredData, asset_class);

    // Step 2: Select models for ensemble
    console.log('  [2/5] Loading models...');
    const modelNames = selectModel(asset_class);
    const models = [];

    for (const modelName of modelNames) {
      try {
        const model = await loadModel(asset_class, modelName);
        models.push({ name: modelName, model });
      } catch (error) {
        console.warn(`⚠️ Skipping model ${modelName}: ${error.message}`);
      }
    }

    if (models.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'No models available for prediction',
      });
    }

    // Step 3: Run predictions
    console.log(`  [3/5] Running predictions with ${models.length} models...`);
    const predictions = [];

    for (const { name, model } of models) {
      try {
        const pred = await runPrediction(model, featureVector);
        predictions.push(pred);
        console.log(`    ✓ ${name}`);
      } catch (error) {
        console.warn(`    ⚠️ ${name} failed: ${error.message}`);
      }
    }

    if (predictions.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'All model predictions failed',
      });
    }

    // Step 4: Ensemble results
    console.log('  [4/5] Ensembling results...');
    const result = ensemblePredictions(predictions);

    const classNames = ['DOWN', 'NEUTRAL', 'UP'];
    const elapsed = Date.now() - startTime;

    // Step 5: Store prediction in MongoDB (NEW - Non-blocking)
    console.log('  [5/5] Storing prediction...');
    
    const predictionData = {
      symbol: symbol,
      asset_class: asset_class,
      prediction: result.class,
      class: classNames[result.class],
      confidence: result.confidence,
      probabilities: result.probabilities,
      models_used: models.length,
      inference_time_ms: elapsed,
      timestamp: new Date().toISOString()
    };

    // Store prediction asynchronously - don't block response
    // If storage fails, we still return the prediction successfully
    let storageResult = { success: false };
    try {
      storageResult = await Promise.race([
        storePrediction(predictionData, req),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Storage timeout')), 3000)
        )
      ]);
    } catch (storageError) {
      console.warn('  ⚠️ Storage failed (timeout or error):', storageError.message);
    }

    console.log(`✅ Prediction complete (${elapsed}ms)`);

    // Return response with storage status
    return res.status(200).json({
      success: true,
      symbol: symbol,
      asset_class: asset_class,
      prediction: result.class,
      class: classNames[result.class],
      confidence: result.confidence,
      probabilities: result.probabilities,
      models_used: models.length,
      inference_time_ms: elapsed,
      timestamp: predictionData.timestamp,
      stored: storageResult.success, // Indicates if MongoDB storage succeeded
      storage_id: storageResult.id || null // MongoDB document ID if stored
    });
  } catch (error) {
    console.error('❌ Prediction error:', error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

// ============================================================================
// Health Check Endpoint (Optional)
// ============================================================================

/**
 * Health check for monitoring
 * GET /api/predict?health=true
 */
module.exports.health = async (req, res) => {
  if (req.query.health === 'true') {
    const modelStats = {
      crypto_models_cached: Object.keys(modelsCache).filter(k => k.startsWith('crypto')).length,
      forex_models_cached: Object.keys(modelsCache).filter(k => k.startsWith('forex')).length,
      engineers_cached: Object.keys(featureEngineersCache).length,
    };

    return res.status(200).json({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cache: modelStats,
      timestamp: new Date().toISOString()
    });
  }
};