/**
 * Crypto Feature Engineering v7.1 - DIRECTIONALLY BALANCED [CRITICAL FIX]
 * Part 1: Core Utilities and Foundation Features
 * 
 * Based on diagnostic analysis showing directional bias
 * 
 * CRITICAL FIXES:
 * ✓ Force 50/50 bullish/bearish feature balance
 * ✓ Add directional clarity features (not just confidence)
 * ✓ Remove redundant trend features
 * ✓ Strengthen neutral class signals
 * ✓ Add bidirectional momentum features
 */

class AsymmetricMarketFeatures {
    constructor() {
        // RESET lists on each init
        this.featureNames = [];
        this.bullishFeatures = [];
        this.bearishFeatures = [];
        this.neutralFeatures = [];
        this.directionalClarityFeatures = [];
        this.problematicFeatures = [];
        
        // Computed features cache
        this._cachedVolMa = {};
        this._cachedAtr = {};
        
        // Balance tracking
        this.maxBullish = 15;  // Hard limit
        this.maxBearish = 15;  // Hard limit
        this.maxNeutral = 20;  // Slightly higher for context
    }
    
    // ========================================================================
    // SAFE MATH OPERATIONS
    // ========================================================================
    
    static safeDivide(numerator, denominator, fillValue = 0.0) {
        /**
         * Safe division that handles arrays
         */
        if (Array.isArray(numerator) && Array.isArray(denominator)) {
            return numerator.map((num, i) => 
                denominator[i] !== 0 ? num / denominator[i] : fillValue
            );
        } else if (Array.isArray(numerator)) {
            return numerator.map(num => 
                denominator !== 0 ? num / denominator : fillValue
            );
        } else if (Array.isArray(denominator)) {
            return denominator.map(den => 
                den !== 0 ? numerator / den : fillValue
            );
        } else {
            return denominator !== 0 ? numerator / denominator : fillValue;
        }
    }
    
    static safeLog(x, fillValue = 0.0) {
        /**
         * Safe logarithm that handles arrays
         */
        if (Array.isArray(x)) {
            return x.map(val => val > 0 ? Math.log(val) : fillValue);
        } else {
            return x > 0 ? Math.log(x) : fillValue;
        }
    }
    
    static safeClip(values, minVal = null, maxVal = null) {
        /**
         * Safe clip that handles arrays
         */
        const clip = (val) => {
            if (minVal !== null && maxVal !== null) {
                return Math.max(minVal, Math.min(maxVal, val));
            } else if (minVal !== null) {
                return Math.max(minVal, val);
            } else if (maxVal !== null) {
                return Math.min(maxVal, val);
            }
            return val;
        };
        
        if (Array.isArray(values)) {
            return values.map(clip);
        } else {
            return clip(values);
        }
    }
    
    static ensureArray(data) {
        /**
         * Ensure data is in array format
         */
        return Array.isArray(data) ? data : [data];
    }
    
    // ========================================================================
    // ARRAY OPERATIONS (DataFrame-like functionality)
    // ========================================================================
    
    static getColumn(df, colName) {
        /**
         * Extract column from DataFrame-like object
         */
        if (!df[colName]) return null;
        return df[colName];
    }
    
    static setColumn(df, colName, values) {
        /**
         * Set column in DataFrame-like object
         */
        df[colName] = values;
    }
    
    static shift(arr, periods = 1) {
        /**
         * Shift array by specified periods (like pandas shift)
         */
        if (periods === 0) return [...arr];
        
        const result = new Array(arr.length);
        if (periods > 0) {
            for (let i = 0; i < arr.length; i++) {
                result[i] = i >= periods ? arr[i - periods] : null;
            }
        } else {
            const absPeriods = Math.abs(periods);
            for (let i = 0; i < arr.length; i++) {
                result[i] = i < arr.length - absPeriods ? arr[i + absPeriods] : null;
            }
        }
        return result;
    }
    
