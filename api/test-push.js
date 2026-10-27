import { notifyAll } from '../lib/push.js';
import { send, fail } from './_util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST uniquement' });
  try {
    send(res, 200, await notifyAll({ title: 'Les alertes fonctionnent', body: 'Vous serez prévenu dès que le prix du vol baisse.', url: '/' }));
  } catch (e) {
    fail(res, e);
  }
}
