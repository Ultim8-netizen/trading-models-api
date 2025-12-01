/**
 * Warm-up endpoint - Pre-loads models before predictions
 * Call this from GitHub Actions BEFORE running predictions
 */

const { getCryptoModels, getForexModels, getGlobalCacheStats } = require('../utils/global-model-cache');

module.exports = async (req, res) => {
    console.log('\n🔥 WARM-UP REQUEST\n');
    
    try {
        const startTime = Date.now();
        
        // Load both crypto and forex models
        const [cryptoModels, forexModels] = await Promise.all([
            getCryptoModels(),
            getForexModels()
        ]);
        
        const elapsed = Date.now() - startTime;
        const stats = getGlobalCacheStats();
        
        console.log(`✅ Warm-up complete (${elapsed}ms)\n`);
        
        return res.status(200).json({
            success: true,
            message: 'Models warmed up and cached',
            cryptoModels: cryptoModels.length,
            forexModels: forexModels.length,
            warmupTime: elapsed,
            stats
        });
        
    } catch (error) {
        console.error('❌ Warm-up failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};