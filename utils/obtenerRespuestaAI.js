// /utils/obtenerRespuestaAI.js
import axios from "axios";
import { getPrompt } from "../lib/promptCache.js";

/**
 * Obtiene una respuesta de la IA para el mensaje del usuario.
 * - Usa el prompt activo desde promptCache.
 * - Soporta ENV para modelo, temperatura y timeout.
 * - Incluye fallback seguro ante errores/timeout.
 *
 * @param {Object} params
 * @param {string} params.from   - Teléfono en E.164 del usuario (ej: +549341...)
 * @param {string} params.body   - Texto del mensaje del usuario (puede ser vacío si solo envió media)
 * @param {string} [params.lang] - Idioma preferido ("es" o "en"); default: "es"
 * @param {number} [params.timeoutMs] - Timeout para la llamada a OpenAI (ms)
 * @returns {Promise<string>} Respuesta en texto plano
 */
export default async function obtenerRespuestaAI({
  from,
  body,
  lang = "es",
  timeoutMs
} = {}) {
  // --- Config ---
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.warn("[obtenerRespuestaAI] Falta OPENAI_API_KEY");
    return fallbackMessage(lang);
  }

  const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-3.5-turbo";
  const TEMPERATURE = safeNumber(process.env.OPENAI_TEMPERATURE, 0.6);
  const TIMEOUT_MS = safeNumber(timeoutMs ?? process.env.OPENAI_TIMEOUT_MS, 12000);

  // --- Prompt base desde cache ---
  let basePrompt = "";
  try {
    basePrompt = getPrompt() || "";
  } catch (e) {
    console.warn("[obtenerRespuestaAI] getPrompt() falló:", e?.message || e);
  }

  // --- Sanitización básica (evitar textos gigantes) ---
  const MAX_LEN = 4000;
  const userText = (body || "").toString().slice(0, MAX_LEN);
  const sysText = basePrompt.toString().slice(0, MAX_LEN);

  // Si viene vacío (ej: solo media), damos un contexto mínimo para que la IA no se quede “muda”.
  const effectiveUserText =
    userText.trim().length > 0 ? userText : "[El usuario envió un adjunto o un mensaje vacío]";

  // Instrucción breve de idioma/estilo
  const languageInstruction =
    lang === "en"
      ? "Reply in clear, concise English."
      : "Responde en español de forma clara y concisa.";

  const messages = [
    { role: "system", content: `${sysText}\n\n${languageInstruction}`.trim() },
    {
      role: "user",
      content: [
        from ? `De: ${from}` : null,
        `Mensaje del usuario:`,
        effectiveUserText
      ]
        .filter(Boolean)
        .join("\n")
    }
  ];

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: MODEL,
        messages,
        temperature: TEMPERATURE
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        timeout: TIMEOUT_MS
      }
    );

    const text =
      response?.data?.choices?.[0]?.message?.content?.trim() ||
      response?.data?.choices?.[0]?.text?.trim() ||
      "";

    return text.length ? text : fallbackMessage(lang);
  } catch (err) {
    console.error("[obtenerRespuestaAI] Error OpenAI:", err?.message || err);
    return fallbackMessage(lang);
  }
}

/* -------------------- Helpers -------------------- */
function safeNumber(n, def) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function fallbackMessage(lang) {
  return lang === "en"
    ? "Sorry, I’m having trouble responding right now. I’ll get back to you shortly."
    : "Lo siento, estoy teniendo problemas para responderte en este momento. En breve te respondemos 🙌";
}
