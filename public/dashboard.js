// ============================================================================
// CONFIGURATION - FIXED: Dynamic API base URL
// ============================================================================
const CONFIG = {
    // If on Vercel domain, use relative paths. Otherwise, use full Vercel URL
    API_BASE: window.location.hostname.includes('vercel.app') 
        ? window.location.origin 
        : 'https://trading-models.vercel.app',  // ← YOUR VERCEL URL
    
    REFRESH_INTERVAL: 60000,
    CACHE_DURATION: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    NETWORK_CHECK_INTERVAL: 30000
};

console.log(`🔧 API Base URL: ${CONFIG.API_BASE}`);

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
let state = {
    currentPage: 1,
    currentOffset: 0,
    assetClass: null,
    limit: 20,
    sort: '-timestamp',
    predictions: [],
    totalCount: 0,
    hasMore: false,
    stats: null,
    lastFetch: 0,
    cache: {},
    isLoading: false,
    isOnline: navigator.onLine,
    retryCount: 0,
    autoRefreshTimer: null,
    networkCheckTimer: null
};

// ============================================================================
// INITIALIZATION - FIXED: Robust startup with error handling
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        // FIXED: Verify critical DOM elements exist
        const requiredElements = [
            'predictionsContainer', 'errorBox', 'totalCount', 'avgConfidence',
            'lastUpdate', 'healthStatus', 'filterAll', 'filterCrypto', 
            'filterForex', 'limitInput', 'sortInput', 'refreshBtn', 
            'statsBtn', 'prevBtn', 'nextBtn', 'networkStatus'
        ];

        const missingElements = requiredElements.filter(id => !document.getElementById(id));
        
        if (missingElements.length > 0) {
            console.error('Missing required DOM elements:', missingElements);
            showError(`Critical UI elements missing: ${missingElements.join(', ')}`);
            return;
        }

        initializeEventListeners();
        setupNetworkMonitoring();
        
        // Initial data fetch with proper error handling
        initializeApp();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError(`Failed to initialize dashboard: ${error.message}`);
    }
});

async function initializeApp() {
    try {
        showLoading();
        
        // Run health check first
        await fetchHealth();
        
        // Then fetch stats and predictions in parallel
        await Promise.all([
            fetchStats(),
            fetchPredictions()
        ]);
        
        // Start auto-refresh timer
        startAutoRefresh();
        
    } catch (error) {
        console.error('App initialization error:', error);
        showError(`Failed to load initial data: ${error.message}`);
        hideLoading();
    }
}

// ============================================================================
// EVENT LISTENERS - FIXED: Better error handling
// ============================================================================
function initializeEventListeners() {
    try {
        // Filter buttons
        safeAddEventListener('filterAll', 'click', () => setAssetClass(null));
        safeAddEventListener('filterCrypto', 'click', () => setAssetClass('crypto'));
        safeAddEventListener('filterForex', 'click', () => setAssetClass('forex'));

        // Select inputs
        safeAddEventListener('limitInput', 'change', (e) => {
            state.limit = parseInt(e.target.value);
            state.currentPage = 1;
            state.currentOffset = 0;
            fetchPredictions();
        });

        safeAddEventListener('sortInput', 'change', (e) => {
            state.sort = e.target.value;
            state.currentPage = 1;
            state.currentOffset = 0;
            fetchPredictions();
        });

        // Action buttons
        safeAddEventListener('refreshBtn', 'click', () => {
            state.cache = {};
            state.retryCount = 0;
            fetchStats();
            fetchPredictions();
        });

        safeAddEventListener('statsBtn', 'click', showStatsModal);
        safeAddEventListener('prevBtn', 'click', previousPage);
        safeAddEventListener('nextBtn', 'click', nextPage);
        safeAddEventListener('modalCloseBtn', 'click', closeModal);
        
        // Modal overlay click
        safeAddEventListener('modalOverlay', 'click', (e) => {
            if (e.target === document.getElementById('modalOverlay')) closeModal();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'r' && e.ctrlKey) {
                e.preventDefault();
                document.getElementById('refreshBtn').click();
            }
        });

    } catch (error) {
        console.error('Error setting up event listeners:', error);
        showError('Failed to initialize controls');
    }
}

