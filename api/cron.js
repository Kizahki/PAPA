import { dailyCheck } from '../lib/tracker.js';
import { send, fail } from './_util.js';

// Appelé chaque matin par Vercel Cron (Authorization: Bearer CRON_SECRET).
// Test manuel : /api/cron?secret=CRON_SECRET
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || '';
  const ok = !secret || auth === `Bearer ${secret}` || url.searchParams.get('secret') === secret;
  if (!ok) return send(res, 401, { error: 'Non autorisé' });
  try {
    send(res, 200, await dailyCheck());
  } catch (e) {
    fail(res, e);
  }
}
