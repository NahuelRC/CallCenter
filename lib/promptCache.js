// lib/promptCache.js
import Prompt from '../models/Prompt.js';

let cachedPrompt = '';
let lastUpdated = null;

export const cargarPromptDesdeDB = async () => {
  try {
    const ultimoPrompt = await Prompt.findOne().sort({ creadoEn: -1 });
    if (ultimoPrompt) {
      cachedPrompt = ultimoPrompt.content;
      lastUpdated = new Date();
      console.log('🧠 Prompt actualizado desde DB:', lastUpdated.toLocaleTimeString());
    }
  } catch (error) {
    console.error('❌ Error al cargar prompt desde DB:', error.message);
  }
};

export const getPrompt = () => cachedPrompt;

export const initPromptCache = async () => {
  await cargarPromptDesdeDB();
  // Actualiza cada 15 minutos
  setInterval(cargarPromptDesdeDB, 15 * 60 * 1000);
};
