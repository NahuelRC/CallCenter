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
   Helpers básicos
   ========================= */

const MEDIA_DOMAIN_WHITELIST = [/^https:\/\/res\.cloudinary\.com\//i];

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
    if (/\/image\/upload\/[^/]+\/./.test(url)) return url; // ya tiene
    return url.replace(/\/image\/upload\/(?![^/]+\/)/, `/image/upload/${transform}/`);
  } catch {
    return url;
  }
}

function cleanMediaUrls(urls) {
  return (Array.isArray(urls) ? urls : [])
    .map(u => (typeof u === "string" ? u.trim() : ""))
    .filter(u => /^https:\/\//i.test(u))
    .filter(u => MEDIA_DOMAIN_WHITELIST.some(rx => rx.test(u)));
}

// Normaliza (quita tildes, a minúsculas)
function norm(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Regex “sin tilde” para una palabra (cápsulas -> c(a|á)psul(a|á)s)
function accentInsensitiveRegex(word) {
  const map = {
    a: "[aá]", e: "[eé]", i: "[ií]", o: "[oó]", u: "[uúü]"
  };
  const src = norm(word);
  const rebuilt = src.replace(/[aeiou]/g, (v) => map[v]);
  return new RegExp(rebuilt, "i");
}

// Precio: usar Intl si está disponible, si no formateo manual $ 39.900
function formatMoney(ars) {
  const n = Number(ars);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  }
}

function buildCaption(prod) {
  if (!prod) return null;
  const p = formatMoney(prod.price);
  const s = (typeof prod.stock === "number") ? ` · Stock: ${prod.stock}` : "";
  const name = prod.name || prod.sku || "Producto";
  return p ? `${name} · ${p}${s}` : `${name}${s}`;
}

/* =========================
   Intención & categorías
   ========================= */

const CATEGORY_SYNONYMS = {
  gotas: ["gota","gotas","gotitas","drop","drops"],
  capsulas: ["capsula","capsulas","cápsula","cápsulas"],
  semillas: ["semilla","semillas"]
};

const IMG_KEYWORDS = [
  "foto","fotos","imagen","imagenes","imágenes",
  "mostrame","mostrar","ver foto","mandame foto","enviá foto","enviar foto",
  "catálogo","catalogo","catalogo","catálogo",
  ...CATEGORY_SYNONYMS.gotas,
  ...CATEGORY_SYNONYMS.capsulas,
  ...CATEGORY_SYNONYMS.semillas
];

function isImageRequest(text = "") {
  const t = norm(text);
  return IMG_KEYWORDS.map(norm).some(kw => t.includes(kw));
}

function isPluralImageRequest(text = "") {
  const t = norm(text);
  return /\b(fotos|imagenes|imagenes)\b/.test(t);
}

function detectCategory(text = "") {
  const t = norm(text);
  for (const [cat, list] of Object.entries(CATEGORY_SYNONYMS)) {
    if (list.some(word => t.includes(norm(word)))) return cat;
  }
  return null;
}

// Extrae “consulta”. Si hay palabra de categoría en el mensaje, usamos la categoría como query
function extractQueryFromBody(text = "") {
  const raw = String(text || "").trim();
  const cat = detectCategory(raw);
  if (cat) return cat; // fuerza a usar la categoría como query (p. ej. "gotas")

  const m = raw.match(/\b(?:de|del)\s+([a-záéíóúñ0-9\s\-\.\,]{3,})$/i);
  if (m && m[1]) {
    const frag = m[1]
      .trim()
      .replace(/^(la|el|los|las)\s+/i, "")
      .replace(/[.,;:!?\s]+$/g, "")
      .trim();
    return frag || null;
  }

  const tokens = norm(raw)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !["de","del","la","el","los","las","una","un","por","favor","porfa","tenes","tienes","hay","queria","quiero","necesito","busco"].includes(w));

  // si entre los tokens hay una categoría, devolvela como query
  for (const w of tokens) {
    const cat2 = detectCategory(w);
    if (cat2) return cat2;
  }

  return tokens.slice(0, 4).join(" ").trim() || null;
}

/* =========================
   Búsqueda de producto
   ========================= */

function buildCategoryPositives(cat) {
  if (!cat) return [];
  const syns = CATEGORY_SYNONYMS[cat] || [];
  const ors = syns.map(w => {
    const re = accentInsensitiveRegex(w);
    return { $or: [{ name: re }, { tags: re }] };
  });
  // aplanar
  return ors.map(o => o.$or).flat();
}

