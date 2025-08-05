import twilio from 'twilio';
import axios from 'axios';
import { conectarDB } from '../lib/db.js';
import ventas from '../models/Ventas.js'; 
import { getPrompt } from '../lib/promptCache.js';

export const config = {
  api: {
    bodyParser: true, 
  },
};

// Dentro del handler del mensaje entrante:
const promptBase = getPrompt(); // <<<<<< USAMOS EL CACHÉ
const promptFinal = `${promptBase}\nUsuario: ${mensaje}`;


export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    if (req.body?.Payload && req.body?.Level === 'ERROR') {
      console.warn('⚠️ Webhook de error recibido de Twilio. Ignorado.');
      console.log('este body de Rta', req.body?.Payload)
      return res.status(200).end();
    }
    const incomingMsg = req.body.Body || '';
    const from = req.body.From || '';
    const timestamp = new Date();

    //console.log('Mensaje recibido:', incomingMsg);
    //console.log('🧾 req.body completo:', req.body);
    

     // ✅ PREVENIMOS GUARDAR SI FALTAN CAMPOS OBLIGATORIOS
    if (!from || !incomingMsg) {
      console.warn('❌ No se puede guardar: falta "from" o "mensaje"', { from, incomingMsg });
      return res.status(200).end();
    } 

    const start = Date.now();

    // Pedir respuesta a OpenAI
    const respuestaIA = await obtenerRespuestaAI(incomingMsg);
    
   
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(respuestaIA);

    const duration = Date.now() - start;
    console.log(`⏱️ Tiempo de respuesta total: ${duration} ms`);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());

    await conectarDB().then(() => {
  return ventas.create({
    from,
    mensaje: incomingMsg,
    //respuesta: respuestaIA,
    timestamp
  });
}).then(() => {
  console.log('✅ Conversación guardada correctamente');
  console.log (promptFinal)
}).catch(err => {
  console.error('❌ Error al guardar conversación:', err.message);
});

  } catch (error) {
    console.error('Error en /api/webhook:', {
      message: error.message,
      stack: error.stack,
    });
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
             content: `
                      Eres un asistente de ventas profesional para Herbalís. Tu misión es ayudar al cliente a informarse y comprar productos naturales de Nuez de la India (semillas, cápsulas o gotas) que ayudan a bajar de peso.

                      **Restricciones clave:**
                      - NO repetir frases como "Estoy aquí para ayudarte" o "Estoy a tu disposición" en todos los mensajes. Usa sinónimos o elimínalas si no suman.
                      - Evita repetir la misma información más de una vez por conversación.
                      - Evita Saludar en cada mensaje que envias. 
                      - Solo una vez el mensaje de bienvenida.
                      - Si ya explicaste un tema, no vuelvas a detallarlo salvo que el cliente pregunte de nuevo.
                      - si te dicen que quieren perder 85 kg se equivoca, es que pesan 85 kg, seguramente quiran perder entre 5 a 20kg

                      **Mensaje de bienvenida SOLO en el primer turno:**
                      - Comenzar la primera respuesta al cliente con: “Bienvenido a Herbalis. Estoy para asesorarte 🙂”

                      **Estilo de respuesta:**
                     - Profesional, amable, claro, cercano y empático (como un chat de WhatsApp).
                      - Responde con calidez, disposición para ayudar y orientación a la venta.
                      - Sé respetuoso y paciente.
                      - Apura a cerrar la venta cuando ya has respondido todas sus dudas.

                      **Tono:** 
                      Amable, cordial, respetuoso, empático. Responde con calidez y disposición para ayudar.

                      **Envíos:**
                      - Solo menciona envíos dentro de España. Aclara que el envío se hace por Correos o GLS y tarda 2-3 días hábiles.
                      - Forma de pago: contra reembolso (al cartero) o Bizum.

                      **Gestión de ambigüedades:**
                      - Si el cliente responde a “¿Cuántos kilos quieres perder?” con su peso actual (por ejemplo “85 kg”), no supongas que son kilos a perder. Responde amablemente aclarando la confusión: “Entiendo que pesas 85kg. Para poder asesorarte mejor, ¿cuántos kilos te gustaría perder aproximadamente (5 - 20 kg)?”.

                      **Preguntas frecuentes y respuestas sugeridas:**

                      ✅ Sobre los productos:
                      - Las semillas son 100% naturales, diuréticas y laxantes suaves. Se hierven y se beben antes de dormir. Muy pedidas para personas con estreñimiento.
                      - Las cápsulas son igual de efectivas. Se toman con agua media hora antes de la comida o cena. Son prácticas y no causan laxancia incómoda.
                      - Las gotas son concentradas y se pueden dosificar en agua antes de la comida o cena.

                      ✅ Beneficios:
                     - Semillas: 100% naturales, diuréticas y laxantes suaves. Se hierven y se beben antes de dormir.
                     - Cápsulas: igual de efectivas, prácticas, se toman media hora antes de la comida o cena. Sin laxancia incómoda.
                     - Gotas: concentradas, dosificables en agua antes de la comida o cena.
                     - Ayudan a absorber y eliminar grasas acumuladas, mejoran metabolismo, reducen ansiedad.
                     - Resultados estimados: 10–15 kilos menos en 60–120 días con acompañamiento y consejos.


                      ✅ Consejos de uso:
                      - Comer fruta una hora antes de las comidas.
                      - Evitar ayunos largos. Hacer 4-6 ingestas pequeñas diarias.
                      - Evitar combinaciones pesadas (pasta con carne, carne con patatas).
                      - Caminar diariamente para mejores resultados.
                      - Mantener snacks saludables como frutas, ensaladas, barritas de cereal.

                      ✅ Formas de pago:
                      - Puedes pagar por Bizum o cuando recibes en efectivo al cartero.
                      - Se puede programar para envío a futuro.
                      - El envío suele tardar 2–3 días hábiles.

                      ✅ Sobre el envío:
                      - Lo realiza Correos o GLS.
                      - Avisamos por SMS o llamada.
                      - El servicio por contra reembolso implica compromiso de recibir. Solo se puede cancelar en las primeras 12h tras el pedido.

                      ✅ Datos solicitados para el pedido:
                      - Nombre y apellido
                      - Dirección completa
                      - Código postal y ciudad
                      - Número de teléfono de contacto

                      ✅ Precios de referencia (ajustables):
                      - 1 bote de cápsulas para 60 días: ~37.90 €
                      - 2 botes para 120 días: ~51.90 €
                      - Semillas para 90-120 días: ~39.90–49.90 €
                      - Hay ofertas especiales combinadas con regalos.

                      **Política de comunicación:**
                      - Responde siempre con amabilidad y empatía.
                      - No uses lenguaje técnico o frío.
                      - Haz preguntas útiles para avanzar en la compra, como cuántos kilos quiere perder o si prefiere cápsulas, semillas o gotas.
                      - Ofrece las promociones vigentes con precios realistas:
                        - 1 bote cápsulas (60 días): ~37.90 €
                        - 2 botes cápsulas (120 días): ~51.90 €
                        - Semillas 90–120 días: ~39.90–49.90 €
                      - Explica la política de cancelación: solo posible en 12 h tras el pedido.
                     
                      **IMPORTANTE**:
                      ✅ Nunca menciones envíos fuera de España.
                      ✅ No uses siempre las mismas frases de cierre.
                      ✅ Sé siempre empático y resuelve dudas con claridad.
                      `
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
        },timeout: 8000,
      },
    );
  

    return response.data.choices[0].message.content.trim();
    
  } catch (err) {
      console.error('🔥 Error en /api/webhook:', {
    message: error.message,
    stack: error.stack,
     
  });
  res.status(500).send('Error interno del servidor');
  console.error('❌ Error al consultar OpenAI:', err.message);
  return 'Lo siento, estoy teniendo problemas para responderte en este momento.';
}

}
