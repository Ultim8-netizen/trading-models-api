/**
 * Trading Models API - Production Prediction Handler
 * 
 * CRITICAL FLOW:
 * 1. Receive raw OHLCV data
 * 2. Engineer features using crypto-features.js or forex-features.js
 * 3. Load trained Keras model
 * 4. Run prediction
 * 5. Return result
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

  const modelPath = path.join(
    __dirname,
    `../models/${assetClass}/${modelName}.keras`
  );

  const fileUrl = `file://${path.resolve(modelPath)}`;

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
    const engineeredData = engineer.engineer_features(rawData);

    // Get feature list (engineered_data has these columns)
    const featureList = engineer.get_feature_list();

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
    const featureList = engineer.get_feature_list();

    // Get the last row of engineered data (most recent)
    // Most recent data is at the end of the engineered DataFrame
    const lastRowIndex = engineeredData.length - 1;

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
// Main Handler
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
 *   "timestamp": "2024-01-15T10:30:00Z"
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
    console.log('  [1/4] Engineering features...');
    const engineeredData = engineFeatures(data, asset_class);
    const featureVector = extractFeatureValues(engineeredData, asset_class);

    // Step 2: Select models for ensemble
    console.log('  [2/4] Loading models...');
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
    console.log(`  [3/4] Running predictions with ${models.length} models...`);
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

    // Step 4: Ensemble and return
    console.log('  [4/4] Ensembling results...');
    const result = ensemblePredictions(predictions);

    const classNames = ['DOWN', 'NEUTRAL', 'UP'];
    const elapsed = Date.now() - startTime;

    console.log(`✅ Prediction complete (${elapsed}ms)`);

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
      timestamp: new Date().toISOString(),
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