// lib/promptCache.js
import Prompt from '../models/Prompt.js';

let cachedPrompt = '';
let lastUpdated = null;
let promptNombre = '';  

export const cargarPromptDesdeDB = async () => {
  try {
    const promptActivo = await Prompt.findOne({ activo: true }).sort({ creadoEn: -1 });
    if (promptActivo) {
      cachedPrompt = promptActivo.content;
      promptNombre = promptActivo.nombre;  
      lastUpdated = new Date();
      console.log(`🧠 Prompt activo actualizado: "${promptNombre}" a las ${lastUpdated.toLocaleTimeString()}`);
    } else {
      console.warn('⚠️ No hay ningún prompt activo en la base de datos');
    }
  } catch (error) {
    console.error('❌ Error al cargar prompt desde DB:', error.message);
  }
};

export const getPrompt = () => cachedPrompt;
export const getPromptNombre = () => promptNombre;  

export const initPromptCache = async () => {
  await cargarPromptDesdeDB();
  setInterval(cargarPromptDesdeDB, 1 * 60 * 1000); // 15 minutos
};
