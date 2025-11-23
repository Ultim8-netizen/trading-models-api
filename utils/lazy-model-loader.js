/**
 * Lazy Model Loader - Load models on-demand, not on startup
 * CRITICAL: Only loads models when predict endpoint is called
 * Keeps memory footprint minimal until prediction is actually needed
 */

const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

class LazyModelLoader {
    constructor(modelsDir = 'models/crypto') {
        this.modelsDir = modelsDir;
        this.models = {};
        this.loadingPromises = {}; // Prevent duplicate simultaneous loads
        this.stats = {
            loaded: 0,
            failed: 0,
            attempts: 0,
            lastLoadTime: null
        };
    }

    /**
     * Load single model on-demand
     * RETURNS: model or null if fails
     */
    async loadModelLazy(modelName) {
        // Prevent duplicate simultaneous loads
        if (this.loadingPromises[modelName]) {
            return this.loadingPromises[modelName];
        }

        // If already loaded, return immediately (no memory cost)
        if (this.models[modelName]) {
            return this.models[modelName];
        }

        // Create loading promise and cache it
        const loadPromise = (async () => {
            try {
                this.stats.attempts++;
                const startTime = Date.now();

                const modelPath = path.join(
                    process.cwd(),
                    this.modelsDir,
                    `${modelName}.keras`
                );

                // Check file exists
                if (!fs.existsSync(modelPath)) {
                    console.warn(`⚠️ Model file missing: ${modelPath}`);
                    this.stats.failed++;
                    return null;
                }

                const fileSize = fs.statSync(modelPath).size / 1024 / 1024;
                console.log(`📦 Loading ${modelName} (${fileSize.toFixed(1)}MB)...`);

                // Load model
                const model = await tf.loadLayersModel(`file://${modelPath}`);

                if (!model || !model.predict) {
                    console.warn(`⚠️ Invalid model structure: ${modelName}`);
                    this.stats.failed++;
                    return null;
                }

                const loadTime = Date.now() - startTime;
                this.stats.loaded++;
                this.stats.lastLoadTime = loadTime;

                console.log(`✓ ${modelName} loaded (${loadTime}ms)`);

                // Cache the model
                this.models[modelName] = model;
                return model;

            } catch (error) {
                console.error(`❌ Failed to load ${modelName}: ${error.message}`);
                this.stats.failed++;
                return null;
            } finally {
                // Clean up promise reference
                delete this.loadingPromises[modelName];
            }
        })();

        this.loadingPromises[modelName] = loadPromise;
        return loadPromise;
    }

    /**
     * Load minimum required models (not all 5)
     * Strategy: Load best-performing models first, skip others if tight on memory
     * 
     * PRIORITY ORDER (based on performance):
     * 1. temporal_transformer.keras (usually best)
     * 2. hybrid_transformer.keras
     * 3. hierarchical_lstm.keras
     * SKIP: bidirectional_attention, multiscale_transformer (to save memory)
     */
    async loadMinimalEnsemble() {
        const priorityModels = [
            'temporal_transformer',
            'hybrid_transformer',
            'hierarchical_lstm'
        ];

        console.log(`\n[Models] Loading minimal ensemble (${priorityModels.length} models)...`);

        const results = [];

        for (const modelName of priorityModels) {
            try {
                const model = await this.loadModelLazy(modelName);
                if (model) {
                    results.push({ name: modelName, model, success: true });
                    console.log(`  ✓ ${modelName}`);
                } else {
                    console.warn(`  ⚠️ ${modelName} failed to load`);
                    results.push({ name: modelName, model: null, success: false });
                }
            } catch (error) {
                console.error(`  ✗ ${modelName}: ${error.message}`);
                results.push({ name: modelName, model: null, success: false });
            }
        }

        const loadedCount = results.filter(r => r.success).length;
        console.log(`[Models] Loaded ${loadedCount}/${priorityModels.length} models\n`);

        if (loadedCount === 0) {
            throw new Error('Failed to load ANY models - cannot proceed with prediction');
        }

        return results.filter(r => r.success).map(r => r.model);
    }

    /**
     * Load models on-demand only when needed
     * Returns only successfully loaded models (may be less than requested)
     */
    async loadAvailableModels(modelNames = null) {
        const toLoad = modelNames || [
            'temporal_transformer',
            'hybrid_transformer',
            'hierarchical_lstm'
        ];

        const models = [];

        for (const name of toLoad) {
            const model = await this.loadModelLazy(name);
            if (model) {
                models.push(model);
            }
        }

        return models;
    }

    /**
     * Unload a specific model to free memory
     * Useful if memory gets tight during prediction
     */
    unloadModel(modelName) {
        if (this.models[modelName] && this.models[modelName].dispose) {
            try {
                this.models[modelName].dispose();
                delete this.models[modelName];
                console.log(`🗑️ Unloaded ${modelName}`);
            } catch (e) {
                console.warn(`Failed to unload ${modelName}: ${e.message}`);
            }
        }
    }

    /**
     * Unload ALL models to free memory
     */
    unloadAll() {
        for (const modelName in this.models) {
            this.unloadModel(modelName);
        }
        console.log('🗑️ All models unloaded');
    }

    /**
     * Get memory stats
     */
    getStats() {
        const memInfo = tf.memory();
        return {
            ...this.stats,
            modelsInMemory: Object.keys(this.models).length,
            tfMemoryBytes: memInfo.numBytes,
            tfMemoryMB: (memInfo.numBytes / 1024 / 1024).toFixed(2),
            numTensors: memInfo.numTensors
        };
    }

    /**
     * Check if model is loaded
     */
    isLoaded(modelName) {
        return !!this.models[modelName];
    }
}

module.exports = LazyModelLoader;