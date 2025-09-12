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
   Helpers de media y destino
   ========================= */

// Dominios permitidos para media (evita 11200 por URLs no válidas)
const MEDIA_DOMAIN_WHITELIST = [/^https:\/\/res\.cloudinary\.com\//i];

// ¿Parece URL de imagen directa?
function looksLikeImageUrl(u = "") {
  return /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(u);
}

// Construye un "whatsapp:+..." válido a partir de From o WaId
function buildToFrom(reqBody) {
  const from = reqBody?.From;
  if (from && /^whatsapp:\+\d{7,15}$/.test(from)) return from;
  const waid = (reqBody?.WaId || "").replace(/[^\d]/g, "");
  if (waid && waid.length >= 8) return `whatsapp:+${waid}`;
  return null;
}

/* =========================
   Reglas para enviar IMAGEN
   ========================= */

// Palabras clave de pedido de imagen/foto
const IMG_KEYWORDS = [
  "foto", "fotos", "imagen", "imagenes", "imágenes",
  "mostrame", "mostrar", "ver foto", "mandame foto", "enviá foto", "enviar foto",
  "catálogo", "catalogo",
  "gota", "gotas", "gotitas", "drop", "drops",
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
  if (m && m[1]) {
    // limpia artículos iniciales y puntuación final: "las gotas." -> "gotas"
    const frag = m[1]
      .trim()
      .replace(/^(la|el|los|las)\s+/i, "")
      .replace(/[.,;:!?\s]+$/g, "")
      .trim();
    return frag || null;
  }

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
    $or: [{ name: new RegExp(q, "i") }, { tags: new RegExp(q, "i") }],
  }).lean();

  return prod?.images?.[0]?.url || null;
}

/* ========================= */

