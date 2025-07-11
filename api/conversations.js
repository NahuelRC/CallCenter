import express from 'express';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config() 

const router = express.Router();


const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('⚠️ MONGODB_URI is not defined in .env file!');
}
console.log('✅ MONGODB_URI:', process.env.MONGODB_URI);
const client = new MongoClient(MONGODB_URI);
 const dbName = 'VentasWsp';
  

// Ruta GET /api/conversations
router.get('/', async (req, res) => {
  try {
    await client.connect();
     const db = client.db(dbName); 
    const messagesCollection = db.collection('messages');
    const allMessages = await messagesCollection.find().sort({ timestamp: -1 }).toArray();
    res.json(allMessages);
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Error fetching conversations' });
  }
});

export default router;