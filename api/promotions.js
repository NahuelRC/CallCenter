import express from "express";
import Promotion from "../models/Promotion.js";
import Product from "../models/Product.js";
import { conectarDB } from "../lib/db.js";

const router = express.Router();

// Listado
router.get("/", async (req, res) => {
  try {
    await conectarDB();
    const { active, limit = "50", offset = "0" } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = parseInt(offset, 10) || 0;

    const q = {};
    if (typeof active !== "undefined") q.active = String(active) === "true";

    const rows = await Promotion.find(q)
      .sort({ updatedAt: -1 })
      .skip(skip).limit(lim)
      .populate({ path: "items.productId", select: "name sku price images" })
      .lean();

    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Detalle
router.get("/:id", async (req, res) => {
  try {
    await conectarDB();
    const row = await Promotion.findById(req.params.id)
      .populate({ path: "items.productId", select: "name sku price images" })
      .lean();
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item: row });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Crear
router.post("/", async (req, res) => {
  try {
    await conectarDB();
    const { code, name, items = [], price, validFrom, validTo, notes = "" } = req.body || {};
    if (!code || !name || typeof price !== "number") {
      return res.status(400).json({ ok: false, error: "code, name y price son obligatorios" });
    }
    // validar productos
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: "items debe ser array" });
    for (const it of items) {
      if (!it.productId) return res.status(400).json({ ok: false, error: "items[].productId requerido" });
      if (it.qty && it.qty < 1) return res.status(400).json({ ok: false, error: "qty >= 1" });
    }
    // (opcional) validar existencia de productId
    const ids = items.map(i => i.productId);
    if (ids.length) {
      const count = await Product.countDocuments({ _id: { $in: ids } });
      if (count !== ids.length) return res.status(400).json({ ok: false, error: "Algún productId no existe" });
    }

    const created = await Promotion.create({
      code, name, items, price,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo:   validTo   ? new Date(validTo)   : null,
      notes, active: true
    });
    res.json({ ok: true, item: created });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Editar
router.patch("/:id", async (req, res) => {
  try {
    await conectarDB();
    const set = { ...req.body, updatedAt: new Date() };
    const upd = await Promotion.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!upd) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item: upd });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Borrar
router.delete("/:id", async (req, res) => {
  try {
    await conectarDB();
    const del = await Promotion.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
