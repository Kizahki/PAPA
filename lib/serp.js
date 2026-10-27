import { TRIP } from './config.js';

const BAG_RE = /bagag|valise|baggage|bag\b|bags\b|soute|cabine|carry-on|checked/i;

// Recherche aller-retour GVA ⇄ ASM sur EgyptAir pour une combinaison de dates.
// Retourne l'offre la moins chère, normalisée, ou { price: null } si rien trouvé.
export async function searchCombo(out, ret) {
  if (process.env.MOCK_SERPAPI === '1') return mockResult(out, ret);

  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('SERPAPI_KEY manquante');

  const params = new URLSearchParams({
    engine: 'google_flights',
    departure_id: TRIP.from,
    arrival_id: TRIP.to,
    outbound_date: out,
    return_date: ret,
    type: '1',
    travel_class: '1',
    adults: '1',
    include_airlines: TRIP.airline,
    currency: TRIP.currency,
    gl: 'ch',
    hl: 'fr',
    api_key: key,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const data = await res.json();
  // « Google Flights hasn't returned any results » = pas de vol EgyptAir ce jour-là.
  if (data.error && !/any results|no results/i.test(data.error)) throw new Error(`SerpApi: ${data.error}`);
  return normalize(data, out, ret);
}

export function normalize(data, out, ret) {
  const options = [...(data.best_flights || []), ...(data.other_flights || [])]
    .filter((o) => typeof o.price === 'number')
    .filter((o) => (o.flights || []).every((f) => /egypt/i.test(f.airline || '')));

  const base = {
    out,
    ret,
    at: new Date().toISOString(),
    url: data.search_metadata?.google_flights_url || null,
    insights: data.price_insights
      ? {
          level: data.price_insights.price_level || null,
          typical: data.price_insights.typical_price_range || null,
        }
      : null,
  };

  if (!options.length) return { ...base, price: null, noFlight: true };

  options.sort((a, b) => a.price - b.price);
  const best = options[0];
  const legs = (best.flights || []).map((f) => ({
    from: f.departure_airport?.id,
    fromTime: f.departure_airport?.time,
    to: f.arrival_airport?.id,
    toTime: f.arrival_airport?.time,
    flight: f.flight_number,
    duration: f.duration,
    extensions: f.extensions || [],
  }));
  const allExt = [...(best.extensions || []), ...legs.flatMap((l) => l.extensions)];
  const bagHints = [...new Set(allExt.filter((e) => BAG_RE.test(e)))];

  return {
    ...base,
    price: best.price,
    duration: best.total_duration || null,
    stops: (best.layovers || []).map((l) => ({ id: l.id, name: l.name, duration: l.duration })),
    legs: legs.map(({ extensions, ...l }) => l),
    bagHints,
    options: options.length,
  };
}

// Données fictives mais réalistes pour tester sans clé.
function mockResult(out, ret) {
  const dow = new Date(out + 'T12:00:00Z').getUTCDay();
  if ([1, 3, 4].includes(dow)) return Promise.resolve({ out, ret, at: new Date().toISOString(), url: null, insights: null, price: null, noFlight: true });
  const seed = [...(out + ret)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const day = Math.floor(Date.now() / 86400000);
  const price = 820 + ((seed * 37) % 260) + ((day + seed) % 5) * 9 - (process.env.MOCK_DROP ? 60 : 0);
  return Promise.resolve({
    out,
    ret,
    at: new Date().toISOString(),
    url: 'https://www.google.com/travel/flights',
    insights: { level: 'typical', typical: [850, 1150] },
    price,
    duration: 905,
    stops: [{ id: 'CAI', name: 'Aéroport international du Caire', duration: 455 }],
    legs: [
      { from: 'GVA', fromTime: `${out} 14:10`, to: 'CAI', toTime: `${out} 19:05`, flight: 'MS 778', duration: 235 },
      { from: 'CAI', fromTime: `${out} 02:40`, to: 'ASM', toTime: `${out} 06:35`, flight: 'MS 851', duration: 175 },
    ],
    bagHints: seed % 2 ? ['1 bagage en soute inclus'] : [],
    options: 3,
  });
}
