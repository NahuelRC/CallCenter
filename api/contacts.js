// api/contacts.js
import express from 'express';
import Contact from '../models/Contact.js';
import { getTwilio } from '../lib/twilioClient.js';
import { toWhatsApp, assertE164 } from '../lib/phone.js';
import { appendConversationMessage } from '../lib/conversationService.js';

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
      { $set, ...(Array.isArray(tags) && tags.length ? { $addToSet: { tags: { $each: tags } } } : {}) },
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
 * body: { body?: string, mediaUrls?: string[] }
 * ➜ Extendido para soportar envío de imágenes y guardado en Conversation
 */
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { body, mediaUrls } = req.body || {};
    if (!body && (!Array.isArray(mediaUrls) || mediaUrls.length === 0)) {
      return res.status(400).json({ error: 'Falta body o mediaUrls' });
    }

    const contact = await Contact.findById(id);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    // Guard de mute/bloqueo
    if (contact.status === 'blocked' || contact.agentEnabled === false) {
      return res.status(403).json({ ok: false, error: 'Contacto bloqueado/muteado' });
    }

    const { client, from } = await getTwilio();
    const payload = {
      from,
      to: toWhatsApp(contact.phone),
    };
    if (body) payload.body = body;
    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
      payload.mediaUrl = mediaUrls;
    }

    const msg = await client.messages.create(payload);

    // Persistimos outbound del agente (humano)
    try {
      await appendConversationMessage({
        phone: contact.phone,
        role: 'agent',
        source: 'human',
        body: body || null,
        media: Array.isArray(mediaUrls) ? mediaUrls : [],
        messageSid: msg.sid,
        lastStatus: 'queued',
        statusHistory: [{ status: 'queued', at: new Date() }]
      });
    } catch (e) {
      // no rompemos el flujo si falla el guardado
      console.warn('appendConversationMessage fallo (/:id/send):', e.message);
    }

    contact.lastOutboundAt = new Date();
    await contact.save();

    return res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('POST /api/contacts/:id/send error:', e);
    // Guardar intento fallido para no perder contexto
    try {
      const { body, mediaUrls } = req.body || {};
      const contact = await Contact.findById(req.params.id);
      if (contact) {
        await appendConversationMessage({
          phone: contact.phone,
          role: 'agent',
          source: 'human',
          body: body || null,
          media: Array.isArray(mediaUrls) ? mediaUrls : [],
          messageSid: undefined,
          lastStatus: 'failed',
          statusHistory: [{ status: 'failed', at: new Date(), errorMessage: e.message }]
        });
      }
    } catch {}
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/contacts/send
 * body: { phone: "+34...", body?: "texto", mediaUrls?: string[] }
 * (upsert de contacto si no existe)
 * ➜ Extendido para soportar envío de imágenes, mute guard y guardado en Conversation
 */
router.post('/send', async (req, res) => {
  try {
    const { phone, body, mediaUrls } = req.body || {};
    if (!phone || !assertE164(phone)) {
      return res.status(400).json({ error: 'Falta phone en E.164' });
    }
    if (!body && (!Array.isArray(mediaUrls) || mediaUrls.length === 0)) {
      return res.status(400).json({ error: 'Falta body o mediaUrls' });
    }

    // Upsert rápido para tener contacto y verificar estado
    const contact = await Contact.findOneAndUpdate(
      { phone },
      { $setOnInsert: { createdAt: new Date(), agentEnabled: true } },
      { upsert: true, new: true }
    );

    // Guard de mute/bloqueo
    if (contact.status === 'blocked' || contact.agentEnabled === false) {
      return res.status(403).json({ ok: false, error: 'Contacto bloqueado/muteado' });
    }

    const { client, from } = await getTwilio();
    const payload = { from, to: toWhatsApp(phone) };
    if (body) payload.body = body;
    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
      payload.mediaUrl = mediaUrls;
    }

    const msg = await client.messages.create(payload);

    // Guardar outbound del agente (humano)
    try {
      await appendConversationMessage({
        phone,
        role: 'agent',
        source: 'human',
        body: body || null,
        media: Array.isArray(mediaUrls) ? mediaUrls : [],
        messageSid: msg.sid,
        lastStatus: 'queued',
        statusHistory: [{ status: 'queued', at: new Date() }]
      });
    } catch (e) {
      console.warn('appendConversationMessage fallo (/send):', e.message);
    }

    await Contact.findOneAndUpdate(
      { phone },
      { $set: { lastOutboundAt: new Date() } },
      { upsert: true }
    );

    return res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('POST /api/contacts/send error:', e);
    // Guardar intento fallido igualmente
    try {
      const { phone, body, mediaUrls } = req.body || {};
      if (phone && assertE164(phone)) {
        await appendConversationMessage({
          phone,
          role: 'agent',
          source: 'human',
          body: body || null,
          media: Array.isArray(mediaUrls) ? mediaUrls : [],
          messageSid: undefined,
          lastStatus: 'failed',
          statusHistory: [{ status: 'failed', at: new Date(), errorMessage: e.message }]
        });
      }
    } catch {}
    return res.status(500).json({ error: e.message });
  }
});

export default router;