function buildCategoryNegatives(cat) {
  if (!cat) return [];
  const negatives = {
    gotas: [...CATEGORY_SYNONYMS.semillas, ...CATEGORY_SYNONYMS.capsulas],
    capsulas: [...CATEGORY_SYNONYMS.semillas, ...CATEGORY_SYNONYMS.gotas],
    semillas: [...CATEGORY_SYNONYMS.gotas, ...CATEGORY_SYNONYMS.capsulas]
  };
  const list = negatives[cat] || [];
  const ors = list.map(w => {
    const re = accentInsensitiveRegex(w);
    return { $or: [{ name: re }, { tags: re }] };
  }).map(o => o.$or).flat();
  // devolver un $nor con todas las variantes que NO queremos
  return ors.length ? [{ $nor: ors }] : [];
}

async function findProductBySkuOrNameOrTags({ sku, nameOrQuery, category }) {
  // 1) SKU directo
  if (sku) {
    const p = await Product.findOne({ sku, active: true }).lean();
    if (p) return p;
  }

  // 2) name/tags + positivos/negativos por categoría
  const and = [{ active: true }];

  if (nameOrQuery) {
    // regex sin tildes
    const reQ = accentInsensitiveRegex(nameOrQuery);
    and.push({ $or: [{ name: reQ }, { tags: reQ }] });
  }

  const pos = buildCategoryPositives(category);
  if (pos.length) and.push({ $or: pos });

  const neg = buildCategoryNegatives(category);
  if (neg.length) and.push(...neg);

  let prod = await Product.findOne({ $and: and }).lean();
  if (prod) return prod;

  // 3) si no hubo suerte, intentá SOLO por categoría (sin query)
  if (category) {
    const andCat = [{ active: true }];
    const posOnly = buildCategoryPositives(category);
    if (posOnly.length) andCat.push({ $or: posOnly });
    const negOnly = buildCategoryNegatives(category);
    if (negOnly.length) andCat.push(...negOnly);

    prod = await Product.findOne({ $and: andCat }).lean();
    if (prod) return prod;
  }

  return null;
}

function pickProductImages(prod, maxCount = 1, hint = null) {
  if (!prod?.images?.length) return [];
  let imgs = prod.images.slice();
  if (hint) {
    const re = new RegExp(hint, "i");
    imgs.sort((a, b) => {
      const am = re.test(a?.alt || "") ? 0 : 1;
      const bm = re.test(b?.alt || "") ? 0 : 1;
      return am - bm;
    });
  }
  const urls = imgs.map(i => i?.url).filter(Boolean).map(u => applyCloudinaryTransform(u));
  return cleanMediaUrls(urls).slice(0, maxCount);
}

/* ========================= */

