/**
 * Local test script - run before deploying to Vercel
 */

const predict = require('./api/predict');

// Mock request/response for testing
const mockReq = {
  method: 'POST',
  body: {
    asset_type: 'crypto',
    features: Array(88).fill(0).map(() => Math.random()) // Random test data
  }
};

const mockRes = {
  setHeader: () => {},
  status: (code) => {
    console.log(`Status: ${code}`);
    return mockRes;
  },
  json: (data) => {
    console.log('\n✅ PREDICTION RESULT:');
    console.log(JSON.stringify(data, null, 2));
    return mockRes;
  },
  end: () => {
    console.log('Request ended');
    return mockRes;
  }
};

console.log('🧪 Testing local prediction...\n');
predict(mockReq, mockRes);