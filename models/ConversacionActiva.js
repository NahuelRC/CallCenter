// models/ConversacionActiva.js
import mongoose from 'mongoose';

const ConversacionActivaSchema = new mongoose.Schema({
  from: { type: String, default: 'global', unique: true },
  promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', required: true },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.models.ConversacionActiva || mongoose.model('ConversacionActiva', ConversacionActivaSchema);
