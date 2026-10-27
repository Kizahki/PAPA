import { getLive } from '../lib/tracker.js';
import { send, fail } from './_util.js';

// Prix en direct des dates choisies (réutilisé s'il a moins d'une heure).
export default async function handler(req, res) {
  try {
    send(res, 200, { live: await getLive() });
  } catch (e) {
    fail(res, e);
  }
}
