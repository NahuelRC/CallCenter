// /api/uploads.js
import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import { conectarDB } from "../lib/db.js";

const router = express.Router();

// guardamos en memoria (no disco) y limitamos a 8MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// POST /api/uploads/product-image  (form-data: file=<archivo>)
router.post("/product-image", upload.single("file"), async (req, res) => {
  try {
    await conectarDB();
    if (!req.file) return res.status(400).json({ ok: false, error: "file requerido" });

    const folder = process.env.CLOUDINARY_FOLDER || "products";
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const r = await cloudinary.uploader.upload(base64, {
      folder,
      resource_type: "image",
      overwrite: false,
      // transformations opcionales:
      // transformation: [{ width: 1024, crop: "limit", quality: "auto" }]
    });

    return res.json({
      ok: true,
      url: r.secure_url,
      contentType: req.file.mimetype,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      publicId: r.public_id,
    });
  } catch (e) {
    console.error("POST /api/uploads/product-image", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
