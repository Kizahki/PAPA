import * as store from './store.js';

const pub = process.env.VAPID_PUBLIC_KEY;
const priv = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:contact@example.com';

export const pushEnabled = () => !!(pub && priv);

let webpush = null;
async function lib() {
  if (!webpush) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(subject, pub, priv);
  }
  return webpush;
}

export async function addSub(sub) {
  if (!sub?.endpoint) throw new Error('Abonnement invalide');
  const subs = await store.get('subs', []);
  const rest = subs.filter((s) => s.endpoint !== sub.endpoint);
  rest.push({ endpoint: sub.endpoint, keys: sub.keys });
  await store.set('subs', rest.slice(-10)); // max 10 appareils
  return rest.length;
}

export async function removeSub(endpoint) {
  const subs = await store.get('subs', []);
  await store.set('subs', subs.filter((s) => s.endpoint !== endpoint));
}

// Envoie à tous les appareils ; retire ceux qui ont expiré.
export async function notifyAll(payload) {
  if (!pushEnabled()) return { sent: 0, reason: 'VAPID non configuré' };
  const wp = await lib();
  const subs = await store.get('subs', []);
  const alive = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await wp.sendNotification(s, JSON.stringify(payload), { TTL: 86400 });
        alive.push(s);
        sent++;
      } catch (e) {
        if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(s);
      }
    }),
  );
  if (alive.length !== subs.length) await store.set('subs', alive);
  return { sent };
}
