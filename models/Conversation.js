// /models/Conversation.js
import mongoose from "mongoose";

const StatusEventSchema = new mongoose.Schema(
  {
    status: { type: String, index: true },            // queued|sent|delivered|read|failed|undelivered
    at: { type: Date, default: Date.now },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

const MessageItemSchema = new mongoose.Schema(
  {
    // Inbound del usuario o outbound del agente (humano/bot)
    role: { type: String, enum: ["user", "agent"], required: true },
    source: { type: String, enum: ["human", "bot", "twilio"], default: "twilio" }, // quién originó
    body: { type: String, default: null },
    media: [{ url: String, contentType: String }],

    // Tracking de envío/entrega (para outbound)
    messageSid: { type: String, index: true },
    lastStatus: { type: String, index: true },
    statusHistory: [StatusEventSchema],

    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ConversationSchema = new mongoose.Schema(
  {
    // Teléfono en E.164 SIN el prefijo "whatsapp:"
    phone: { type: String, unique: true, required: true },

    // Link al contacto si existe
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },

    // Hilo completo
    messages: [MessageItemSchema],

    // Campos para listar más rápido
    lastMessage: { type: String, default: null },
    lastMessageAt: { type: Date, default: null },

    // Espejo (opcional) del estado del contacto
    status: { type: String, enum: ["active", "blocked"], default: "active" },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: "Conversations",
  }
);

// Índices útiles
ConversationSchema.index({ updatedAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

// Mantener updatedAt al modificar
ConversationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Conversation", ConversationSchema);