export async function handleInboundAsync(reqBody) {
  const t0 = Date.now();

  // Solo mensajes
  const isInboundMessage = typeof reqBody?.Body === "string" && (reqBody?.From || reqBody?.WaId);
  if (!isInboundMessage) {
    console.warn("[async] skip: no inbound message (posible callback). Keys:", Object.keys(reqBody || {}));
    return;
  }

  const toWa = buildToFrom(reqBody);
  if (!toWa) {
    console.warn("[async] skip: invalid 'to' (no From/WaId)");
    return;
  }

  const fromWa = toWa;
  const from   = normalizePhone(fromWa);
  const body   = reqBody.Body || null;

  // INBOUND media (opcional guardado)
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

  // MUTE
  let contact = null;
  try { contact = await Contact.findOne({ phone: from }).lean(); } catch {}
  if (contact && (contact.agentEnabled === false || contact.status === "blocked")) {
    console.log(`[async] 🔕 Mute para ${from}. Guardamos inbound y no respondemos.`);
    try {
      await withTimeout(
        appendConversationMessage({
          phone: from, role: "user", source: "twilio",
          body, media: media.map((m) => m.url),
          messageSid: reqBody.MessageSid || reqBody.SmsMessageSid,
        }),
        1500, "append inbound (mute)"
      );
    } catch (e) { console.warn("[async] append inbound (mute) falló:", e.message); }
    return;
  }

  // 1) Persist inbound
  try {
    await withTimeout(
      appendConversationMessage({
        phone: from, role: "user", source: "twilio",
        body, media: media.map((m) => m.url),
        messageSid: reqBody.MessageSid || reqBody.SmsMessageSid,
      }),
      1500, "append inbound"
    );
  } catch (e) { console.warn("[async] inbound append skipped:", e.message); }

  // 2) IA
  let ai = { text: "👍", wantImage: false, mediaUrls: [], sku: null, productName: null, imageHint: null };
  try {
    const promptInput =
      body && body.trim().length ? body : (numMedia > 0 ? "[Usuario envió un adjunto]" : "[Mensaje vacío]");
    ai = await withTimeout(obtenerRespuestaAI({ from, body: promptInput }), 7000, "AI");
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    ai = { text: "Gracias por tu mensaje. En breve te respondemos 🙌", wantImage: false, mediaUrls: [] };
  }

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

  // Forzar imagen si la piden
  if (isImageRequest(body)) {
    ai.wantImage = true;
    if (!ai.sku && !ai.productName) {
      ai.productName = extractQueryFromBody(body); // ahora devuelve “gotas/capsulas/semillas” si aparece
    }
    console.log("[IMG INTENT] forced wantImage=true, query:", ai.productName || ai.sku || "(none)");
  }

  // 2.1) Media: IA → catálogo → fallback
  const wantPlural = isPluralImageRequest(body);
  const maxImages = wantPlural ? 3 : 1;
  const category = detectCategory(body) || detectCategory(ai.text || "") || detectCategory(ai.productName || "");

  let mediaOut = cleanMediaUrls(ai.mediaUrls).slice(0, maxImages);
  let prodUsed = null;

  if (ai.wantImage && mediaOut.length === 0) {
    try {
      const nameOrQuery = ai.productName || extractQueryFromBody(body);
      // Búsqueda sesgada por categoría
      prodUsed = await findProductBySkuOrNameOrTags({
        sku: ai.sku || null,
        nameOrQuery,
        category
      });
      if (prodUsed) {
        const urls = pickProductImages(prodUsed, maxImages, ai.imageHint);
        if (urls.length) mediaOut = urls;
      }
      console.log("[PRODUCT PICK]", {
        query: nameOrQuery, category,
        chosenSku: prodUsed?.sku || null,
        chosenName: prodUsed?.name || null
      });
    } catch (e) {
      console.warn("[async] catalog lookup failed:", e.message);
    }
  }

  // Fallback: respetar categoría si existe; sino cualquiera con Cloudinary
  if (ai.wantImage && mediaOut.length === 0) {
    try {
      let any = null;
      if (category) {
        const pos = buildCategoryPositives(category);
        const neg = buildCategoryNegatives(category);
        const andCat = [{ active: true }];
        if (pos.length) andCat.push({ $or: pos });
        if (neg.length) andCat.push(...neg);
        andCat.push({ "images.url": { $regex: /^https:\/\/res\.cloudinary\.com\//i } });
        any = await Product.findOne({ $and: andCat }).select({ images: 1, name: 1, price: 1, stock: 1, sku: 1 }).lean();
      }
      if (!any) {
        any = await Product.findOne({
          active: true,
          "images.url": { $regex: /^https:\/\/res\.cloudinary\.com\//i }
        }).select({ images: 1, name: 1, price: 1, stock: 1, sku: 1 }).lean();
      }
      if (any) {
        prodUsed = prodUsed || any;
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

  // 3) Envío
  let sid = null;
  let text = (ai.text || "").trim();

  // Si hay media: SIEMPRE agregar caption con precio/stock en 2ª línea
  if (mediaOut.length > 0) {
    const caption = buildCaption(prodUsed);
    if (caption) {
      text = text ? `${text}\n${caption}` : caption;
    } else if (!text) {
      text = "Te envío la imagen ✅";
    }
  }

  if (mediaOut.length === 0 && text.length === 0) {
    text = "No tengo foto de ese producto todavía 🙏. ¿Querés que te envíe el catálogo?";
  }

  const mediaOutClean = cleanMediaUrls(mediaOut).map(u => applyCloudinaryTransform(u)).slice(0, maxImages);
  console.log("[MEDIA OUT raw]", mediaOut);
  console.log("[MEDIA OUT clean]", mediaOutClean);

  try {
    const { client, from: twilioFrom } = await getTwilio();

    if (text.length === 0 && mediaOutClean.length === 0) {
      console.warn("[TW SEND] skip: no body, no media");
    } else {
      const payload = {
        from: twilioFrom,
        to: fromWa,
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

  // 4) Persist OUTBOUND
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
