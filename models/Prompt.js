import mongoose from 'mongoose';

const promptSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  content: { type: String, required: true },
  creadoEn: { type: Date, default: Date.now },
  activo: { type: Boolean, default: false }
});

const Prompt = mongoose.models.Prompt || mongoose.model('Prompt', promptSchema);
export default Prompt;
