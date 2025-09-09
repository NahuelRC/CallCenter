// /lib/asyncTasks.js
import { normalizePhone } from "./phone.js";
import { appendConversationMessage } from "./conversationService.js";
import { getTwilio } from "./twilioClient.js";
import obtenerRespuestaAI from "../utils/obtenerRespuestaAI.js";
import Product from "../models/Product.js";
import { conectarDB } from "./db.js";
import Contact from "../models/Contact.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label = "op") =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)
    ),
  ]);

/* =========================
   Reglas para enviar IMAGEN
   ========================= */

// Palabras clave de pedido de imagen/foto
const IMG_KEYWORDS = [
  "foto", "fotos", "imagen", "imagenes", "imágenes",
  "mostrame", "mostrar", "ver foto", "mandame foto", "enviá foto", "enviar foto",
  "catálogo", "catalogo"
];

// ¿El usuario pidió imagen?
function isImageRequest(text = "") {
  const t = String(text || "").toLowerCase();
  return IMG_KEYWORDS.some((kw) => t.includes(kw));
}

// Extrae una consulta de producto simple del texto del usuario
// ej: "mandame foto de semillas 250" -> "semillas 250"
function extractQueryFromBody(text = "") {
  const t = String(text || "").trim();
  // intenta capturar después de "de" o "del ..."
  const m = t.match(/\b(?:de|del)\s+([a-záéíóúñ0-9\s\-\.\,]{3,})$/i);
  if (m && m[1]) return m[1].trim();

  // si no hay "de/del", probá con las palabras "fuertes"
  const tokens = t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !IMG_KEYWORDS.includes(w))
    .filter((w) => !["de", "del", "la", "el", "los", "las", "una", "un", "por", "favor", "porfa"].includes(w));

  return tokens.slice(0, 4).join(" ").trim() || null;
}

// Busca un producto activo por SKU/nombre/tags y devuelve la primer imagen
async function findProductImageUrl(query) {
  if (!query) return null;

  // 1) si el query parece SKU exacto
  const maybeSku = /^[A-Z0-9\-_.]{3,}$/i.test(query) ? query : null;
  if (maybeSku) {
    const bySku = await Product.findOne({ sku: maybeSku, active: true }).lean();
    const url = bySku?.images?.[0]?.url || null;
    if (url) return url;
  }

  // 2) búsqueda flexible por nombre/tags
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prod = await Product.findOne({
    active: true,
    $or: [
      { name: new RegExp(q, "i") },
      { tags: new RegExp(q, "i") }
    ]
  }).lean();

  return prod?.images?.[0]?.url || null;
}

/* ========================= */

export async function handleInboundAsync(reqBody) {
  const fromWa = reqBody.From;           // "whatsapp:+549..."
  const from   = normalizePhone(fromWa); // "+549..."
  const body   = reqBody.Body || null;

  // construir media INBOUND
  const numMedia = parseInt(reqBody.NumMedia || "0", 10);
  const media = [];
  for (let i = 0; i < numMedia; i++) {
    media.push({
      url: reqBody[`MediaUrl${i}`],
      contentType: reqBody[`MediaContentType${i}`],
    });
  }

  // Conexión DB
  try { await conectarDB(); } catch (e) { console.warn("[async] conectarDB:", e.message); }

  // MUTE guard
  let contact = null;
  try { contact = await Contact.findOne({ phone: from }).lean(); } catch {}
  if (contact && (contact.agentEnabled === false || contact.status === "blocked")) {
    console.log(`[async] 🔕 Mute para ${from}. Guardamos inbound y no respondemos.`);
    try {
      await withTimeout(
        appendConversationMessage({
          phone: from,
          role: "user",
          source: "twilio",
          body,
          media: media.map((m) => m.url),
          messageSid: reqBody.MessageSid || reqBody.SmsMessageSid,
        }),
        1500,
        "append inbound (mute)"
      );
    } catch (e) {
      console.warn("[async] append inbound (mute) falló:", e.message);
    }
    return;
  }

  // 1) Persistir INBOUND (best-effort)
  try {
    await withTimeout(
      appendConversationMessage({
        phone: from,
        role: "user",
        source: "twilio",
        body,
        media: media.map((m) => m.url),
        messageSid: reqBody.MessageSid || reqBody.SmsMessageSid,
      }),
      1500,
      "append inbound"
    );
  } catch (e) {
    console.warn("[async] inbound append skipped:", e.message);
  }

  // 2) Obtener TEXTO de la IA (solo texto; imágenes las decide nuestra regla)
  let textAnswer = "👍";
  try {
    const promptInput =
      body && body.trim().length
        ? body
        : numMedia > 0
        ? "[Usuario envió un adjunto]"
        : "[Mensaje vacío]";

    const aiRaw = await withTimeout(
      obtenerRespuestaAI({ from, body: promptInput }),
      7000,
      "AI"
    );
    textAnswer = typeof aiRaw === "string" ? aiRaw : (aiRaw?.text || "👍");
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    textAnswer = "Gracias por tu mensaje. En breve te respondemos 🙌";
  }

  // 2.1) NUEVA LÓGICA: si el usuario pidió imagen, buscamos y adjuntamos
  let mediaOut = [];
  try {
    if (isImageRequest(body)) {
      const query = extractQueryFromBody(body);
      const imgUrl = await findProductImageUrl(query);
      if (imgUrl) mediaOut.push(imgUrl);
    }
  } catch (e) {
    console.warn("[async] image lookup failed:", e.message);
  }

  // 3) Enviar por Twilio (texto + media si corresponde)
  let sid = null;
  try {
    const { client, from: twilioFrom } = await getTwilio();
    const payload = {
      from: twilioFrom,
      to: fromWa,
      body: textAnswer,
    };
    if (mediaOut.length) payload.mediaUrl = mediaOut; // adjuntamos imágenes
    const msg = await withTimeout(client.messages.create(payload), 5000, "twilio send");
    sid = msg.sid;
  } catch (e) {
    console.error("[async] twilio send failed:", e.message);
  }

  // 4) Persistir OUTBOUND (bot)
  try {
    await withTimeout(
      appendConversationMessage({
        phone: from,
        role: "agent",
        source: "bot",
        body: textAnswer,
        media: mediaOut,                  // guardamos urls de media enviadas
        messageSid: sid || undefined,
        lastStatus: sid ? "queued" : "failed",
        statusHistory: [{ status: sid ? "queued" : "failed", at: new Date() }],
      }),
      1500,
      "append outbound"
    );
  } catch (e) {
    console.warn("[async] outbound append skipped:", e.message);
  }

  await sleep(5);
}
