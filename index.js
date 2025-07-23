import express from 'express';
import dotenv from 'dotenv';
import webhook from './api/webhook.js';
import conversationsRouter from './api/conversations.js';
import sendManualRouter from './api/sendManual.js'
import { conectarDB } from './db.js';


dotenv.config();

const app = express();

// MUY IMPORTANTE: parsear x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// Por si lo mandás como JSON también
app.use(express.json());

app.post('/webhook', webhook);
app.use('/sendManual', sendManualRouter);
app.use('/conversations', conversationsRouter);


const PORT = process.env.PORT || 3000;
await conectarDB()

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});
