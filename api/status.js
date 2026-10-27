import { getStatus } from '../lib/tracker.js';
import { send, fail } from './_util.js';

export default async function handler(req, res) {
  try {
    send(res, 200, await getStatus());
  } catch (e) {
    fail(res, e);
  }
}
