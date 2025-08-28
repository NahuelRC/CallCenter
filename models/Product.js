import mongoose from "mongoose";

const ImageSchema = new mongoose.Schema(
  { url: { type: String, required: true }, alt: { type: String, default: "" } },
  { _id: false }
);

const ProductSchema = new mongoose.Schema(
  {
    sku: { type: String, unique: true, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    images: { type: [ImageSchema], default: [] },          // usamos URL (S3/Cloudinary/etc.)
    price: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    tags: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: "Products" }
);

ProductSchema.index({ name: "text", sku: "text", tags: 1 });

ProductSchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("Product", ProductSchema);
