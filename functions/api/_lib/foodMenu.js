// Server-side source of truth for in-seat food menu prices. Mirrors the
// client-side list in src/pages/index.astro -- keep both in sync. Never
// trust a price submitted by the browser; only id/qty are taken from the
// request, the price is always looked up here.
export const FOOD_MENU = {
  suya: { name: 'Beef Suya', priceKobo: 150000 },
  pepper: { name: 'Pepper Soup', priceKobo: 200000 },
  chicken: { name: 'Grilled Chicken', priceKobo: 250000 },
  water: { name: 'Bottled Water', priceKobo: 30000 },
  malt: { name: 'Malt Drink', priceKobo: 50000 },
  puff: { name: 'Puff Puff (5 pcs)', priceKobo: 50000 },
  plantain: { name: 'Fried Plantain', priceKobo: 80000 },
  pie: { name: 'Meat Pie', priceKobo: 70000 },
};
