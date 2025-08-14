// api/twilio.js
import express from 'express';
import TwilioConfig from '../models/TwilioConfig.js';
import { getTwilio } from '../lib/twilioClient.js';
import { toWhatsApp, assertE164 } from '../lib/phone.js';

const router = express.Router();

// GET: obtener config (enmascarada)
router.get('/config', async (_req, res) => {
  try {
    const cfg = await TwilioConfig.findOne().sort({ updatedAt: -1 });
    if (!cfg) {
      return res.json({ accountSid: '', authTokenMasked: '', fromNumber: '', webhookUrl: '' });
    }
    const masked = cfg.authToken ? cfg.authToken.replace(/.(?=.{4})/g, '•') : '';
    return res.json({
      accountSid: cfg.accountSid || '',
      authTokenMasked: masked,
      fromNumber: cfg.fromNumber || '',
      webhookUrl: cfg.webhookUrl || '',
      updatedAt: cfg.updatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT: guardar/actualizar config
// body: { accountSid, authToken, fromNumber, webhookUrl? }
router.put('/config', async (req, res) => {
  try {
    const { accountSid, authToken, fromNumber, webhookUrl } = req.body || {};
    if (!accountSid || !authToken || !fromNumber) {
      return res.status(400).json({ error: 'Faltan campos: accountSid, authToken, fromNumber' });
    }
    if (!fromNumber.startsWith('whatsapp:+')) {
      return res.status(400).json({ error: 'fromNumber debe ser formato whatsapp:+549...' });
    }
    const saved = await TwilioConfig.findOneAndUpdate(
      {},
      { accountSid, authToken, fromNumber, webhookUrl, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: probar conexión
// body: { testTo?: "+549..." } → opcional: envía un mensaje de prueba
router.post('/test', async (req, res) => {
  try {
    const { client, from, accountSid } = await getTwilio();

    // 1) validar credenciales haciendo un fetch del account
    await client.api.v2010.accounts(accountSid).fetch();

    // 2) si viene testTo, enviar un WhatsApp de prueba
    const { testTo } = req.body || {};
    let messageSid = null;
    if (testTo) {
      if (!assertE164(testTo)) {
        return res.status(400).json({ error: 'testTo debe ser E.164: +549...' });
      }
      const msg = await client.messages.create({
        from,
        to: toWhatsApp(testTo),
        body: '✅ Conexión exitosa con Twilio desde AI Sales Pro.'
      });
      messageSid = msg.sid;
    }

    return res.json({ ok: true, messageSid });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