export async function handleInboundAsync(reqBody) {
  // Solo procesamos webhooks que representen un MENSAJE entrante
  const isInboundMessage = typeof reqBody?.Body === "string" && (reqBody?.From || reqBody?.WaId);
  if (!isInboundMessage) {
    console.warn("[async] skip: no inbound message (posible callback). Keys:", Object.keys(reqBody || {}));
    return;
  }

  const toWa = buildToFrom(reqBody); // whatsapp:+...
  if (!toWa) {
    console.warn("[async] skip: invalid 'to' (no From/WaId)");
    return;
  }

  const fromWa = toWa;                  // el número del usuario al que vamos a responder
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
      body && body.trim().length ? body : (numMedia > 0 ? "[Usuario envió un adjunto]" : "[Mensaje vacío]");

    ai = await withTimeout(obtenerRespuestaAI({ from, body: promptInput }), 7000, "AI");
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    ai = { text: "Gracias por tu mensaje. En breve te respondemos 🙌", wantImage: false, mediaUrls: [] };
  }

  /* ========== CHEQUEO #2: asegurar que AI no sea string JSON ni texto suelto ========== */
  if (ai && typeof ai === "string") {
    try {
      const parsed = JSON.parse(ai);
      ai = {
        text: typeof parsed.text === "string" ? parsed.text.trim() : "Ok.",
        wantImage: !!parsed.wantImage,
        sku: parsed.sku || null,
        productName: parsed.productName || null,
        imageHint: parsed.imageHint || null,
        mediaUrls: Array.isArray(parsed.mediaUrls) ? parsed.mediaUrls.filter(Boolean) : []
      };
    } catch {
      ai = { text: ai.trim(), wantImage: false, mediaUrls: [] };
    }
  }

  /* ========== CHEQUEO #1: log de diagnóstico del resultado de IA ========== */
  try {
    console.log("[AI RESULT]", {
      text: (ai.text || "").slice(0, 120),
      wantImage: !!ai.wantImage,
      mediaUrlsCount: Array.isArray(ai.mediaUrls) ? ai.mediaUrls.length : 0,
      sku: ai.sku || null,
      productName: ai.productName || null,
      imageHint: ai.imageHint || null
    });
  } catch {}

  /* ======= Forzar imagen si el usuario la pidió ======= */
  if (isImageRequest(body)) {
    ai.wantImage = true;
    if (!ai.sku && !ai.productName) {
      ai.productName = extractQueryFromBody(body);
    }
    console.log("[IMG INTENT] forced wantImage=true, query:", ai.productName || ai.sku || "(none)");
  }
  /* ================================================ */

  // 2.1) Si hay que enviar imagen: primero las mediaUrls que ya vinieron; si no, buscar en catálogo
  let mediaOut = Array.isArray(ai.mediaUrls) ? [...ai.mediaUrls] : [];

  if (ai.wantImage && mediaOut.length === 0) {
    try {
      // --- buscar imagen por sku/productName/tags ---
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

  // Fallback: si sigue sin imagen, intentamos con cualquier producto con imagen Cloudinary
  if (ai.wantImage && mediaOut.length === 0) {
    try {
      // buscar cualquier producto activo con al menos una imagen Cloudinary
      let any = await Product.findOne({
        active: true,
        "images.url": { $regex: /^https:\/\/res\.cloudinary\.com\//i }
      })
        .select({ images: 1 })
        .lean();

      // Elegir la primera imagen Cloudinary válida
      const pick = (any?.images || []).map(i => i?.url).find(url =>
        typeof url === "string" &&
        /^https:\/\//i.test(url) &&
        MEDIA_DOMAIN_WHITELIST.some(rx => rx.test(url)) &&
        looksLikeImageUrl(url)
      );

      if (pick) {
        mediaOut.push(pick);
        console.log("[IMG FALLBACK] using cloudinary image:", pick);
      } else {
        console.log("[IMG FALLBACK] no cloudinary image found.");
      }
    } catch (e) {
      console.warn("[async] fallback any-image failed:", e.message);
    }
  }

  // 3) Enviar por Twilio (texto + media si corresponde)
  let sid = null;
  try {
    const { client, from: twilioFrom } = await getTwilio();

    const mediaOutClean = (Array.isArray(mediaOut) ? mediaOut : [])
      .map(u => (typeof u === "string" ? u.trim() : ""))
      // Solo https
      .filter(u => /^https:\/\//i.test(u))
      // Whitelist dominio (Cloudinary)
      .filter(u => MEDIA_DOMAIN_WHITELIST.some(rx => rx.test(u)))
      // Debe parecer imagen directa
      .filter(looksLikeImageUrl);

    // DEBUG: ver exactamente qué URLs van a salir
    console.log("[MEDIA OUT]", mediaOutClean);

    // Normalizar texto (evitar vacíos)
    let text = (ai.text || "").trim();

    // Si hay media pero no hay texto => usar caption por defecto
    if (mediaOutClean.length > 0 && text.length === 0) {
      text = "Te envío la imagen ✅";
    }

    if (mediaOutClean.length === 0 && text.length === 0) {
      console.warn("[TW SEND] skip: no body, no media");
      sid = null;
    } else {
      const payload = {
        from: twilioFrom,
        to: toWa, // siempre el usuario
        body: text, // texto final (nunca vacío)
        ...(mediaOutClean.length ? { mediaUrl: mediaOutClean } : {})
      };

      console.log("[TW SEND] payload:", {
        to: payload.to,
        hasBody: !!payload.body,
        mediaCount: payload.mediaUrl?.length || 0,
      });

      const msg = await withTimeout(client.messages.create(payload), 7000, "twilio send");
      sid = msg.sid;
    }
  } catch (e) {
    console.error("[async] twilio send failed:", e.message);
  }

  // 4) Persistir OUTBOUND del agente BOT (solo si hubo algo que enviar o si querés registrar fallos)
  try {
    const bodyToSave = (ai.text || "").trim() || (mediaOut?.length ? "Te envío la imagen ✅" : null);
    const mediaToSave = (Array.isArray(mediaOut) ? mediaOut : []).filter(Boolean);

    if (bodyToSave || mediaToSave.length) {
      await withTimeout(
        appendConversationMessage({
          phone: from,
          role: "agent",
          source: "bot",
          body: bodyToSave,
          media: mediaToSave,
          messageSid: sid || undefined,
          lastStatus: sid ? "queued" : "skipped",
          statusHistory: [{ status: sid ? "queued" : "skipped", at: new Date() }]
        }),
        1500,
        "append outbound"
      );
    } else {
      console.log("[OUTBOUND] skip persist: no body/media");
    }
  } catch (e) {
    console.warn("[async] outbound append skipped:", e.message);
  }
}
