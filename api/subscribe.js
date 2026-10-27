import { addSub, removeSub } from '../lib/push.js';
import { send, fail, readJson } from './_util.js';

export default async function handler(req, res) {
  try {
    const body = await readJson(req);
    if (req.method === 'POST') return send(res, 200, { devices: await addSub(body) });
    if (req.method === 'DELETE') {
      await removeSub(body.endpoint);
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'POST ou DELETE' });
  } catch (e) {
    fail(res, e);
  }
}
