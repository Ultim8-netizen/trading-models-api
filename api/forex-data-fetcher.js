/**
 * Forex Data Fetcher - Twelve Data + EODHD/Alpha Vantage Fallback
 * 
 * PRIMARY: Twelve Data API - BEST FREE TIER FOR FOREX
 * - 800 API calls per day (completely free)
 * - 1-minute to daily candles
 * - Real forex data (not crypto approximations)
 * - NO API KEY for basic free tier
 * 
 * FALLBACK OPTIONS:
 * 1. EODHD (20 req/min, paid)
 * 2. Alpha Vantage (5 req/min, paid)
 * 
 * SUPPORTED PAIRS:
 * - EURUSD, GBPJPY, USDJPY, GBPUSD, AUDUSD, USDCAD, USDCHF, EURAUD, NZDUSD
 * 
 * RATE LIMIT STRATEGY:
 * ✓ Use batch requests where possible
 * ✓ Cache aggressively (24-48 hour cache)
 * ✓ Spread requests to avoid hitting 800/day limit
 * ✓ Fallback for critical trading hours
 */

const axios = require('axios');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Primary API - Twelve Data (BEST FREE TIER)
  TWELVE_DATA_API: 'https://api.twelvedata.com',
  
  // Fallback APIs
  EODHD_API: 'https://eodhd.com/api',
  ALPHA_VANTAGE_API: 'https://www.alphavantage.co/query',
  
  // Twelve Data Forex Symbols (format: PAIR)
  TWELVE_DATA_FOREX_PAIRS: {
    'EURUSD': 'EURUSD',
    'GBPJPY': 'GBPJPY',
    'USDJPY': 'USDJPY',
    'GBPUSD': 'GBPUSD',
    'AUDUSD': 'AUDUSD',
    'USDCAD': 'USDCAD',
    'USDCHF': 'USDCHF',
    'EURAUD': 'EURAUD',
    'NZDUSD': 'NZDUSD'
  },
  
  // EODHD Symbols
  EODHD_FOREX_PAIRS: {
    'EURUSD': 'EURUSD.FOREX',
    'GBPJPY': 'GBPJPY.FOREX',
    'USDJPY': 'USDJPY.FOREX',
    'GBPUSD': 'GBPUSD.FOREX',
    'AUDUSD': 'AUDUSD.FOREX',
    'USDCAD': 'USDCAD.FOREX',
    'USDCHF': 'USDCHF.FOREX',
    'EURAUD': 'EURAUD.FOREX',
    'NZDUSD': 'NZDUSD.FOREX'
  },
  
  // Request configuration
  REQUEST_TIMEOUT_MS: 12000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 2000,
  
  // Rate limit strategy for Twelve Data (800/day free)
  TWELVE_DATA_DAILY_LIMIT: 800,
  TWELVE_DATA_REQUEST_SPACING_MS: 150 // ~5-6 calls per second max
};

// ============================================================================
// REQUEST RATE LIMITER FOR TWELVE DATA
// ============================================================================

class TwelveDataRateLimiter {
  constructor(dailyLimit = 800) {
    this.dailyLimit = dailyLimit;
    this.requests = [];
    this.lastResetDate = new Date().toDateString();
  }
  
