import assert from 'node:assert/strict';
process.env.MOCK_SERPAPI = '1';
const { normalize } = await import('../lib/serp.js');
const tracker = await import('../lib/tracker.js');
const store = await import('../lib/store.js');

// 1. Lecture d'une réponse SerpApi google_flights
const fixture = {
  search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?x' },
  best_flights: [
    { price: 1210, total_duration: 590, flights: [{ airline: 'EgyptAir', flight_number: 'MS 772', departure_airport: { id: 'GVA', time: '2027-02-16 14:05' }, arrival_airport: { id: 'CAI' } }, { airline: 'EgyptAir', departure_airport: { id: 'CAI' }, arrival_airport: { id: 'ASM' } }], layovers: [{ id: 'CAI', name: 'Le Caire', duration: 455 }] },
  ],
  other_flights: [
    { price: 776, flights: [{ airline: 'EgyptAir' }, { airline: 'EgyptAir' }], layovers: [{ id: 'CAI' }] },
    { price: 500, flights: [{ airline: 'Turkish Airlines' }] },
  ],
};
assert.equal(normalize(fixture, '2027-02-16', '2027-03-21').price, 776, 'moins cher EgyptAir, autres compagnies ignorées');
assert.equal(normalize({}, 'a', 'b').noFlight, true, 'aucune offre = pas de vol');

// 2. Prix en direct : 1 recherche, puis réutilisé pendant une heure
const searches = () => store.peekDaily('live');
const live1 = await tracker.getLive();
assert.ok(live1.price > 0 && !live1.cached);
assert.equal(await searches(), 1);
const live2 = await tracker.getLive();
assert.equal(live2.cached, true, 'réutilisé dans l’heure');
assert.equal(await searches(), 1, 'pas de recherche en plus');

// 3. Actualisation forcée limitée à 3 par jour
for (let i = 0; i < 3; i++) await tracker.getLive({ force: true });
await assert.rejects(() => tracker.getLive({ force: true }), /actualisations forcées/);

// 4. Alerte quotidienne : rien la première fois, puis baisse ≥ 10 CHF
let r = await tracker.dailyCheck();
assert.equal(r.searches, 1);
assert.equal(r.notified, null, 'première référence, pas d’alerte');
process.env.MOCK_DROP = '1';
r = await tracker.dailyCheck();
assert.match(r.notified?.body || '', /Baisse de/, 'alerte quand le prix baisse');
r = await tracker.dailyCheck();
assert.equal(r.notified, null, 'pas de nouvelle alerte au même prix');

// 5. Prix cible : alerte une seule fois
await tracker.saveSettings({ target: r.price + 50 });
r = await tracker.dailyCheck();
assert.match(r.notified?.body || '', /prix cible/);
r = await tracker.dailyCheck();
assert.equal(r.notified, null);

// 6. Changement de dates : prix immédiat, sert de nouvelle référence
const s = await tracker.saveSettings({ out: '2027-02-14', ret: '2027-03-22' });
assert.equal(s.tripChanged, true);
const st = await tracker.getStatus();
assert.equal(st.settings.out, '2027-02-14');
assert.ok(st.live && st.live.trip === '2027-02-14_2027-03-22', 'prix des nouvelles dates affiché');
await assert.rejects(() => tracker.saveSettings({ out: '2027-03-01', ret: '2027-02-01' }), /après l’aller/);
await assert.rejects(() => tracker.saveSettings({ target: 5 }), /entre 100/);

console.log('OK — tous les tests passent');
