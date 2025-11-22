/**predict-crypto-handler.js */
/**
 * Crypto Prediction Handler - Core Logic
 * 
 * FLOW:
 * 1. Receive raw OHLCV data from Binance/CoinGecko
 * 2. Engineer features (v7.1 BALANCED - 15 bullish + 15 bearish)
 * 3. Load 5 crypto models in parallel
 * 4. Run ensemble predictions
 * 5. Store in MongoDB
 * 6. Return result
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

const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs');
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
  STORAGE_TIMEOUT_MS: 3000
};

// ============================================================================
// CACHING LAYER
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
    /**
     * Load all available models in parallel for speed
     */
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
// FEATURE ENGINEERING
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
    const categories = engineer.getFeatureCategories();
    const balance = engineer.getBalanceReport();
    
    if (!featureList || featureList.length === 0) {
      throw new Error('No features engineered');
    }
    
    console.log(`  Total features: ${featureList.length}`);
    console.log(`  Balance: ${balance.bullish_count} bullish, ${balance.bearish_count} bearish`);
    
    if (!balance.is_balanced) {
      console.warn(`  ⚠️ Features imbalanced (may affect predictions)`);
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
    throw error;
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
function extractCryptoFeatureVector(engineeredData, featureList) {
  try {
    // Find last row index
    const firstKey = Object.keys(engineeredData).find(k => Array.isArray(engineeredData[k]));
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
      console.warn(`  ⚠️ Feature issues (${issues.length}): ${issues.slice(0, 3).join(', ')}`);
    }
    
    return features;
    
  } catch (error) {
    console.error(`[FeatureExtraction] Error: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// MODEL INFERENCE
// ============================================================================

/**
 * Run single model prediction
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
        
        // Cleanup
        inputTensor.dispose();
        outputTensor.dispose();
        
        resolve(result);
      }).catch(error => {
        clearTimeout(timeout);
        inputTensor.dispose();
        outputTensor.dispose();
        reject(error);
      });
      
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Run predictions across multiple models
 * 
 * @param {Array<Object>} models - Loaded model objects
 * @param {Array<Number>} features - Feature vector
 * @returns {Promise<Array>} Array of predictions
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
 * Ensemble multiple predictions
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
  
  // Simple average
  for (const pred of predictions) {
    for (let i = 0; i < numClasses; i++) {
      ensemble[i] += (pred[i] || 0);
    }
  }
  
  for (let i = 0; i < numClasses; i++) {
    ensemble[i] /= predictions.length;
  }
  
  // Normalize to ensure valid probabilities
  const sum = ensemble.reduce((a, b) => a + b, 0);
  const normalized = ensemble.map(p => p / sum);
  
  // Get predicted class
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
// MONGODB STORAGE
// ============================================================================

/**
 * Store prediction in MongoDB
 * Non-blocking - doesn't fail if storage fails
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
      console.warn(`  ✗ HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
  } catch (error) {
    console.warn(`  ✗ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  modelCache,
  CONFIG,
  engineCryptoFeatures,
  extractCryptoFeatureVector,
  runSinglePrediction,
  runEnsemblePredictions,
  ensembleCryptoPredictions,
  storeCryptoPrediction
};