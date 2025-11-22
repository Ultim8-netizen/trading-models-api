// Dashboard Configuration
const CONFIG = {
    API_BASE: 'https://trading-models.vercel.app', // Change to your Vercel URL
    REFRESH_INTERVAL: 60000, // Auto-refresh every 60 seconds
    CACHE_DURATION: 30000    // Cache API responses for 30 seconds
};

// State Management
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
    cache: {}
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    fetchHealth();
    fetchStats();
    fetchPredictions();
    
    // Auto-refresh
    setInterval(fetchPredictions, CONFIG.REFRESH_INTERVAL);
});

function initializeEventListeners() {
    // Filter buttons
    document.getElementById('filterAll').addEventListener('click', () => {
        setAssetClass(null);
    });
    document.getElementById('filterCrypto').addEventListener('click', () => {
        setAssetClass('crypto');
    });
    document.getElementById('filterForex').addEventListener('click', () => {
        setAssetClass('forex');
    });

    // Inputs
    document.getElementById('limitInput').addEventListener('change', (e) => {
        state.limit = parseInt(e.target.value);
        state.currentPage = 1;
        state.currentOffset = 0;
        fetchPredictions();
    });

    document.getElementById('sortInput').addEventListener('change', (e) => {
        state.sort = e.target.value;
        state.currentPage = 1;
        state.currentOffset = 0;
        fetchPredictions();
    });

    // Buttons
    document.getElementById('refreshBtn').addEventListener('click', () => {
        state.cache = {};
        fetchStats();
        fetchPredictions();
    });

    document.getElementById('statsBtn').addEventListener('click', showStatsModal);
    document.getElementById('prevBtn').addEventListener('click', previousPage);
    document.getElementById('nextBtn').addEventListener('click', nextPage);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modalOverlay')) closeModal();
    });
}

// ============================================================================
// STATE MANAGEMENT
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
        document.getElementById('filterAll').classList.add('active');
    } else if (state.assetClass === 'crypto') {
        document.getElementById('filterCrypto').classList.add('active');
    } else if (state.assetClass === 'forex') {
        document.getElementById('filterForex').classList.add('active');
    }
}

function previousPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        state.currentOffset = (state.currentPage - 1) * state.limit;
        fetchPredictions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    if (state.hasMore) {
        state.currentPage++;
        state.currentOffset = (state.currentPage - 1) * state.limit;
        fetchPredictions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ============================================================================
// API CALLS
// ============================================================================

async function fetchHealth() {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/get-predictions?health=true`);
        const data = await response.json();
        
        if (data.status === 'healthy') {
            document.getElementById('healthStatus').innerHTML = '✓ Healthy';
        }
    } catch (error) {
        document.getElementById('healthStatus').innerHTML = '✗ Offline';
        console.warn('Health check failed:', error.message);
    }
}

async function fetchStats() {
    try {
        const cacheKey = 'stats';
        if (state.cache[cacheKey] && Date.now() - state.cache[cacheKey].time < CONFIG.CACHE_DURATION) {
            state.stats = state.cache[cacheKey].data;
            updateStatsDisplay();
            return;
        }

        let url = `${CONFIG.API_BASE}/api/get-predictions?include_stats=true&limit=1`;
        if (state.assetClass) {
            url += `&asset_class=${state.assetClass}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.success && data.stats) {
            state.stats = data.stats;
            state.cache[cacheKey] = { data: data.stats, time: Date.now() };
            updateStatsDisplay();
        }
    } catch (error) {
        console.error('Stats fetch error:', error);
    }
}

