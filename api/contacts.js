// api/contacts.js
import express from 'express';
import Contact from '../models/Contact.js';
import { getTwilio } from '../lib/twilioClient.js';
import { toWhatsApp, assertE164 } from '../lib/phone.js';

const router = express.Router();

/**
 * POST /api/contacts
 * Crea o actualiza contacto por phone.
 * body: { phone: "+34...", name?: string, tags?: string[], notes?: string, sandboxJoined?: boolean }
 */
router.post('/', async (req, res) => {
  try {
    const { phone, name, tags, notes, sandboxJoined } = req.body || {};
    if (!phone || !assertE164(phone)) {
      return res.status(400).json({ error: 'Falta phone en formato E.164 (ej: +34999999999)' });
    }
    const updated = await Contact.findOneAndUpdate(
      { phone },
      { $set: { name, notes, sandboxJoined }, ...(tags ? { $addToSet: { tags: { $each: tags } } } : {}) },
      { upsert: true, new: true }
    );
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/contacts
 * Lista contactos (simple)
 */
router.get('/', async (_req, res) => {
  try {
    const list = await Contact.find().sort({ createdAt: -1 }).limit(200);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/contacts/:id/send
 * Envía un mensaje OUTBOUND a un contacto por _id (primer “hola”, follow-up, etc.)
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
 * Conveniencia: envía OUTBOUND directo por número (sin buscar por _id)
 * body: { phone: "+34...", body: "texto" }
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

    // upsert básico para registrar el contacto
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

// PATCH /api/contacts/agent-by-phone   body: { phone: "+549...", enabled: boolean }
router.patch('/agent-by-phone', async (req, res) => {
  try {
    const { phone, enabled } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Falta phone' });
    if (typeof enabled === 'undefined') return res.status(400).json({ error: 'Falta enabled (boolean)' });

    const phoneE164 = phone.startsWith('whatsapp:') ? phone.replace('whatsapp:', '') : phone;
    if (!assertE164(phoneE164)) return res.status(400).json({ error: 'phone debe ser E.164 (ej: +549...)' });

    const updated = await Contact.findOneAndUpdate(
      { phone: phoneE164 },
      { $set: { agentEnabled: !!enabled } },
      { upsert: true, new: true }
    );
    return res.json({ ok: true, phone: updated.phone, agentEnabled: updated.agentEnabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


export default router;
