import twilio from 'twilio';
const { MessagingResponse } = twilio;
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const incomingMsg = req.body.Body;
  const from = req.body.From;

  const prompt = `Sos un asistente profesional de ventas para el negocio India Nuts. Vendés nueces de la India.
  Preguntas frecuentes:
  - ¿Cuánto sale? El pack de 8 cuesta $15.000.
  - ¿Me voy a morir si la tomo? No, es segura si se toma en la dosis justa.
  - ¿Cómo la pago? Cuando te llega el cartero, le pagás a él.

  Cliente: ${incomingMsg}
  IA:`;

  try {
    const aiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Sos un asistente profesional de ventas para India Nuts.' },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const responseText = aiResponse.data.choices[0].message.content;

    const twiml = new MessagingResponse();
    twiml.message(responseText);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  } catch (err) {
    console.error('Error al consultar OpenAI:', err.message);
    res.status(500).send('Error interno');
  }
}
