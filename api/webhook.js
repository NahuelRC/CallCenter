// /api/webhook.js
import twilio from 'twilio';
import { handleInboundAsync } from "../lib/asyncTasks.js";

/**
 * Webhook de WhatsApp (Twilio)
 * - Devuelve 200 en <100 ms para evitar timeouts/reintentos.
 * - Delega procesamiento a una tarea asíncrona (guardar inbound,
 *   IA, envío por Twilio, append en Conversation, etc.).
 */
const webhook = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // Algunos eventos de Twilio no son mensajes (errores de entrega, etc.)
    // Los ignoramos sin cortar el flujo general.
    if (req.body?.Payload && req.body?.Level === "ERROR") {
      console.warn("⚠️ Webhook Twilio nivel ERROR recibido, ignorado:", {
        code: req.body?.ErrorCode,
        msg: req.body?.Payload
      });
      return res.status(200).end();
    }

    // --- ACK INMEDIATO ---
    // Importante: respondemos YA para que Twilio no marque timeout.
    if (!res.headersSent) {
      res.status(200).send("OK");
    }

    // --- PROCESAR EN BACKGROUND ---
    // No bloquear: todo lo pesado va a una tarea async.
    // Si algo falla, lo logueamos y NO afecta el ACK.
    setImmediate(() => {
      handleInboundAsync(req.body).catch((err) => {
        console.error("[webhook async] unhandled:", err);
      });
    });
  } catch (error) {
    console.error("❌ Error en /webhook:", error?.message || error);
    // Aunque falle, devolvemos 200 para evitar reintentos agresivos de Twilio.
    if (!res.headersSent) {
      res.status(200).send("OK");
    }
  }
};

export default webhook;
