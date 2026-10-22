// GET /api/admin/kitchen/stream -- live updates for the Kitchen Screen (the same
// Server-Sent Events as the Live Order Board: "change" whenever an order is
// placed, paid or moved), at a kitchen address so Kitchen Staff accounts can use it.
export { onRequestGet } from '../food-orders/stream.js';
