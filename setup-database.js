// setup-database.js
const { MongoClient } = require('mongodb');

async function setupDatabase() {
  const uri = "mongodb+srv://eldergod263_db_user:mRAxoRCTNIFP5IBG@reasoner.ghroryc.mongodb.net/?appName=Reasoner";
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db('your-database-name'); // Replace with your DB name
    
    // Create predictions collection with validation
    await db.createCollection('predictions', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['asset_class', 'timestamp', 'class', 'confidence'],
          properties: {
            timestamp: { bsonType: 'date' },
            asset_class: { enum: ['crypto', 'forex'] },
            symbol: { bsonType: 'string' },
            pair: { bsonType: 'string' },
            class: { enum: ['UP', 'DOWN', 'NEUTRAL'] },
            confidence: { bsonType: 'double' },
            prediction: { bsonType: 'int' },
            models_used: { bsonType: 'int' }
          }
        }
      }
    });

    // Create indexes
    await db.collection('predictions').createIndex({ timestamp: -1 });
    await db.collection('predictions').createIndex({ asset_class: 1, timestamp: -1 });
    await db.collection('predictions').createIndex({ symbol: 1, timestamp: -1 });
    
    // Create other collections
    await db.createCollection('crypto_stats');
    await db.createCollection('forex_stats');
    await db.createCollection('metadata');
    
    await db.collection('crypto_stats').createIndex({ date: -1 });
    await db.collection('forex_stats').createIndex({ date: -1 });
    
    console.log('Database setup complete!');
  } finally {
    await client.close();
  }
}

setupDatabase().catch(console.error);