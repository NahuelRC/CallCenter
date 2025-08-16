// api/webhook.js
import twilio from 'twilio';
import axios from 'axios';
import mensajes from '../models/Mensajes.js';
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

    
    // upsert contacto y leer flag
    const contact = await Contact.findOneAndUpdate(
      { phone: phoneE164 },
      { $setOnInsert: { createdAt: new Date() }, $set: { lastInboundAt: new Date() } },
      { upsert: true, new: true }
    );

    // ⬅️ Si el agente está desactivado para ESTE teléfono, no respondemos
    if (!contact.agentEnabled || contact.status === 'blocked') {
      console.log(`🔕 Agente deshabilitado para ${phoneE164}. No se responde.`);
      const twiml = new twilio.twiml.MessagingResponse();
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(twiml.toString()); // <Response/>
    }

    if (!from || !incomingMsg) {
      console.warn('❌ Faltan datos obligatorios:', { from, incomingMsg });
      return res.status(200).end();
    }

    const promptBase = getPrompt();
    const promptFinal = `${promptBase}\nUsuario: ${incomingMsg}`;
    console.log('🧠 Prompt usado:', promptFinal);

    const respuestaIA = await obtenerRespuestaAI(promptFinal);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

    await conectarDB();
    await mensajes.create({ from, mensaje: incomingMsg, timestamp });

    console.log('✅ Conversación guardada correctamente');
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
     // console.log('📤 Enviando prompt a OpenAI:', promptFinal);
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
    console.log('📤 Enviando prompt a OpenAI:', promptFinal);
  } catch (err) {
    console.error('❌ Error al consultar OpenAI:', err.message);
    return 'Lo siento, estoy teniendo problemas para responderte en este momento.';
  }
}

export default webhook;
