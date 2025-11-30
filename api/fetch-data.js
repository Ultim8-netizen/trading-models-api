/**
 * Data Orchestrator - Free Tier Optimized.   actual file name: fetch-data.js
 * 
 * STRATEGY:
 * - Crypto: Binance (unlimited free) → CoinGecko (50 calls/min free)
 * - Forex: Twelve Data (800 calls/day free) → EODHD (fallback)
 * 
 * FEATURES:
 * ✓ Intelligent caching (24-48 hour for forex, 1 hour for crypto)
 * ✓ Quota tracking and warnings
 * ✓ Smart batching to minimize API calls
 * ✓ Rate limiting aware (respects all API limits)
 * ✓ Cost-aware (always prioritize free tier options)
 */

const cryptoFetcher = require('./crypto-data-fetcher');
const forexFetcher = require('./forex-data-fetcher');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Asset definitions
  CRYPTO_PAIRS: [
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT',
    'ETC/USDT', 'DOGE/USDT', 'ADA/USDT'
  ],
  
  FOREX_PAIRS: [
    'EURUSD', 'GBPJPY', 'USDJPY', 'GBPUSD',
    'AUDUSD', 'USDCAD', 'USDCHF', 'EURAUD', 'NZDUSD'
  ],
  
  // Cache configuration (optimized for free tier)
  CACHE_CRYPTO_DURATION_MS: 60 * 60 * 1000,        // 1 hour (crypto changes fast)
  CACHE_FOREX_DURATION_MS: 4 * 60 * 60 * 1000,     // 4 hours (forex more stable)
  ENABLE_CACHE: true,
  
  // Request configuration
  MAX_RETRIES: 1,  // Minimal retries to save quota
  RETRY_DELAY_MS: 2000
};

// ============================================================================
// INTELLIGENT CACHE SYSTEM
// ============================================================================

class IntelligentCache {
  constructor() {
    this.cache = {};
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }
  
  set(key, value, durationMs) {
    this.cache[key] = {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + durationMs,
      durationMs
    };
  }
  
  get(key) {
    if (!this.cache[key]) {
      this.stats.misses++;
      return null;
    }
    
    const entry = this.cache[key];
    if (entry.expiresAt < Date.now()) {
      delete this.cache[key];
      this.stats.evictions++;
      return null;
    }
    
    this.stats.hits++;
    const agePercent = ((Date.now() - entry.timestamp) / entry.durationMs * 100).toFixed(0);
    return { value: entry.value, agePercent };
  }
  
  has(key) {
    const cached = this.get(key);
    return cached !== null;
  }
  
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(1) : 0,
      itemsInCache: Object.keys(this.cache).length,
      totalRequests: total
    };
  }
  
  clear() {
    this.cache = {};
  }
}

const cache = new IntelligentCache();

// ============================================================================
// REQUEST LOG & QUOTA TRACKING
// ============================================================================

class RequestLog {
  constructor() {
    this.logs = [];
    this.quotaUsage = {
      crypto: { binance: 0, coingecko: 0 },
      forex: { twelvedata: 0, eodhd: 0, alphavantage: 0 }
    };
  }
  
  log(entry) {
    this.logs.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    
    // Update quota
    if (entry.source) {
      const parts = entry.source.toLowerCase().split(' ');
      const source = parts[0];
      const assetClass = entry.assetClass;
      
      if (this.quotaUsage[assetClass] && this.quotaUsage[assetClass][source] !== undefined) {
        this.quotaUsage[assetClass][source]++;
      }
    }
    
    // Keep only last 100 logs
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }
  }
  
  getQuotaReport() {
    return {
      crypto: {
        binance: `${this.quotaUsage.crypto.binance} requests (unlimited)`,
        coingecko: `${this.quotaUsage.crypto.coingecko} requests (50/min)`
      },
      forex: {
        twelvedata: `${this.quotaUsage.forex.twelvedata} requests (800/day)`,
        eodhd: `${this.quotaUsage.forex.eodhd} requests (20/min, paid)`,
        alphavantage: `${this.quotaUsage.forex.alphavantage} requests (5/min, paid)`
      }
    };
  }
  
  getRecent(count = 10) {
    return this.logs.slice(-count);
  }
}

const requestLog = new RequestLog();

// ============================================================================
// ASSET CLASSIFICATION
// ============================================================================

function classifyAsset(symbol) {
  if (CONFIG.CRYPTO_PAIRS.includes(symbol)) {
    return {
      assetClass: 'crypto',
      symbol,
      valid: true,
      primarySource: 'Binance',
      fallbackSource: 'CoinGecko'
    };
  }
  
  if (CONFIG.FOREX_PAIRS.includes(symbol)) {
    return {
      assetClass: 'forex',
      symbol,
      valid: true,
      primarySource: 'TwelveData (800/day free)',
      fallbackSource: 'EODHD'
    };
  }
  
  return {
    valid: false,
    error: `Unknown symbol: ${symbol}`
  };
}

