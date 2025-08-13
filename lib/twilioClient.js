// lib/twilioClient.js
import twilio from 'twilio';

export async function getTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_NUMBER; // ej: whatsapp:+543416987944

  if (!accountSid || !authToken || !from) {
    throw new Error('Faltan variables de entorno de Twilio');
  }

  const client = twilio(accountSid, authToken);
  return { client, from };
}