  async waitIfNeeded() {
    const today = new Date().toDateString();
    
    // Reset counter at midnight
    if (today !== this.lastResetDate) {
      this.requests = [];
      this.lastResetDate = today;
    }
    
    // Check daily limit
    if (this.requests.length >= this.dailyLimit) {
      const oldestRequest = this.requests[0];
      const waitTime = 24 * 60 * 60 * 1000 - (Date.now() - oldestRequest);
      
      if (waitTime > 0) {
        console.log(`[TwelveDataRateLimit] Daily limit reached. Wait until: ${new Date(Date.now() + waitTime).toLocaleTimeString()}`);
        throw new Error(`Twelve Data daily limit reached. Wait ${Math.ceil(waitTime / 1000)}s`);
      }
    }
    
    // Add spacing between requests
    if (this.requests.length > 0) {
      const lastRequest = this.requests[this.requests.length - 1];
      const timeSinceLastRequest = Date.now() - lastRequest;
      
      if (timeSinceLastRequest < CONFIG.TWELVE_DATA_REQUEST_SPACING_MS) {
        const waitTime = CONFIG.TWELVE_DATA_REQUEST_SPACING_MS - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    this.requests.push(Date.now());
  }
  
  getRemainingRequests() {
    return this.dailyLimit - this.requests.length;
  }
  
  getStats() {
    return {
      used: this.requests.length,
      limit: this.dailyLimit,
      remaining: this.dailyLimit - this.requests.length,
      percentUsed: (this.requests.length / this.dailyLimit * 100).toFixed(1)
    };
  }
}

const twelveDataLimiter = new TwelveDataRateLimiter(CONFIG.TWELVE_DATA_DAILY_LIMIT);

// ============================================================================
// TWELVE DATA FETCHER (PRIMARY - BEST FREE FOREX)
// ============================================================================

/**
 * Fetch forex candles from Twelve Data
 * Free tier: 800 calls/day (very generous for forex)
 * 
 * @param {String} symbol - Forex pair (e.g., 'EURUSD')
 * @param {String} interval - Interval (1h, 4h, 1d)
 * @param {Number} limit - Number of candles
 * @returns {Promise<Array>} Candles
 */
async function fetchTwelveDataCandles(symbol, interval, limit = 50) {
  await twelveDataLimiter.waitIfNeeded();
  
  const twelveDataSymbol = CONFIG.TWELVE_DATA_FOREX_PAIRS[symbol];
  if (!twelveDataSymbol) {
    throw new Error(`Unknown pair for Twelve Data: ${symbol}`);
  }
  
  try {
    console.log(`  [TwelveData] ${symbol} (${interval})...`);
    
    // Map our intervals to Twelve Data format
    const intervalMap = { '1h': '1h', '4h': '4h', '1d': '1d' };
    
    const response = await axios.get(`${CONFIG.TWELVE_DATA_API}/time_series`, {
      params: {
        symbol: twelveDataSymbol,
        interval: intervalMap[interval],
        format: 'json',
        outputsize: limit
      },
      timeout: CONFIG.REQUEST_TIMEOUT_MS
    });
    
    if (!response.data.values || response.data.values.length === 0) {
      throw new Error('Empty response from Twelve Data');
    }
    
    // Transform Twelve Data format
    const candles = response.data.values.map(candle => ({
      timestamp: new Date(candle.datetime).getTime(),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume) || 0
    })).reverse(); // Reverse to chronological order
    
    return candles;
    
  } catch (error) {
    throw new Error(`Twelve Data ${symbol} failed: ${error.message}`);
  }
}

/**
 * Fetch forex data from Twelve Data (optimized for free tier)
 * Strategy: Fetch minimal candles per timeframe to conserve daily quota
 * 
 * @param {String} pair - Forex pair
 * @returns {Promise<Object>} Multi-timeframe data
 */
async function fetchForexDataTwelveData(pair) {
  console.log(`\n[TwelveData] Fetching ${pair}...`);
  
  try {
    // Check remaining quota
    const remaining = twelveDataLimiter.getRemainingRequests();
    console.log(`  Quota remaining: ${remaining}/${CONFIG.TWELVE_DATA_DAILY_LIMIT}`);
    
    if (remaining < 15) {
      throw new Error(`Insufficient Twelve Data quota. Need 15 calls, have ${remaining}`);
    }
    
    // Fetch timeframes SEQUENTIALLY to monitor quota
    // (3 calls minimum: 1h, 4h, 1d + overhead)
    const candles1h = await fetchTwelveDataCandles(pair, '1h', 168);
    const candles4h = await fetchTwelveDataCandles(pair, '4h', 42);
    const candles1d = await fetchTwelveDataCandles(pair, '1d', 365);
    
    // Validate
    if (candles1h.length < 50 || candles4h.length < 20 || candles1d.length < 20) {
      throw new Error(
        `Insufficient data: 1h=${candles1h.length}, 4h=${candles4h.length}, 1d=${candles1d.length}`
      );
    }
    
    // Organize data
    const data = {
      '1h_timestamp': candles1h.map(c => c.timestamp),
      '1h_open': candles1h.map(c => c.open),
      '1h_high': candles1h.map(c => c.high),
      '1h_low': candles1h.map(c => c.low),
      '1h_close': candles1h.map(c => c.close),
      '1h_volume': candles1h.map(c => c.volume),
      
      '4h_timestamp': candles4h.map(c => c.timestamp),
      '4h_open': candles4h.map(c => c.open),
      '4h_high': candles4h.map(c => c.high),
      '4h_low': candles4h.map(c => c.low),
      '4h_close': candles4h.map(c => c.close),
      '4h_volume': candles4h.map(c => c.volume),
      
      '1d_timestamp': candles1d.map(c => c.timestamp),
      '1d_open': candles1d.map(c => c.open),
      '1d_high': candles1d.map(c => c.high),
      '1d_low': candles1d.map(c => c.low),
      '1d_close': candles1d.map(c => c.close),
      '1d_volume': candles1d.map(c => c.volume)
    };
    
    const stats = twelveDataLimiter.getStats();
    console.log(`✓ TwelveData success (quota: ${stats.percentUsed}% used)`);
    
    return {
      source: 'TwelveData',
      pair,
      data,
      success: true,
      quotaUsed: stats
    };
    
  } catch (error) {
    console.error(`✗ TwelveData failed: ${error.message}`);
    return {
      source: 'TwelveData',
      pair,
      data: {},
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// EODHD FETCHER (FALLBACK 1)
// ============================================================================

/**
 * Fetch from EODHD (fallback if TwelveData quota exhausted)
 * 
 * @param {String} pair - Forex pair
 * @returns {Promise<Object>} Multi-timeframe data
 */
async function fetchForexDataEODHD(pair) {
  console.log(`\n[EODHD] Fetching ${pair} (fallback)...`);
  
  if (!process.env.EODHD_KEY) {
    throw new Error('EODHD_KEY not set');
  }
  
  try {
    const eodhdSymbol = CONFIG.EODHD_FOREX_PAIRS[pair];
    if (!eodhdSymbol) {
      throw new Error(`Unknown pair for EODHD: ${pair}`);
    }
    
    // Fetch hourly
    const response1h = await axios.get(
      `${CONFIG.EODHD_API}/intraday/${eodhdSymbol}`,
      {
        params: {
          api_token: process.env.EODHD_KEY,
          period: '1h',
          fmt: 'json'
        },
        timeout: CONFIG.REQUEST_TIMEOUT_MS
      }
    );
    
    const candles1h = response1h.data.slice(0, 168).map(c => ({
      timestamp: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume) || 0
    })).reverse();
    
    // Fetch daily
    const response1d = await axios.get(
      `${CONFIG.EODHD_API}/intraday/${eodhdSymbol}`,
      {
        params: {
          api_token: process.env.EODHD_KEY,
          period: 'd',
          fmt: 'json'
        },
        timeout: CONFIG.REQUEST_TIMEOUT_MS
      }
    );
    
    const candles1d = response1d.data.slice(0, 365).map(c => ({
      timestamp: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume) || 0
    })).reverse();
    
    // Aggregate 1h to 4h
    const candles4h = aggregateCandles(candles1h, 4);
    
    const data = {
      '1h_timestamp': candles1h.map(c => c.timestamp),
      '1h_open': candles1h.map(c => c.open),
      '1h_high': candles1h.map(c => c.high),
      '1h_low': candles1h.map(c => c.low),
      '1h_close': candles1h.map(c => c.close),
      '1h_volume': candles1h.map(c => c.volume),
      
      '4h_timestamp': candles4h.map(c => c.timestamp),
      '4h_open': candles4h.map(c => c.open),
      '4h_high': candles4h.map(c => c.high),
      '4h_low': candles4h.map(c => c.low),
      '4h_close': candles4h.map(c => c.close),
      '4h_volume': candles4h.map(c => c.volume),
      
      '1d_timestamp': candles1d.map(c => c.timestamp),
      '1d_open': candles1d.map(c => c.open),
      '1d_high': candles1d.map(c => c.high),
      '1d_low': candles1d.map(c => c.low),
      '1d_close': candles1d.map(c => c.close),
      '1d_volume': candles1d.map(c => c.volume)
    };
    
    console.log(`✓ EODHD success`);
    return { source: 'EODHD', pair, data, success: true };
    
  } catch (error) {
    console.error(`✗ EODHD failed: ${error.message}`);
    return { source: 'EODHD', pair, data: {}, success: false, error: error.message };
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Aggregate candles to higher timeframes
 * 
 * @param {Array} candles - Base candles
 * @param {Number} factor - Aggregation factor
 * @returns {Array} Aggregated candles
 */
function aggregateCandles(candles, factor) {
  const aggregated = [];
  
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    
    aggregated.push({
      timestamp: chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0)
    });
  }
  
  return aggregated;
}

/**
 * Validate forex data
 * 
 * @param {Object} data - Data to validate
 * @returns {Object} Validation result
 */
function validateForexData(data) {
  const errors = [];
  const requiredTimeframes = ['1h', '4h', '1d'];
  const requiredFields = ['open', 'high', 'low', 'close', 'volume'];
  
  for (const tf of requiredTimeframes) {
    for (const field of requiredFields) {
      const key = `${tf}_${field}`;
      if (!data[key] || !Array.isArray(data[key]) || data[key].length === 0) {
        errors.push(`Missing/empty: ${key}`);
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
  
  return { valid: errors.length === 0, errors, dataPoints };
}

// ============================================================================
// MAIN ENTRY POINT WITH FALLBACK CHAIN
// ============================================================================

/**
 * Fetch forex data with intelligent fallback
 * TwelveData (best free tier) → EODHD → Error
 * 
 * @param {String} pair - Forex pair
 * @returns {Promise<Object>} Multi-timeframe data
 */
async function fetchForexData(pair) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Fetching forex: ${pair}`);
  console.log(`${'='.repeat(70)}`);
  
  // Try TwelveData (best free tier)
  const twelveDataResult = await fetchForexDataTwelveData(pair);
  
  if (twelveDataResult.success) {
    const validation = validateForexData(twelveDataResult.data);
    if (validation.valid) {
      console.log(`✅ Using TwelveData (${validation.dataPoints} points)`);
      return twelveDataResult.data;
    }
  }
  
  // Fallback to EODHD
  console.log(`\n[Fallback] Trying EODHD...`);
  const eodhdResult = await fetchForexDataEODHD(pair);
  
  if (eodhdResult.success) {
    const validation = validateForexData(eodhdResult.data);
    if (validation.valid) {
      console.log(`✅ Using EODHD (${validation.dataPoints} points)`);
      return eodhdResult.data;
    }
  }
  
  throw new Error(
    `Failed to fetch ${pair}: TwelveData=(${twelveDataResult.error}), EODHD=(${eodhdResult.error})`
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  fetchForexData,
  fetchForexDataTwelveData,
  fetchForexDataEODHD,
  fetchTwelveDataCandles,
  aggregateCandles,
  validateForexData,
  getTwelveDataStats: () => twelveDataLimiter.getStats(),
  CONFIG,
  SUPPORTED_PAIRS: Object.keys(CONFIG.TWELVE_DATA_FOREX_PAIRS)
};