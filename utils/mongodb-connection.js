const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  // Use cached connection if available (Vercel keeps in memory)
  if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
    console.log('✓ Using cached MongoDB connection');
    return cachedDb;
  }

  console.log('🔄 Connecting to MongoDB...');

  try {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });

    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(process.env.MONGODB_DB || 'trading');

    cachedClient = client;
    cachedDb = db;

    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    throw error;
  }
}

module.exports = { connectToDatabase };