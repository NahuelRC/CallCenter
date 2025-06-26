import express from 'express';
import dotenv from 'dotenv';
import webhook from './api/webhook.js';

dotenv.config();

const app = express();

// MUY IMPORTANTE: parsear x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// Por si lo mandás como JSON también
app.use(express.json());

app.post('/webhook', webhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});
