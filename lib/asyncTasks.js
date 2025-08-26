// /lib/asyncTasks.js
import { normalizePhone } from "./phone.js";
import { appendConversationMessage } from "./conversationService.js";
import { client as twilioClient } from "./twilioClient.js";
import obtenerRespuestaAI from "../utils/obtenerRespuestaAI.js";
import { conectarDB } from "./db.js";              // <-- fix path
import Contact from "../models/Contact.js";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, label = "op") =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms))
  ]);

export async function handleInboundAsync(reqBody) {
  const fromWa = reqBody.From;                 // "whatsapp:+549..."
  const from   = normalizePhone(fromWa);       // "+549..."
  const body   = reqBody.Body || null;

  // --- construir media ANTES de cualquier return ---
  const numMedia = parseInt(reqBody.NumMedia || "0", 10);
  const media = [];
  for (let i = 0; i < numMedia; i++) {
    media.push({ url: reqBody[`MediaUrl${i}`], contentType: reqBody[`MediaContentType${i}`] });
  }

  // Conexión DB (no bloquea si ya está conectada)
  try { await conectarDB(); } catch (e) { console.warn("[async] conectarDB:", e.message); }

  // --- MUTE guard (ajusta a tu esquema: agentEnabled === false ó status === 'blocked') ---
  let contact = null;
  try { contact = await Contact.findOne({ phone: from }).lean(); } catch (e) {}
  if (contact && (contact.agentEnabled === false || contact.status === "blocked")) {
    console.log(`[async] 🔕 Mute para ${from}. Guardamos inbound y no respondemos.`);
    try {
      await withTimeout(
        appendConversationMessage({
          phone: from,
          role: "user",
          source: "twilio",
          body,
          media: media.map(m => m.url),
          messageSid: reqBody.MessageSid || reqBody.SmsMessageSid
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
        media: media.map(m => m.url),
        messageSid: reqBody.MessageSid || reqBody.SmsMessageSid
      }),
      1500,
      "append inbound"
    );
  } catch (e) {
    console.warn("[async] inbound append skipped:", e.message);
  }

  // 2) Respuesta IA (con timeout y fallback si body es null)
  let answer = "👍";
  try {
    const promptInput = body && body.trim().length
      ? body
      : (numMedia > 0 ? "[Usuario envió un adjunto]" : "[Mensaje vacío]");
    answer = await withTimeout(obtenerRespuestaAI({ from, body: promptInput }), 7000, "AI");
  } catch (e) {
    console.error("[async] AI error/timeout, fallback:", e.message);
    answer = "Gracias por tu mensaje. En breve te respondemos 🙌";
  }

  // 3) Enviar por Twilio (best-effort)
  let sid = null;
  try {
    const msg = await withTimeout(
      twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,            // debe tener formato "whatsapp:+549..."
        to: fromWa,
        body: answer,
        statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL // opcional
      }),
      5000,
      "twilio send"
    );
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
        body: answer,
        messageSid: sid || undefined,
        lastStatus: sid ? "queued" : "failed",
        statusHistory: [{ status: sid ? "queued" : "failed", at: new Date() }]
      }),
      1500,
      "append outbound"
    );
  } catch (e) {
    console.warn("[async] outbound append skipped:", e.message);
  }

  await sleep(5);
}
