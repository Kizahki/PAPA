// Stockage clé/valeur : Upstash Redis (API REST) en production, mémoire en local.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const remote = !!(url && token);

const mem = globalThis.__volMem || (globalThis.__volMem = new Map());

async function cmd(...args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
  return data.result;
}

export const hasPersistentStore = () => remote;

export async function get(key, fallback = null) {
  if (remote) {
    const v = await cmd('GET', `vol:${key}`);
    return v == null ? fallback : JSON.parse(v);
  }
  return mem.has(key) ? structuredClone(mem.get(key)) : fallback;
}

export async function set(key, value) {
  if (remote) return cmd('SET', `vol:${key}`, JSON.stringify(value));
  mem.set(key, structuredClone(value));
}

const today = () => new Date().toISOString().slice(0, 10);

// Compteur journalier (ex. actualisations manuelles), expire après 2 jours.
export async function incrDaily(name) {
  const key = `vol:${name}:${today()}`;
  if (remote) {
    const n = await cmd('INCR', key);
    if (n === 1) await cmd('EXPIRE', key, 172800);
    return n;
  }
  const n = (mem.get(key) || 0) + 1;
  mem.set(key, n);
  return n;
}

export async function peekDaily(name) {
  const key = `vol:${name}:${today()}`;
  if (remote) return Number(await cmd('GET', key)) || 0;
  return mem.get(key) || 0;
}
