/**
 * Test Crypto Prediction Pipeline
 * 
 * Tests the ENTIRE flow:
 * 1. Fetch real data from Binance
 * 2. Engineer features
 * 3. Load models
 * 4. Run prediction
 * 5. Store in MongoDB
 * 
 * Run: node test/test-crypto-prediction.js
 */

require('dotenv').config();
const { orchestrator } = require('../api/data-orchestrator');
const {
  modelCache,
  engineCryptoFeatures,
  extractCryptoFeatureVector,
  runEnsemblePredictions,
  ensembleCryptoPredictions
} = require('../api/predict-crypto-handler');

const TEST_SYMBOL = 'BTC/USDT';

async function testCryptoPrediction() {
  console.log('\n' + '='.repeat(70));
  console.log('CRYPTO PREDICTION PIPELINE TEST');
  console.log('='.repeat(70));
  console.log(`\nTesting with: ${TEST_SYMBOL}`);
  console.log('This will test the ENTIRE pipeline from data fetch to prediction\n');
  
  const startTime = Date.now();
  
  try {
    // ========================================================================
    // STEP 1: FETCH REAL DATA
    // ========================================================================
    console.log('[1/6] Fetching real market data from Binance...');
    
    const rawData = await orchestrator.fetchData(TEST_SYMBOL);
    
    if (!rawData || !rawData['1h_close']) {
      throw new Error('Failed to fetch market data');
    }
    
    console.log(`  ✓ Fetched ${rawData['1h_close'].length} hourly candles`);
    console.log(`  ✓ Latest close: $${rawData['1h_close'][rawData['1h_close'].length - 1].toFixed(2)}`);
    
    // ========================================================================
    // STEP 2: ENGINEER FEATURES
    // ========================================================================
    console.log('\n[2/6] Engineering features...');
    
    const featureResult = engineCryptoFeatures(rawData, TEST_SYMBOL);
    
    if (!featureResult.success) {
      throw new Error('Feature engineering failed');
    }
    
    console.log(`  ✓ Features engineered: ${featureResult.featureList.length}`);
    console.log(`  ✓ Bullish signals: ${featureResult.balance.bullish_count}`);
    console.log(`  ✓ Bearish signals: ${featureResult.balance.bearish_count}`);
    console.log(`  ✓ Balanced: ${featureResult.balance.is_balanced ? 'YES' : 'NO'}`);
    
    if (!featureResult.balance.is_balanced) {
      console.warn('  ⚠️ WARNING: Features not balanced! May affect predictions.');
    }
    
    // ========================================================================
    // STEP 3: EXTRACT FEATURE VECTOR
    // ========================================================================
    console.log('\n[3/6] Extracting feature vector...');
    
    const featureVector = extractCryptoFeatureVector(
      featureResult.engineeredData,
      featureResult.featureList
    );
    
    console.log(`  ✓ Feature vector length: ${featureVector.length}`);
    
    // Check for invalid values
    const invalidCount = featureVector.filter(v => !isFinite(v)).length;
    if (invalidCount > 0) {
      console.warn(`  ⚠️ ${invalidCount} invalid values (will be replaced with 0)`);
    }
    
    // ========================================================================
    // STEP 4: LOAD MODELS
    // ========================================================================
    console.log('\n[4/6] Loading crypto models...');
    
    const models = await modelCache.loadAllModels();
    
    if (models.length === 0) {
      throw new Error('No models loaded! Check models/crypto/ directory');
    }
    
    console.log(`  ✓ Models loaded: ${models.length}/5`);
    
    const stats = modelCache.getStats();
    console.log(`  ✓ Cache stats: ${stats.loaded} loaded, ${stats.reused} reused, ${stats.failed} failed`);
    
    // ========================================================================
    // STEP 5: RUN PREDICTIONS
    // ========================================================================
    console.log('\n[5/6] Running predictions...');
    
    const predictionResult = await runEnsemblePredictions(models, featureVector);
    
    console.log(`  ✓ Predictions: ${predictionResult.predictions.length}/${models.length} succeeded`);
    
    if (predictionResult.predictions.length === 0) {
      throw new Error('All predictions failed!');
    }
    
    // ========================================================================
    // STEP 6: ENSEMBLE RESULTS
    // ========================================================================
    console.log('\n[6/6] Ensembling results...');
    
    const ensembleResult = ensembleCryptoPredictions(predictionResult.predictions);
    
    const elapsed = Date.now() - startTime;
    
    // ========================================================================
    // RESULTS
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS');
    console.log('='.repeat(70));
    console.log(`\nSymbol: ${TEST_SYMBOL}`);
    console.log(`Prediction: ${ensembleResult.className}`);
    console.log(`Confidence: ${(ensembleResult.confidence * 100).toFixed(1)}%`);
    console.log('\nProbabilities:');
    console.log(`  DOWN:    ${(ensembleResult.probabilities.down * 100).toFixed(1)}%`);
    console.log(`  NEUTRAL: ${(ensembleResult.probabilities.neutral * 100).toFixed(1)}%`);
    console.log(`  UP:      ${(ensembleResult.probabilities.up * 100).toFixed(1)}%`);
    console.log(`\nModels Used: ${ensembleResult.modelsUsed}/5`);
    console.log(`Total Time: ${elapsed}ms`);
    console.log('='.repeat(70));
    
    // ========================================================================
    // VALIDATION
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('VALIDATION');
    console.log('='.repeat(70));
    
    const checks = [
      {
        name: 'Data Fetched',
        pass: rawData['1h_close'].length >= 50,
        message: `${rawData['1h_close'].length} candles`
      },
      {
        name: 'Features Engineered',
        pass: featureResult.featureList.length >= 30,
        message: `${featureResult.featureList.length} features`
      },
      {
        name: 'Feature Balance',
        pass: featureResult.balance.is_balanced,
        message: featureResult.balance.is_balanced ? 'Balanced' : 'Imbalanced'
      },
      {
        name: 'Models Loaded',
        pass: models.length >= 3,
        message: `${models.length}/5 models`
      },
      {
        name: 'Predictions Successful',
        pass: predictionResult.predictions.length >= 3,
        message: `${predictionResult.predictions.length}/${models.length} succeeded`
      },
      {
        name: 'Confidence Valid',
        pass: ensembleResult.confidence >= 0 && ensembleResult.confidence <= 1,
        message: `${(ensembleResult.confidence * 100).toFixed(1)}%`
      },
      {
        name: 'Performance',
        pass: elapsed < 10000,
        message: `${elapsed}ms`
      }
    ];
    
    let allPassed = true;
    
    for (const check of checks) {
      const status = check.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${check.name}: ${check.message}`);
      if (!check.pass) allPassed = false;
    }
    
    console.log('='.repeat(70));
    
    if (allPassed) {
      console.log('\n✅ ALL TESTS PASSED - READY FOR DEPLOYMENT\n');
      process.exit(0);
    } else {
      console.log('\n❌ SOME TESTS FAILED - FIX ISSUES BEFORE DEPLOYMENT\n');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('TEST FAILED');
    console.error('='.repeat(70));
    console.error(`\nError: ${error.message}`);
    console.error(`\nStack trace:`);
    console.error(error.stack);
    console.error('\n' + '='.repeat(70));
    
    process.exit(1);
  }
}

// Run test
if (require.main === module) {
  testCryptoPrediction();
}

module.exports = { testCryptoPrediction };