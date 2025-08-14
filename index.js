import express from 'express';
import dotenv from 'dotenv';
import webhook from './api/webhook.js';
import promptsRouter from './api/prompts.js';
import promptActivoRouter from './api/prompt-activo.js';
import cors from 'cors';
import contactsRouter from './api/contacts.js';
import twilioRouter from './api/twilio.js';
import { conectarDB } from './lib/db.js';

dotenv.config();

const PORT = process.env.PORT || 8080;

const main = async () => {
  console.log('🟡 Iniciando main()...');
  await conectarDB();

  const app = express();

  const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://192.168.1.4:3000',
  // agrega tu FE de producción si existe:
  // 'https://tu-frontend.com'
];

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/api/contacts', contactsRouter);
  app.use('/api/twilio', twilioRouter);
 app.use(cors({
  origin(origin, cb) {
    // permitir llamadas sin Origin (p.ej. curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

  app.options('*', cors());
  
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