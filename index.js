// index.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import webhook from './api/webhook.js';
import promptsRouter from './api/prompts.js';
import promptActivoRouter from './api/prompt-activo.js';
import contactsRouter from './api/contacts.js';
import twilioRouter from './api/twilio.js';
import { conectarDB } from './lib/db.js';

dotenv.config();

const PORT = process.env.PORT || 8080;

const main = async () => {
  console.log('🟡 Iniciando main()...');
  await conectarDB();

  const app = express();

  // --- CORS PRIMERO ---
  const allowedOrigins = [
    process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.4:3000',
    'https://call-center-fe-six.vercel.app/',
    'https://callcenter-z98c.onrender.com',
  ];

  // headers y preflight global
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // (opcional) paquete cors por si querés delegar
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado para origen: ${origin}`));
    },
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
  }));
  // --- FIN CORS ---

  // parsers
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // rutas
  app.use('/api/contacts', contactsRouter);
  app.use('/api/twilio', twilioRouter);
  app.post('/webhook', webhook);
  app.use('/api/prompts', promptsRouter);
  app.use('/api/prompt-activo', promptActivoRouter);

  app.get('/', (_req, res) => res.send('✅ Backend funcionando en Render'));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en el puerto: ${PORT}`);
    console.log('✅ /api/prompts montado');
  });
};

main().catch((err) => {
  console.error('❌ Error al iniciar la app:', err);
  process.exit(1);
});
