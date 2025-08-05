// api/webhook.js
import twilio from 'twilio';
import axios from 'axios';
import ventas from '../models/Ventas.js'; 
import { getPrompt } from '../lib/promptCache.js';
import { conectarDB } from '../lib/db.js';

const webhook = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    if (req.body?.Payload && req.body?.Level === 'ERROR') {
      console.warn('⚠️ Webhook de error recibido de Twilio. Ignorado.');
      return res.status(200).end();
    }

    const incomingMsg = req.body.Body || '';
    const from = req.body.From || '';
    const timestamp = new Date();

    if (!from || !incomingMsg) {
      console.warn('❌ Faltan datos obligatorios:', { from, incomingMsg });
      return res.status(200).end();
    }

    const promptBase = getPrompt();
    const promptFinal = `${promptBase}\nUsuario: ${incomingMsg}`;
    console.log('🧠 Prompt usado:', promptFinal);

    const respuestaIA = await obtenerRespuestaAI(incomingMsg);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());

    await conectarDB();
    await ventas.create({
      from,
      mensaje: incomingMsg,
      timestamp,
    });

    console.log('✅ Conversación guardada correctamente');
  } catch (error) {
    console.error('❌ Error en /webhook:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error interno del servidor');
    }
  }
};

async function obtenerRespuestaAI(mensaje) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: getPrompt() },
          { role: 'user', content: mensaje },
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

export default webhook;