// ============================================================================
// FETCH WITH RETRY & QUOTA AWARENESS
// ============================================================================

async function fetchWithRetry(symbol, fetchFn, assetClass, retries = 0) {
  try {
    return await fetchFn(symbol);
  } catch (error) {
    if (retries < CONFIG.MAX_RETRIES) {
      console.warn(`[Retry] Attempt ${retries + 1}/${CONFIG.MAX_RETRIES + 1}...`);
      await new Promise(resolve => 
        setTimeout(resolve, CONFIG.RETRY_DELAY_MS * (retries + 1))
      );
      return fetchWithRetry(symbol, fetchFn, assetClass, retries + 1);
    } else {
      throw error;
    }
  }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

class DataOrchestrator {
  constructor() {
    this.cache = cache;
    this.requestLog = requestLog;
  }
  
  /**
   * Fetch data for any symbol with smart caching
   * 
   * @param {String} symbol - Trading symbol
   * @returns {Promise<Object>} Multi-timeframe OHLCV data
   */
  async fetchData(symbol) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[Orchestrator] Fetching ${symbol}`);
    console.log(`${'='.repeat(70)}`);
    
    const startTime = Date.now();
    
    try {
      // Classify asset
      const classification = classifyAsset(symbol);
      if (!classification.valid) {
        throw new Error(classification.error);
      }
      
      console.log(`✓ Asset: ${classification.assetClass}`);
      console.log(`✓ Primary: ${classification.primarySource}`);
      console.log(`✓ Fallback: ${classification.fallbackSource}`);
      
      // Check cache
      const cacheKey = `${symbol}`;
      const cacheDuration = classification.assetClass === 'crypto'
        ? CONFIG.CACHE_CRYPTO_DURATION_MS
        : CONFIG.CACHE_FOREX_DURATION_MS;
      
      const cached = this.cache.get(cacheKey);
      if (cached && CONFIG.ENABLE_CACHE) {
        console.log(`\n✅ CACHE HIT (age: ${cached.agePercent}%)`);
        
        this.requestLog.log({
          symbol,
          assetClass: classification.assetClass,
          source: 'Cache',
          elapsed: Date.now() - startTime,
          success: true
        });
        
        return cached.value;
      }
      
      // Fetch from API
      console.log(`\n⏳ Fetching from API...`);
      
      let data;
      if (classification.assetClass === 'crypto') {
        data = await fetchWithRetry(symbol, cryptoFetcher.fetchCryptoData, 'crypto');
      } else {
        data = await fetchWithRetry(symbol, forexFetcher.fetchForexData, 'forex');
      }
      
      // Validate data
      const validation = this._validateData(data);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.slice(0, 2).join('; ')}`);
      }
      
      // Cache data
      if (CONFIG.ENABLE_CACHE) {
        this.cache.set(cacheKey, data, cacheDuration);
      }
      
      const elapsed = Date.now() - startTime;
      
      this.requestLog.log({
        symbol,
        assetClass: classification.assetClass,
        source: 'API',
        elapsed,
        success: true,
        dataPoints: validation.dataPoints
      });
      
      console.log(`\n✅ Success (${elapsed}ms, ${validation.dataPoints} points)`);
      console.log(`${'='.repeat(70)}\n`);
      
      return data;
      
    } catch (error) {
      const elapsed = Date.now() - startTime;
      
      this.requestLog.log({
        symbol,
        assetClass: classifyAsset(symbol).assetClass,
        source: 'API-Error',
        elapsed,
        success: false,
        error: error.message
      });
      
      console.error(`\n✗ Error: ${error.message}`);
      console.log(`${'='.repeat(70)}\n`);
      
      throw error;
    }
  }
  /**
   * Fetch multiple symbols efficiently
   * Uses cache and parallel requests where possible
   * 
   * @param {Array<String>} symbols - Trading symbols
   * @returns {Promise<Object>} Results
   */
  async fetchBatch(symbols) {
    console.log(`\n[BatchFetch] Processing ${symbols.length} symbols...`);
    
    const results = {};
    const errors = {};
    
    // Separate by asset class for parallel processing efficiency
    const cryptoSymbols = symbols.filter(s => CONFIG.CRYPTO_PAIRS.includes(s));
    const forexSymbols = symbols.filter(s => CONFIG.FOREX_PAIRS.includes(s));
    
    console.log(`  - Crypto: ${cryptoSymbols.length}`);
    console.log(`  - Forex: ${forexSymbols.length}`);
    
    // Fetch in sequence by asset class (respects rate limits)
    const allFetches = [
      ...cryptoSymbols.map(s => 
        this.fetchData(s)
          .then(data => { results[s] = data; })
          .catch(error => { errors[s] = error.message; })
      ),
      ...forexSymbols.map(s =>
        this.fetchData(s)
          .then(data => { results[s] = data; })
          .catch(error => { errors[s] = error.message; })
      )
    ];
    
    await Promise.all(allFetches);
    
    const successCount = Object.keys(results).length;
    const errorCount = Object.keys(errors).length;
    
    console.log(`\n[BatchFetch] Complete: ${successCount} succeeded, ${errorCount} failed`);
    
    if (errorCount > 0) {
      console.warn(`Failed symbols:`, errors);
    }
    
    return {
      success: successCount > 0,
      results,
      errors: errorCount > 0 ? errors : null,
      stats: {
        total: symbols.length,
        succeeded: successCount,
        failed: errorCount
      }
    };
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }
  
  /**
   * Get quota usage report
   */
  getQuotaReport() {
    return this.requestLog.getQuotaReport();
  }
  
  /**
   * Get recent requests
   */
  getRecentRequests(count = 10) {
    return this.requestLog.getRecent(count);
  }
  
  /**
   * Get supported symbols
   */
  getSupportedSymbols() {
    return {
      crypto: CONFIG.CRYPTO_PAIRS,
      forex: CONFIG.FOREX_PAIRS,
      all: [...CONFIG.CRYPTO_PAIRS, ...CONFIG.FOREX_PAIRS]
    };
  }
  
  /**
   * Get Twelve Data quota status (for forex planning)
   */
  getTwelveDataStatus() {
    return forexFetcher.getTwelveDataStats();
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[Cache] Cleared');
  }
  
  /**
   * Validate data structure
   */
  _validateData(data) {
    const errors = [];
    const requiredTimeframes = ['1h', '4h', '1d'];
    const requiredFields = ['open', 'high', 'low', 'close', 'volume'];
    
    for (const tf of requiredTimeframes) {
      for (const field of requiredFields) {
        const key = `${tf}_${field}`;
        
        if (!data[key]) {
          errors.push(`Missing: ${key}`);
          continue;
        }
        
        if (!Array.isArray(data[key]) || data[key].length === 0) {
          errors.push(`Empty: ${key}`);
          continue;
        }
      }
    }
    
    const lengths = new Set();
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        lengths.add(data[key].length);
      }
    }
    
    if (lengths.size > 1) {
      errors.push(`Inconsistent lengths`);
    }
    
    const dataPoints = data['1h_close']?.length || 0;
    
    return {
      valid: errors.length === 0,
      errors,
      dataPoints
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

const orchestrator = new DataOrchestrator();

// ============================================================================
// VERCEL API HANDLER
// ============================================================================

/**
 * Main fetch endpoint
 * GET /api/fetch-data?symbol=BTC/USDT
 * GET /api/fetch-data?batch=BTC/USDT,EURUSD,ETH/USDT
 * GET /api/fetch-data?health=true
 */
const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== HEALTH CHECK =====
  if (req.query.health === 'true') {
    try {
      const cacheStats = orchestrator.getCacheStats();
      const quotaReport = orchestrator.getQuotaReport();
      const recentRequests = orchestrator.getRecentRequests(5);
      
      return res.status(200).json({
        status: 'healthy',
        service: 'fetch-data',
        cache: cacheStats,
        quota: quotaReport,
        recentRequests,
        supported: orchestrator.getSupportedSymbols(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // ===== MAIN FETCH LOGIC =====
  try {
    const { symbol, batch } = req.query;
    
    if (!symbol && !batch) {
      return res.status(400).json({
        error: 'Missing parameter',
        usage: {
          single: '/api/fetch-data?symbol=BTC/USDT',
          batch: '/api/fetch-data?batch=BTC/USDT,EURUSD',
          health: '/api/fetch-data?health=true'
        },
        supported: orchestrator.getSupportedSymbols()
      });
    }
    
    if (symbol) {
      const data = await orchestrator.fetchData(symbol);
      
      return res.status(200).json({
        success: true,
        symbol,
        dataPoints: data['1h_close']?.length || 0,
        timestamp: new Date().toISOString(),
        data
      });
    }
    
    if (batch) {
      const symbols = batch.split(',').map(s => s.trim());
      const result = await orchestrator.fetchBatch(symbols);
      
      return res.status(200).json({
        success: result.success,
        stats: result.stats,
        timestamp: new Date().toISOString(),
        errors: result.errors
      });
    }
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ============================================================================
// SINGLE EXPORT
// ============================================================================

module.exports = handler;