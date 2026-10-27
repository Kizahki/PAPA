import { BUDGET, TRIP, allCombos, comboKey, refKey, outDates, retDates, tripFrom, validateTrip, inTrip, todayCH } from './config.js';
import { searchCombo } from './serp.js';
import * as store from './store.js';
import { notifyAll, pushEnabled } from './push.js';

const DAY_FR = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (iso) => DAY_FR.format(new Date(iso + 'T12:00:00Z'));

async function currentTrip() {
  return tripFrom(await store.get('settings', {}));
}

async function runSearches(combos) {
  const grid = await store.get('grid', {});
  const errors = [];
  for (let i = 0; i < combos.length; i += 4) {
    const batch = combos.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((c) => searchCombo(c.out, c.ret)));
    results.forEach((r, j) => {
      const k = comboKey(batch[j].out, batch[j].ret);
      const prev = grid[k];
      if (r.status === 'rejected') {
        errors.push(`${k}: ${r.reason?.message || r.reason}`);
        return;
      }
      const res = r.value;
      if (res.price == null && prev?.price != null) {
        // Plus d'offre aujourd'hui : on garde le dernier prix connu.
        grid[k] = { ...prev, checkedAt: res.at, unavailable: true };
      } else {
        grid[k] = { ...res, checkedAt: res.at, prevPrice: prev?.price ?? null, unavailable: false };
      }
    });
  }
  await store.set('grid', grid);
  return { grid, errors };
}

// Meilleur prix parmi les combinaisons des dates choisies uniquement.
function bestOf(grid, trip) {
  let best = null;
  for (const [k, v] of Object.entries(grid)) {
    if (inTrip(trip, k) && v?.price != null && (!best || v.price < best.price)) best = v;
  }
  return best;
}

async function evaluateAlerts(grid, trip) {
  const best = bestOf(grid, trip);
  if (!best) return null;
  const settings = await store.get('settings', {});
  const alert = await store.get('alert', {});
  const lines = [];
  const sameTrip = alert.trip === refKey(trip);

  if (sameTrip && alert.lastBest != null && alert.lastBest - best.price >= BUDGET.dropThreshold) {
    lines.push(`Baisse de ${alert.lastBest - best.price} CHF`);
  }
  const target = Number(settings.target) || null;
  if (target && best.price <= target && (alert.lastTargetPrice == null || best.price < alert.lastTargetPrice)) {
    lines.push(`Sous votre prix cible de ${target} CHF`);
    alert.lastTargetPrice = best.price;
  }
  if (target && best.price > target) alert.lastTargetPrice = null;
  alert.lastBest = best.price;
  alert.trip = refKey(trip);
  await store.set('alert', alert);

  if (!lines.length) return null;
  const payload = {
    title: `${best.price} CHF · Genève ⇄ Asmara`,
    body: `${lines.join(' · ')}. Départ ${fmtDate(best.out)}, retour ${fmtDate(best.ret)}.`,
    url: '/',
  };
  return { ...payload, ...(await notifyAll(payload)) };
}

async function appendHistory(grid, trip) {
  const history = await store.get('history', []);
  const day = todayCH();
  const best = bestOf(grid, trip);
  const entry = { day, trip: refKey(trip), best: best?.price ?? null, ref: grid[refKey(trip)]?.price ?? null };
  const rest = history.filter((h) => !(h.day === day && h.trip === entry.trip));
  rest.push(entry);
  await store.set('history', rest.slice(-120));
}

// Cron quotidien : dates choisies + les combinaisons les plus anciennes.
// Tout est relevé si demandé, si les dates ont changé depuis, ou s'il manque des cases.
export async function dailyCheck({ full = false } = {}) {
  const settings = await store.get('settings', {});
  const trip = tripFrom(settings);
  const lastRun = await store.get('lastRun', null);
  if (trip.out < todayCH()) return { searches: 0, errors: [], notified: null, note: 'Voyage passé' };

  const grid = await store.get('grid', {});
  const combos = allCombos(trip);
  const ref = refKey(trip);
  const missing = combos.filter((c) => !grid[comboKey(c.out, c.ret)]);
  const changed = settings.tripChangedAt && settings.tripChangedAt > (lastRun?.at || '');

  let todo;
  if (full || changed || missing.length > BUDGET.rotatingPerCron) {
    todo = combos;
  } else {
    const others = combos
      .filter((c) => comboKey(c.out, c.ret) !== ref)
      .sort((a, b) => (grid[comboKey(a.out, a.ret)]?.checkedAt || '').localeCompare(grid[comboKey(b.out, b.ret)]?.checkedAt || ''))
      .slice(0, BUDGET.rotatingPerCron);
    todo = [{ out: trip.out, ret: trip.ret }, ...others];
  }
  const { grid: g, errors } = await runSearches(todo);
  await appendHistory(g, trip);
  const notified = await evaluateAlerts(g, trip);
  await store.set('lastRun', { at: new Date().toISOString(), searches: todo.length, errors });
  return { searches: todo.length, errors, notified };
}

