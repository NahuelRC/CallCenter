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

// Dominios permitidos para media
const MEDIA_DOMAIN_WHITELIST = [/^https:\/\/res\.cloudinary\.com\//i];

// Build "whatsapp:+..." desde From o WaId
function buildToFrom(reqBody) {
  const from = reqBody?.From;
  if (from && /^whatsapp:\+\d{7,15}$/.test(from)) return from;
  const waid = (reqBody?.WaId || "").replace(/[^\d]/g, "");
  if (waid && waid.length >= 8) return `whatsapp:+${waid}`;
  return null;
}

// Inserta transformación Cloudinary tras "/upload/"
function applyCloudinaryTransform(url, transform = "f_auto,q_auto,w_1024") {
  try {
    if (!url) return url;
    if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) return url;
    // ya tiene transform ("/upload/<algo>/")?
    if (/\/image\/upload\/[^/]+\/./.test(url)) return url;
    return url.replace(/\/image\/upload\/(?![^/]+\/)/, `/image/upload/${transform}/`);
  } catch {
    return url;
  }
}

// Normaliza y filtra media a solo Cloudinary https
function cleanMediaUrls(urls) {
  return (Array.isArray(urls) ? urls : [])
    .map(u => (typeof u === "string" ? u.trim() : ""))
    .filter(u => /^https:\/\//i.test(u))
    .filter(u => MEDIA_DOMAIN_WHITELIST.some(rx => rx.test(u)));
}

/* =========================
   Reglas para enviar IMAGEN
   ========================= */

const IMG_KEYWORDS = [
  "foto", "fotos", "imagen", "imagenes", "imágenes",
  "mostrame", "mostrar", "ver foto", "mandame foto", "enviá foto", "enviar foto",
  "catálogo", "catalogo",
  "gota", "gotas", "gotitas", "drop", "drops",
];

// ¿El usuario pidió imágenes?
function isImageRequest(text = "") {
  const t = String(text || "").toLowerCase();
  return IMG_KEYWORDS.some((kw) => t.includes(kw));
}

// ¿Plural? (enviar varias)
function isPluralImageRequest(text = "") {
  const t = String(text || "").toLowerCase();
  return /\b(fotos|imagenes|imágenes)\b/.test(t);
}

// Extrae consulta de producto simple: "foto de las gotas." -> "gotas"
function extractQueryFromBody(text = "") {
  const t = String(text || "").trim();
  const m = t.match(/\b(?:de|del)\s+([a-záéíóúñ0-9\s\-\.\,]{3,})$/i);
  if (m && m[1]) {
    const frag = m[1]
      .trim()
      .replace(/^(la|el|los|las)\s+/i, "")
      .replace(/[.,;:!?\s]+$/g, "")
      .trim();
    return frag || null;
  }
  const tokens = t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !IMG_KEYWORDS.includes(w))
    .filter((w) => !["de", "del", "la", "el", "los", "las", "una", "un", "por", "favor", "porfa"].includes(w));
  return tokens.slice(0, 4).join(" ").trim() || null;
}

/* =========================
   Búsqueda de producto e imágenes
   ========================= */

async function findProductBySkuOrNameOrTags({ sku, nameOrQuery }) {
  let prod = null;
  if (sku) {
    prod = await Product.findOne({ sku, active: true }).lean();
  }
  if (!prod && nameOrQuery) {
    const q = nameOrQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    prod = await Product.findOne({
      active: true,
      $or: [{ name: new RegExp(q, "i") }, { tags: new RegExp(q, "i") }]
    }).lean();
  }
  return prod;
}

function pickProductImages(prod, maxCount = 1, hint = null) {
  if (!prod?.images?.length) return [];
  let imgs = prod.images.slice(); // copia
  // si hay hint, priorizar las que matcheen el alt
  if (hint) {
    const re = new RegExp(hint, "i");
    imgs.sort((a, b) => {
      const am = re.test(a?.alt || "") ? 0 : 1;
      const bm = re.test(b?.alt || "") ? 0 : 1;
      return am - bm;
    });
  }
  const urls = imgs
    .map(i => i?.url)
    .filter(Boolean)
    .map(u => applyCloudinaryTransform(u));
  return cleanMediaUrls(urls).slice(0, maxCount);
}

function formatMoney(ars) {
  try {
    const n = Number(ars);
    if (!Number.isFinite(n)) return null;
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  } catch {
    return null;
  }
}

function buildCaption(prod) {
  if (!prod) return null;
  const p = formatMoney(prod.price);
  const s = (typeof prod.stock === "number") ? ` · Stock: ${prod.stock}` : "";
  const name = prod.name || prod.sku || "Producto";
  return p ? `${name} · ${p}${s}` : `${name}${s}`;
}

/* ========================= */

