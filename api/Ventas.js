import mongoose from 'mongoose';

const ventaSchema = new mongoose.Schema({
  from: { type: String, required: true },
  mensaje: { type: String, required: true },
  //respuesta: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const ventas = mongoose.models.Venta || mongoose.model('Venta', ventaSchema, 'Messages');
export default ventas;
