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
    const { nombre, content, activo } = req.body;
    if (!content) return res.status(400).json({ error: 'Falta el contenido del prompt' });
    const nuevoPrompt = await Prompt.create({  
      nombre,
      content,
      activo: !!activo });
    res.status(201).json(nuevoPrompt);
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el prompt' });
  }
});

// PUT: Actualizar prompt por ID
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {  nombre, content, activo } = req.body;
    if (!id || !content) return res.status(400).json({ error: 'Faltan datos' });
    const actualizado = await Prompt.findByIdAndUpdate(id,{ ...(nombre && { nombre }), ...(content && { content }), ...(typeof activo !== 'undefined' && { activo }) },
      { new: true });
    if (!actualizado) return res.status(404).json({ error: 'Prompt no encontrado' });
    res.status(200).json(actualizado);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el prompt' });
  }
});

router.patch('/activar/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ error: 'Falta el ID del prompt a activar' });

    // Verificamos que exista
    const promptExistente = await Prompt.findById(id);
    if (!promptExistente) {
      return res.status(404).json({ error: 'Prompt no encontrado' });
    }

    // Desactivamos todos
    await Prompt.updateMany({}, { activo: false });

    // Activamos el solicitado
    const promptActivado = await Prompt.findByIdAndUpdate(id, { activo: true }, { new: true });

    res.status(200).json({ message: 'Prompt activado correctamente', prompt: promptActivado });
  } catch (error) {
    console.error('❌ Error al activar el prompt:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
