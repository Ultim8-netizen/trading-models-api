/**
 * Debug endpoint - Check if models are accessible
 * GET /api/check-models
 */

const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    try {
        const cryptoDir = path.join(process.cwd(), 'models', 'crypto');
        const forexDir = path.join(process.cwd(), 'models', 'forex');
        
        const result = {
            cwd: process.cwd(),
            crypto: checkDirectory(cryptoDir),
            forex: checkDirectory(forexDir)
        };
        
        const allModelsPresent = 
            result.crypto.filesFound === 5 && 
            result.forex.filesFound === 4;
        
        return res.status(allModelsPresent ? 200 : 500).json({
            success: allModelsPresent,
            ...result
        });
        
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

function checkDirectory(dirPath) {
    const exists = fs.existsSync(dirPath);
    
    if (!exists) {
        return {
            exists: false,
            path: dirPath,
            files: [],
            filesFound: 0
        };
    }
    
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.keras'));
    
    return {
        exists: true,
        path: dirPath,
        files,
        filesFound: files.length
    };
}