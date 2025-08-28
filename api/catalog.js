import express from "express";
import Product from "../models/Product.js";
import Promotion from "../models/Promotion.js";
import { conectarDB } from "../lib/db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await conectarDB();
    const products = await Product.find({ active: true })
      .select("name sku price images")
      .sort({ name: 1 })
      .limit(200)
      .lean();

    const promotions = await Promotion.find({ active: true })
      .select("code name price items")
      .populate({ path: "items.productId", select: "name" })
      .sort({ name: 1 })
      .limit(200)
      .lean();

    res.json({ ok: true, products, promotions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
