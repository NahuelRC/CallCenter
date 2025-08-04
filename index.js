import express from 'express';
import dotenv from 'dotenv';
import webhook from './api/webhook.js';
//import conversationsRouter from './api/conversations.js';
//import sendManualRouter from './api/sendManual.js'
import { conectarDB } from './lib/db.js';
import promptsRouter from './api/prompts.js'

dotenv.config();

const app = express();

// MUY IMPORTANTE: parsear x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// Por si lo mandás como JSON también
app.use(express.json());

const PORT = process.env.PORT || 3000;
await conectarDB()

app.post('/webhook', webhook);
app.use('/api/prompts', promptsRouter);


  app.get('/', (req, res) => {
  res.send('✅ Backend funcionando en Railway');
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log('✅ /api/prompts montado');
});

