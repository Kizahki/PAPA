import { BUDGET, TRIP, refKey, tripFrom, validateTrip, todayCH } from './config.js';
import { searchCombo } from './serp.js';
import * as store from './store.js';
import { notifyAll, pushEnabled } from './push.js';

const DAY_FR = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (iso) => DAY_FR.format(new Date(iso + 'T12:00:00Z'));

function httpError(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

/* ---------- Prix des dates choisies ---------- */

// Enregistre un résultat de recherche comme « prix en direct » des dates choisies.
async function record(trip, res) {
  const key = refKey(trip);
  const prev = await store.get('live', null);
  const same = prev?.trip === key;
  let live;
  if (res.price == null && !res.noFlight && same && prev.price != null) {
    // Recherche sans offre mais pas « pas de vol » : on garde le dernier prix connu.
    live = { ...prev, checkedAt: res.at, unavailable: true };
  } else {
    const prevPrice = same ? (prev.price ?? prev.prevPrice ?? null) : null;
    live = { ...res, trip: key, checkedAt: res.at, unavailable: false, prevPrice: prevPrice !== res.price ? prevPrice : (prev?.prevPrice ?? null) };
  }
  await store.set('live', live);
  if (live.price != null) await appendHistory(key, live.price);
  return live;
}

async function appendHistory(key, price) {
  const history = await store.get('history', []);
  const day = todayCH();
  const rest = history.filter((h) => !(h.day === day && h.trip === key));
  const prevSameDay = history.find((h) => h.day === day && h.trip === key);
  // Un point par jour : le prix le plus bas vu ce jour-là.
  rest.push({ day, trip: key, price: prevSameDay ? Math.min(prevSameDay.price, price) : price });
  rest.sort((a, b) => a.day.localeCompare(b.day));
  await store.set('history', rest.slice(-120));
}

// Prix en direct à l'ouverture de l'app. Résultat gardé LIVE_TTL minutes pour ménager le quota.
export async function getLive({ force = false } = {}) {
  const trip = tripFrom(await store.get('settings', {}));
  const key = refKey(trip);
  const live = await store.get('live', null);
  const fresh = live?.trip === key && Date.now() - new Date(live.checkedAt).getTime() < BUDGET.liveTtlMin * 60000;

  if (fresh && !force) return { ...live, cached: true };
  if (trip.out < todayCH()) return live?.trip === key ? { ...live, cached: true } : null;

  if (force) {
    if ((await store.peekDaily('force')) >= BUDGET.forcePerDay) {
      throw httpError(429, `Déjà ${BUDGET.forcePerDay} actualisations forcées aujourd'hui. Le prix se met à jour seul à chaque ouverture de l'app.`);
    }
    await store.incrDaily('force');
  }
  if ((await store.peekDaily('live')) >= BUDGET.searchesPerDay) {
    if (live?.trip === key) return { ...live, cached: true, capped: true };
    throw httpError(429, 'Limite de recherches du jour atteinte. Le prix sera mis à jour demain.');
  }
  await store.incrDaily('live');
  try {
    return await record(trip, await searchCombo(trip.out, trip.ret));
  } catch (e) {
    console.error(e);
    if (live?.trip === key) return { ...live, cached: true, stale: true };
    throw httpError(502, 'La recherche du prix n’a pas abouti. Réessayez dans un moment.');
  }
}

/* ---------- Alerte quotidienne ---------- */

// Appelé une fois par jour par Vercel Cron : 1 recherche, notification seulement si le prix baisse.
export async function dailyCheck() {
  const settings = await store.get('settings', {});
  const trip = tripFrom(settings);
  const key = refKey(trip);
  if (trip.out < todayCH()) return { searches: 0, notified: null, note: 'Voyage passé' };

  const live = await record(trip, await searchCombo(trip.out, trip.ret));
  await store.set('lastRun', { at: new Date().toISOString() });
  if (live.price == null || live.unavailable) return { searches: 1, price: null, notified: null };

  const alert = await store.get('alert', {});
  if (alert.trip !== key) Object.assign(alert, { trip: key, lastPrice: null, lastTargetPrice: null });
  const lines = [];
  if (alert.lastPrice != null && alert.lastPrice - live.price >= BUDGET.dropThreshold) {
    lines.push(`Baisse de ${alert.lastPrice - live.price} CHF`);
  }
  const target = Number(settings.target) || null;
  if (target && live.price <= target && (alert.lastTargetPrice == null || live.price < alert.lastTargetPrice)) {
    lines.push(`Sous votre prix cible de ${target} CHF`);
    alert.lastTargetPrice = live.price;
  }
  if (target && live.price > target) alert.lastTargetPrice = null;
  alert.lastPrice = live.price;
  await store.set('alert', alert);

  if (!lines.length) return { searches: 1, price: live.price, notified: null };
  const payload = {
    title: `${live.price} CHF · Genève ⇄ Asmara`,
    body: `${lines.join(' · ')}. Aller ${fmtDate(trip.out)}, retour ${fmtDate(trip.ret)}.`,
    url: '/',
  };
  return { searches: 1, price: live.price, notified: { ...payload, ...(await notifyAll(payload)) } };
}

/* ---------- État et réglages ---------- */

export async function getStatus() {
  const [live, history, settings, lastRun, forceUsed, tripUsed] = await Promise.all([
    store.get('live', null),
    store.get('history', []),
    store.get('settings', {}),
    store.get('lastRun', null),
    store.peekDaily('force'),
    store.peekDaily('trip'),
  ]);
  const trip = tripFrom(settings);
  const key = refKey(trip);
  return {
    trip: { ...TRIP, refOut: trip.out, refRet: trip.ret },
    live: live?.trip === key ? live : null,
    liveTtlMin: BUDGET.liveTtlMin,
    history: history.filter((h) => h.trip === key),
    settings: { target: settings.target ?? null, out: trip.out, ret: trip.ret },
    lastRun,
    forceLeft: Math.max(0, BUDGET.forcePerDay - forceUsed),
    tripChangesLeft: Math.max(0, BUDGET.tripChangesPerDay - tripUsed),
    dropThreshold: BUDGET.dropThreshold,
    today: todayCH(),
    push: { enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY || null },
    persistent: store.hasPersistentStore(),
    demo: process.env.MOCK_SERPAPI === '1',
  };
}

// Prix cible et/ou dates du voyage.
export async function saveSettings(body = {}) {
  const settings = { ...(await store.get('settings', {})) };
  const alert = await store.get('alert', {});
  let tripChanged = false;

  if ('target' in body) {
    const t = body.target === null || body.target === '' ? null : Math.round(Number(body.target));
    if (t !== null && (!Number.isFinite(t) || t < 100 || t > 10000)) throw httpError(400, 'Prix cible entre 100 et 10 000 CHF.');
    settings.target = t;
    alert.lastTargetPrice = null;
  }

  if ('out' in body || 'ret' in body) {
    const err = validateTrip(body.out, body.ret);
    if (err) throw httpError(400, err);
    const cur = tripFrom(settings);
    if (body.out !== cur.out || body.ret !== cur.ret) {
      if ((await store.peekDaily('trip')) >= BUDGET.tripChangesPerDay) {
        throw httpError(429, `Les dates ont déjà été changées ${BUDGET.tripChangesPerDay} fois aujourd'hui. Réessayez demain.`);
      }
      await store.incrDaily('trip');
      settings.out = body.out;
      settings.ret = body.ret;
      Object.assign(alert, { trip: refKey(tripFrom(settings)), lastPrice: null, lastTargetPrice: null });
      tripChanged = true;
    }
  }

  await store.set('settings', settings);
  await store.set('alert', alert);

  // Nouvelles dates : prix tout de suite, qui sert aussi de référence pour la prochaine alerte.
  let result = null;
  if (tripChanged) {
    result = await getLive({ force: false }).catch(() => null);
    if (result?.price != null) {
      alert.lastPrice = result.price;
      await store.set('alert', alert);
    }
  }
  return { settings: { target: settings.target ?? null, ...tripFrom(settings) }, tripChanged, result };
}
