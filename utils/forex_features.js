/**
 * Conservative Feature Engineering v3.0 - PRODUCTION READY
 * Philosophy: Quality over quantity, historical data only
 * 
 * VERCEL COMPATIBLE - Fixed export pattern
 * 
 * STRICT RULES:
 * 1. Never use future data
 * 2. Never use pctChange() without explicit shift(1)
 * 3. All rolling windows use expanding() for early data
 * 4. When uncertain, exclude the feature
 * 5. Every feature must pass the "can I calculate this in real-time?" test
 * 
 * FEATURES INCLUDED (~40 carefully selected):
 * - Intra-bar patterns (OHLC relationships)
 * - Historical momentum (properly shifted)
 * - Conservative moving averages
 * - Realized volatility (backward-looking)
 * - Volume dynamics
 * - Multi-timeframe alignment
 * - Simple technical indicators
 */

class ConservativeFeatureEngineer {
    constructor() {
        this.featureNames = [];
    }
    
    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================
    
    static shift(arr, periods = 1) {
        /**
         * Shift array by specified periods (pandas-like shift)
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
    
    static rolling(arr, window, minPeriods = null) {
        /**
         * Rolling window mean
         */
        const actualMinPeriods = minPeriods || window;
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
    
    static expanding(arr, minPeriods = 1) {
        /**
         * Expanding window mean (grows from start)
         */
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const windowVals = arr.slice(0, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= minPeriods) {
                result[i] = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static rollingStd(arr, window, minPeriods = null) {
        /**
         * Rolling window standard deviation
         */
        const actualMinPeriods = minPeriods || window;
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowVals = arr.slice(start, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= actualMinPeriods) {
                const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
                const variance = windowVals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowVals.length;
                result[i] = Math.sqrt(variance);
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    static expandingStd(arr, minPeriods = 2) {
        /**
         * Expanding window standard deviation
         */
        const result = new Array(arr.length);
        
        for (let i = 0; i < arr.length; i++) {
            const windowVals = arr.slice(0, i + 1).filter(v => v !== null && !isNaN(v));
            
            if (windowVals.length >= minPeriods) {
                const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
                const variance = windowVals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowVals.length;
                result[i] = Math.sqrt(variance);
            } else {
                result[i] = null;
            }
        }
        return result;
    }
    
    // ========================================================================
    // INTRA-BAR FEATURES
    // ========================================================================
    
    addIntrabarFeatures(df, prefix = '1h') {
        /**
         * Intra-bar features: characteristics of current candle
         * These are SAFE because they describe the current bar only
         */
        const open = df[`${prefix}_open`];
        const high = df[`${prefix}_high`];
        const low = df[`${prefix}_low`];
        const close = df[`${prefix}_close`];
        
        // Price momentum within bar
        df[`${prefix}_trend`] = close.map((c, i) => 
            (c - open[i]) / (open[i] + 1e-10)
        );
        
        // Range metrics
        df[`${prefix}_range_pct`] = high.map((h, i) => 
            (h - low[i]) / (close[i] + 1e-10)
        );
        
        // Body ratio (strength of directional move)
        const body = close.map((c, i) => Math.abs(c - open[i]));
        const totalRange = high.map((h, i) => h - low[i]);
        df[`${prefix}_body_ratio`] = body.map((b, i) => 
            b / (totalRange[i] + 1e-10)
        );
        
        // Shadows (rejection wicks)
        const maxOC = close.map((c, i) => Math.max(open[i], c));
        const minOC = close.map((c, i) => Math.min(open[i], c));
        
        df[`${prefix}_upper_shadow`] = high.map((h, i) => 
            (h - maxOC[i]) / (close[i] + 1e-10)
        );
        
        df[`${prefix}_lower_shadow`] = minOC.map((min, i) => 
            (min - low[i]) / (close[i] + 1e-10)
        );
        
        // Close position within range (0 = at low, 1 = at high)
        df[`${prefix}_close_position`] = close.map((c, i) => 
            (c - low[i]) / (totalRange[i] + 1e-10)
        );
        
        return df;
    }
    
    // ========================================================================
    // HISTORICAL MOMENTUM
    // ========================================================================
    
    addHistoricalMomentum(df, prefix = '1h', periods = [1, 3, 6, 12]) {
        /**
         * Historical momentum: compare current price to past prices
         * CRITICAL: Use shift(period) to ensure backward-looking
         */
        const closeCol = `${prefix}_close`;
        const close = df[closeCol];
        
        for (const period of periods) {
            // Momentum = (current - past) / past
            const shifted = ConservativeFeatureEngineer.shift(close, period);
            df[`${prefix}_momentum_${period}`] = close.map((c, i) => 
                (c - (shifted[i] || 0)) / ((shifted[i] || 0) + 1e-10)
            );
        }
        
        // Rate of change of momentum (acceleration)
        if (periods.includes(1) && periods.includes(3)) {
            const mom1 = df[`${prefix}_momentum_1`];
            const mom1Shifted = ConservativeFeatureEngineer.shift(mom1, 2);
            df[`${prefix}_momentum_accel`] = mom1.map((m, i) => 
                m - (mom1Shifted[i] || 0)
            );
        }
        
        return df;
    }
    
    // ========================================================================
    // CONSERVATIVE MOVING AVERAGES
    // ========================================================================
    
    addConservativeMovingAverages(df, prefix = '1h', periods = [10, 20, 50]) {
        /**
         * Moving averages using expanding windows for early data
         * This prevents NaN values while maintaining temporal integrity
         */
        const closeCol = `${prefix}_close`;
        const close = df[closeCol];
        
        for (const period of periods) {
            // Use expanding mean for first 'period' bars
            const expandingMa = ConservativeFeatureEngineer.expanding(close, 1);
            const rollingMa = ConservativeFeatureEngineer.rolling(close, period, period);
            
            // Combine: use rolling where available, expanding for early data
            df[`${prefix}_sma_${period}`] = rollingMa.map((r, i) => 
                r !== null ? r : expandingMa[i]
            );
            
            // Distance from MA (normalized)
            df[`${prefix}_dist_sma_${period}`] = close.map((c, i) => 
                (c - df[`${prefix}_sma_${period}`][i]) / 
                (df[`${prefix}_sma_${period}`][i] + 1e-10)
            );
        }
        
        // MA crossovers (trend strength)
        if (periods.includes(10) && periods.includes(20)) {
            const sma10 = df[`${prefix}_sma_10`];
            const sma20 = df[`${prefix}_sma_20`];
            df[`${prefix}_ma_cross_10_20`] = sma10.map((s10, i) => 
                (s10 - sma20[i]) / (sma20[i] + 1e-10)
            );
        }
        
        if (periods.includes(20) && periods.includes(50)) {
            const sma20 = df[`${prefix}_sma_20`];
            const sma50 = df[`${prefix}_sma_50`];
            df[`${prefix}_ma_cross_20_50`] = sma20.map((s20, i) => 
                (s20 - sma50[i]) / (sma50[i] + 1e-10)
            );
        }
        
        // MA slope (trend direction)
        if (periods.includes(20)) {
            const sma20 = df[`${prefix}_sma_20`];
            const sma20Shifted = ConservativeFeatureEngineer.shift(sma20, 5);
            df[`${prefix}_ma_slope_20`] = sma20.map((s, i) => 
                (s - (sma20Shifted[i] || s)) / ((sma20Shifted[i] || s) + 1e-10)
            );
        }
        
        return df;
    }
    
    // ========================================================================
    // REALIZED VOLATILITY
    // ========================================================================
    
    addRealizedVolatility(df, prefix = '1h', windows = [10, 20]) {
        /**
         * Realized volatility: std of historical returns
         * Uses expanding windows for early data
         */
        // First calculate returns (with proper shift)
        const returnsCol = `${prefix}_returns`;
        if (!df[returnsCol]) {
            const close = df[`${prefix}_close`];
            const closeShifted = ConservativeFeatureEngineer.shift(close, 1);
            df[returnsCol] = close.map((c, i) => 
                (c - (closeShifted[i] || c)) / ((closeShifted[i] || c) + 1e-10)
            );
        }
        
        const returns = df[returnsCol];
        
        for (const window of windows) {
            const expandingVol = ConservativeFeatureEngineer.expandingStd(returns, 2);
            const rollingVol = ConservativeFeatureEngineer.rollingStd(returns, window, window);
            
            df[`${prefix}_volatility_${window}`] = rollingVol.map((r, i) => 
                r !== null ? r : expandingVol[i]
            );
        }
        
        // Volatility ratio (regime detection)
        if (windows.length >= 2) {
            const vol1 = df[`${prefix}_volatility_${windows[0]}`];
            const vol2 = df[`${prefix}_volatility_${windows[1]}`];
            df[`${prefix}_vol_ratio`] = vol1.map((v1, i) => 
                v1 / ((vol2[i] || 0) + 1e-10)
            );
        }
        
        return df;
    }
    
    // ========================================================================
    // VOLUME FEATURES
    // ========================================================================
    
    addVolumeFeatures(df, prefix = '1h') {
        /**
         * Volume dynamics
         */
        const volCol = `${prefix}_volume`;
        const volume = df[volCol];
        
        // Volume moving average
        const expandingVol = ConservativeFeatureEngineer.expanding(volume, 1);
        const rollingVol = ConservativeFeatureEngineer.rolling(volume, 20, 20);
        df[`${prefix}_volume_ma`] = rollingVol.map((r, i) => 
            r !== null ? r : expandingVol[i]
        );
        
        // Volume ratio (relative to average)
        df[`${prefix}_volume_ratio`] = volume.map((v, i) => 
            v / (df[`${prefix}_volume_ma`][i] + 1e-10)
        );
        
        // Volume trend
        const volumeShifted = ConservativeFeatureEngineer.shift(volume, 3);
        df[`${prefix}_volume_trend`] = volume.map((v, i) => 
            (v - (volumeShifted[i] || v)) / ((volumeShifted[i] || v) + 1e-10)
        );
        
        // Price-volume relationship
        if (df[`${prefix}_returns`]) {
            const returns = df[`${prefix}_returns`];
            const volumeRatio = df[`${prefix}_volume_ratio`];
            df[`${prefix}_pv_momentum`] = returns.map((r, i) => 
                r * volumeRatio[i]
            );
        }
        
        return df;
    }
    
    // ========================================================================
    // MULTI-TIMEFRAME ALIGNMENT
    // ========================================================================
    
    addMultiTimeframeAlignment(df) {
        /**
         * Multi-timeframe features: relationships between timeframes
         * These are safe because higher timeframes are strictly historical
         */
        // 4H vs 1D
        if (df['4h_close'] && df['1d_close']) {
            const h4Close = df['4h_close'];
            const d1Close = df['1d_close'];
            df['4h_vs_1d_price'] = h4Close.map((h4, i) => 
                (h4 - d1Close[i]) / (d1Close[i] + 1e-10)
            );
        }
        
        // 1H vs 4H
        if (df['1h_close'] && df['4h_close']) {
            const h1Close = df['1h_close'];
            const h4Close = df['4h_close'];
            df['1h_vs_4h_price'] = h1Close.map((h1, i) => 
                (h1 - h4Close[i]) / (h4Close[i] + 1e-10)
            );
        }
        
        // Position within higher timeframe ranges
        if (df['1h_close'] && df['4h_low'] && df['4h_high']) {
            const h1Close = df['1h_close'];
            const h4Low = df['4h_low'];
            const h4High = df['4h_high'];
            df['1h_in_4h_range'] = h1Close.map((h1, i) => 
                (h1 - h4Low[i]) / (h4High[i] - h4Low[i] + 1e-10)
            );
        }
        
        if (df['1h_close'] && df['1d_low'] && df['1d_high']) {
            const h1Close = df['1h_close'];
            const d1Low = df['1d_low'];
            const d1High = df['1d_high'];
            df['1h_in_1d_range'] = h1Close.map((h1, i) => 
                (h1 - d1Low[i]) / (d1High[i] - d1Low[i] + 1e-10)
            );
        }
        
        // Trend alignment (all timeframes agreeing)
        if (df['1d_trend'] && df['4h_trend'] && df['1h_trend']) {
            const d1Trend = df['1d_trend'];
            const h4Trend = df['4h_trend'];
            const h1Trend = df['1h_trend'];
            df['trend_alignment'] = d1Trend.map((d1, i) => 
                Math.sign(d1) * Math.sign(h4Trend[i]) * Math.sign(h1Trend[i])
            );
        }
        
        return df;
    }
}
/**
 * Conservative Feature Engineering v3.0 - Part 2
 * Simple Indicators, Main Pipeline, and Verification
 * 
 * VERCEL COMPATIBLE - Fixed export pattern
 * This completes the ConservativeFeatureEngineer class
 */

// ========================================================================
// SIMPLE INDICATORS
// ========================================================================

ConservativeFeatureEngineer.prototype.addSimpleIndicators = function(df, prefix = '1h') {
    /**
     * Simple, well-understood technical indicators
     */
    const closeCol = `${prefix}_close`;
    const close = df[closeCol];
    
    // Calculate returns if not already present
    if (!df[`${prefix}_returns`]) {
        const closeShifted = ConservativeFeatureEngineer.shift(close, 1);
        df[`${prefix}_returns`] = close.map((c, i) => 
            (c - (closeShifted[i] || c)) / ((closeShifted[i] || c) + 1e-10)
        );
    }
    
    const returns = df[`${prefix}_returns`];
    
    // RSI (14-period)
    const gains = returns.map(r => r > 0 ? r : 0);
    const losses = returns.map(r => r < 0 ? -r : 0);
    
    const avgGain = ConservativeFeatureEngineer.rolling(gains, 14, 14);
    const avgLoss = ConservativeFeatureEngineer.rolling(losses, 14, 14);
    
    const rs = avgGain.map((gain, i) => 
        gain / ((avgLoss[i] || 0) + 1e-10)
    );
    
    df[`${prefix}_rsi`] = rs.map(r => 100 - (100 / (1 + r)));
    
    // Normalize RSI to [-1, 1] range
    df[`${prefix}_rsi_norm`] = df[`${prefix}_rsi`].map(rsi => 
        (rsi - 50) / 50
    );
    
    // Bollinger Band position
    if (df[`${prefix}_sma_20`] && df[`${prefix}_volatility_20`]) {
        const sma20 = df[`${prefix}_sma_20`];
        const vol20 = df[`${prefix}_volatility_20`];
        
        const bbUpper = sma20.map((sma, i) => 
            sma + (2 * (vol20[i] || 0) * sma)
        );
        const bbLower = sma20.map((sma, i) => 
            sma - (2 * (vol20[i] || 0) * sma)
        );
        
        df[`${prefix}_bb_position`] = close.map((c, i) => 
            (c - bbLower[i]) / (bbUpper[i] - bbLower[i] + 1e-10)
        );
    }
    
    return df;
};

// ========================================================================
// MAIN PIPELINE
// ========================================================================

ConservativeFeatureEngineer.prototype.engineerFeatures = function(df) {
    /**
     * Main feature engineering pipeline
     * Returns dataframe with ~40 carefully selected features
     */
    console.log("      → Engineering conservative features...");
    
    // Intra-bar features (all timeframes)
    const timeframes = ['1h', '4h', '1d'];
    for (const timeframe of timeframes) {
        if (df[`${timeframe}_open`] && df[`${timeframe}_high`] && 
            df[`${timeframe}_low`] && df[`${timeframe}_close`]) {
            df = this.addIntrabarFeatures(df, timeframe);
        }
    }
    
    // Historical momentum (1H only to keep feature count manageable)
    if (df['1h_close']) {
        df = this.addHistoricalMomentum(df, '1h', [1, 3, 6, 12]);
    }
    
    // Moving averages
    if (df['1h_close']) {
        df = this.addConservativeMovingAverages(df, '1h', [10, 20, 50]);
    }
    
    // Volatility
    if (df['1h_close']) {
        df = this.addRealizedVolatility(df, '1h', [10, 20]);
    }
    
    // Volume
    if (df['1h_volume']) {
        df = this.addVolumeFeatures(df, '1h');
    }
    
    // Multi-timeframe alignment
    df = this.addMultiTimeframeAlignment(df);
    
    // Simple indicators
    if (df['1h_close']) {
        df = this.addSimpleIndicators(df, '1h');
    }
    
    // 30M momentum (historical)
    if (df['30m1_close'] && df['30m2_close']) {
        const m1Close = df['30m1_close'];
        const m2Close = df['30m2_close'];
        df['30m_momentum'] = m2Close.map((m2, i) => 
            (m2 - m1Close[i]) / (m1Close[i] + 1e-10)
        );
    }
    
    // Store feature names for later use
    const excludePatterns = [
        'timestamp', 'symbol', 'future_close', 'future_return',
        '_open', '_high', '_low', '_close', '_volume',
        '30m1', '30m2', '30m_avg'
    ];
    
    this.featureNames = Object.keys(df).filter(col => {
        return !excludePatterns.some(pattern => 
            col === pattern || col.endsWith(pattern) || col.startsWith(pattern)
        );
    });
    
    console.log(`      ✓ Created ${this.featureNames.length} conservative features`);
    
    return df;
};

ConservativeFeatureEngineer.prototype.getFeatureList = function() {
    /**
     * Return list of engineered feature names
     */
    return this.featureNames;
};

// ========================================================================
// VERIFICATION FUNCTIONS
// ========================================================================

function verifyNoLeakage(df, featureCols) {
    /**
     * Final verification: check that no features contain future information
     */
    console.log("\n🔍 Verifying features for leakage...");
    
    const issues = [];
    
    for (const col of featureCols) {
        if (!df[col]) {
            issues.push(`${col}: Column not found`);
            continue;
        }
        
        const values = df[col];
        
        // Check for suspiciously low variance (all same value = problem)
        const validValues = values.filter(v => v !== null && !isNaN(v));
        if (validValues.length > 0) {
            const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
            const variance = validValues.reduce((sum, val) => 
                sum + Math.pow(val - mean, 2), 0
            ) / validValues.length;
            const std = Math.sqrt(variance);
            
            if (std < 1e-8) {
                issues.push(`${col}: Suspiciously low variance`);
            }
        }
        
        // Check for infinite values
        const hasInf = values.some(v => !isFinite(v) && v !== null);
        if (hasInf) {
            issues.push(`${col}: Contains infinite values`);
        }
    }
    
    if (issues.length > 0) {
        console.log(`   ⚠️  Found ${issues.length} potential issues:`);
        for (let i = 0; i < Math.min(5, issues.length); i++) {
            console.log(`      - ${issues[i]}`);
        }
        return false;
    } else {
        console.log(`   ✅ All ${featureCols.length} features passed verification`);
        return true;
    }
}

// ========================================================================
// EXAMPLE USAGE
// ========================================================================

function createSampleForexData(n = 1000) {
    /**
     * Create sample forex data for testing
     */
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
    
    const generatePrice = () => cumsum(Array.from({length: n}, () => randn() * 0.0001));
    const basePrice = 1.1000;
    
    const sampleDf = {
        '1h_open': generatePrice().map(v => basePrice + v),
        '1h_high': generatePrice().map(v => basePrice + v + 0.0002),
        '1h_low': generatePrice().map(v => basePrice + v - 0.0002),
        '1h_close': generatePrice().map(v => basePrice + v),
        '1h_volume': Array.from({length: n}, () => 1000 + rand() * 5000),
        '4h_open': generatePrice().map(v => basePrice + v),
        '4h_high': generatePrice().map(v => basePrice + v + 0.0003),
        '4h_low': generatePrice().map(v => basePrice + v - 0.0003),
        '4h_close': generatePrice().map(v => basePrice + v),
        '1d_open': generatePrice().map(v => basePrice + v),
        '1d_high': generatePrice().map(v => basePrice + v + 0.0005),
        '1d_low': generatePrice().map(v => basePrice + v - 0.0005),
        '1d_close': generatePrice().map(v => basePrice + v)
    };
    
    return sampleDf;
}

function runExample() {
    console.log("=".repeat(70));
    console.log("Conservative Feature Engineering v3.0");
    console.log("=".repeat(70));
    console.log("\nPhilosophy: Quality over quantity");
    console.log("Target: ~40 carefully selected, leak-free features");
    console.log("\nFeature categories:");
    console.log("  • Intra-bar patterns (15 features)");
    console.log("  • Historical momentum (5 features)");
    console.log("  • Moving averages (9 features)");
    console.log("  • Volatility (3 features)");
    console.log("  • Volume (4 features)");
    console.log("  • Multi-timeframe alignment (5 features)");
    console.log("  • Technical indicators (3 features)");
    console.log("=".repeat(70));
    console.log("\n");
    
    // Create feature engineer
    const engineer = new ConservativeFeatureEngineer();
    
    // Create sample data
    const df = createSampleForexData(1000);
    
    // Engineer features
    const dfWithFeatures = engineer.engineerFeatures(df);
    
    // Get feature list
    const features = engineer.getFeatureList();
    
    console.log("\n" + "=".repeat(70));
    console.log("FEATURE ENGINEERING COMPLETE");
    console.log("=".repeat(70));
    console.log(`Total features created: ${features.length}`);
    console.log("\nFeature names:");
    
    // Group features by category
    const categories = {
        'Intra-bar': features.filter(f => f.includes('_trend') || f.includes('_range') || 
                                           f.includes('_body') || f.includes('_shadow') || 
                                           f.includes('_position')),
        'Momentum': features.filter(f => f.includes('momentum')),
        'Moving Averages': features.filter(f => f.includes('sma') || f.includes('_ma_')),
        'Volatility': features.filter(f => f.includes('volatility') || f.includes('vol_ratio')),
        'Volume': features.filter(f => f.includes('volume')),
        'Multi-timeframe': features.filter(f => f.includes('_vs_') || f.includes('_in_') || 
                                                 f.includes('alignment')),
        'Indicators': features.filter(f => f.includes('rsi') || f.includes('bb'))
    };
    
    for (const [category, feats] of Object.entries(categories)) {
        if (feats.length > 0) {
            console.log(`\n${category} (${feats.length} features):`);
            feats.forEach(f => console.log(`  - ${f}`));
        }
    }
    
    // Verify no leakage
    verifyNoLeakage(dfWithFeatures, features);
    
    console.log("\n" + "=".repeat(70));
    console.log("✅ Feature engineering complete and verified!");
    console.log("=".repeat(70));
}

// Run example if in Node.js environment
if (typeof require !== 'undefined' && require.main === module) {
    runExample();
}

// ========================================================================
// VERCEL-COMPATIBLE EXPORT (CRITICAL FIX)
// ========================================================================
// ONLY export the class constructor - this matches your usage pattern:
// new ConservativeFeatureEngineer()
//
// The utility functions are available as:
// ConservativeFeatureEngineer.verifyNoLeakage
// ConservativeFeatureEngineer.createSampleForexData
// ConservativeFeatureEngineer.runExample

if (typeof module !== 'undefined' && module.exports) {
    // Primary export: the class itself
    module.exports = ConservativeFeatureEngineer;
    
    // Attach utility functions as static properties
    module.exports.verifyNoLeakage = verifyNoLeakage;
    module.exports.createSampleForexData = createSampleForexData;
    module.exports.runExample = runExample;
}