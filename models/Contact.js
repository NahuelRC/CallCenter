import mongoose from 'mongoose';

const ContactSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true }, // E.164 ej: +549...
  name:  { type: String, default: '' },
  tags:  { type: [String], default: [] },
  status: { type: String, default: 'active' }, // active | blocked | test | prospect | customer
  sandboxJoined: { type: Boolean, default: false },
  lastInboundAt:  { type: Date },
  lastOutboundAt: { type: Date },
  notes: { type: String, default: '' },
  agentEnabled: { type: Boolean, default: true },
  mutedAt:      { type: Date },

  createdAt: { type: Date, default: Date.now },
}, { collection: 'contacts' });

ContactSchema.index({ phone: 1 });

const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
export default Contact;
