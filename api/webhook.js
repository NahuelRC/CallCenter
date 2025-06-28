import twilio from 'twilio';
import axios from 'axios';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const incomingMsg = req.body.Body || '';
    const from = req.body.From || '';

    console.log('Mensaje recibido:', incomingMsg);

    // Pedir respuesta a OpenAI
    const respuestaIA = await obtenerRespuestaAI(incomingMsg);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  } catch (error) {
    console.error('Error en /api/webhook:', error.message);
    res.status(500).send('Error interno del servidor');
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
            content: 'Sos un profesional de ventas de India Nuts Argentino. Sé claro, amable y profesional responde a todas sus preguntas. No hace falta que digas Hola en cada mensaje! si la conversacion esta dentro de los 5 min - 10 min, Solo vendes Nueces de la india a 100 pesos, haces envios a todo el mundo, a contra-reembolso osea que le pagas al cartero, para confirmar pedi cantidad, Nombre completo, domicilio ciudad, y codigo postal, cuado manda audio avisar qno puede escucharlo qsolo texto, los mensajes vacios tomalos como audio',
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
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error al consultar OpenAI:', err.message);
    return 'Lo siento, estoy teniendo problemas para responderte en este momento.';
  }
}
