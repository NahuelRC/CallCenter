// models/Contact.js
import mongoose from 'mongoose';

const ContactSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true }, // E.164, ej: +34600111222
  name:  { type: String, default: '' },
  tags:  { type: [String], default: [] },
  status: { type: String, default: 'active' }, // active | blocked | test | prospect | customer
  sandboxJoined: { type: Boolean, default: false }, // útil si usás Sandbox
  lastInboundAt:  { type: Date },
  lastOutboundAt: { type: Date },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'contacts' });

const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
export default Contact;
