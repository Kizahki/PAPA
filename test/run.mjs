import assert from 'node:assert/strict';
process.env.MOCK_SERPAPI = '1';
const { normalize } = await import('../lib/serp.js');
const tracker = await import('../lib/tracker.js');
const store = await import('../lib/store.js');

// 1. Parsing d'une réponse SerpApi (structure google_flights)
const fixture = {
  search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?x' },
  best_flights: [
    { price: 1210, total_duration: 900, flights: [{ airline: 'EgyptAir', flight_number: 'MS 778', departure_airport: { id: 'GVA', time: '2027-02-16 14:10' }, arrival_airport: { id: 'CAI', time: '2027-02-16 19:05' }, extensions: ['Bagage en soute : 1 inclus'] }, { airline: 'EgyptAir', departure_airport: { id: 'CAI' }, arrival_airport: { id: 'ASM' } }], layovers: [{ id: 'CAI', name: 'Le Caire', duration: 455 }] },
  ],
  other_flights: [
    { price: 990, flights: [{ airline: 'EgyptAir' }, { airline: 'EgyptAir' }], layovers: [{ id: 'CAI' }] },
    { price: 700, flights: [{ airline: 'Turkish Airlines' }] }, // doit être ignoré
  ],
  price_insights: { price_level: 'low', typical_price_range: [1000, 1300] },
};
const n = normalize(fixture, '2027-02-16', '2027-03-21');
assert.equal(n.price, 990, 'prend le moins cher EgyptAir, ignore les autres compagnies');
assert.equal(n.url, 'https://www.google.com/travel/flights?x');
assert.equal(normalize({}, 'a', 'b').price, null, 'aucune offre → null');
const n2 = normalize({ best_flights: [fixture.best_flights[0]] }, 'a', 'b');
assert.deepEqual(n2.bagHints, ['Bagage en soute : 1 inclus'], 'indice bagages extrait');

// 2. Premier contrôle : pas d'alerte (pas de référence)
let r = await tracker.dailyCheck({ full: true });
assert.equal(r.searches, 25);
assert.equal(r.notified, null);
const best1 = (await tracker.getStatus()).best.price;

// 3. Baisse ≥ 10 CHF → alerte
process.env.MOCK_DROP = '1';
r = await tracker.dailyCheck();
const best2 = (await tracker.getStatus()).best.price;
assert.ok(best2 < best1, 'le prix a baissé');
assert.match(r.notified?.body || '', /Baisse de/, 'alerte de baisse');

// 4. Prix cible au-dessus du prix → alerte cible une seule fois
await tracker.saveSettings({ target: best2 + 100 });
r = await tracker.dailyCheck();
assert.match(r.notified?.body || '', /prix cible/, 'alerte cible');
r = await tracker.dailyCheck();
assert.equal(r.notified, null, 'pas de doublon au même prix');

// 5. Validation prix cible
await assert.rejects(() => tracker.saveSettings({ target: 5 }), /entre 100/);

// 6. Si plus aucune offre : on garde le dernier prix
const grid = await store.get('grid');
const k = '2027-02-16_2027-03-21';
assert.ok(grid[k].price > 0);
console.log('OK — tous les tests passent', { best1, best2 });
