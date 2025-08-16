import mongoose from 'mongoose';

const mensajeSchema = new mongoose.Schema({
  from: { type: String, required: true },
  mensaje: { type: String, required: true },
  //respuesta: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const mensajes = mongoose.models.mensaje || mongoose.model('mensaje', mensajeSchema, 'Messages');
export default mensajes;