export async function handleInboundAsync(reqBody) {
  const t0 = Date.now();

  // Solo mensajes entrantes válidos
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

  const fromWa = toWa;                   // número del usuario
  const from   = normalizePhone(fromWa); // "+549..."
  const body   = reqBody.Body || null;

  // Media INBOUND (por si querés guardarla)
  const numMedia = parseInt(reqBody.NumMedia || "0", 10);
  const media = [];
  for (let i = 0; i < numMedia; i++) {
    media.push({
      url: reqBody[`MediaUrl${i}`],
      contentType: reqBody[`MediaContentType${i}`],
    });
  }

  // DB
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

  // 1) Guardar INBOUND (best-effort)
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

  // 2) Obtener plan de IA
  let ai = { text: "👍", wantImage: false, mediaUrls: [], sku: null, productName: null, imageHint: null };
  try {
    const promptInput =
      body && body.trim().length ? body : (numMedia > 0 ? "[Usuario envió un adjunto]" : "[Mensaje vacío]");
    ai = await withTimeout(obtenerRespuestaAI({ from, body: promptInput }), 7000, "AI");
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    ai = { text: "Gracias por tu mensaje. En breve te respondemos 🙌", wantImage: false, mediaUrls: [] };
  }

  // Normalización si IA devolvió string/json
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

  // Log IA
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

  // Forzar imagen si el usuario la pidió
  if (isImageRequest(body)) {
    ai.wantImage = true;
    if (!ai.sku && !ai.productName) {
      ai.productName = extractQueryFromBody(body);
    }
    console.log("[IMG INTENT] forced wantImage=true, query:", ai.productName || ai.sku || "(none)");
  }

  // 2.1) Armar mediaOut: IA → catálogo → fallback
  const wantPlural = isPluralImageRequest(body);
  const maxImages = wantPlural ? 3 : 1;

  let mediaOut = Array.isArray(ai.mediaUrls) ? [...ai.mediaUrls] : [];
  mediaOut = cleanMediaUrls(mediaOut).slice(0, maxImages);

  let prodUsed = null;

  if (ai.wantImage && mediaOut.length === 0) {
    try {
      prodUsed = await findProductBySkuOrNameOrTags({
        sku: ai.sku || null,
        nameOrQuery: ai.productName || extractQueryFromBody(body)
      });
      if (prodUsed) {
        const urls = pickProductImages(prodUsed, maxImages, ai.imageHint);
        if (urls.length) mediaOut = urls;
      }
    } catch (e) {
      console.warn("[async] catalog lookup failed:", e.message);
    }
  }

  // Fallback: cualquier producto con imagen Cloudinary
  if (ai.wantImage && mediaOut.length === 0) {
    try {
      const any = await Product.findOne({
        active: true,
        "images.url": { $regex: /^https:\/\/res\.cloudinary\.com\//i }
      }).select({ images: 1, name: 1, price: 1, stock: 1, sku: 1 }).lean();

      if (any) {
        prodUsed = any;
        const urls = pickProductImages(any, maxImages, null);
        if (urls.length) mediaOut = urls;
        console.log("[IMG FALLBACK] using cloudinary image(s):", urls);
      } else {
        console.log("[IMG FALLBACK] no cloudinary image found.");
      }
    } catch (e) {
      console.warn("[async] fallback any-image failed:", e.message);
    }
  }

  // 3) Enviar por Twilio
  let sid = null;
  let text = (ai.text || "").trim();

  // Si hay media y no hay texto ⇒ caption con precio/stock
  if (mediaOut.length > 0 && text.length === 0) {
    text = prodUsed ? (buildCaption(prodUsed) || "Te envío la imagen ✅") : "Te envío la imagen ✅";
  }
  // Si no hay media ni texto ⇒ fallback elegante
  if (mediaOut.length === 0 && text.length === 0) {
    text = "No tengo foto de ese producto todavía 🙏. ¿Querés que te envíe el catálogo?";
  }

  // Transformaciones finales (Cloudinary) y limpieza
  const mediaOutClean = cleanMediaUrls(mediaOut).map(u => applyCloudinaryTransform(u)).slice(0, maxImages);

  // Logs de media
  console.log("[MEDIA OUT raw]", mediaOut);
  console.log("[MEDIA OUT clean]", mediaOutClean);

  try {
    const { client, from: twilioFrom } = await getTwilio();

    if (text.length === 0 && mediaOutClean.length === 0) {
      console.warn("[TW SEND] skip: no body, no media");
    } else {
      const payload = {
        from: twilioFrom,
        to: fromWa, // siempre respondemos al usuario
        body: text,
        ...(mediaOutClean.length ? { mediaUrl: mediaOutClean } : {})
      };

      console.log("[TW SEND] payload:", {
        to: payload.to,
        hasBody: !!payload.body,
        mediaCount: payload.mediaUrl?.length || 0,
      });

      const msg = await withTimeout(client.messages.create(payload), 7000, "twilio send");
      sid = msg.sid;

      // Telemetría simple
      const t1 = Date.now();
      console.log("[METRIC] outbound_sent", {
        sku: prodUsed?.sku || null,
        productName: prodUsed?.name || ai.productName || null,
        mediaCount: mediaOutClean.length,
        latency_ms: (t1 - t0)
      });
    }
  } catch (e) {
    console.error("[async] twilio send failed:", e.message);
  }

  // 4) Guardar OUTBOUND (best-effort)
  try {
    const bodyToSave = text || null;
    const mediaToSave = mediaOutClean;

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
