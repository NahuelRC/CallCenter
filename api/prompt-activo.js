// api/prompt-activo.js
import express from 'express';
import ConversacionActiva from '../models/ConversacionActiva.js';
import Prompt from '../models/Prompt.js';
import { conectarDB } from '../lib/db.js';

const router = express.Router();
await conectarDB();

// GET: obtener el prompt activo actual
router.get('/', async (req, res) => {
  try {
    const data = await ConversacionActiva.findOne({ from: 'global' }).populate('promptId');
    if (!data) return res.status(404).json({ error: 'No hay prompt activo' });
    res.status(200).json(data.promptId);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener prompt activo' });
  }
});

// PUT: cambiar el prompt activo
router.put('/', async (req, res) => {
  try {
    const { promptId } = req.body;
    const prompt = await Prompt.findById(promptId);
    if (!prompt) return res.status(404).json({ error: 'Prompt no encontrado' });

    const updated = await ConversacionActiva.findOneAndUpdate(
      { from: 'global' },
      { promptId, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    res.status(200).json({ message: 'Prompt activo actualizado', data: updated });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar prompt activo' });
  }
});

export default router;
