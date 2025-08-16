// api/conversations.js
import express from 'express';
import Mensaje from '../models/Mensajes.js';
import Contact from '../models/Contact.js'; // ya lo tenés
import { assertE164, toWhatsApp } from '../lib/phone.js';

const router = express.Router();

/**
 * GET /api/conversations
 * Lista conversaciones agregadas por "from" (whatsapp:+E164), normalizando a "phone" (+E164).
 * Query:
 *  - search?: string    (busca por teléfono parcial o exacto)
 *  - limit?: number     (default 50, máx 200)
 *  - offset?: number    (default 0)
 * Retorna: [{ phone, from, status, conversationsCount, lastActivityAt }]
 */
router.get('/', async (req, res) => {
  try {
    const { search = '', limit = '50', offset = '0' } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = parseInt(offset, 10) || 0;

    // Normalizamos en pipeline un campo "phone" = from sin "whatsapp:"
    const pipeline = [
      { $addFields: {
          phone: {
            $cond: [
              { $regexMatch: { input: '$from', regex: /^whatsapp:\+/ } },
              { $substr: ['$from', 9, -1] }, // quita 'whatsapp:' (9 chars)
              '$from'
            ]
          }
        }
      }
    ];

    // Filtro por búsqueda (si mandan "+549..." o parcial)
    if (search) {
      const s = String(search).trim();
      // busca por phone (E.164) o from
      pipeline.push({
        $match: {
          $or: [
            { phone: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            { from:  { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
          ]
        }
      });
    }

    // Agrupar por "from"
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
      // Join con contacts (si existe) por phone (+E164)
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
          from: '$_id',            // ej: whatsapp:+549...
          phone: 1,                // ej: +549...
          status: 1,               // active | blocked | ...
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
 * Historial de mensajes por número E.164 (ej: +549341XXXXXX)
 * Query:
 *  - limit?: number (default 50)
 *  - before?: ISO date
 *  - after?: ISO date
 */
router.get('/:phone/messages', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.phone || '');
    const phone = raw.startsWith('+') ? raw : `+${raw.replace(/^\+/, '')}`;
    if (!assertE164(phone)) {
      return res.status(400).json({ error: 'Parámetro phone debe ser E.164, ej: +549...' });
    }

    const from = toWhatsApp(phone); // whatsapp:+549...
    const { limit = '50', before, after } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 500);

    const match = { from };
    if (before) match.timestamp = { ...(match.timestamp || {}), $lt: new Date(before) };
    if (after)  match.timestamp = { ...(match.timestamp || {}), $gt: new Date(after) };

    const docs = await Mensaje.find(match)
      .sort({ timestamp: -1 })
      .limit(lim)
      .lean();

    // Opcional: mapear a un formato UI más directo
    const items = docs.map(d => ({
      id: String(d._id),
      from: d.from,                // whatsapp:+...
      phone,                       // +...
      body: d.mensaje,
      timestamp: d.timestamp
    }));

    res.json(items);
  } catch (e) {
    console.error('GET /api/conversations/:phone/messages error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/conversations/:phone/deactivate
 * Desactiva al agente para ese teléfono (Contact.status = 'blocked')
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
 * Reactiva al agente para ese teléfono (Contact.status = 'active')
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
