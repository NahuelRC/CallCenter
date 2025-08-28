import express from "express";
import Product from "../models/Product.js";
import { conectarDB } from "../lib/db.js";

const router = express.Router();

// Listado + búsqueda
router.get("/", async (req, res) => {
  try {
    await conectarDB();
    const { search = "", limit = "50", offset = "0", active } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = parseInt(offset, 10) || 0;

    const q = {};
    if (search) {
      q.$or = [
        { name: { $regex: escapeReg(search), $options: "i" } },
        { sku:  { $regex: escapeReg(search), $options: "i" } },
        { tags: { $regex: escapeReg(search), $options: "i" } }
      ];
    }
    if (typeof active !== "undefined") {
      q.active = String(active) === "true";
    }

    const rows = await Product.find(q)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(lim)
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
    const row = await Product.findById(req.params.id).lean();
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
    const { sku, name, price, description = "", images = [], tags = [] } = req.body || {};
    if (!sku || !name || typeof price !== "number") {
      return res.status(400).json({ ok: false, error: "sku, name y price son obligatorios" });
    }
    const created = await Product.create({ sku, name, price, description, images, tags, active: true });
    res.json({ ok: true, item: created });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Editar parcial
router.patch("/:id", async (req, res) => {
  try {
    await conectarDB();
    const set = { ...req.body, updatedAt: new Date() };
    const upd = await Product.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
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
    const del = await Product.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function escapeReg(s=""){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export default router;
