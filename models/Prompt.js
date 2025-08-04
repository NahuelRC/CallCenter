import mongoose from 'mongoose';

const promptSchema = new mongoose.Schema({
 
  content: { type: String, required: true },
  creadoEn: { type: Date, default: Date.now }
});

const Prompt = mongoose.models.Prompt || mongoose.model('Prompt', promptSchema);
export default Prompt;
