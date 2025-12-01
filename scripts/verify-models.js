/**
 * Verify all model files exist before deployment
 * This runs during Vercel build (via vercel-build script)
 */

const fs = require('fs');
const path = require('path');

const CRYPTO_MODELS = [
    'temporal_transformer.keras',
    'hybrid_transformer.keras',
    'hierarchical_lstm.keras',
    'bidirectional_attention.keras',
    'multiscale_transformer.keras'
];

const FOREX_MODELS = [
    'temporal_transformer.keras',
    'hierarchical_lstm.keras',
    'hybrid_transformer.keras',
    'multiscale_transformer.keras'
];

function verifyModels(modelFiles, directory) {
    const missing = [];
    let totalSize = 0;
    
    console.log(`\n📦 Verifying ${directory}...`);
    
    for (const file of modelFiles) {
        const filePath = path.join(process.cwd(), directory, file);
        
        if (!fs.existsSync(filePath)) {
            missing.push(file);
            console.error(`  ❌ Missing: ${file}`);
        } else {
            const stats = fs.statSync(filePath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            totalSize += stats.size;
            console.log(`  ✅ ${file} (${sizeMB} MB)`);
        }
    }
    
    if (missing.length > 0) {
        throw new Error(
            `Missing ${missing.length} model file(s) in ${directory}:\n` +
            missing.map(f => `  - ${f}`).join('\n')
        );
    }
    
    const totalMB = (totalSize / 1024 / 1024).toFixed(2);
    console.log(`  ✓ All ${modelFiles.length} models present (${totalMB} MB total)`);
    
    return { count: modelFiles.length, sizeMB: totalMB };
}

try {
    console.log('═'.repeat(70));
    console.log('MODEL FILE VERIFICATION');
    console.log('═'.repeat(70));
    
    const crypto = verifyModels(CRYPTO_MODELS, 'models/crypto');
    const forex = verifyModels(FOREX_MODELS, 'models/forex');
    
    console.log('\n' + '═'.repeat(70));
    console.log('✅ VERIFICATION PASSED');
    console.log('═'.repeat(70));
    console.log(`Crypto: ${crypto.count} models (${crypto.sizeMB} MB)`);
    console.log(`Forex: ${forex.count} models (${forex.sizeMB} MB)`);
    console.log(`Total: ${crypto.count + forex.count} models (${(parseFloat(crypto.sizeMB) + parseFloat(forex.sizeMB)).toFixed(2)} MB)`);
    console.log('═'.repeat(70) + '\n');
    
    process.exit(0);
    
} catch (error) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ VERIFICATION FAILED');
    console.error('═'.repeat(70));
    console.error(error.message);
    console.error('═'.repeat(70) + '\n');
    
    console.error('SOLUTION:');
    console.error('1. Ensure all .keras files are committed to git');
    console.error('2. Check models/crypto/ and models/forex/ directories');
    console.error('3. Run: git status to verify models are tracked');
    console.error('');
    
    process.exit(1);
}