// models/TwilioConfig.js
import mongoose from 'mongoose';

const TwilioConfigSchema = new mongoose.Schema({
  accountSid: { type: String, required: true },
  authToken:  { type: String, required: true },
  fromNumber: { type: String, required: true }, // formato "whatsapp:+549..."
  webhookUrl: { type: String, default: '' },    // opcional, informativo
  updatedAt:  { type: Date, default: Date.now }
}, { collection: 'twilio_config' });

const TwilioConfig = mongoose.models.TwilioConfig || mongoose.model('TwilioConfig', TwilioConfigSchema);
export default TwilioConfig;
