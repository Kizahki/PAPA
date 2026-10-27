import { TRIP, BUDGET, BAGGAGE, allCombos, comboKey, REF_KEY, outDates, retDates } from './config.js';
import { searchCombo } from './serp.js';
import * as store from './store.js';
import { notifyAll, pushEnabled } from './push.js';

const DAY_FR = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (iso) => DAY_FR.format(new Date(iso + 'T12:00:00Z'));

async function runSearches(combos) {
  const grid = await store.get('grid', {});
  const errors = [];
  // 4 recherches en parallèle maximum
  for (let i = 0; i < combos.length; i += 4) {
    const batch = combos.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((c) => searchCombo(c.out, c.ret)));
    results.forEach((r, j) => {
      const { out, ret } = batch[j];
      const k = comboKey(out, ret);
      const prev = grid[k];
      if (r.status === 'rejected') {
        errors.push(`${k}: ${r.reason?.message || r.reason}`);
        return;
      }
      const res = r.value;
      if (res.price == null && prev?.price != null) {
        // Aucune offre aujourd'hui : on garde le dernier prix connu.
        grid[k] = { ...prev, checkedAt: res.at, unavailable: true };
      } else {
        grid[k] = { ...res, checkedAt: res.at, prevPrice: prev?.price ?? null };
      }
    });
  }
  await store.set('grid', grid);
  return { grid, errors };
}

function bestOf(grid) {
  let best = null;
  for (const v of Object.values(grid)) {
    if (v?.price != null && (!best || v.price < best.price)) best = v;
  }
  return best;
}

async function evaluateAlerts(grid) {
  const best = bestOf(grid);
  if (!best) return null;
  const settings = await store.get('settings', {});
  const alert = await store.get('alert', {});
  const lines = [];

  if (alert.lastBest != null && alert.lastBest - best.price >= BUDGET.dropThreshold) {
    lines.push(`Baisse de ${alert.lastBest - best.price} CHF`);
  }
  const target = Number(settings.target) || null;
  if (target && best.price <= target && (alert.lastTargetPrice == null || best.price < alert.lastTargetPrice)) {
    lines.push(`Sous votre prix cible de ${target} CHF`);
    alert.lastTargetPrice = best.price;
  }
  if (target && best.price > target) alert.lastTargetPrice = null;
  alert.lastBest = best.price;
  await store.set('alert', alert);

  if (!lines.length) return null;
  const payload = {
    title: `${best.price} CHF · Genève ⇄ Asmara`,
    body: `${lines.join(' · ')}. Départ ${fmtDate(best.out)}, retour ${fmtDate(best.ret)}.`,
    url: '/',
  };
  const res = await notifyAll(payload);
  return { ...payload, ...res };
}

async function appendHistory(grid) {
  const history = await store.get('history', []);
  const day = new Date().toISOString().slice(0, 10);
  const best = bestOf(grid);
  const entry = { day, best: best?.price ?? null, ref: grid[REF_KEY]?.price ?? null };
  const rest = history.filter((h) => h.day !== day);
  rest.push(entry);
  await store.set('history', rest.slice(-90));
}

// Cron quotidien : référence + les combinaisons les plus anciennes.
export async function dailyCheck({ full = false } = {}) {
  const grid = await store.get('grid', {});
  let combos;
  if (full) {
    combos = allCombos();
  } else {
    const others = allCombos()
      .filter((c) => comboKey(c.out, c.ret) !== REF_KEY)
      .sort((a, b) => {
        const ta = grid[comboKey(a.out, a.ret)]?.checkedAt || '';
        const tb = grid[comboKey(b.out, b.ret)]?.checkedAt || '';
        return ta.localeCompare(tb);
      })
      .slice(0, BUDGET.rotatingPerCron);
    combos = [{ out: TRIP.refOut, ret: TRIP.refRet }, ...others];
  }
  const { grid: g, errors } = await runSearches(combos);
  await appendHistory(g);
  const notified = await evaluateAlerts(g);
  await store.set('lastRun', { at: new Date().toISOString(), searches: combos.length, errors });
  return { searches: combos.length, errors, notified };
}

// Actualisation manuelle depuis l'app : référence seule, quota limité.
export async function manualRefresh() {
  const used = await store.peekDaily('manual');
  if (used >= BUDGET.manualPerDay) {
    const e = new Error(`Déjà ${BUDGET.manualPerDay} actualisations aujourd'hui. Les prix se mettent aussi à jour seuls chaque matin.`);
    e.status = 429;
    throw e;
  }
  await store.incrDaily('manual');
  const { grid, errors } = await runSearches([{ out: TRIP.refOut, ret: TRIP.refRet }]);
  if (errors.length) {
    const e = new Error('La recherche n’a pas abouti. Réessayez plus tard.');
    e.status = 502;
    e.detail = errors;
    throw e;
  }
  await appendHistory(grid);
  await evaluateAlerts(grid);
  return grid[REF_KEY];
}

export async function getStatus() {
  const [grid, history, settings, lastRun, manualUsed] = await Promise.all([
    store.get('grid', {}),
    store.get('history', []),
    store.get('settings', {}),
    store.get('lastRun', null),
    store.peekDaily('manual'),
  ]);
  return {
    trip: TRIP,
    outDates: outDates(),
    retDates: retDates(),
    refKey: REF_KEY,
    grid,
    best: bestOf(grid),
    history,
    settings,
    lastRun,
    baggage: BAGGAGE,
    manualLeft: Math.max(0, BUDGET.manualPerDay - manualUsed),
    push: { enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY || null },
    persistent: store.hasPersistentStore(),
    demo: process.env.MOCK_SERPAPI === '1',
  };
}

export async function saveSettings({ target }) {
  const t = target === null || target === '' ? null : Math.round(Number(target));
  if (t !== null && (!Number.isFinite(t) || t < 100 || t > 10000)) {
    const e = new Error('Prix cible entre 100 et 10 000 CHF.');
    e.status = 400;
    throw e;
  }
  const settings = { ...(await store.get('settings', {})), target: t };
  await store.set('settings', settings);
  // Recalcule l'alerte cible au prochain contrôle.
  const alert = await store.get('alert', {});
  alert.lastTargetPrice = null;
  await store.set('alert', alert);
  return settings;
}
