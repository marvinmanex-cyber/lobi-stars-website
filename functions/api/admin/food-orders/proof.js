// GET /api/admin/food-orders/proof?id=   The evidence for a WhatsApp payment (kitchen managers: see adminRoles).
import { requireAdminUser } from '../../_lib/adminEvents.js';
import { proofResponse } from '../../_lib/foodPaymentProof.js';

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return proofResponse(env.DB, new URL(request.url).searchParams.get('id') || '');
}
