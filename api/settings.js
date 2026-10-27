import { saveSettings } from '../lib/tracker.js';
import { send, fail, readJson } from './_util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST uniquement' });
  try {
    send(res, 200, await saveSettings(await readJson(req)));
  } catch (e) {
    fail(res, e);
  }
}