function safeAddEventListener(elementId, event, handler) {
    const element = document.getElementById(elementId);
    if (element) {
        element.addEventListener(event, handler);
    } else {
        console.warn(`Element not found: ${elementId}`);
    }
}

// ============================================================================
// NETWORK MONITORING - NEW: Track connection status
// ============================================================================
function setupNetworkMonitoring() {
    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Periodic connectivity check
    state.networkCheckTimer = setInterval(checkNetworkHealth, CONFIG.NETWORK_CHECK_INTERVAL);
    
    // Initial check
    updateNetworkStatus(navigator.onLine);
}

function handleOnline() {
    state.isOnline = true;
    updateNetworkStatus(true);
    showNetworkNotification('🟢 Back online', 'online');
    
    // Retry failed requests
    if (state.retryCount > 0) {
        setTimeout(() => {
            fetchPredictions();
        }, 1000);
    }
}

function handleOffline() {
    state.isOnline = false;
    updateNetworkStatus(false);
    showNetworkNotification('🔴 No internet connection', 'offline');
}

function updateNetworkStatus(isOnline) {
    const statusEl = document.getElementById('networkStatus');
    const iconEl = document.getElementById('networkStatusIcon');
    const textEl = document.getElementById('networkStatusText');
    
    if (!statusEl || !iconEl || !textEl) return;
    
    if (isOnline) {
        statusEl.className = 'network-status online';
        iconEl.textContent = '🟢';
        textEl.textContent = 'Connected';
    } else {
        statusEl.className = 'network-status offline';
        iconEl.textContent = '🔴';
        textEl.textContent = 'Offline';
    }
}

function showNetworkNotification(message, type) {
    const statusEl = document.getElementById('networkStatus');
    const textEl = document.getElementById('networkStatusText');
    
    if (!statusEl || !textEl) return;
    
    textEl.textContent = message;
    statusEl.classList.add('show', type);
    
    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 3000);
}

async function checkNetworkHealth() {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/get-predictions?health=true`, {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            if (!state.isOnline) {
                handleOnline();
            }
        } else {
            throw new Error('Health check failed');
        }
    } catch (error) {
        if (state.isOnline) {
            handleOffline();
        }
    }
}

// ============================================================================
// AUTO-REFRESH MANAGEMENT - NEW: Smarter refresh logic
// ============================================================================
function startAutoRefresh() {
    // Clear existing timer
    if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
    }
    
    // Start new timer
    state.autoRefreshTimer = setInterval(() => {
        if (state.isOnline && !state.isLoading && document.visibilityState === 'visible') {
            fetchPredictions(true); // Silent refresh
        }
    }, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = null;
    }
}

// Pause refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        startAutoRefresh();
        // Refresh data when returning to page
        if (Date.now() - state.lastFetch > CONFIG.REFRESH_INTERVAL) {
            fetchPredictions(true);
        }
    } else {
        stopAutoRefresh();
    }
});

// ============================================================================
// STATE MANAGEMENT FUNCTIONS
// ============================================================================
function setAssetClass(assetClass) {
    state.assetClass = assetClass;
    state.currentPage = 1;
    state.currentOffset = 0;
    
    updateFilterButtons();
    fetchPredictions();
}

function updateFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (!state.assetClass) {
        document.getElementById('filterAll')?.classList.add('active');
    } else if (state.assetClass === 'crypto') {
        document.getElementById('filterCrypto')?.classList.add('active');
    } else if (state.assetClass === 'forex') {
        document.getElementById('filterForex')?.classList.add('active');
    }
}

function previousPage() {
    if (state.currentPage > 1 && !state.isLoading) {
        state.currentPage--;
        state.currentOffset = (state.currentPage - 1) * state.limit;
        fetchPredictions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    if (state.hasMore && !state.isLoading) {
        state.currentPage++;
        state.currentOffset = (state.currentPage - 1) * state.limit;
        fetchPredictions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}
// ============================================================================
// API CALLS - FIXED: Comprehensive error handling & retry logic
// ============================================================================

async function fetchWithRetry(url, options = {}, retries = CONFIG.MAX_RETRIES) {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // FIXED: Check response status
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Reset retry count on success
            state.retryCount = 0;
            
            return { success: true, data };
            
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} failed:`, error.message);
            
            if (i < retries) {
                // Exponential backoff
                const delay = CONFIG.RETRY_DELAY * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
                state.retryCount++;
            } else {
                return { success: false, error: error.message };
            }
        }
    }
}

