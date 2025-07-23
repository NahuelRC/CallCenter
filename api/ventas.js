import mongoose from 'mongoose';

const ventaSchema = new mongoose.Schema({
  from: { type: String, required: true },
  mensaje: { type: String, required: true },
  respuesta: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Venta = mongoose.models.Venta || mongoose.model('Venta', ventaSchema);
export default Venta;
