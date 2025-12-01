const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

async function connectToDatabase() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI environment variable is not set!');
    throw new Error('MONGODB_URI not configured in environment variables.');
  }

  // Reuse existing connection if still open
  if (cachedClient && cachedClient.topology && !cachedClient.topology.s.closed) {
    console.log('✓ Using cached MongoDB connection');
    return cachedDb;
  }

  console.log(`🔄 Connecting to MongoDB (attempt ${connectionAttempts + 1}/${MAX_ATTEMPTS})...`);
  connectionAttempts++;

  try {
    const client = new MongoClient(process.env.MONGODB_URI, {
      // Connection pool — optimized for Vercel
      maxPoolSize: 5,       // lighter
      minPoolSize: 1,
      maxIdleTimeMS: 5000,  // releases idle sockets

      // Timeouts — conservative + stable
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 12000,
      socketTimeoutMS: 30000,

      // Stability
      retryWrites: true,
      w: 'majority',
      wtimeoutMS: 5000,

      family: 4 // force IPv4
    });

    await client.connect();
    console.log('✅ Connected to MongoDB successfully');

    const db = client.db(process.env.MONGODB_DB || 'trading');

    // Quick health check
    await db.command({ ping: 1 });
    console.log('✅ MongoDB ping successful');

    // Cache connection
    cachedClient = client;
    cachedDb = db;
    connectionAttempts = 0;

    return db;

  } catch (error) {
    console.error(`❌ MongoDB connection error (attempt ${connectionAttempts}):`, error.message);

    if (connectionAttempts < MAX_ATTEMPTS) {
      console.log('⏳ Retrying in 3 seconds...');
      await new Promise(r => setTimeout(r, 3000));
      return connectToDatabase();
    }

    connectionAttempts = 0;
    throw new Error(`MongoDB connection failed after ${MAX_ATTEMPTS} attempts: ${error.message}`);
  }
}

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
