import mongoose from 'mongoose';


const MensajeSchema = new mongoose.Schema({
  from: { type: String, required: true },
  mensaje: { type: String, required: true },
  //respuesta: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
  

}, { collection: 'Messages' }
);

MensajeSchema.index({ from: 1, timestamp: -1 });
MensajeSchema.index({ timestamp: -1 });

const Mensaje =
  mongoose.models.Mensaje || mongoose.model('Mensaje', MensajeSchema);

export default Mensaje;