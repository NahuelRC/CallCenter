// lib/phone.js
export function toWhatsApp(numberE164) {
  // normaliza a formato que Twilio espera
  return numberE164.startsWith('whatsapp:') ? numberE164 : `whatsapp:${numberE164}`;
}

export function assertE164(number) {
  // validación mínima E.164 (+, dígitos, 8..15 dígitos)
  return /^\+[1-9]\d{7,14}$/.test(number);
}

// lib/phone.js (opcional)
export function fromTwilioToE164(from) {
  if (!from) return '';
  return from.startsWith('whatsapp:') ? from.slice(9) : from;
}

export function normalizePhone(number) {
  return fromTwilioToE164(number);
}