async function fetchHealth() {
    try {
        const result = await fetchWithRetry(
            `${CONFIG.API_BASE}/api/get-predictions?health=true`,
            { method: 'GET', cache: 'no-cache' },
            1 // Only retry once for health checks
        );
        
        const healthEl = document.getElementById('healthStatus');
        if (!healthEl) return;
        
        if (result.success && result.data.status === 'healthy') {
            healthEl.innerHTML = '✓ Healthy';
            healthEl.style.color = '#6ee7b7';
        } else {
            healthEl.innerHTML = '✗ Degraded';
            healthEl.style.color = '#fca5a5';
        }
    } catch (error) {
        const healthEl = document.getElementById('healthStatus');
        if (healthEl) {
            healthEl.innerHTML = '✗ Offline';
            healthEl.style.color = '#fca5a5';
        }
        console.warn('Health check failed:', error.message);
    }
}

async function fetchStats() {
    try {
        const cacheKey = `stats-${state.assetClass || 'all'}`;
        
        // FIXED: Check cache with proper validation
        if (state.cache[cacheKey] && Date.now() - state.cache[cacheKey].time < CONFIG.CACHE_DURATION) {
            state.stats = state.cache[cacheKey].data;
            updateStatsDisplay();
            return;
        }

        let url = `${CONFIG.API_BASE}/api/get-predictions?include_stats=true&limit=1`;
        if (state.assetClass) {
            url += `&asset_class=${encodeURIComponent(state.assetClass)}`;
        }

        const result = await fetchWithRetry(url);

        if (result.success && result.data.success && result.data.stats) {
            state.stats = result.data.stats;
            state.cache[cacheKey] = { data: result.data.stats, time: Date.now() };
            updateStatsDisplay();
        } else {
            console.warn('Stats fetch failed:', result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Stats fetch error:', error);
    }
}

async function fetchPredictions(silent = false) {
    // FIXED: Prevent concurrent requests
    if (state.isLoading) {
        console.log('Request already in progress, skipping...');
        return;
    }
    
    try {
        state.isLoading = true;
        
        if (!silent) {
            showLoading();
        }
        
        // FIXED: Proper URL construction with encoding
        let url = `${CONFIG.API_BASE}/api/get-predictions`;
        const params = new URLSearchParams({
            limit: state.limit,
            offset: state.currentOffset,
            sort: state.sort
        });
        
        if (state.assetClass) {
            params.append('asset_class', state.assetClass);
        }
        
        url += `?${params.toString()}`;

        const result = await fetchWithRetry(url);

        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch predictions');
        }
        
        const data = result.data;

        if (!data.success) {
            throw new Error(data.error || 'API returned error status');
        }

        // FIXED: Validate response structure
        if (!Array.isArray(data.data)) {
            throw new Error('Invalid response format: expected array');
        }

        state.predictions = data.data;
        state.totalCount = data.pagination?.total_count || 0;
        state.hasMore = data.pagination?.has_more || false;
        state.lastFetch = Date.now();

        // Update UI elements
        updateLastUpdateTime(data.data);
        updatePaginationInfo();
        renderPredictions();
        
        hideLoading();
        hideError();

    } catch (error) {
        console.error('Predictions fetch error:', error);
        if (!silent) {
            showError(`Failed to load predictions: ${error.message}`);
        }
        renderEmptyState(error.message);
    } finally {
        state.isLoading = false;
    }
}

// ============================================================================
// UI UPDATE FUNCTIONS - FIXED: Null checks & proper formatting
// ============================================================================

function updateLastUpdateTime(predictions) {
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (!lastUpdateEl) return;
    
    if (predictions && predictions.length > 0) {
        try {
            const lastTime = new Date(predictions[0].timestamp);
            if (isNaN(lastTime.getTime())) {
                lastUpdateEl.textContent = 'Invalid';
            } else {
                lastUpdateEl.textContent = lastTime.toLocaleTimeString();
            }
        } catch (error) {
            lastUpdateEl.textContent = 'Error';
        }
    } else {
        lastUpdateEl.textContent = 'No data';
    }
}

function updatePaginationInfo() {
    const totalCountEl = document.getElementById('totalCount');
    const currentPageEl = document.getElementById('currentPage');
    const pageInfoEl = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (totalCountEl) totalCountEl.textContent = state.totalCount.toLocaleString();
    if (currentPageEl) currentPageEl.textContent = state.currentPage;
    
    if (pageInfoEl) {
        const start = state.currentOffset + 1;
        const end = Math.min(state.currentOffset + state.limit, state.totalCount);
        pageInfoEl.textContent = `${start}-${end} of ${state.totalCount}`;
    }
    
    if (prevBtn) prevBtn.disabled = state.currentPage === 1 || state.isLoading;
    if (nextBtn) nextBtn.disabled = !state.hasMore || state.isLoading;
}

function updateStatsDisplay() {
    if (!state.stats) return;

    const avgConfEl = document.getElementById('avgConfidence');
    if (avgConfEl) {
        const avgConf = (state.stats.confidence?.average || 0) * 100;
        avgConfEl.textContent = avgConf.toFixed(0);
    }
}

// ============================================================================
// RENDERING - FIXED: Better error states & loading
// ============================================================================

function renderPredictions() {
    const container = document.getElementById('predictionsContainer');
    if (!container) {
        console.error('Predictions container not found');
        return;
    }

    if (state.predictions.length === 0) {
        renderEmptyState('No predictions available');
        return;
    }

    try {
        container.innerHTML = state.predictions
            .map(pred => createPredictionCard(pred))
            .join('');
    } catch (error) {
        console.error('Render error:', error);
        showError(`Failed to display predictions: ${error.message}`);
    }
}

function createPredictionCard(pred) {
    // FIXED: Safe property access with defaults
    const predClass = (pred.class || 'NEUTRAL').toLowerCase();
    const confidence = parseFloat(pred.confidence || 0);
    const confidencePercent = (confidence * 100).toFixed(1);
    
    let timestamp = 'Unknown';
    try {
        timestamp = new Date(pred.timestamp).toLocaleString();
    } catch (e) {
        console.warn('Invalid timestamp:', pred.timestamp);
    }

    const symbol = pred.symbol || pred.pair || 'Unknown';
    const assetType = pred.asset_class === 'crypto' ? '🪙 Crypto' : '💱 Forex';
    
    const probabilities = pred.probabilities || { down: 0, neutral: 0, up: 0 };
    const models = pred.models || { used: 0, total: 0 };
    const performance = pred.performance || { inference_time_ms: 0 };
    const features = pred.features || { bullish: 0, bearish: 0 };

    const cryptoFeatures = pred.asset_class === 'crypto' ? `
        <div class="footer-item">
            <span class="footer-label">Features:</span>
            <span>${features.bullish}/${features.bearish}</span>
        </div>
    ` : '';

    return `
        <div class="prediction-card">
            <div class="card-header">
                <div class="symbol-info">
                    <span class="symbol">${escapeHtml(symbol)}</span>
                    <span class="asset-type">${assetType}</span>
                </div>
                <span class="prediction-badge ${predClass}">
                    ${predClass === 'up' ? '📈' : predClass === 'down' ? '📉' : '〰️'} ${pred.class || 'NEUTRAL'}
                </span>
            </div>

            <div class="confidence-section">
                <div class="confidence-label">Confidence</div>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${confidencePercent}%">
                        ${parseFloat(confidencePercent) > 20 ? `<span class="confidence-percent">${confidencePercent}%</span>` : ''}
                    </div>
                </div>
            </div>

            <div class="probabilities">
                <div class="prob-item">
                    <div class="prob-label">📉 DOWN</div>
                    <div class="prob-value">${(parseFloat(probabilities.down || 0) * 100).toFixed(0)}%</div>
                </div>
                <div class="prob-item">
                    <div class="prob-label">〰️ NEUTRAL</div>
                    <div class="prob-value">${(parseFloat(probabilities.neutral || 0) * 100).toFixed(0)}%</div>
                </div>
                <div class="prob-item">
                    <div class="prob-label">📈 UP</div>
                    <div class="prob-value">${(parseFloat(probabilities.up || 0) * 100).toFixed(0)}%</div>
                </div>
            </div>

            <div class="card-footer">
                <div class="footer-item">
                    <span class="footer-label">Models:</span>
                    <span>${models.used}/${models.total}</span>
                </div>
                <div class="footer-item">
                    <span class="footer-label">Inference:</span>
                    <span>${performance.inference_time_ms}ms</span>
                </div>
                ${cryptoFeatures}
                <div class="timestamp">
                    🕐 ${escapeHtml(timestamp)}
                </div>
            </div>
        </div>
    `;
}

function renderEmptyState(message = 'No predictions found') {
    const container = document.getElementById('predictionsContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div style="grid-column: 1/-1;">
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <h3>No predictions found</h3>
                <p>${escapeHtml(message)}</p>
                <button onclick="document.getElementById('refreshBtn').click()" style="margin-top: 20px;">
                    🔄 Try Again
                </button>
            </div>
        </div>
    `;
}

// ============================================================================
// LOADING & ERROR STATES - FIXED: Proper visibility management
// ============================================================================

function showLoading() {
    const container = document.getElementById('predictionsContainer');
    if (!container) return;
    
    // Show skeleton loaders
    container.innerHTML = `
        <div style="grid-column: 1/-1;">
            <div class="loading-container">
                <div class="spinner"></div>
                <div class="loading-text">Loading predictions...</div>
            </div>
        </div>
    `;
}

function hideLoading() {
    // Loading is hidden by rendering actual content
}

function showError(message) {
    const errorBox = document.getElementById('errorBox');
    if (!errorBox) return;
    
    errorBox.textContent = `❌ ${message}`;
    errorBox.classList.add('show');
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
        hideError();
    }, 8000);
}

function hideError() {
    const errorBox = document.getElementById('errorBox');
    if (errorBox) {
        errorBox.classList.remove('show');
    }
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================

function showStatsModal() {
    if (!state.stats) {
        showError('Statistics not available');
        return;
    }

    const stats = state.stats;
    const content = `
        <div style="color: #e5e7eb;">
            <h4 style="margin-bottom: 12px; font-size: 16px;">Prediction Distribution</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 20px;">
                <div style="text-align: center; padding: 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px;">
                    <div style="color: var(--gray-400); font-size: 12px;">📈 UP</div>
                    <div style="font-size: 20px; font-weight: 700; color: #6ee7b7;">${stats.distribution?.up || 0}</div>
                </div>
                <div style="text-align: center; padding: 12px; background: rgba(245, 158, 11, 0.1); border-radius: 8px;">
                    <div style="color: var(--gray-400); font-size: 12px;">〰️ NEUTRAL</div>
                    <div style="font-size: 20px; font-weight: 700; color: #fcd34d;">${stats.distribution?.neutral || 0}</div>
                </div>
                <div style="text-align: center; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
                    <div style="color: var(--gray-400); font-size: 12px;">📉 DOWN</div>
                    <div style="font-size: 20px; font-weight: 700; color: #fca5a5;">${stats.distribution?.down || 0}</div>
                </div>
            </div>

            <h4 style="margin-bottom: 12px; font-size: 16px;">Confidence Metrics</h4>
            <div style="display: grid; gap: 8px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--glass-bg); border-radius: 8px;">
                    <span>Average:</span>
                    <strong>${((stats.confidence?.average || 0) * 100).toFixed(1)}%</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--glass-bg); border-radius: 8px;">
                    <span>Maximum:</span>
                    <strong>${((stats.confidence?.max || 0) * 100).toFixed(1)}%</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--glass-bg); border-radius: 8px;">
                    <span>Minimum:</span>
                    <strong>${((stats.confidence?.min || 0) * 100).toFixed(1)}%</strong>
                </div>
            </div>

            <h4 style="margin-bottom: 12px; font-size: 16px;">Performance</h4>
            <div style="display: grid; gap: 8px;">
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--glass-bg); border-radius: 8px;">
                    <span>Avg Models Used:</span>
                    <strong>${(stats.performance?.avg_models_used || 0)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--glass-bg); border-radius: 8px;">
                    <span>Avg Inference Time:</span>
                    <strong>${(stats.performance?.avg_inference_time_ms || 0).toFixed(0)}ms</strong>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modalTitle').textContent = '📊 Prediction Statistics';
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
    document.getElementById('modalOverlay')?.classList.remove('show');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Global error handler
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showError('An unexpected error occurred. Please refresh the page.');
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showError('A network error occurred. Please check your connection.');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
    if (state.networkCheckTimer) {
        clearInterval(state.networkCheckTimer);
    }
});