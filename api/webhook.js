// api/webhook.js
import twilio from 'twilio';
import axios from 'axios';
import ventas from '../models/Ventas.js'; 
import { conectarDB } from '../lib/db.js';
import { getPrompt } from '../lib/promptCache.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // Ignorar errores internos de Twilio (no son mensajes de usuario)
    if (req.body?.Payload && req.body?.Level === 'ERROR') {
      console.warn('⚠️ Webhook de error recibido de Twilio. Ignorado.');
      return res.status(200).end();
    }

    const incomingMsg = req.body.Body || '';
    const from = req.body.From || '';
    const timestamp = new Date();

    // Validación básica
    if (!from || !incomingMsg) {
      console.warn('❌ Faltan datos obligatorios:', { from, incomingMsg });
      return res.status(200).end();
    }

    // Obtener prompt cacheado y construir mensaje final
    const promptBase = getPrompt();
    const promptFinal = `${promptBase}\nUsuario: ${incomingMsg}`;
    console.log('🧠 Prompt usado:', promptFinal);

    const start = Date.now();

    // Obtener respuesta de OpenAI
    const respuestaIA = await obtenerRespuestaAI(incomingMsg);

    // Responder vía Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    const duration = Date.now() - start;
    console.log(`⏱️ Tiempo de respuesta total: ${duration} ms`);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

    // Guardar la conversación
    await conectarDB();
    await ventas.create({
      from,
      mensaje: incomingMsg,
      timestamp,
    });

    console.log('✅ Conversación guardada correctamente');

  } catch (error) {
    console.error('❌ Error en /api/webhook:', {
      message: error.message,
      stack: error.stack,
    });
    if (!res.headersSent) {
      res.status(500).send('Error interno del servidor');
    }
  }
}

async function obtenerRespuestaAI(mensaje) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: getPrompt(), // se reutiliza el prompt cacheado
          },
          {
            role: 'user',
            content: mensaje,
          },
        ],
        temperature: 0.6,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        timeout: 8000,
      }
    );

    return response.data.choices[0].message.content.trim();

  } catch (err) {
    console.error('❌ Error al consultar OpenAI:', err.message);
    return 'Lo siento, estoy teniendo problemas para responderte en este momento.';
  }
}
