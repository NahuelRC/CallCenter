// lib/twilioClient.js
import twilio from 'twilio';
import TwilioConfig from '../models/TwilioConfig.js';

export async function getTwilio() {
  
  let cfg = await TwilioConfig.findOne().sort({ updatedAt: -1 });
  
  const accountSid = cfg?.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken  = cfg?.authToken  || process.env.TWILIO_AUTH_TOKEN;
  const from       = cfg?.fromNumber || process.env.TWILIO_WHATSAPP_NUMBER; // ej: whatsapp:+543416987944

  if (!accountSid || !authToken || !from) {
    throw new Error('Faltan variables de entorno de Twilio');
  }

  const client = twilio(accountSid, authToken);
  return { client, from, accountSid  };
}
