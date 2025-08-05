// api/prompts.js
import express from 'express';
import Prompt from '../models/Prompt.js';
import { initPromptCache } from '../lib/promptCache.js';
import { conectarDB } from '../lib/db.js';

// Dentro de main():
await conectarDB();
await initPromptCache(); // <<<<< AGREGADO



const router = express.Router();
//await conectarDB(); // conexión única al iniciar

// GET: Obtener todos los prompts
router.get('/', async (req, res) => {
  try {
    const prompts = await Prompt.find().sort({ timestamp: -1 });
    res.status(200).json(prompts);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener prompts' });
  }
});

// POST: Crear nuevo prompt
router.post('/', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Falta el contenido del prompt' });
    const nuevoPrompt = await Prompt.create({ content });
    res.status(201).json(nuevoPrompt);
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el prompt' });
  }
});

// PUT: Actualizar prompt por ID
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!id || !content) return res.status(400).json({ error: 'Faltan datos' });
    const actualizado = await Prompt.findByIdAndUpdate(id, { content }, { new: true });
    res.status(200).json(actualizado);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el prompt' });
  }
});

export default router;
