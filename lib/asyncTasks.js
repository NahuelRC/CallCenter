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

  // 2) Obtener plan de IA (objeto con text + opcionales)
let ai = { text: "👍", wantImage: false, mediaUrls: [], sku: null, productName: null, imageHint: null };
try {
  const promptInput =
    body && body.trim().length
      ? body
      : (numMedia > 0 ? "[Usuario envió un adjunto]" : "[Mensaje vacío]");

  ai = await withTimeout(obtenerRespuestaAI({ from, body: promptInput }), 7000, "AI");
} catch (e) {
  console.error("[async] AI error/timeout, fallback:", e.message);
  ai = { text: "Gracias por tu mensaje. En breve te respondemos 🙌", wantImage: false, mediaUrls: [] };
}

// 2.1) Si hay que enviar imagen: primero las mediaUrls que ya vinieron; si no, buscar en catálogo
let mediaOut = Array.isArray(ai.mediaUrls) ? [...ai.mediaUrls] : [];

if (ai.wantImage && mediaOut.length === 0) {
  try {
    // --- tu lógica existente para buscar imagen por sku/productName/tags ---
    let prod = null;
    if (ai.sku) {
      prod = await Product.findOne({ sku: ai.sku, active: true }).lean();
    }
    if (!prod && ai.productName) {
      const q = ai.productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      prod = await Product.findOne({
        active: true,
        $or: [{ name: new RegExp(q, "i") }, { tags: new RegExp(q, "i") }]
      }).lean();
    }
    // Elegimos primera imagen (o por hint en alt si tenés esa convención)
    if (prod?.images?.length) {
      const pick = ai.imageHint
        ? prod.images.find(i => new RegExp(ai.imageHint, "i").test(i?.alt || ""))
        : prod.images[0];
      if (pick?.url) mediaOut.push(pick.url);
    }
  } catch (e) {
    console.warn("[async] catalog lookup failed:", e.message);
  }
}

// 3) Enviar por Twilio (texto + media si corresponde)
let sid = null;
try {
  const { client, from: twilioFrom } = await getTwilio();

  // limpiar media: solo https/https válidos (Twilio requiere URLs públicas)
  const mediaOutClean = (Array.isArray(mediaOut) ? mediaOut : [])
    .map(u => (typeof u === "string" ? u.trim() : ""))
    .filter(u => /^https?:\/\//i.test(u));

  // armar payload de forma segura
  const payload = {
    from: twilioFrom,
    to: fromWa,
  };

  const text = (ai.text || "").trim();
  if (text.length > 0) {
    payload.body = text;              // ✔ body válido
  }
  if (mediaOutClean.length > 0) {
    payload.mediaUrl = mediaOutClean; // ✔ media válido (puede ser array)
  }

  // Fallback: si por algún motivo no quedó ni body ni mediaUrl, evitamos el 400 de Twilio
  if (!payload.body && (!payload.mediaUrl || payload.mediaUrl.length === 0)) {
    payload.body = " "; // un espacio (o "."), solo para cumplir el requisito mínimo
  }

  console.log("[TW SEND] payload:", {
    hasBody: !!payload.body,
    mediaCount: payload.mediaUrl?.length || 0,
  });

  const msg = await withTimeout(client.messages.create(payload), 5000, "twilio send");
  sid = msg.sid;
} catch (e) {
  console.error("[async] twilio send failed:", e.message);
}

// 4) Persistir OUTBOUND del agente BOT (best-effort)
try {
  await withTimeout(
    appendConversationMessage({
      phone: from,
      role: "agent",
      source: "bot",
      body: (ai.text || "").trim() || null,
      media: (Array.isArray(mediaOut) ? mediaOut : []).filter(Boolean),
      messageSid: sid || undefined,
      lastStatus: sid ? "queued" : "failed",
      statusHistory: [{ status: sid ? "queued" : "failed", at: new Date() }]
    }),
    1500,
    "append outbound"
  );
} catch (e) {
  console.warn("[async] outbound append skipped:", e.message);
}}
