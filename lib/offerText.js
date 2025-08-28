export function composeProductOffer(p) {
  // p: { name, price }
  const price = formatPrice(p.price);
  return `Oferta: ${p.name} — ${price}\n¿Querés que te lo reserve?`;
}

export function composePromotionOffer(pr) {
  // pr: { name, price, items:[{ productId:{name}, qty }] }
  const price = formatPrice(pr.price);
  const lines = (pr.items || [])
    .map(i => `• ${i.productId?.name || "Producto"} x${i.qty || 1}`)
    .join("\n");
  return `Promo: ${pr.name}\n${lines}\nPrecio especial: ${price}\n¿Te la reservo?`;
}

function formatPrice(n) {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n); }
  catch { return `$${Number(n).toFixed(0)}`; }
}
