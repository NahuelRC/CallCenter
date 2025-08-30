// /lib/asyncTasks.js
import { normalizePhone } from "./phone.js";
import { appendConversationMessage } from "./conversationService.js";
import { getTwilio } from "./twilioClient.js";
import obtenerRespuestaAI from "../utils/obtenerRespuestaAI.js";
import Product from "../models/Product.js";
import { conectarDB } from "./db.js"; // <-- fix path
import Contact from "../models/Contact.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label = "op") =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)
    ),
  ]);

// Helper: pick first image or one that matches hint in alt
function pickProductImage(prod, imageHint) {
  if (!prod?.images?.length) return null;
  if (imageHint) {
    const hinted = prod.images.find((i) =>
      new RegExp(imageHint, "i").test(i?.alt || "")
    );
    if (hinted?.url) return hinted.url;
  }
  return prod.images[0]?.url || null;
}

export async function handleInboundAsync(reqBody) {
  const fromWa = reqBody.From; // "whatsapp:+549..."
  const from = normalizePhone(fromWa); // "+549..."
  const body = reqBody.Body || null;

  // --- construir media ANTES de cualquier return ---
  const numMedia = parseInt(reqBody.NumMedia || "0", 10);
  const media = [];
  for (let i = 0; i < numMedia; i++) {
    media.push({
      url: reqBody[`MediaUrl${i}`],
      contentType: reqBody[`MediaContentType${i}`],
    });
  }

  // Conexión DB (no bloquea si ya está conectada)
  try {
    await conectarDB();
  } catch (e) {
    console.warn("[async] conectarDB:", e.message);
  }

  // --- MUTE guard ---
  let contact = null;
  try {
    contact = await Contact.findOne({ phone: from }).lean();
  } catch (e) {}
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
    return; // No IA, no envío
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

  // 2) Respuesta IA (con timeout y fallback si body es null)
  let aiPlan = { text: "👍", wantImage: false, sku: null, productName: null, imageHint: null };
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

    // Soporta tu implementación actual (string) o la estructurada propuesta
    if (typeof aiRaw === "string") {
      aiPlan.text = aiRaw;
    } else if (aiRaw && typeof aiRaw === "object") {
      aiPlan.text = aiRaw.text || "👍";
      aiPlan.wantImage = !!aiRaw.wantImage;
      aiPlan.sku = aiRaw.sku || null;
      aiPlan.productName = aiRaw.productName || null;
      aiPlan.imageHint = aiRaw.imageHint || null;
    }
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    aiPlan = { text: "Gracias por tu mensaje. En breve te respondemos 🙌", wantImage: false };
  }

  // 2.1) Si la IA quiere imagen, intentamos buscar producto e imagen
  const mediaOut = [];
  if (aiPlan.wantImage) {
    try {
      let prod = null;
      if (aiPlan.sku) {
        prod = await Product.findOne({ sku: aiPlan.sku, active: true }).lean();
      }
      if (!prod && aiPlan.productName) {
        prod = await Product.findOne({
          name: new RegExp(aiPlan.productName, "i"),
          active: true,
        }).lean();
      }
      const pickedUrl = pickProductImage(prod, aiPlan.imageHint);
      if (pickedUrl) mediaOut.push(pickedUrl);
      else console.log("[async] No se encontró imagen para enviar, mando solo texto.");
    } catch (e) {
      console.warn("[async] catalog lookup failed:", e.message);
    }
  }

  // 3) Enviar por Twilio (best-effort)
  let sid = null;
  try {
    // ⚠️ Evitamos conflicto de nombres con 'from' (teléfono del usuario)
    const { client, from: twilioFrom } = await getTwilio();
    const payload = {
      from: twilioFrom, // tu número whatsapp:+...
      to: fromWa,
      body: aiPlan.text,
    };
    if (mediaOut.length) payload.mediaUrl = mediaOut; // adjuntamos imágenes si hay
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
        body: aiPlan.text,
        media: mediaOut, // guardamos urls de media enviadas
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
