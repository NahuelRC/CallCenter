import { MongoClient } from 'mongodb';
import twilio from 'twilio';

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = 'VentasWsp';
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { to, message } = req.body;
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  const timestamp = new Date();

  await twilioClient.messages.create({
    from,
    body: message,
    to
  });

  await client.connect();
  const db = client.db(dbName);
  await db.collection('messages').insertOne({
    from,
    to,
    body: message,
    timestamp,
    direction: 'outbound',
    sessionId: to,
    answeredBy: 'HUMAN'
  });

  res.status(200).json({ success: true });
}
