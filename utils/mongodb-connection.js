const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

async function connectToDatabase() {
  // CRITICAL: Check if MONGODB_URI is set
  if (!process.env.MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI environment variable is not set!');
    throw new Error('MongoDB URI not configured. Set MONGODB_URI in Vercel environment variables.');
  }

  // Use cached connection if available (Vercel keeps in memory)
  if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
    console.log('✓ Using cached MongoDB connection');
    return cachedDb;
  }

  console.log(`🔄 Connecting to MongoDB (attempt ${connectionAttempts + 1}/${MAX_ATTEMPTS})...`);

  try {
    connectionAttempts++;

    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      serverSelectionTimeoutMS: 8000,  // Increased from 5s to 8s
      connectTimeoutMS: 15000,          // Increased from 10s to 15s
      socketTimeoutMS: 30000,           // Added socket timeout
      family: 4                         // Force IPv4 (sometimes fixes issues)
    });

    await client.connect();
    console.log('✅ Connected to MongoDB successfully!');

    const db = client.db(process.env.MONGODB_DB || 'trading');

    // Test the connection
    await db.command({ ping: 1 });
    console.log('✅ MongoDB ping successful');

    cachedClient = client;
    cachedDb = db;
    connectionAttempts = 0; // Reset on success

    return db;
  } catch (error) {
    console.error(`❌ MongoDB connection error (attempt ${connectionAttempts}):`, error.message);
    
    if (connectionAttempts < MAX_ATTEMPTS) {
      console.log(`⏳ Retrying connection in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return connectToDatabase(); // Retry
    }
    
    connectionAttempts = 0; // Reset counter
    throw new Error(`MongoDB connection failed after ${MAX_ATTEMPTS} attempts: ${error.message}`);
  }
}

// Export health check function
async function checkDatabaseHealth() {
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    return { healthy: true, message: 'MongoDB connected' };
  } catch (error) {
    return { healthy: false, message: error.message };
  }
}

module.exports = { connectToDatabase, checkDatabaseHealth };