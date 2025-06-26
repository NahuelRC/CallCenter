require('dotenv').config();
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const getAIResponse = async (message) => {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Sos un asistente de ventas profesional para el negocio India Nuts. 
Vendés nueces de la India. Estas son algunas respuestas típicas:
- ¿Cuánto sale? El pack de 8 cuesta $15.000.
- ¿Me voy a morir si la tomo? No, es segura si se toma en la dosis justa.
- ¿Cómo la pago? Cuando te llega el cartero, le pagás a él.

Respondé siempre de forma profesional y clara.`
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.6
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error al consultar OpenAI:', error.message);
    return 'Disculpá, no entendí. Te paso con alguien del equipo humano.';
  }
};

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  const aiResponse = await getAIResponse(body);

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: from,
    body: aiResponse
  });

  res.sendStatus(200);
});
console.log("deploy")
app.listen(process.env.PORT, () => {
  console.log(`Servidor corriendo en el puerto ${process.env.PORT}`);
});
