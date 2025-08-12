import express from 'express';
import dotenv from 'dotenv';
import webhook from './api/webhook.js';
import promptsRouter from './api/prompts.js';
import promptActivoRouter from './api/prompt-activo.js';
import cors from 'cors';
import { conectarDB } from './lib/db.js';

dotenv.config();

const PORT = process.env.PORT || 8080;

const main = async () => {
  console.log('🟡 Iniciando main()...');
  await conectarDB();

  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'https://TU-FE.vercel.app'],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
  
  app.post('/webhook', webhook);
  app.use('/api/prompts', promptsRouter);
  app.use('/api/prompt-activo', promptActivoRouter);

  app.get('/', (req, res) => {
    res.send('✅ Backend funcionando en Render');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en el puerto: ${PORT}`);
    console.log('✅ /api/prompts montado');
  });
};

main().catch((err) => {
  console.error('❌ Error al iniciar la app:', err);
  process.exit(1);
});