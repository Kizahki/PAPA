import { getLive } from '../lib/tracker.js';
import { send, fail } from './_util.js';

// Nouvelle recherche immédiate, même si le dernier prix a moins d'une heure (3 par jour).
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST uniquement' });
  try {
    send(res, 200, { live: await getLive({ force: true }) });
  } catch (e) {
    fail(res, e);
  }
}