function tooMany(msg) {
  const e = new Error(msg);
  e.status = 429;
  return e;
}

// Actualisation manuelle depuis l'app : dates choisies seulement, quota limité.
export async function manualRefresh() {
  if ((await store.peekDaily('manual')) >= BUDGET.manualPerDay) {
    throw tooMany(`Déjà ${BUDGET.manualPerDay} actualisations aujourd'hui. Les prix se mettent aussi à jour seuls chaque matin.`);
  }
  await store.incrDaily('manual');
  const trip = await currentTrip();
  const { grid, errors } = await runSearches([{ out: trip.out, ret: trip.ret }]);
  if (errors.length) {
    const e = new Error('La recherche n’a pas abouti. Réessayez plus tard.');
    e.status = 502;
    throw e;
  }
  await appendHistory(grid, trip);
  await evaluateAlerts(grid, trip);
  return grid[refKey(trip)];
}

export async function getStatus() {
  const [grid, history, settings, lastRun, manualUsed, tripUsed] = await Promise.all([
    store.get('grid', {}),
    store.get('history', []),
    store.get('settings', {}),
    store.get('lastRun', null),
    store.peekDaily('manual'),
    store.peekDaily('trip'),
  ]);
  const trip = tripFrom(settings);
  const ref = refKey(trip);
  return {
    trip: { ...TRIP, refOut: trip.out, refRet: trip.ret },
    outDates: outDates(trip),
    retDates: retDates(trip),
    refKey: ref,
    grid: Object.fromEntries(Object.entries(grid).filter(([k]) => inTrip(trip, k))),
    best: bestOf(grid, trip),
    history: history.filter((h) => !h.trip || h.trip === ref),
    settings: { target: settings.target ?? null, out: trip.out, ret: trip.ret },
    lastRun,
    manualLeft: Math.max(0, BUDGET.manualPerDay - manualUsed),
    tripChangesLeft: Math.max(0, BUDGET.tripChangesPerDay - tripUsed),
    today: todayCH(),
    push: { enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY || null },
    persistent: store.hasPersistentStore(),
    demo: process.env.MOCK_SERPAPI === '1',
  };
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

// Prix cible et/ou dates du voyage.
export async function saveSettings(body = {}) {
  const settings = { ...(await store.get('settings', {})) };
  const alert = await store.get('alert', {});
  let tripChanged = false;

  if ('target' in body) {
    const t = body.target === null || body.target === '' ? null : Math.round(Number(body.target));
    if (t !== null && (!Number.isFinite(t) || t < 100 || t > 10000)) throw badRequest('Prix cible entre 100 et 10 000 CHF.');
    settings.target = t;
    alert.lastTargetPrice = null;
  }

  if ('out' in body || 'ret' in body) {
    const err = validateTrip(body.out, body.ret);
    if (err) throw badRequest(err);
    const cur = tripFrom(settings);
    if (body.out !== cur.out || body.ret !== cur.ret) {
      if ((await store.peekDaily('trip')) >= BUDGET.tripChangesPerDay) {
        throw tooMany(`Les dates ont déjà été changées ${BUDGET.tripChangesPerDay} fois aujourd'hui. Réessayez demain.`);
      }
      await store.incrDaily('trip');
      settings.out = body.out;
      settings.ret = body.ret;
      settings.tripChangedAt = new Date().toISOString();
      alert.lastBest = null;
      alert.lastTargetPrice = null;
      tripChanged = true;
    }
  }

  await store.set('settings', settings);
  await store.set('alert', alert);

  // Nouvelles dates : premier prix tout de suite (1 recherche), le reste demain matin.
  let result = null;
  if (tripChanged) {
    const trip = tripFrom(settings);
    const { grid } = await runSearches([{ out: trip.out, ret: trip.ret }]);
    await appendHistory(grid, trip);
    result = grid[refKey(trip)] || null;
  }
  return { settings: { target: settings.target ?? null, ...tripFrom(settings) }, tripChanged, result };
}
