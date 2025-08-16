// api/webhook.js
import twilio from 'twilio';
import axios from 'axios';
import Mensaje from '../models/Mensaje.js';        // ← AJUSTA ESTE PATH/CASE SI TU ARCHIVO ES "Mensajes.js"
import Contact from '../models/Contact.js';
import { getPrompt } from '../lib/promptCache.js';
import { conectarDB } from '../lib/db.js';

function toE164FromTwilio(from) {
  // Twilio manda 'whatsapp:+549...' → nos quedamos con '+549...'
  return (from || '').replace(/^whatsapp:/, '');
}

const webhook = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    // Eventos de error de Twilio (que no son mensajes)
    if (req.body?.Payload && req.body?.Level === 'ERROR') {
      console.warn('⚠️ Webhook de error recibido de Twilio. Ignorado.');
      return res.status(200).end();
    }

    const incomingMsg = req.body.Body || '';
    const fromTwilio  = req.body.From || ''; // ej: 'whatsapp:+549...'
    const phoneE164   = toE164FromTwilio(fromTwilio);
    const timestamp   = new Date();

    if (!fromTwilio || !incomingMsg) {
      console.warn('❌ Faltan datos obligatorios:', { fromTwilio, incomingMsg });
      return res.status(200).end();
    }

    // Conexión a DB (para leer Contact y guardar Mensaje)
    await conectarDB();

    // ─────────────────────────────────────────────────────────────
    // 1) Chequeo de mute: si el contacto existe y agentEnabled === false → NO respondemos
    // ─────────────────────────────────────────────────────────────
    const contact = await Contact.findOne({ phone: phoneE164 });

    if (contact && contact.agentEnabled === false) {
      console.log(`🔕 Agente muteado para ${phoneE164}. No se responde al inbound.`);

      // Guardamos el inbound igualmente
      await Mensaje.create({ from: fromTwilio, mensaje: incomingMsg, timestamp });

      // (Opcional) track del último inbound
      contact.lastInboundAt = new Date();
      await contact.save();

      // Respondemos <Response/> vacío a Twilio
      const twiml = new twilio.twiml.MessagingResponse();
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(twiml.toString());
    }

    // (Opcional) si existe el contacto, actualizamos lastInboundAt
    if (contact) {
      contact.lastInboundAt = new Date();
      await contact.save();
    }
    // Si NO existe, no lo creamos acá para mantener la regla de “solo se mutea si está agendado”.

    // ─────────────────────────────────────────────────────────────
    // 2) Generación de respuesta con IA (solo si NO está muteado)
    // ─────────────────────────────────────────────────────────────
    const promptBase  = getPrompt();
    const promptFinal = `${promptBase}\nUsuario: ${incomingMsg}`;
    console.log('🧠 Prompt usado:', promptFinal);

    const respuestaIA = await obtenerRespuestaAI(promptFinal);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());

    // Guardamos el inbound
    await Mensaje.create({ from: fromTwilio, mensaje: incomingMsg, timestamp });

    console.log('✅ Mensaje guardado correctamente');
  } catch (error) {
    console.error('❌ Error en /webhook:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error interno del servidor');
    }
  }
};

async function obtenerRespuestaAI(promptFinal) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: promptFinal },
        ],
        temperature: 0.6,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        timeout: 15000,
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('❌ Error al consultar OpenAI:', err.message);
    return 'Lo siento, estoy teniendo problemas para responderte en este momento.';
  }
}

export default webhook;
