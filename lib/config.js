// Paramètres fixes du voyage. Tout est ici : un seul endroit à modifier.
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
  rotatingPerCron: 3, // combinaisons rafraîchies chaque jour en plus de la référence
  manualPerDay: 2, // actualisations manuelles autorisées par jour
  dropThreshold: 10, // baisse minimale (CHF) pour déclencher une notification
};

// Règle bagages officielle EgyptAir (communiqué du 01.01.2026).
export const BAGGAGE = {
  includedPieces: 1,
  sourceUrl:
    'https://www.egyptair.com/en/about-egyptair/news-and-press/Pages/Effective%201%20January%202026,%20the%20baggage%20allowance%20for%20all%20tickets%20to%20and%20from%20Asmara%20will%20be%20limited%20to%20one%20checked%20piece%20for.aspx',
  allowanceUrl: 'https://www.egyptair.com/en/fly/baggage/pages/baggage-allowance.aspx',
};

function shift(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function outDates() {
  const r = [];
  for (let i = -TRIP.flexDays; i <= TRIP.flexDays; i++) r.push(shift(TRIP.refOut, i));
  return r;
}

export function retDates() {
  const r = [];
  for (let i = -TRIP.flexDays; i <= TRIP.flexDays; i++) r.push(shift(TRIP.refRet, i));
  return r;
}

export function allCombos() {
  const combos = [];
  for (const o of outDates()) for (const r of retDates()) combos.push({ out: o, ret: r });
  return combos;
}

export const comboKey = (out, ret) => `${out}_${ret}`;
export const REF_KEY = comboKey(TRIP.refOut, TRIP.refRet);
