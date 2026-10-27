// Paramètres du voyage. Les dates par défaut sont remplacées par celles choisies dans l'app.
export const TRIP = {
  from: 'GVA',
  to: 'ASM',
  airline: 'MS', // EgyptAir
  airlineName: 'EgyptAir',
  currency: 'CHF',
  refOut: '2027-02-16',
  refRet: '2027-03-21',
  flexDays: 2,
};

// Quota SerpApi gratuit : 250 recherches / mois.
export const BUDGET = {
  rotatingPerCron: 3, // combinaisons rafraîchies chaque jour en plus des dates choisies
  manualPerDay: 2, // actualisations manuelles autorisées par jour
  tripChangesPerDay: 3, // changements de dates autorisés par jour (1 recherche immédiate chacun)
  dropThreshold: 10, // baisse minimale (CHF) pour déclencher une notification
  maxStayDays: 330,
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function shift(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Date du jour en Suisse (le serveur tourne en UTC).
export function todayCH() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}

export function tripFrom(settings = {}) {
  const out = ISO.test(settings.out || '') ? settings.out : TRIP.refOut;
  const ret = ISO.test(settings.ret || '') ? settings.ret : TRIP.refRet;
  return { out, ret };
}

export function validateTrip(out, ret) {
  if (!ISO.test(out || '') || !ISO.test(ret || '')) return 'Choisissez une date d’aller et une date de retour.';
  if (out < todayCH()) return 'La date d’aller est déjà passée.';
  if (ret <= out) return 'Le retour doit être après l’aller.';
  const days = (new Date(ret) - new Date(out)) / 86400000;
  if (days > BUDGET.maxStayDays) return 'Le retour doit être moins de 11 mois après l’aller.';
  return null;
}

const range = (iso) => {
  const r = [];
  for (let i = -TRIP.flexDays; i <= TRIP.flexDays; i++) r.push(shift(iso, i));
  return r;
};

export const outDates = (trip) => range(trip.out);
export const retDates = (trip) => range(trip.ret);
export const comboKey = (out, ret) => `${out}_${ret}`;
export const refKey = (trip) => comboKey(trip.out, trip.ret);

// Les 25 combinaisons autour des dates choisies, sans les dates passées.
export function allCombos(trip) {
  const today = todayCH();
  const combos = [];
  for (const o of outDates(trip)) for (const r of retDates(trip)) if (o >= today && r > o) combos.push({ out: o, ret: r });
  return combos;
}

export function inTrip(trip, key) {
  const [o, r] = key.split('_');
  return outDates(trip).includes(o) && retDates(trip).includes(r);
}