async function fetchPredictions() {
    try {
        showLoading();
        
        let url = `${CONFIG.API_BASE}/api/get-predictions?limit=${state.limit}&offset=${state.currentOffset}&sort=${state.sort}`;
        if (state.assetClass) {
            url += `&asset_class=${state.assetClass}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to fetch predictions');
            hideLoading();
            return;
        }

        state.predictions = data.data || [];
        state.totalCount = data.pagination.total_count;
        state.hasMore = data.pagination.has_more;

        // Update last update time
        if (data.data.length > 0) {
            const lastTime = new Date(data.data[0].timestamp);
            document.getElementById('lastUpdate').textContent = lastTime.toLocaleTimeString();
        }

        document.getElementById('totalCount').textContent = state.totalCount.toLocaleString();
        document.getElementById('currentPage').textContent = state.currentPage;
        document.getElementById('pageInfo').textContent = 
            `${state.currentOffset + 1}-${Math.min(state.currentOffset + state.limit, state.totalCount)} of ${state.totalCount}`;

        document.getElementById('prevBtn').disabled = state.currentPage === 1;
        document.getElementById('nextBtn').disabled = !state.hasMore;

        renderPredictions();
        hideLoading();
        hideError();

    } catch (error) {
        showError(error.message);
        hideLoading();
    }
}

// ============================================================================
// RENDERING
// ============================================================================

function renderPredictions() {
    const container = document.getElementById('predictionsContainer');

    if (state.predictions.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1;">
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <h3>No predictions found</h3>
                    <p>Try adjusting filters or refresh the page</p>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = state.predictions.map(pred => createPredictionCard(pred)).join('');
}

function createPredictionCard(pred) {
    const predClass = pred.class.toLowerCase();
    const confidencePercent = (parseFloat(pred.confidence) * 100).toFixed(1);
    const timestamp = new Date(pred.timestamp).toLocaleString();

    const cryptoFeatures = pred.asset_class === 'crypto' ? `
        <div class="footer-item">
            <span class="footer-label">Features:</span>
            <span>${pred.features?.bullish || 0}/${pred.features?.bearish || 0}</span>
        </div>
    ` : '';

    return `
        <div class="prediction-card">
            <div class="card-header">
                <div class="symbol-info">
                    <span class="symbol">${pred.symbol || pred.pair}</span>
                    <span class="asset-type">${pred.asset_class === 'crypto' ? '🪙 Crypto' : '💱 Forex'}</span>
                </div>
                <span class="prediction-badge ${predClass}">
                    ${pred.class === 'UP' ? '📈' : pred.class === 'DOWN' ? '📉' : '〰️'} ${pred.class}
                </span>
            </div>

            <div class="confidence-section">
                <div class="confidence-label">Confidence</div>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${confidencePercent}%">
                        ${confidencePercent > 20 ? `<span class="confidence-percent">${confidencePercent}%</span>` : ''}
                    </div>
                </div>
            </div>

            <div class="probabilities">
                <div class="prob-item">
                    <div class="prob-label">📉 DOWN</div>
                    <div class="prob-value">${(parseFloat(pred.probabilities.down) * 100).toFixed(0)}%</div>
                </div>
                <div class="prob-item">
                    <div class="prob-label">〰️ NEUTRAL</div>
                    <div class="prob-value">${(parseFloat(pred.probabilities.neutral) * 100).toFixed(0)}%</div>
                </div>
                <div class="prob-item">
                    <div class="prob-label">📈 UP</div>
                    <div class="prob-value">${(parseFloat(pred.probabilities.up) * 100).toFixed(0)}%</div>
                </div>
            </div>

            <div class="card-footer">
                <div class="footer-item">
                    <span class="footer-label">Models:</span>
                    <span>${pred.models?.used || 0}/${pred.models?.total || 0}</span>
                </div>
                <div class="footer-item">
                    <span class="footer-label">Inference:</span>
                    <span>${pred.performance?.inference_time_ms || 0}ms</span>
                </div>
                ${cryptoFeatures}
                <div class="timestamp">
                    🕐 ${timestamp}
                </div>
            </div>
        </div>
    `;
}

function updateStatsDisplay() {
    if (!state.stats) return;

    const stats = state.stats;
    const avgConf = (stats.confidence?.average || 0) * 100;
    document.getElementById('avgConfidence').textContent = avgConf.toFixed(0);
}

// ============================================================================
// UI HELPERS
// ============================================================================

function showLoading() {
    // Create loading state in container if not already present
    const container = document.getElementById('predictionsContainer');
    if (!container.querySelector('.loading-container')) {
        container.innerHTML = `
            <div style="grid-column: 1/-1;">
                <div class="loading-container">
                    <div class="spinner"></div>
                    <div class="loading-text">Loading predictions...</div>
                </div>
            </div>
        `;
    }
}

function hideLoading() {
    // Remove loading indicator
}

function showError(message) {
    const errorBox = document.getElementById('errorBox');
    errorBox.textContent = `❌ ${message}`;
    errorBox.classList.add('show');
    
    setTimeout(() => {
        errorBox.classList.remove('show');
    }, 5000);
}

function hideError() {
    const errorBox = document.getElementById('errorBox');
    errorBox.classList.remove('show');
}

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
    document.getElementById('modalOverlay').classList.remove('show');
}

// ============================================================================
// UTILITY
// ============================================================================

window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showError('An unexpected error occurred');
});