#!/usr/bin/env python3
"""Relevé des prix EgyptAir GVA ⇄ ASM via SerpApi, pour l'artefact « Vol Asmara ».

Usage : python3 releve.py <dossier_etat> <dossier_sortie> [--full]
  dossier_etat : documents lus dans l'artefact (prices/*.json, settings/main.json, history/*.json)
                 tels qu'écrits par ArtifactData list/get avec out_dir, plus versions.json :
                 {"prices/<id>": version, "settings/main": version, "history/<jour>": version}.
  dossier_sortie : reçoit un fichier JSON par document à écrire + writes.json
                   (liste prête pour ArtifactData batch) + summary.json.
Clé : variable d'environnement SERPAPI_KEY.
"""
import json, os, sys, glob, datetime, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

DEFAULT_OUT, DEFAULT_RET, FLEX = '2027-02-16', '2027-03-21', 2
ROTATING, DROP = 3, 10
BAG_WORDS = ('bagag', 'valise', 'baggage', 'bag ', 'bags', 'soute', 'checked', 'carry-on')


def load(path):
    try:
        with open(path) as f:
            d = json.load(f)
    except FileNotFoundError:
        return None
    # Accepte un document nu ou enveloppé {data, version}
    if isinstance(d, dict) and 'data' in d and isinstance(d['data'], dict):
        return d['data'], d.get('version')
    return d, (d.pop('__version__', None) if isinstance(d, dict) else None)


def shift(iso, n):
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=n)).isoformat()


def search(out, ret, key):
    q = urllib.parse.urlencode({
        'engine': 'google_flights', 'departure_id': 'GVA', 'arrival_id': 'ASM',
        'outbound_date': out, 'return_date': ret, 'type': '1', 'travel_class': '1', 'adults': '1',
        'include_airlines': 'MS', 'currency': 'CHF', 'gl': 'ch', 'hl': 'fr', 'api_key': key})
    with urllib.request.urlopen(f'https://serpapi.com/search.json?{q}', timeout=45) as r:
        d = json.load(r)
    err = (d.get('error') or '').lower()
    no_flight = 'any results' in err or 'no results' in err
    if err and not no_flight:
        raise RuntimeError(d['error'])
    opts = [o for o in d.get('best_flights', []) + d.get('other_flights', [])
            if isinstance(o.get('price'), (int, float))
            and all('egypt' in (f.get('airline') or '').lower() for f in o.get('flights', []))]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    base = {'out': out, 'ret': ret, 'checkedAt': now,
            'url': d.get('search_metadata', {}).get('google_flights_url')}
    if not opts:
        return {**base, 'price': None, 'noFlight': True}
    o = min(opts, key=lambda x: x['price'])
    exts = list(o.get('extensions') or [])
    for f in o.get('flights', []):
        exts += f.get('extensions') or []
    legs = o.get('flights', [])
    return {**base, 'price': o['price'], 'duration': o.get('total_duration'),
            'stops': [{'id': l.get('id'), 'name': l.get('name')} for l in o.get('layovers', [])],
            'depTime': legs[0].get('departure_airport', {}).get('time') if legs else None,
            'flights': [f.get('flight_number') for f in legs],
            'bagHints': sorted({e for e in exts if any(w in e.lower() for w in BAG_WORDS)})}


