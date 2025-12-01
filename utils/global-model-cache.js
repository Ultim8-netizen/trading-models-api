/**
 * GLOBAL Model Cache with Explicit File References
 * This ensures Vercel's Node File Trace detects the models
 */

const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

// ============================================================================
// CRITICAL: Explicit file references for Vercel's Node File Trace
// ============================================================================

// List all model files explicitly so Vercel knows they're needed
const CRYPTO_MODEL_FILES = [
    'temporal_transformer.keras',
    'hybrid_transformer.keras',
    'hierarchical_lstm.keras',
    'bidirectional_attention.keras',
    'multiscale_transformer.keras'
];

const FOREX_MODEL_FILES = [
    'temporal_transformer.keras',
    'hierarchical_lstm.keras',
    'hybrid_transformer.keras',
    'multiscale_transformer.keras'
];

// Global state (persists across invocations)
let CRYPTO_MODELS = null;
let FOREX_MODELS = null;
let IS_CRYPTO_LOADING = false;
let IS_FOREX_LOADING = false;
let CRYPTO_LOAD_PROMISE = null;
let FOREX_LOAD_PROMISE = null;

/**
 * Verify model files exist at startup
 * This creates fs references that Vercel's trace can detect
 */
function verifyModelFiles(modelNames, modelsDir) {
    const missing = [];
    
    for (const fileName of modelNames) {
        const filePath = path.join(process.cwd(), modelsDir, fileName);
        
        // CRITICAL: This fs.existsSync call is what Node File Trace detects
        if (!fs.existsSync(filePath)) {
            missing.push(fileName);
        }
    }
    
    if (missing.length > 0) {
        throw new Error(
            `Missing model files in ${modelsDir}: ${missing.join(', ')}\n` +
            `Expected location: ${path.join(process.cwd(), modelsDir)}`
        );
    }
    
    console.log(`✓ Verified ${modelNames.length} model files in ${modelsDir}`);
}

/**
 * Load multiple models in PARALLEL
 */
async function loadModelsParallel(modelNames, modelsDir) {
    console.log(`[GlobalCache] Loading ${modelNames.length} models in PARALLEL...`);
    const startTime = Date.now();
    
    // Load ALL models simultaneously
    const loadPromises = modelNames.map(async (fileName) => {
        try {
            const modelPath = path.join(process.cwd(), modelsDir, fileName);
            const model = await tf.loadLayersModel(`file://${modelPath}`);
            
            const name = fileName.replace('.keras', '');
            console.log(`  ✓ ${name} loaded`);
            return { name, model, fileName };
        } catch (error) {
            console.error(`  ✗ ${fileName} failed: ${error.message}`);
            return null;
        }
    });
    
    const results = await Promise.all(loadPromises);
    const loadedModels = results.filter(r => r !== null);
    
    const elapsed = Date.now() - startTime;
    console.log(`[GlobalCache] Loaded ${loadedModels.length}/${modelNames.length} in ${elapsed}ms`);
    
    return loadedModels;
}

/**
 * WARM UP models with dummy prediction
 */
async function warmUpModels(models, inputShape) {
    console.log('[GlobalCache] Warming up models...');
    
    const dummyInput = tf.zeros(inputShape);
    
    for (const { name, model } of models) {
        try {
            const warmupResult = model.predict(dummyInput);
            await warmupResult.data();
            warmupResult.dispose();
            console.log(`  ✓ ${name} warmed`);
        } catch (error) {
            console.warn(`  ⚠️ ${name} warmup failed: ${error.message}`);
        }
    }
    
    dummyInput.dispose();
}

/**
 * Initialize CRYPTO models globally
 */
