// api/contacts.js
import express from 'express';
import Contact from '../models/Contact.js';
import { getTwilio } from '../lib/twilioClient.js';
import { toWhatsApp, assertE164 } from '../lib/phone.js';


const router = express.Router();

/**
 * POST /api/contacts
 * Crea o actualiza contacto por phone.
 * body: { phone: "+34...", name?, tags?, notes?, sandboxJoined?, agentEnabled? }
 */
router.post('/', async (req, res) => {
  try {
    const { phone, name, tags, notes, sandboxJoined, agentEnabled } = req.body || {};
    if (!phone || !assertE164(phone)) {
      return res.status(400).json({ error: 'Falta phone en formato E.164 (ej: +34999999999)' });
    }

    // Solo seteamos agentEnabled si vino explícito (boolean)
    const $set = { name, notes, sandboxJoined };
    if (typeof agentEnabled === 'boolean') {
      $set.agentEnabled = agentEnabled;
      $set.mutedAt = agentEnabled ? null : new Date();
    }

    const updated = await Contact.findOneAndUpdate(
      { phone },
      { $set, ...(tags ? { $addToSet: { tags: { $each: tags } } } : {}) },
      { upsert: true, new: true }
    );
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** GET /api/contacts (simple list) */
router.get('/', async (_req, res) => {
  try {
    const list = await Contact.find().sort({ createdAt: -1 }).limit(200);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/contacts/:id/agent
 * body: { enabled: boolean }
 */
router.patch('/:id/agent', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Falta enabled (boolean)' });
    }
    const contact = await Contact.findById(id);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    contact.agentEnabled = enabled;
    contact.mutedAt = enabled ? null : new Date();
    await contact.save();

    return res.json({ ok: true, id: contact._id, agentEnabled: contact.agentEnabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/contacts/agent/by-phone
 * body: { phone: "+549...", enabled: boolean }
 * ➜ Solo permite mutear si el número EXISTE en contacts (si no, 404)
 */
router.patch('/agent/by-phone', async (req, res) => {
  try {
    const { phone, enabled } = req.body || {};
    if (!phone || !assertE164(phone)) {
      return res.status(400).json({ error: 'phone debe ser E.164 (+549...)' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Falta enabled (boolean)' });
    }

    const contact = await Contact.findOne({ phone });
    if (!contact) {
      return res.status(404).json({ error: 'El número no está agendado en contacts' });
    }

    contact.agentEnabled = enabled;
    contact.mutedAt = enabled ? null : new Date();
    await contact.save();

    return res.json({ ok: true, phone: contact.phone, agentEnabled: contact.agentEnabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/contacts/:id/send
 * body: { body: string }
 */
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Falta body' });

    const contact = await Contact.findById(id);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    const { client, from } = await getTwilio();
    const msg = await client.messages.create({
      from,
      to: toWhatsApp(contact.phone),
      body
    });

    contact.lastOutboundAt = new Date();
    await contact.save();

    return res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/contacts/send
 * body: { phone: "+34...", body: "texto" }
 * (upsert de contacto si no existe; agentEnabled queda true por defecto)
 */
router.post('/send', async (req, res) => {
  try {
    const { phone, body } = req.body || {};
    if (!phone || !assertE164(phone)) {
      return res.status(400).json({ error: 'Falta phone en E.164' });
    }
    if (!body) return res.status(400).json({ error: 'Falta body' });

    const { client, from } = await getTwilio();
    const msg = await client.messages.create({
      from,
      to: toWhatsApp(phone),
      body
    });

    await Contact.findOneAndUpdate(
      { phone },
      { $setOnInsert: { createdAt: new Date() }, $set: { lastOutboundAt: new Date() } },
      { upsert: true }
    );

    return res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