def main():
    state, outdir = sys.argv[1], sys.argv[2]
    full = '--full' in sys.argv
    key = os.environ['SERPAPI_KEY']
    os.makedirs(outdir, exist_ok=True)
    try:
        versions = json.load(open(os.path.join(state, 'versions.json')))
    except FileNotFoundError:
        versions = {}

    s = load(os.path.join(state, 'settings', 'main.json'))
    settings = s[0] if s else {}
    s_ver = versions.get('settings/main')
    out, ret = settings.get('out') or DEFAULT_OUT, settings.get('ret') or DEFAULT_RET
    trip = f'{out}_{ret}'
    combos = [(shift(out, i), shift(ret, j)) for i in range(-FLEX, FLEX + 1) for j in range(-FLEX, FLEX + 1)]
    today = datetime.date.today().isoformat()
    combos = [(o, r) for o, r in combos if o >= today and r > o]

    prices = {}
    for p in glob.glob(os.path.join(state, 'prices', '*.json')):
        d = load(p)
        if d:
            k = os.path.basename(p)[:-5]
            prices[k] = (d[0], versions.get(f'prices/{k}'))

    changed = settings.get('tripChangedAt') and settings.get('tripChangedAt') > (settings.get('lastRun') or '')
    missing = [c for c in combos if f'{c[0]}_{c[1]}' not in prices]
    if full or changed or len(missing) > ROTATING:
        todo = combos
    else:
        others = sorted((c for c in combos if f'{c[0]}_{c[1]}' != trip),
                        key=lambda c: (prices.get(f'{c[0]}_{c[1]}', ({}, 0))[0].get('checkedAt') or ''))
        todo = [(out, ret)] + others[:ROTATING]

    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(lambda c: (c, _safe(search, c[0], c[1], key)), todo))

    writes, errors = [], []
    for (o, r), res in results:
        k = f'{o}_{r}'
        if isinstance(res, Exception):
            errors.append(f'{k}: {res}')
            continue
        prev, ver = prices.get(k, (None, None))
        if res['price'] is None and prev and prev.get('price') is not None:
            doc = {**prev, 'checkedAt': res['checkedAt'], 'unavailable': True}
        elif res['price'] is None:
            doc = {**res, 'prevPrice': None, 'unavailable': False}
        else:
            doc = {**res, 'prevPrice': prev.get('price') if prev else None, 'unavailable': False}
        prices[k] = (doc, ver)
        writes.append(_write('prices', k, doc, ver, outdir))

    grid = {k: v[0] for k, v in prices.items() if tuple(k.split('_')) in set(combos)}
    priced = [v for v in grid.values() if v.get('price') is not None]
    best = min(priced, key=lambda v: v['price']) if priced else None

    # Alertes
    alerts = []
    last_best = settings.get('lastBest')
    target = settings.get('target')
    new = dict(settings)
    if best:
        if last_best is not None and last_best - best['price'] >= DROP:
            alerts.append(f"baisse de {last_best - best['price']} CHF")
        if target and best['price'] <= target and (settings.get('lastTargetPrice') is None or best['price'] < settings['lastTargetPrice']):
            alerts.append(f'sous le prix cible de {target} CHF')
            new['lastTargetPrice'] = best['price']
        if target and best['price'] > target:
            new['lastTargetPrice'] = None
        new['lastBest'] = best['price']
    new['lastRun'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    new['out'], new['ret'] = out, ret
    writes.append(_write('settings', 'main', new, s_ver, outdir))

    day = today
    h = load(os.path.join(state, 'history', f'{day}.json'))
    hist = {'day': day, 'trip': trip, 'best': best['price'] if best else None,
            'ref': grid.get(trip, {}).get('price')}
    writes.append(_write('history', day, hist, versions.get(f'history/{day}'), outdir))

    summary = {'searches': len(todo), 'errors': errors, 'trip': trip,
               'best': best and {k: best.get(k) for k in ('price', 'out', 'ret', 'flights')},
               'alerts': alerts}
    json.dump(writes, open(os.path.join(outdir, 'writes.json'), 'w'), indent=1)
    json.dump(summary, open(os.path.join(outdir, 'summary.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(summary, ensure_ascii=False))


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa
        return e


def _write(coll, doc_id, data, version, outdir):
    os.makedirs(os.path.join(outdir, coll), exist_ok=True)
    path = os.path.abspath(os.path.join(outdir, coll, f'{doc_id}.json'))
    json.dump(data, open(path, 'w'), ensure_ascii=False)
    w = {'op': 'set', 'collection': coll, 'doc_id': doc_id, 'file_path': path}
    if version:
        w['if_version'] = version
    return w


if __name__ == '__main__':
    main()