async function initializeCryptoModels() {
    if (CRYPTO_MODELS) return CRYPTO_MODELS;
    if (IS_CRYPTO_LOADING && CRYPTO_LOAD_PROMISE) return CRYPTO_LOAD_PROMISE;
    
    IS_CRYPTO_LOADING = true;
    
    CRYPTO_LOAD_PROMISE = (async () => {
        try {
            console.log('\n🚀 [COLD START] Initializing crypto models...');
            
            const modelsDir = 'models/crypto';
            
            // CRITICAL: Verify files exist (creates fs references for Vercel)
            verifyModelFiles(CRYPTO_MODEL_FILES, modelsDir);
            
            // Load in parallel
            const loaded = await loadModelsParallel(CRYPTO_MODEL_FILES, modelsDir);
            
            if (loaded.length === 0) {
                throw new Error('No crypto models loaded!');
            }
            
            // Warm up with correct input shape
            await warmUpModels(loaded, [1, 50]);
            
            CRYPTO_MODELS = loaded;
            IS_CRYPTO_LOADING = false;
            
            console.log(`✅ Crypto models ready: ${loaded.length} models\n`);
            return loaded;
            
        } catch (error) {
            IS_CRYPTO_LOADING = false;
            CRYPTO_LOAD_PROMISE = null;
            console.error('❌ Crypto model initialization failed:', error.message);
            throw error;
        }
    })();
    
    return CRYPTO_LOAD_PROMISE;
}

/**
 * Initialize FOREX models globally
 */
async function initializeForexModels() {
    if (FOREX_MODELS) return FOREX_MODELS;
    if (IS_FOREX_LOADING && FOREX_LOAD_PROMISE) return FOREX_LOAD_PROMISE;
    
    IS_FOREX_LOADING = true;
    
    FOREX_LOAD_PROMISE = (async () => {
        try {
            console.log('\n🚀 [COLD START] Initializing forex models...');
            
            const modelsDir = 'models/forex';
            
            // CRITICAL: Verify files exist
            verifyModelFiles(FOREX_MODEL_FILES, modelsDir);
            
            const loaded = await loadModelsParallel(FOREX_MODEL_FILES, modelsDir);
            
            if (loaded.length === 0) {
                throw new Error('No forex models loaded!');
            }
            
            await warmUpModels(loaded, [1, 40]);
            
            FOREX_MODELS = loaded;
            IS_FOREX_LOADING = false;
            
            console.log(`✅ Forex models ready: ${loaded.length} models\n`);
            return loaded;
            
        } catch (error) {
            IS_FOREX_LOADING = false;
            FOREX_LOAD_PROMISE = null;
            console.error('❌ Forex model initialization failed:', error.message);
            throw error;
        }
    })();
    
    return FOREX_LOAD_PROMISE;
}

/**
 * Get crypto models (loads if needed)
 */
async function getCryptoModels() {
    if (!CRYPTO_MODELS) {
        await initializeCryptoModels();
    }
    return CRYPTO_MODELS.map(m => m.model);
}

/**
 * Get forex models (loads if needed)
 */
async function getForexModels() {
    if (!FOREX_MODELS) {
        await initializeForexModels();
    }
    return FOREX_MODELS.map(m => m.model);
}

/**
 * Get stats
 */
function getGlobalCacheStats() {
    const tfMem = tf.memory();
    return {
        crypto: {
            loaded: CRYPTO_MODELS ? CRYPTO_MODELS.length : 0,
            isLoading: IS_CRYPTO_LOADING,
            modelFiles: CRYPTO_MODEL_FILES
        },
        forex: {
            loaded: FOREX_MODELS ? FOREX_MODELS.length : 0,
            isLoading: IS_FOREX_LOADING,
            modelFiles: FOREX_MODEL_FILES
        },
        tfMemory: {
            numBytes: tfMem.numBytes,
            numBytesMB: (tfMem.numBytes / 1024 / 1024).toFixed(2),
            numTensors: tfMem.numTensors
        }
    };
}

module.exports = {
    getCryptoModels,
    getForexModels,
    getGlobalCacheStats,
    // Export file lists for verification
    CRYPTO_MODEL_FILES,
    FOREX_MODEL_FILES
};