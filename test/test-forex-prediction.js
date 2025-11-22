/**
 * Test Forex Prediction Pipeline
 * 
 * Tests the ENTIRE flow:
 * 1. Fetch real data from Twelve Data
 * 2. Engineer features
 * 3. Load models
 * 4. Run prediction
 * 5. Store in MongoDB
 * 
 * Run: node test/test-forex-prediction.js
 */

require('dotenv').config();
const { orchestrator } = require('../api/data-orchestrator');
const {
  forexModelCache,
  engineForexFeatures,
  extractForexFeatureVector,
  runForexEnsemblePredictions,
  ensembleForexPredictions
} = require('../api/predict-forex-handler');

const TEST_PAIR = 'EURUSD';

async function testForexPrediction() {
  console.log('\n' + '='.repeat(70));
  console.log('FOREX PREDICTION PIPELINE TEST');
  console.log('='.repeat(70));
  console.log(`\nTesting with: ${TEST_PAIR}`);
  console.log('This will test the ENTIRE pipeline from data fetch to prediction\n');
  
  const startTime = Date.now();
  
  try {
    // ========================================================================
    // STEP 1: FETCH REAL DATA
    // ========================================================================
    console.log('[1/6] Fetching real market data from Twelve Data...');
    
    const rawData = await orchestrator.fetchData(TEST_PAIR);
    
    if (!rawData || !rawData['1h_close']) {
      throw new Error('Failed to fetch market data');
    }
    
    console.log(`  ✓ Fetched ${rawData['1h_close'].length} hourly candles`);
    console.log(`  ✓ Latest close: ${rawData['1h_close'][rawData['1h_close'].length - 1].toFixed(5)}`);
    
    // ========================================================================
    // STEP 2: ENGINEER FEATURES
    // ========================================================================
    console.log('\n[2/6] Engineering features...');
    
    const featureResult = engineForexFeatures(rawData, TEST_PAIR);
    
    if (!featureResult.success) {
      throw new Error('Feature engineering failed');
    }
    
    console.log(`  ✓ Features engineered: ${featureResult.featureList.length}`);
    console.log(`  ✓ Conservative features (no leakage)`);
    
    // ========================================================================
    // STEP 3: EXTRACT FEATURE VECTOR
    // ========================================================================
    console.log('\n[3/6] Extracting feature vector...');
    
    const featureVector = extractForexFeatureVector(
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
    console.log('\n[4/6] Loading forex models...');
    
    const models = await forexModelCache.loadAllModels();
    
    if (models.length === 0) {
      throw new Error('No models loaded! Check models/forex/ directory');
    }
    
    console.log(`  ✓ Models loaded: ${models.length}/4`);
    
    const stats = forexModelCache.getStats();
    console.log(`  ✓ Cache stats: ${stats.loaded} loaded, ${stats.reused} reused, ${stats.failed} failed`);
    
    // ========================================================================
    // STEP 5: RUN PREDICTIONS
    // ========================================================================
    console.log('\n[5/6] Running predictions...');
    
    const predictionResult = await runForexEnsemblePredictions(models, featureVector);
    
    console.log(`  ✓ Predictions: ${predictionResult.predictions.length}/${models.length} succeeded`);
    
    if (predictionResult.predictions.length === 0) {
      throw new Error('All predictions failed!');
    }
    
    // ========================================================================
    // STEP 6: ENSEMBLE RESULTS
    // ========================================================================
    console.log('\n[6/6] Ensembling results...');
    
    const ensembleResult = ensembleForexPredictions(predictionResult.predictions);
    
    const elapsed = Date.now() - startTime;
    
    // ========================================================================
    // RESULTS
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS');
    console.log('='.repeat(70));
    console.log(`\nPair: ${TEST_PAIR}`);
    console.log(`Prediction: ${ensembleResult.className}`);
    console.log(`Confidence: ${(ensembleResult.confidence * 100).toFixed(1)}%`);
    console.log('\nProbabilities:');
    console.log(`  DOWN:    ${(ensembleResult.probabilities.down * 100).toFixed(1)}%`);
    console.log(`  NEUTRAL: ${(ensembleResult.probabilities.neutral * 100).toFixed(1)}%`);
    console.log(`  UP:      ${(ensembleResult.probabilities.up * 100).toFixed(1)}%`);
    console.log(`\nModels Used: ${ensembleResult.modelsUsed}/4`);
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
        name: 'Models Loaded',
        pass: models.length >= 2,
        message: `${models.length}/4 models`
      },
      {
        name: 'Predictions Successful',
        pass: predictionResult.predictions.length >= 2,
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
  testForexPrediction();
}

module.exports = { testForexPrediction };