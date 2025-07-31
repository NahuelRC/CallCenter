// api/prompts.js
import Prompt from './models/Prompt.js';
import { conectarDB } from '../lib/db.js';

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  await conectarDB();

  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const prompts = await Prompt.find().sort({ timestamp: -1 });
        return res.status(200).json(prompts);
      } catch (error) {
        return res.status(500).json({ error: 'Error al obtener prompts' });
      }

    case 'POST':
      try {
        const { nombre, content } = req.body;
        if (!content) return res.status(400).json({ error: 'Falta el contenido del prompt' });
        const nuevoPrompt = await Prompt.create({ nombre, content });
        return res.status(201).json(nuevoPrompt);
      } catch (error) {
        return res.status(500).json({ error: 'Error al guardar el prompt' });
      }

    case 'PUT':
      try {
        const { id } = req.query;
        const { content } = req.body;
        if (!id || !content) return res.status(400).json({ error: 'Faltan datos' });
        const actualizado = await Prompt.findByIdAndUpdate(id, { content }, { new: true });
        return res.status(200).json(actualizado);
      } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar el prompt' });
      }

    default:
      return res.status(405).end(`Método ${method} no permitido`);
  }
}