    static rollingWindow(arr, window, minPeriods = null) {
        /**
         * Apply rolling window operation
         */
        const actualMinPeriods = minPeriods || Math.floor(window / 2);
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowVals = arr.slice(start, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= actualMinPeriods) {
                result[i] = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static rollingMax(arr, window, minPeriods = null) {
        const actualMinPeriods = minPeriods || Math.floor(window / 2);
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowVals = arr.slice(start, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= actualMinPeriods) {
                result[i] = Math.max(...windowVals);
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static rollingMin(arr, window, minPeriods = null) {
        const actualMinPeriods = minPeriods || Math.floor(window / 2);
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowVals = arr.slice(start, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= actualMinPeriods) {
                result[i] = Math.min(...windowVals);
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static rollingSum(arr, window, minPeriods = null) {
        const actualMinPeriods = minPeriods || Math.floor(window / 2);
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowVals = arr.slice(start, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= actualMinPeriods) {
                result[i] = windowVals.reduce((a, b) => a + b, 0);
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static pctChange(arr, periods = 1) {
        /**
         * Calculate percentage change
         */
        const shifted = this.shift(arr, periods);
        return arr.map((val, i) => {
            const prev = shifted[i];
            if (prev === null || prev === 0) return null;
            return (val - prev) / prev;
        });
    }
    
    // ========================================================================
    // FOUNDATION FEATURES
    // ========================================================================
    
    _addBasicFeatures(df) {
        /**
         * Basic features - foundation for everything else
         */
        const timeframes = ['1h', '4h', '1d'];
        
        for (const tf of timeframes) {
            const requiredCols = [`${tf}_open`, `${tf}_high`, `${tf}_low`, `${tf}_close`];
            if (!requiredCols.every(col => df[col])) continue;
            
            const o = df[`${tf}_open`];
            const h = df[`${tf}_high`];
            const l = df[`${tf}_low`];
            const c = df[`${tf}_close`];
            
            // Basic metrics
            df[`${tf}_return`] = AsymmetricMarketFeatures.safeDivide(
                c.map((val, i) => val - o[i]), o
            );
            
            df[`${tf}_range`] = AsymmetricMarketFeatures.safeDivide(
                h.map((val, i) => val - l[i]), c
            );
            
            df[`${tf}_body_ratio`] = AsymmetricMarketFeatures.safeDivide(
                c.map((val, i) => Math.abs(val - o[i])),
                h.map((val, i) => val - l[i])
            );
        }
        
        return df;
    }
    
    _calculateAtr(df, tf, period) {
        /**
         * Calculate Average True Range - returns array with caching
         */
        const cacheKey = `${tf}_atr_${period}`;
        
        if (this._cachedAtr[cacheKey]) {
            return this._cachedAtr[cacheKey];
        }
        
        const high = df[`${tf}_high`];
        const low = df[`${tf}_low`];
        const close = df[`${tf}_close`];
        const closePrev = AsymmetricMarketFeatures.shift(close, 1);
        
        const tr = high.map((h, i) => {
            const l = low[i];
            const cp = closePrev[i];
            if (cp === null) return h - l;
            
            return Math.max(
                h - l,
                Math.abs(h - cp),
                Math.abs(l - cp)
            );
        });
        
        const atr = AsymmetricMarketFeatures.rollingWindow(
            tr, period, Math.max(1, Math.floor(period / 2))
        );
        
        this._cachedAtr[cacheKey] = atr;
        return atr;
    }
    
    _calculateVolumeMa(df, tf = '1h', window = 24) {
        /**
         * Calculate volume moving average with caching
         */
        const cacheKey = `${tf}_vol_ma_${window}`;
        
        if (!this._cachedVolMa[cacheKey]) {
            if (df[`${tf}_volume`]) {
                const volMa = AsymmetricMarketFeatures.rollingWindow(
                    df[`${tf}_volume`], window, Math.floor(window / 2)
                );
                this._cachedVolMa[cacheKey] = volMa;
            } else {
                this._cachedVolMa[cacheKey] = null;
            }
        }
        
        return this._cachedVolMa[cacheKey];
    }
    
    _safeClv(high, low, close) {
        /**
         * Safe Close Location Value calculation
         */
        const numerator = high.map((h, i) => 
            (close[i] - low[i]) - (h - close[i])
        );
        const denominator = high.map((h, i) => h - low[i]);
        return AsymmetricMarketFeatures.safeDivide(numerator, denominator, 0.0);
    }
    
    _canAddBullish() {
        return this.bullishFeatures.length < this.maxBullish;
    }
    
    _canAddBearish() {
        return this.bearishFeatures.length < this.maxBearish;
    }
    
    _canAddNeutral() {
        return this.neutralFeatures.length < this.maxNeutral;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AsymmetricMarketFeatures;
}
/**
 * Crypto Feature Engineering v7.1 - Part 2
 * Directional Features and Balance Logic
 * 
 * This extends the AsymmetricMarketFeatures class from Part 1
 * Add these methods to the class or use as a mixin
 */

// ========================================================================
// A. DIRECTIONAL FEATURE SETS (BALANCED) - CRITICAL FIX
// ========================================================================

AsymmetricMarketFeatures.prototype.addDirectionalFeatures = function(df) {
    /**
     * CRITICAL FIX: Strictly balanced bullish/bearish features
     * MAX 15 BULLISH + 15 BEARISH to prevent directional bias
     */
    console.log("      → Directional features (STRICTLY BALANCED)...");
    
    const volMa = this._calculateVolumeMa(df, '1h', 24);
    
    // --- BULLISH SIGNALS (MAX 15) ---
    
    // 1. Volume on breakout UP
    if (this._canAddBullish() && df['1h_high'] && df['1h_volume'] && volMa) {
        const past10High = AsymmetricMarketFeatures.rollingMax(
            AsymmetricMarketFeatures.shift(df['1h_high'], 1), 10, 5
        );
        const breakoutHigh = df['1h_high'].map((h, i) => h > (past10High[i] || 0));
        const volSurge = AsymmetricMarketFeatures.safeDivide(df['1h_volume'], volMa);
        
        df['volume_on_breakout_up'] = breakoutHigh.map((b, i) => 
            b ? volSurge[i] : 0
        );
        this.bullishFeatures.push('volume_on_breakout_up');
    }
    
    // 2. Accumulation volume
    if (this._canAddBullish() && df['1h_volume'] && df['1h_high'] && df['1h_low'] && df['1h_close']) {
        const clv = this._safeClv(df['1h_high'], df['1h_low'], df['1h_close']);
        const clvPositive = AsymmetricMarketFeatures.safeClip(clv, 0, null);
        
        const accumulation = AsymmetricMarketFeatures.rollingSum(
            clvPositive.map((c, i) => c * df['1h_volume'][i]), 24, 12
        );
        const volTotal = AsymmetricMarketFeatures.rollingSum(df['1h_volume'], 24, 12);
        
        df['accumulation_volume'] = AsymmetricMarketFeatures.safeDivide(accumulation, volTotal);
        this.bullishFeatures.push('accumulation_volume');
    }
    
    // 3. Support bounce strength
    if (this._canAddBullish() && df['4h_low'] && df['1h_close'] && df['1h_volume'] && volMa) {
        const support = AsymmetricMarketFeatures.rollingMin(df['4h_low'], 20, 10);
        const distToSupport = AsymmetricMarketFeatures.safeDivide(
            df['1h_close'].map((c, i) => c - (support[i] || 0)),
            support
        );
        
        const nearSupport = distToSupport.map(d => 
            (d >= -0.02 && d <= 0.03) ? 1 : 0
        );
        const volSurge = AsymmetricMarketFeatures.safeDivide(df['1h_volume'], volMa);
        
        df['support_bounce_strength'] = nearSupport.map((n, i) => n * volSurge[i]);
        this.bullishFeatures.push('support_bounce_strength');
    }
    
    // 4. Bullish momentum (1h)
    if (this._canAddBullish() && df['1h_close']) {
        const mom3h = AsymmetricMarketFeatures.pctChange(df['1h_close'], 3);
        df['bullish_momentum_1h'] = AsymmetricMarketFeatures.safeClip(mom3h, 0, null);
        this.bullishFeatures.push('bullish_momentum_1h');
    }
    
    // 5. Bullish momentum (4h)
    if (this._canAddBullish() && df['4h_close']) {
        const mom12h = AsymmetricMarketFeatures.pctChange(df['4h_close'], 3);
        df['bullish_momentum_4h'] = AsymmetricMarketFeatures.safeClip(mom12h, 0, null);
        this.bullishFeatures.push('bullish_momentum_4h');
    }
    
    // 6. Higher highs pattern
    if (this._canAddBullish() && df['1h_high']) {
        const high = df['1h_high'];
        const shift1 = AsymmetricMarketFeatures.shift(high, 1);
        const shift2 = AsymmetricMarketFeatures.shift(high, 2);
        
        df['higher_highs'] = high.map((h, i) => 
            (h > (shift1[i] || 0) && (shift1[i] || 0) > (shift2[i] || 0)) ? 1.0 : 0.0
        );
        this.bullishFeatures.push('higher_highs');
    }
    
    // 7. Bullish body strength
    if (this._canAddBullish() && df['1h_open'] && df['1h_close'] && df['1h_high'] && df['1h_low']) {
        const bullishCandle = df['1h_close'].map((c, i) => c > df['1h_open'][i] ? 1.0 : 0.0);
        const bodySize = AsymmetricMarketFeatures.safeDivide(
            df['1h_close'].map((c, i) => c - df['1h_open'][i]),
            df['1h_high'].map((h, i) => h - df['1h_low'][i])
        );
        
        df['bullish_body_strength'] = bullishCandle.map((bc, i) => bc * bodySize[i]);
        this.bullishFeatures.push('bullish_body_strength');
    }
    
    // 8. Positive volume delta
    if (this._canAddBullish() && df['1h_volume'] && df['1h_close']) {
        const priceUp = df['1h_close'].map((c, i) => {
            const prev = i > 0 ? df['1h_close'][i - 1] : c;
            return c > prev ? 1.0 : 0.0;
        });
        
        const volRatio = AsymmetricMarketFeatures.safeDivide(
            df['1h_volume'],
            AsymmetricMarketFeatures.rollingWindow(df['1h_volume'], 20, 10)
        );
        
        df['positive_volume_delta'] = priceUp.map((p, i) => p * volRatio[i]);
        this.bullishFeatures.push('positive_volume_delta');
    }
    
    // --- BEARISH SIGNALS (MAX 15) - MIRROR OF BULLISH ---
    
    // 1. Volume on breakdown
    if (this._canAddBearish() && df['1h_low'] && df['1h_volume'] && volMa) {
        const past10Low = AsymmetricMarketFeatures.rollingMin(
            AsymmetricMarketFeatures.shift(df['1h_low'], 1), 10, 5
        );
        const breakdownLow = df['1h_low'].map((l, i) => l < (past10Low[i] || Infinity));
        const volSurge = AsymmetricMarketFeatures.safeDivide(df['1h_volume'], volMa);
        
        df['volume_on_breakdown'] = breakdownLow.map((b, i) => b ? volSurge[i] : 0);
        this.bearishFeatures.push('volume_on_breakdown');
    }
    
    // 2. Distribution patterns
    if (this._canAddBearish() && df['1h_volume'] && df['1h_high'] && df['1h_low'] && df['1h_close']) {
        const clv = this._safeClv(df['1h_high'], df['1h_low'], df['1h_close']);
        const clvNegative = AsymmetricMarketFeatures.safeClip(clv, null, 0);
        const clvNegativeAbs = clvNegative.map(v => Math.abs(v));
        
        const distribution = AsymmetricMarketFeatures.rollingSum(
            clvNegativeAbs.map((c, i) => c * df['1h_volume'][i]), 24, 12
        );
        const volTotal = AsymmetricMarketFeatures.rollingSum(df['1h_volume'], 24, 12);
        
        df['distribution_patterns'] = AsymmetricMarketFeatures.safeDivide(distribution, volTotal);
        this.bearishFeatures.push('distribution_patterns');
    }
    
    // 3. Resistance rejection strength
    if (this._canAddBearish() && df['4h_high'] && df['1h_high'] && df['1h_close'] && df['1h_volume'] && volMa) {
        const resistance = AsymmetricMarketFeatures.rollingMax(df['4h_high'], 20, 10);
        const rejection = df['1h_high'].map((h, i) => {
            const r = resistance[i] || 0;
            const c = df['1h_close'][i];
            return (h > r && c < r) ? 1 : 0;
        });
        
        const volSurge = AsymmetricMarketFeatures.safeDivide(df['1h_volume'], volMa);
        df['resistance_rejection_strength'] = rejection.map((r, i) => r * volSurge[i]);
        this.bearishFeatures.push('resistance_rejection_strength');
    }
    
    // 4. Bearish momentum (1h)
    if (this._canAddBearish() && df['1h_close']) {
        const mom3h = AsymmetricMarketFeatures.pctChange(df['1h_close'], 3);
        df['bearish_momentum_1h'] = AsymmetricMarketFeatures.safeClip(mom3h, null, 0).map(v => Math.abs(v));
        this.bearishFeatures.push('bearish_momentum_1h');
    }
    
    // 5. Bearish momentum (4h)
    if (this._canAddBearish() && df['4h_close']) {
        const mom12h = AsymmetricMarketFeatures.pctChange(df['4h_close'], 3);
        df['bearish_momentum_4h'] = AsymmetricMarketFeatures.safeClip(mom12h, null, 0).map(v => Math.abs(v));
        this.bearishFeatures.push('bearish_momentum_4h');
    }
    
    // 6. Lower lows pattern
    if (this._canAddBearish() && df['1h_low']) {
        const low = df['1h_low'];
        const shift1 = AsymmetricMarketFeatures.shift(low, 1);
        const shift2 = AsymmetricMarketFeatures.shift(low, 2);
        
        df['lower_lows'] = low.map((l, i) => 
            (l < (shift1[i] || Infinity) && (shift1[i] || Infinity) < (shift2[i] || Infinity)) ? 1.0 : 0.0
        );
        this.bearishFeatures.push('lower_lows');
    }
    
    // 7. Bearish body strength
    if (this._canAddBearish() && df['1h_open'] && df['1h_close'] && df['1h_high'] && df['1h_low']) {
        const bearishCandle = df['1h_close'].map((c, i) => c < df['1h_open'][i] ? 1.0 : 0.0);
        const bodySize = AsymmetricMarketFeatures.safeDivide(
            df['1h_open'].map((o, i) => o - df['1h_close'][i]),
            df['1h_high'].map((h, i) => h - df['1h_low'][i])
        );
        
        df['bearish_body_strength'] = bearishCandle.map((bc, i) => bc * bodySize[i]);
        this.bearishFeatures.push('bearish_body_strength');
    }
    
    // 8. Negative volume delta
    if (this._canAddBearish() && df['1h_volume'] && df['1h_close']) {
        const priceDown = df['1h_close'].map((c, i) => {
            const prev = i > 0 ? df['1h_close'][i - 1] : c;
            return c < prev ? 1.0 : 0.0;
        });
        
        const volRatio = AsymmetricMarketFeatures.safeDivide(
            df['1h_volume'],
            AsymmetricMarketFeatures.rollingWindow(df['1h_volume'], 20, 10)
        );
        
        df['negative_volume_delta'] = priceDown.map((p, i) => p * volRatio[i]);
        this.bearishFeatures.push('negative_volume_delta');
    }
    
    console.log(`        ✓ Created ${this.bullishFeatures.length} bullish signals (max ${this.maxBullish})`);
    console.log(`        ✓ Created ${this.bearishFeatures.length} bearish signals (max ${this.maxBearish})`);
    
    // CRITICAL: Verify balance
    if (Math.abs(this.bullishFeatures.length - this.bearishFeatures.length) > 2) {
        console.log(`        ⚠️  WARNING: Bullish/Bearish imbalance detected!`);
    }
    
    return df;
};

// ========================================================================
// B. DIRECTIONAL CLARITY FEATURES (NEW) - CRITICAL FOR NEUTRAL CLASS
// ========================================================================

AsymmetricMarketFeatures.prototype.addDirectionalClarityFeatures = function(df) {
    /**
     * NEW: Features that explicitly measure directional ambiguity
     * HIGH clarity = strong trend (class 0 or 2)
     * LOW clarity = choppy/neutral (class 1)
     */
    console.log("      → Directional clarity features (NEW)...");
    
    // 1. Bullish vs Bearish feature disagreement
    if (this.bullishFeatures.length > 0 && this.bearishFeatures.length > 0) {
        const bullishCols = this.bullishFeatures.filter(f => df[f]);
        const bearishCols = this.bearishFeatures.filter(f => df[f]);
        
        if (bullishCols.length > 0 && bearishCols.length > 0) {
            // Normalize to 0-1
            const normalize = (arr) => {
                const min = Math.min(...arr.filter(v => v !== null && !isNaN(v)));
                const max = Math.max(...arr.filter(v => v !== null && !isNaN(v)));
                if (max === min) return arr.map(() => 0);
                return arr.map(v => (v - min) / (max - min));
            };
            
            const bullishScores = bullishCols.map(col => normalize(df[col]));
            const bearishScores = bearishCols.map(col => normalize(df[col]));
            
            const bullishScore = bullishScores[0].map((_, i) => 
                bullishScores.reduce((sum, arr) => sum + (arr[i] || 0), 0) / bullishScores.length
            );
            
            const bearishScore = bearishScores[0].map((_, i) => 
                bearishScores.reduce((sum, arr) => sum + (arr[i] || 0), 0) / bearishScores.length
            );
            
            // Clarity = absolute difference
            df['directional_clarity'] = bullishScore.map((b, i) => 
                Math.abs(b - bearishScore[i])
            );
            this.directionalClarityFeatures.push('directional_clarity');
            
            // Directional bias
            df['directional_bias'] = bullishScore.map((b, i) => 
                b - bearishScore[i]
            );
            this.directionalClarityFeatures.push('directional_bias');
        }
    }
    
    // 2. Trend consistency across timeframes
    if (df['1h_close'] && df['4h_close'] && df['1d_close']) {
        const h1Mom = AsymmetricMarketFeatures.pctChange(df['1h_close'], 3);
        const h4Mom = AsymmetricMarketFeatures.pctChange(df['4h_close'], 1);
        const d1Mom = AsymmetricMarketFeatures.pctChange(df['1d_close'], 1);
        
        const sameSign1h4h = h1Mom.map((h1, i) => 
            ((h1 || 0) > 0) === ((h4Mom[i] || 0) > 0) ? 1 : 0
        );
        const sameSign4h1d = h4Mom.map((h4, i) => 
            ((h4 || 0) > 0) === ((d1Mom[i] || 0) > 0) ? 1 : 0
        );
        
        df['trend_consistency'] = sameSign1h4h.map((s1, i) => 
            (s1 + sameSign4h1d[i]) / 2
        );
        this.directionalClarityFeatures.push('trend_consistency');
    }
    
    // 3. Volatility-adjusted momentum
    if (df['1h_close'] && df['1h_atr']) {
        const mom = AsymmetricMarketFeatures.pctChange(df['1h_close'], 3).map(v => Math.abs(v || 0));
        const vol = AsymmetricMarketFeatures.safeDivide(df['1h_atr'], df['1h_close']);
        
        df['choppiness_index'] = AsymmetricMarketFeatures.safeDivide(mom, vol, 0).map(v => 
            AsymmetricMarketFeatures.safeClip([1 - v], 0, 1)[0]
        );
        this.neutralFeatures.push('choppiness_index');
    }
    
    // 4. Range compression
    if (df['1h_high'] && df['1h_low'] && df['1h_close']) {
        const currentRange = df['1h_high'].map((h, i) => h - df['1h_low'][i]);
        const avgRange = AsymmetricMarketFeatures.rollingWindow(currentRange, 24, 12);
        
        df['range_compression'] = AsymmetricMarketFeatures.safeDivide(currentRange, avgRange, 1).map(v => 
            AsymmetricMarketFeatures.safeClip([1 - v], 0, 1)[0]
        );
        this.neutralFeatures.push('range_compression');
    }
    
    // 5. Sideways movement indicator
    if (df['1h_close']) {
        const priceChange = AsymmetricMarketFeatures.pctChange(df['1h_close'], 10).map(v => Math.abs(v || 0));
        df['sideways_movement'] = priceChange.map(pc => 1 / (1 + pc * 100));
        this.neutralFeatures.push('sideways_movement');
    }
    
    console.log(`        ✓ Created ${this.directionalClarityFeatures.length} clarity features`);
    console.log(`        ✓ Created ${this.neutralFeatures.length} neutral-specific features`);
    
    return df;
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AsymmetricMarketFeatures;
}
/**
 * Crypto Feature Engineering v7.1 - Part 3
 * Context Features, Quality Checks, and Main Pipeline
 * 
 * This completes the AsymmetricMarketFeatures class
 */

// ========================================================================
// C. MINIMAL CONTEXT FEATURES (NO TREND BIAS)
// ========================================================================

AsymmetricMarketFeatures.prototype.addMinimalContextFeatures = function(df) {
    /**
     * Minimal context features WITHOUT trend bias
     * NO trend_strength, NO trend_with_decay (these dominated before)
     */
    console.log("      → Minimal context features (NO TREND BIAS)...");
    
    // 1. Volatility regime only
    if (df['1h_atr'] && this._canAddNeutral()) {
        const atr = df['1h_atr'];
        
        // Calculate ATR percentile
        const atrPercentile = atr.map((val, i) => {
            if (i < 50) return 0.5;
            const window = atr.slice(Math.max(0, i - 168), i);
            const validWindow = window.filter(v => v !== null && !isNaN(v));
            if (validWindow.length < 10) return 0.5;
            
            const belowCount = validWindow.filter(v => v < val).length;
            return belowCount / validWindow.length;
        });
        
        // Convert to categorical
        df['vol_regime'] = atrPercentile.map(p => {
            if (p <= 0.25) return 0;
            if (p <= 0.5) return 1;
            if (p <= 0.75) return 2;
            return 3;
        });
        this.neutralFeatures.push('vol_regime');
    }
    
    // 2. Volume regime (not directional)
    const volMa = this._calculateVolumeMa(df, '1h', 24);
    if (volMa && this._canAddNeutral()) {
        const volSurge = AsymmetricMarketFeatures.safeDivide(df['1h_volume'], volMa);
        
        df['volume_regime'] = volSurge.map(v => {
            if (v <= 0.8) return 0;
            if (v <= 1.2) return 1;
            if (v <= 2.0) return 2;
            return 3;
        });
        this.neutralFeatures.push('volume_regime');
    }
    
    // 3. Range expansion (neutral metric)
    if (df['1h_high'] && df['1h_low'] && this._canAddNeutral()) {
        const currentRange = df['1h_high'].map((h, i) => h - df['1h_low'][i]);
        const avgRange = AsymmetricMarketFeatures.rollingWindow(currentRange, 24, 12);
        
        df['range_expansion_ratio'] = AsymmetricMarketFeatures.safeDivide(currentRange, avgRange);
        this.neutralFeatures.push('range_expansion_ratio');
    }
    
    // 4. Price distance from moving average (absolute, not directional)
    if (df['1h_close'] && this._canAddNeutral()) {
        const ma20 = AsymmetricMarketFeatures.rollingWindow(df['1h_close'], 20, 10);
        const distFromMa = AsymmetricMarketFeatures.safeDivide(
            df['1h_close'].map((c, i) => Math.abs(c - (ma20[i] || c))),
            ma20
        );
        
        df['price_ma_distance'] = distFromMa;
        this.neutralFeatures.push('price_ma_distance');
    }
    
    console.log(`        ✓ Created ${this.neutralFeatures.length} context features (max ${this.maxNeutral})`);
    
    return df;
};

// ========================================================================
// FEATURE QUALITY & BALANCE ENFORCEMENT
// ========================================================================

AsymmetricMarketFeatures.prototype.enforceDirectionalBalance = function() {
    /**
     * CRITICAL: Force exact 50/50 bullish/bearish balance
     * Remove excess from larger group
     */
    console.log("      → Enforcing directional balance...");
    
    const nBullish = this.bullishFeatures.length;
    const nBearish = this.bearishFeatures.length;
    
    const removed = [];
    
    if (nBullish > nBearish) {
        const excess = nBullish - nBearish;
        const toRemove = this.bullishFeatures.slice(-excess);
        removed.push(...toRemove);
        this.bullishFeatures = this.bullishFeatures.slice(0, -excess);
        console.log(`        ⚠ Removed ${excess} excess bullish features`);
    } else if (nBearish > nBullish) {
        const excess = nBearish - nBullish;
        const toRemove = this.bearishFeatures.slice(-excess);
        removed.push(...toRemove);
        this.bearishFeatures = this.bearishFeatures.slice(0, -excess);
        console.log(`        ⚠ Removed ${excess} excess bearish features`);
    }
    
    console.log(`        ✓ Final balance: ${this.bullishFeatures.length} bullish, ${this.bearishFeatures.length} bearish`);
    
    return removed;
};

AsymmetricMarketFeatures.prototype.checkFeatureQuality = function(df) {
    /**
     * Check and fix problematic features
     */
    console.log("      → Checking feature quality...");
    
    const problematic = [];
    const totalRows = df[Object.keys(df)[0]].length;
    
    for (const feat of this.featureNames) {
        if (!df[feat]) {
            problematic.push(`${feat} (missing)`);
            continue;
        }
        
        const series = df[feat];
        
        // Check: Too many NaNs
        const nanCount = series.filter(v => v === null || isNaN(v)).length;
        const nanPct = nanCount / totalRows;
        if (nanPct > 0.1) {
            problematic.push(`${feat} (NaN: ${(nanPct * 100).toFixed(1)}%)`);
            continue;
        }
        
        // Check: Constant
        const uniqueVals = new Set(series.filter(v => v !== null && !isNaN(v)));
        if (uniqueVals.size <= 1) {
            problematic.push(`${feat} (constant)`);
            continue;
        }
        
        // Check: Mostly zeros
        const zeroCount = series.filter(v => v === 0).length;
        const zeroPct = zeroCount / totalRows;
        if (zeroPct > 0.95) {
            problematic.push(`${feat} (mostly zeros: ${(zeroPct * 100).toFixed(1)}%)`);
            continue;
        }
        
        // Fix infinite values
        const hasInf = series.some(v => !isFinite(v) && v !== null);
        if (hasInf) {
            df[feat] = series.map((v, i) => {
                if (!isFinite(v)) {
                    // Forward fill, then backward fill, then zero
                    for (let j = i - 1; j >= 0; j--) {
                        if (isFinite(series[j]) && series[j] !== null) return series[j];
                    }
                    for (let j = i + 1; j < series.length; j++) {
                        if (isFinite(series[j]) && series[j] !== null) return series[j];
                    }
                    return 0;
                }
                return v;
            });
        }
    }
    
    if (problematic.length > 0) {
        console.log(`        ⚠ Found ${problematic.length} problematic features`);
        const problematicNames = problematic.map(p => p.split(' ')[0]);
        
        this.featureNames = this.featureNames.filter(f => !problematicNames.includes(f));
        this.bullishFeatures = this.bullishFeatures.filter(f => !problematicNames.includes(f));
        this.bearishFeatures = this.bearishFeatures.filter(f => !problematicNames.includes(f));
        this.neutralFeatures = this.neutralFeatures.filter(f => !problematicNames.includes(f));
        this.directionalClarityFeatures = this.directionalClarityFeatures.filter(f => !problematicNames.includes(f));
        this.problematicFeatures = problematic;
    } else {
        console.log(`        ✓ All features passed quality checks`);
    }
    
    return df;
};

// ========================================================================
// MAIN PIPELINE
// ========================================================================

AsymmetricMarketFeatures.prototype.engineerFeatures = function(df, symbol = "UNKNOWN") {
    /**
     * Main feature engineering pipeline v7.1 - DIRECTIONALLY BALANCED
     */
    console.log(`\n${'='.repeat(70)}`);
    console.log(`   Engineering features v7.1 BALANCED for ${symbol}`);
    console.log(`${'='.repeat(70)}`);
    
    // RESET caches
    this._cachedVolMa = {};
    this._cachedAtr = {};
    
    // Step 1: Foundation
    console.log("   [1/7] Adding basic features...");
    df = this._addBasicFeatures(df);
    
    // Step 2: ATR calculation
    console.log("   [2/7] Calculating ATR...");
    for (const tf of ['1h', '4h', '1d']) {
        const requiredCols = [`${tf}_high`, `${tf}_low`, `${tf}_close`];
        if (requiredCols.every(col => df[col])) {
            df[`${tf}_atr`] = this._calculateAtr(df, tf, 14);
        }
    }
    
    // Step 3: BALANCED directional features (CRITICAL)
    console.log("   [3/7] Adding directional features (STRICTLY BALANCED)...");
    df = this.addDirectionalFeatures(df);
    
    // Step 4: Directional clarity features
    console.log("   [4/7] Adding directional clarity features...");
    df = this.addDirectionalClarityFeatures(df);
    
    // Step 5: Minimal context
    console.log("   [5/7] Adding context features (NO TREND BIAS)...");
    df = this.addMinimalContextFeatures(df);
    
    // Step 6: Collect feature names
    console.log("   [6/7] Collecting feature names...");
    const allFeatures = [
        ...this.bullishFeatures,
        ...this.bearishFeatures,
        ...this.neutralFeatures,
        ...this.directionalClarityFeatures
    ];
    this.featureNames = [...new Set(allFeatures)];
    
    // Step 7: ENFORCE balance
    console.log("   [7/7] Enforcing balance and quality checks...");
    const removed = this.enforceDirectionalBalance();
    if (removed.length > 0) {
        // Remove from DataFrame
        removed.forEach(col => delete df[col]);
        this.featureNames = this.featureNames.filter(f => !removed.includes(f));
    }
    
    // Quality check
    df = this.checkFeatureQuality(df);
    
    // Final statistics
    console.log(`\n${'='.repeat(70)}`);
    console.log(`   FEATURE ENGINEERING COMPLETE`);
    console.log(`${'='.repeat(70)}`);
    console.log(`   Total features: ${this.featureNames.length}`);
    console.log(`   - Bullish signals: ${this.bullishFeatures.length}`);
    console.log(`   - Bearish signals: ${this.bearishFeatures.length}`);
    console.log(`   - Neutral/context: ${this.neutralFeatures.length}`);
    console.log(`   - Clarity metrics: ${this.directionalClarityFeatures.length}`);
    
    // CRITICAL: Verify final balance
    const bullCount = this.bullishFeatures.length;
    const bearCount = this.bearishFeatures.length;
    
    if (bullCount === bearCount) {
        console.log(`\n   ✅ PERFECT BALANCE: ${bullCount} bullish = ${bearCount} bearish`);
    } else {
        console.log(`\n   ⚠️  IMBALANCE: ${bullCount} bullish vs ${bearCount} bearish`);
    }
    
    // Print feature breakdown
    const directionalPct = this.featureNames.length > 0 
        ? ((bullCount + bearCount) / this.featureNames.length) * 100 
        : 0;
    console.log(`   📊 Directional features: ${directionalPct.toFixed(1)}% of total`);
    console.log(`${'='.repeat(70)}\n`);
    
    return df;
};

// ========================================================================
// UTILITY METHODS
// ========================================================================

AsymmetricMarketFeatures.prototype.getFeatureList = function() {
    /**
     * Return list of engineered feature names
     */
    return this.featureNames;
};

AsymmetricMarketFeatures.prototype.getFeatureCategories = function() {
    /**
     * Return features organized by category
     */
    return {
        bullish_signals: this.bullishFeatures,
        bearish_signals: this.bearishFeatures,
        neutral_features: this.neutralFeatures,
        directional_clarity: this.directionalClarityFeatures
    };
};

AsymmetricMarketFeatures.prototype.getBalanceReport = function() {
    /**
     * Get detailed balance report
     */
    const total = this.featureNames.length;
    
    return {
        total_features: total,
        bullish_count: this.bullishFeatures.length,
        bearish_count: this.bearishFeatures.length,
        neutral_count: this.neutralFeatures.length,
        clarity_count: this.directionalClarityFeatures.length,
        bullish_pct: total > 0 ? (this.bullishFeatures.length / total * 100) : 0,
        bearish_pct: total > 0 ? (this.bearishFeatures.length / total * 100) : 0,
        is_balanced: this.bullishFeatures.length === this.bearishFeatures.length,
        balance_ratio: this.bearishFeatures.length > 0 
            ? this.bullishFeatures.length / this.bearishFeatures.length 
            : 0
    };
};

AsymmetricMarketFeatures.prototype.printBalanceReport = function() {
    /**
     * Print detailed balance report
     */
    const report = this.getBalanceReport();
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`   FEATURE BALANCE REPORT`);
    console.log(`${'='.repeat(70)}`);
    console.log(`   Total features: ${report.total_features}`);
    console.log(`   Bullish signals: ${report.bullish_count} (${report.bullish_pct.toFixed(1)}%)`);
    console.log(`   Bearish signals: ${report.bearish_count} (${report.bearish_pct.toFixed(1)}%)`);
    console.log(`   Neutral/context: ${report.neutral_count}`);
    console.log(`   Clarity metrics: ${report.clarity_count}`);
    console.log(`   Balance ratio: ${report.balance_ratio.toFixed(2)}`);
    console.log(`   Is balanced: ${report.is_balanced ? '✅ YES' : '❌ NO'}`);
    console.log(`${'='.repeat(70)}\n`);
};

// ========================================================================
// EXAMPLE USAGE
// ========================================================================

// Example: Create sample data and test
function createSampleData(n = 1000) {
    const seededRandom = (seed) => {
        let value = seed;
        return () => {
            value = (value * 9301 + 49297) % 233280;
            return value / 233280;
        };
    };
    
    const rand = seededRandom(42);
    const randn = () => Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    
    const cumsum = (arr) => {
        const result = [arr[0]];
        for (let i = 1; i < arr.length; i++) {
            result.push(result[i - 1] + arr[i]);
        }
        return result;
    };
    
    const generatePrice = () => cumsum(Array.from({length: n}, () => randn() * 100));
    const basePrice = 40000;
    
    const sampleDf = {
        '1h_open': generatePrice().map(v => basePrice + v),
        '1h_high': generatePrice().map(v => basePrice + v + 50),
        '1h_low': generatePrice().map(v => basePrice + v - 50),
        '1h_close': generatePrice().map(v => basePrice + v),
        '1h_volume': Array.from({length: n}, () => 1000 + rand() * 4000),
        '4h_open': generatePrice().map(v => basePrice + v),
        '4h_high': generatePrice().map(v => basePrice + v + 100),
        '4h_low': generatePrice().map(v => basePrice + v - 100),
        '4h_close': generatePrice().map(v => basePrice + v),
        '1d_open': generatePrice().map(v => basePrice + v),
        '1d_high': generatePrice().map(v => basePrice + v + 200),
        '1d_low': generatePrice().map(v => basePrice + v - 200),
        '1d_close': generatePrice().map(v => basePrice + v)
    };
    
    return sampleDf;
}

// Run example if in Node.js environment
if (typeof require !== 'undefined' && require.main === module) {
    const featureEngineer = new AsymmetricMarketFeatures();
    const sampleDf = createSampleData(1000);
    
    const dfWithFeatures = featureEngineer.engineerFeatures(sampleDf, "BTC/USDT");
    featureEngineer.printBalanceReport();
    
    const categories = featureEngineer.getFeatureCategories();
    
    console.log("\nBullish Features:");
    categories.bullish_signals.forEach(feat => console.log(`  - ${feat}`));
    
    console.log("\nBearish Features:");
    categories.bearish_signals.forEach(feat => console.log(`  - ${feat}`));
    
    console.log("\nDirectional Clarity Features:");
    categories.directional_clarity.forEach(feat => console.log(`  - ${feat}`));
    
    console.log("\nNeutral Features:");
    categories.neutral_features.forEach(feat => console.log(`  - ${feat}`));
    
    console.log(`\nTotal feature columns: ${featureEngineer.getFeatureList().length}`);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AsymmetricMarketFeatures;
}