const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

async function connectToDatabase() {
  // Ensure URI exists
  if (!process.env.MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI environment variable is not set!');
    throw new Error('MONGODB_URI not configured in environment variables.');
  }

  // Use cached connection (Vercel keeps this alive across invocations)
  if (cachedClient && cachedClient.topology && !cachedClient.topology.s.closed) {
    console.log('✓ Using cached MongoDB connection');
    return cachedDb;
  }

  console.log(`🔄 Connecting to MongoDB (attempt ${connectionAttempts + 1}/${MAX_ATTEMPTS})...`);

  try {
    connectionAttempts++;

    const client = new MongoClient(process.env.MONGODB_URI, {
      // Connection stability
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,

      // FIXES
      w: 'majority',
      wtimeoutMS: 5000,

      // Timeout tuning
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,

      family: 4 // Force IPv4
    });

    await client.connect();
    console.log('✅ Connected to MongoDB successfully');

    const db = client.db(process.env.MONGODB_DB || 'trading');

    // Ping to confirm connection
    await db.command({ ping: 1 });
    console.log('✅ MongoDB ping successful');

    /**
     * OPTIONAL WRITE TEST:
     * This verifies the cluster truly accepts writes,
     * but it will create and delete 1 document on every cold start.
     * 
     * Uncomment if you need to validate DB write capability.
     */
    /*
    const testCol = db.collection('_connection_test');
    await testCol.insertOne({ test: true, timestamp: new Date() });
    await testCol.deleteOne({ test: true });
    console.log('✅ MongoDB write test successful');
    */

    // Cache connection
    cachedClient = client;
    cachedDb = db;
    connectionAttempts = 0;

    return db;
  } catch (error) {
    console.error(`❌ MongoDB connection error (attempt ${connectionAttempts}):`, error.message);

    if (connectionAttempts < MAX_ATTEMPTS) {
      console.log(`⏳ Retrying in 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
      return connectToDatabase(); // retry
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
