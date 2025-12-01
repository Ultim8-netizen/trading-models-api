/**
 * GLOBAL Model Cache - Loads once, persists across invocations
 * CRITICAL: This runs ONCE per cold start, not per request
 */

const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

// Global state (persists across Vercel function invocations)
let CRYPTO_MODELS = null;
let FOREX_MODELS = null;
let IS_LOADING = false;
let LOAD_PROMISE = null;

/**
 * Load multiple models in PARALLEL (3-4s vs 9s sequential)
 */
async function loadModelsParallel(modelNames, modelsDir) {
    console.log(`[GlobalCache] Loading ${modelNames.length} models in PARALLEL...`);
    const startTime = Date.now();
    
    // Load ALL models simultaneously
    const loadPromises = modelNames.map(async (name) => {
        try {
            const modelPath = path.join(process.cwd(), modelsDir, `${name}.keras`);
            
            if (!fs.existsSync(modelPath)) {
                console.warn(`⚠️ Model missing: ${name}`);
                return null;
            }
            
            const model = await tf.loadLayersModel(`file://${modelPath}`);
            console.log(`  ✓ ${name} loaded`);
            return { name, model };
        } catch (error) {
            console.error(`  ✗ ${name} failed: ${error.message}`);
            return null;
        }
    });
    
    // Wait for ALL to complete
    const results = await Promise.all(loadPromises);
    const loadedModels = results.filter(r => r !== null);
    
    const elapsed = Date.now() - startTime;
    console.log(`[GlobalCache] Loaded ${loadedModels.length}/${modelNames.length} models in ${elapsed}ms`);
    
    return loadedModels;
}

/**
 * WARM UP models with dummy prediction
 * Critical: Eliminates first-run compilation delay
 */
async function warmUpModels(models, inputShape) {
    console.log('[GlobalCache] Warming up models...');
    
    const dummyInput = tf.zeros(inputShape);
    
    for (const { name, model } of models) {
        try {
            const warmupResult = model.predict(dummyInput);
            await warmupResult.data(); // Force execution
            warmupResult.dispose();
            console.log(`  ✓ ${name} warmed up`);
        } catch (error) {
            console.warn(`  ⚠️ ${name} warmup failed: ${error.message}`);
        }
    }
    
    dummyInput.dispose();
    console.log('[GlobalCache] Warmup complete');
}

/**
 * Initialize CRYPTO models globally
 */
async function initializeCryptoModels() {
    if (CRYPTO_MODELS) return CRYPTO_MODELS; // Already loaded
    if (IS_LOADING && LOAD_PROMISE) return LOAD_PROMISE; // Loading in progress
    
    IS_LOADING = true;
    
    LOAD_PROMISE = (async () => {
        try {
            console.log('\n🚀 [COLD START] Initializing crypto models...');
            
            const modelNames = [
                'temporal_transformer',
                'hybrid_transformer',
                'hierarchical_lstm',
                'bidirectional_attention',
                'multiscale_transformer'
            ];
            
            // PARALLEL LOAD (saves 5-7s!)
            const loaded = await loadModelsParallel(modelNames, 'models/crypto');
            
            if (loaded.length === 0) {
                throw new Error('No crypto models loaded!');
            }
            
            // WARM UP (saves 2-3s on first real prediction!)
            await warmUpModels(loaded, [1, 50]); // Adjust shape to match your features
            
            CRYPTO_MODELS = loaded;
            IS_LOADING = false;
            
            console.log(`✅ Crypto models ready: ${loaded.length} models cached globally\n`);
            return loaded;
            
        } catch (error) {
            IS_LOADING = false;
            LOAD_PROMISE = null;
            throw error;
        }
    })();
    
    return LOAD_PROMISE;
}

/**
 * Initialize FOREX models globally
 */
async function initializeForexModels() {
    if (FOREX_MODELS) return FOREX_MODELS;
    
    console.log('\n🚀 [COLD START] Initializing forex models...');
    
    const modelNames = [
        'temporal_transformer',
        'hierarchical_lstm',
        'hybrid_transformer',
        'multiscale_transformer'
    ];
    
    const loaded = await loadModelsParallel(modelNames, 'models/forex');
    await warmUpModels(loaded, [1, 40]); // Adjust to forex feature count
    
    FOREX_MODELS = loaded;
    console.log(`✅ Forex models ready: ${loaded.length} models cached globally\n`);
    
    return loaded;
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
 * Get memory stats
 */
function getGlobalCacheStats() {
    return {
        cryptoModels: CRYPTO_MODELS ? CRYPTO_MODELS.length : 0,
        forexModels: FOREX_MODELS ? FOREX_MODELS.length : 0,
        isLoading: IS_LOADING,
        tfMemory: tf.memory()
    };
}

module.exports = {
    getCryptoModels,
    getForexModels,
    getGlobalCacheStats
};