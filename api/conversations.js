// api/conversations.js
import express from 'express';
import Mensaje from '../models/Mensajes.js';
import Contact from '../models/Contact.js';
import Conversation from '../models/Conversation.js'; // <-- NUEVO
import { assertE164, toWhatsApp } from '../lib/phone.js';

const router = express.Router();

/**
 * GET /api/conversations
 * (SIN CAMBIOS)
 */
router.get('/', async (req, res) => {
  try {
    const { search = '', limit = '50', offset = '0' } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = parseInt(offset, 10) || 0;

    const pipeline = [
      { $addFields: {
          phone: {
            $cond: [
              { $regexMatch: { input: '$from', regex: /^whatsapp:\+/ } },
              { $substr: ['$from', 9, -1] },
              '$from'
            ]
          }
        }
      }
    ];

    if (search) {
      const s = String(search).trim();
      pipeline.push({
        $match: {
          $or: [
            { phone: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            { from:  { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
          ]
        }
      });
    }

    pipeline.push(
      {
        $group: {
          _id: '$from',
          phone: { $first: '$phone' },
          lastActivityAt: { $max: '$timestamp' },
          conversationsCount: { $sum: 1 }
        }
      },
      { $sort: { lastActivityAt: -1 } },
      { $skip: skip },
      { $limit: lim },
      {
        $lookup: {
          from: 'contacts',
          localField: 'phone',
          foreignField: 'phone',
          as: 'contact'
        }
      },
      {
        $addFields: {
          status: {
            $ifNull: [ { $arrayElemAt: ['$contact.status', 0] }, 'active' ]
          }
        }
      },
      {
        $project: {
          _id: 0,
          from: '$_id',
          phone: 1,
          status: 1,
          conversationsCount: 1,
          lastActivityAt: 1
        }
      }
    );

    const rows = await Mensaje.aggregate(pipeline).allowDiskUse(true);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/conversations error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/conversations/:phone/messages
 * (ACTUALIZADO) Fuente principal: Conversation.messages
 * Fallback: Mensajes (legacy)
 * Query:
 *  - limit?: number (default 50, máx 500)
 *  - before?: ISO date (filtra createdAt/timestamp < before)
 *  - after?:  ISO date (filtra createdAt/timestamp > after)
 * Respuesta:
 *  { ok: true, messages: [ { role, source, body, media[], messageSid, lastStatus, createdAt, _id } ] }
 */
router.get('/:phone/messages', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.phone || '');
    const phone = raw.startsWith('+') ? raw : `+${raw.replace(/^\+/, '')}`;
    if (!assertE164(phone)) {
      return res.status(400).json({ ok: false, error: 'Parámetro phone debe ser E.164, ej: +549...' });
    }

    const { limit = '50', before, after } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 500);

    // ---- 1) Intentar nueva fuente: Conversation ----
    const convo = await Conversation.findOne({ phone }).lean();

    if (convo && Array.isArray(convo.messages)) {
      const beforeDate = before ? new Date(String(before)) : null;
      const afterDate  = after  ? new Date(String(after))  : null;

      let msgs = convo.messages;

      if (beforeDate) msgs = msgs.filter(m => m.createdAt && new Date(m.createdAt) < beforeDate);
      if (afterDate)  msgs = msgs.filter(m => m.createdAt && new Date(m.createdAt) > afterDate);

      // Orden cronológico ASC y limitar a últimos N
      msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      if (msgs.length > lim) msgs = msgs.slice(-lim);

      const out = msgs.map(m => ({
        _id: String(m._id || ''),
        role: m.role,                              // "user" | "agent"
        source: m.source || null,                  // "twilio" | "bot" | "human"
        body: m.body ?? null,
        media: (m.media || []).map(mm => ({
          url: mm.url,
          contentType: mm.contentType || null
        })),
        messageSid: m.messageSid || null,
        lastStatus: m.lastStatus || null,
        createdAt: m.createdAt || convo.updatedAt || new Date().toISOString()
      }));

      return res.json({ ok: true, messages: out });
    }

    // ---- 2) Fallback: Mensajes (legacy, solo inbound) ----
    const from = toWhatsApp(phone); // "whatsapp:+549..."
    const legacyMatch = { from };
    if (before) legacyMatch.timestamp = { ...(legacyMatch.timestamp || {}), $lt: new Date(String(before)) };
    if (after)  legacyMatch.timestamp = { ...(legacyMatch.timestamp || {}), $gt: new Date(String(after))  };

    const docs = await Mensaje.find(legacyMatch)
      .sort({ timestamp: 1 }) // ascendente para lectura natural
      .limit(lim)
      .lean();

    const legacyOut = docs.map(d => ({
      _id: String(d._id),
      role: 'user',
      source: 'twilio',
      body: d.mensaje,
      media: [],
      messageSid: null,
      lastStatus: null,
      createdAt: d.timestamp
    }));

    return res.json({ ok: true, messages: legacyOut });
  } catch (e) {
    console.error('GET /api/conversations/:phone/messages error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH /api/conversations/:phone/deactivate
 * (SIN CAMBIOS)
 */
router.patch('/:phone/deactivate', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.phone || '');
    const phone = raw.startsWith('+') ? raw : `+${raw.replace(/^\+/, '')}`;
    if (!assertE164(phone)) {
      return res.status(400).json({ error: 'Parámetro phone debe ser E.164, ej: +549...' });
    }

    const updated = await Contact.findOneAndUpdate(
      { phone },
      { $set: { status: 'blocked', updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, status: updated.status });
  } catch (e) {
    console.error('PATCH /api/conversations/:phone/deactivate error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/conversations/:phone/activate
 * (SIN CAMBIOS)
 */
router.patch('/:phone/activate', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.phone || '');
    const phone = raw.startsWith('+') ? raw : `+${raw.replace(/^\+/, '')}`;
    if (!assertE164(phone)) {
      return res.status(400).json({ error: 'Parámetro phone debe ser E.164, ej: +549...' });
    }

    const updated = await Contact.findOneAndUpdate(
      { phone },
      { $set: { status: 'active', updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, status: updated.status });
  } catch (e) {
    console.error('PATCH /api/conversations/:phone/activate error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
