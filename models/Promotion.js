import mongoose from "mongoose";

const PromoItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    qty: { type: Number, default: 1, min: 1 }
  },
  { _id: false }
);

const PromotionSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    items: { type: [PromoItemSchema], default: [] },       // relación a productos
    price: { type: Number, required: true, min: 0 },       // precio preferencial del bundle
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    active: { type: Boolean, default: true },
    notes: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: "Promotions" }
);

PromotionSchema.index({ code: 1, active: 1 });

PromotionSchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Promotion", PromotionSchema);
