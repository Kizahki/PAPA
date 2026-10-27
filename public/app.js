const $ = (s) => document.querySelector(s);
const CACHE_KEY = 'vol-asmara:status';
const SEEN_KEY = 'vol-asmara:lastSeenPrice';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const nf = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 });
const dShort = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dCol = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dDay = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', timeZone: 'UTC' });
const toDate = (iso) => new Date(iso + 'T12:00:00Z');
const fmtPrice = (n) => nf.format(n);
const fmtDur = (m) => (m ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : '');

let state = null;
let selectedKey = null; // null = le moins cher

/* ---------- Données ---------- */

function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

async function fetchStatus() {
  try {
    state = await api('/api/status');
    store(CACHE_KEY, state);
  } catch (e) {
    const cached = load(CACHE_KEY);
    if (!cached) throw e;
    state = cached;
    toast('Pas de connexion : derniers prix enregistrés.', true);
  }
}

/* ---------- Affichage ---------- */

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 6000);
}

function ago(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

function tickTo(el, to) {
  const from = Number(load(SEEN_KEY)) || 0;
  store(SEEN_KEY, to);
  if (reduceMotion || !from || from === to) { el.textContent = fmtPrice(to); return; }
  // Number ticker : défile depuis le dernier prix vu par l'utilisateur.
  const start = performance.now();
  const dur = 1100;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(2, -10 * p);
    el.textContent = fmtPrice(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function trendFor(entry) {
  const el = $('#trend');
  const prev = entry?.prevPrice;
  if (entry?.price == null || prev == null) { el.hidden = true; return; }
  const diff = entry.price - prev;
  el.hidden = false;
  el.className = 'trend ' + (diff < 0 ? 'down' : diff > 0 ? 'up' : 'flat');
  if (diff === 0) { el.textContent = 'Prix inchangé depuis le dernier relevé'; return; }
  const icon = diff < 0 ? 'i-down' : 'i-up';
  el.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${icon}"/></svg>`;
  el.append(`${diff < 0 ? 'Baisse' : 'Hausse'} de ${fmtPrice(Math.abs(diff))} CHF`);
}

function renderTicket(first) {
  const entry = selectedKey ? state.grid[selectedKey] : state.best;
  const ticket = $('#ticket');
  const isBest = !selectedKey || (state.best && selectedKey === `${state.best.out}_${state.best.ret}`);
  $('#ticketTitle').textContent = isBest ? 'Meilleur prix trouvé' : 'Prix pour ces dates';
  $('#showBest').hidden = isBest;

  if (!entry || entry.price == null) {
    $('#price').textContent = '—';
    $('#trend').hidden = true;
    const [o, r] = selectedKey ? selectedKey.split('_') : [state.trip.refOut, state.trip.refRet];
    $('#outDate').textContent = dShort.format(toDate(o));
    $('#retDate').textContent = dShort.format(toDate(r));
    $('#legs').textContent = state.lastRun
      ? 'Aucun vol EgyptAir trouvé pour ces dates au dernier relevé.'
      : 'Premier relevé en cours de préparation. Touchez le bouton d’actualisation en haut.';
    $('#updated').textContent = '';
    $('#bookBtn').href = 'https://www.egyptair.com';
    return;
  }

  if (first) {
    tickTo($('#price'), entry.price);
    ticket.classList.add('enter');
  } else {
    $('#price').textContent = fmtPrice(entry.price);
  }
  trendFor(entry);
  $('#outDate').textContent = dShort.format(toDate(entry.out));
  $('#retDate').textContent = dShort.format(toDate(entry.ret));

  const stops = entry.stops || [];
  const via = stops.map((s) => (s.id === 'CAI' ? 'Le Caire' : s.name || s.id)).join(', ');
  const parts = [];
  const viaTxt = stops.length === 1 && stops[0].id === 'CAI' ? 'au Caire' : `à ${via}`;
  parts.push(stops.length === 0 ? 'Vol direct' : stops.length === 1 ? `1 escale ${viaTxt}` : `${stops.length} escales (${via})`);
  if (entry.duration) parts.push(`${fmtDur(entry.duration)} de trajet à l’aller`);
  const leg0 = entry.legs?.[0];
  if (leg0?.fromTime) parts.push(`décollage ${leg0.fromTime.slice(-5)}`);
  $('#legs').textContent = parts.join(' · ');

  $('#bookBtn').href = entry.url || 'https://www.egyptair.com';
  $('#updated').textContent = `Relevé ${ago(entry.checkedAt || entry.at)}${entry.unavailable ? ' · plus proposé au dernier contrôle' : ''}`;
}

function renderGrid() {
  const table = $('#grid');
  const bestKey = state.best ? `${state.best.out}_${state.best.ret}` : null;
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.innerHTML = '<th class="corner" scope="col">Départ<br>Retour</th>';
  for (const r of state.retDates) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.innerHTML = `${dDay.format(toDate(r))}<br>${dCol.format(toDate(r))}`;
    hr.append(th);
  }
  head.append(hr);

  const body = document.createElement('tbody');
  for (const o of state.outDates) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.innerHTML = `${dDay.format(toDate(o))}<br>${dCol.format(toDate(o))}`;
    tr.append(th);
    for (const r of state.retDates) {
      const k = `${o}_${r}`;
      const v = state.grid[k];
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.key = k;
      if (v?.price != null) {
        b.textContent = fmtPrice(v.price);
        b.setAttribute('aria-label', `Départ ${dShort.format(toDate(o))}, retour ${dShort.format(toDate(r))} : ${fmtPrice(v.price)} francs`);
        b.setAttribute('aria-pressed', String(selectedKey === k));
        if (k === bestKey) b.classList.add('best');
      } else if (v?.noFlight) {
        b.textContent = 'Pas de vol';
        b.classList.add('none');
        b.disabled = true;
        b.setAttribute('aria-label', `Départ ${dShort.format(toDate(o))}, retour ${dShort.format(toDate(r))} : pas de vol EgyptAir`);
      } else {
        b.textContent = '…';
        b.classList.add('empty');
        b.disabled = true;
        b.setAttribute('aria-label', `Départ ${dShort.format(toDate(o))}, retour ${dShort.format(toDate(r))} : pas encore relevé`);
      }
      if (k === state.refKey) b.classList.add('ref');
      td.append(b);
      tr.append(td);
    }
    body.append(tr);
  }
  table.querySelectorAll('thead, tbody').forEach((n) => n.remove());
  table.append(head, body);
}

function renderChart() {
  const pts = (state.history || []).filter((h) => h.best != null);
  $('#historyBlock').hidden = pts.length < 2;
  if (pts.length < 2) return;
  const W = 340, H = 150, padL = 44, padR = 8, padT = 12, padB = 26;
  const target = Number(state.settings?.target) || null;
  const vals = pts.map((p) => p.best).concat(target ? [target] : []);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 40) { min -= 20; max += 20; }
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.best).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const last = pts[pts.length - 1];
  const fmtDay = (iso) => dCol.format(toDate(iso));
  $('#chart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Meilleur prix du ${fmtDay(pts[0].day)} au ${fmtDay(last.day)} : de ${fmtPrice(pts[0].best)} à ${fmtPrice(last.best)} CHF">
      <line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(max)}" y2="${y(max)}"/>
      <line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(min)}" y2="${y(min)}"/>
      <text class="axis" x="${padL - 8}" y="${y(max) + 4}" text-anchor="end">${fmtPrice(max)}</text>
      <text class="axis" x="${padL - 8}" y="${y(min) + 4}" text-anchor="end">${fmtPrice(min)}</text>
      ${target ? `<line class="target-line" x1="${padL}" x2="${W - padR}" y1="${y(target)}" y2="${y(target)}"/><text class="axis" x="${W - padR}" y="${y(target) - 6}" text-anchor="end">cible ${fmtPrice(target)}</text>` : ''}
      <path class="area" d="${area}" opacity="0.6"/>
      <path class="line" d="${d}"/>
      <circle class="dot" cx="${x(pts.length - 1)}" cy="${y(last.best)}" r="5"/>
      <text class="axis" x="${padL}" y="${H - 6}">${fmtDay(pts[0].day)}</text>
      <text class="axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${fmtDay(last.day)}</text>
    </svg>`;
}

function renderSettings() {
  const t = state.settings?.target;
  if (t && document.activeElement !== $('#target')) $('#target').value = t;
  $('#refreshBtn').disabled = state.manualLeft === 0;
  $('#refreshBtn').title = state.manualLeft === 0 ? 'Actualisations du jour utilisées' : `Encore ${state.manualLeft} actualisation(s) aujourd’hui`;
}

let tripDirty = false;
function renderTrip() {
  const o = $('#outInput'), r = $('#retInput');
  const out = state.settings?.out || state.trip.refOut, ret = state.settings?.ret || state.trip.refRet;
  if (!tripDirty && document.activeElement !== o && document.activeElement !== r) { o.value = out; r.value = ret; }
  o.min = state.today || '';
  r.min = o.value || state.today || '';
  $('#saveTrip').hidden = !tripDirty;
}

function render(first = false) {
  renderTrip();
  renderTicket(first);
  renderGrid();
  renderChart();
  renderSettings();
  renderPush();
}

/* ---------- Actions ---------- */

['#outInput', '#retInput'].forEach((id) =>
  $(id).addEventListener('input', () => {
    tripDirty = $('#outInput').value !== state.settings.out || $('#retInput').value !== state.settings.ret;
    renderTrip();
  }),
);

$('#tripForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#outInput').value, ret = $('#retInput').value;
  if (!out || !ret) return toast('Choisissez une date d’aller et une date de retour.', true);
  if (ret <= out) return toast('Le retour doit être après l’aller.', true);
  const btn = $('#saveTrip');
  btn.disabled = true;
  btn.textContent = 'Recherche du prix…';
  try {
    const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ out, ret }) });
    tripDirty = false;
    selectedKey = null;
    await fetchStatus();
    render(true);
    toast(r.result?.price != null
      ? `Dates enregistrées. Prix pour ces dates : ${fmtPrice(r.result.price)} CHF. Les dates voisines arrivent demain matin.`
      : r.result?.noFlight
        ? 'Dates enregistrées. EgyptAir ne propose pas de vol ce jour-là : regardez les dates voisines demain matin.'
        : 'Dates enregistrées. Les prix arrivent au prochain relevé, demain matin.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suivre ces dates';
    renderTrip();
  }
});

$('#grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (!b || b.disabled) return;
  selectedKey = selectedKey === b.dataset.key ? null : b.dataset.key;
  render();
  $('#ticket').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
});

$('#showBest').addEventListener('click', () => { selectedKey = null; render(); });

$('#refreshBtn').addEventListener('click', async () => {
  const btn = $('#refreshBtn');
  btn.disabled = true;
  btn.classList.add('spin');
  try {
    await api('/api/refresh', { method: 'POST' });
    await fetchStatus();
    selectedKey = null;
    render(true);
    toast('Prix mis à jour.');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.classList.remove('spin');
    renderSettings();
  }
});

document.querySelectorAll('.stepper [data-step]').forEach((b) =>
  b.addEventListener('click', () => {
    const input = $('#target');
    const base = Number(input.value) || Math.round((state?.best?.price || 1000) / 50) * 50;
    input.value = Math.max(100, base + Number(b.dataset.step));
  }),
);

$('#targetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#target').value.trim();
  try {
    const { settings } = await api('/api/settings', { method: 'POST', body: JSON.stringify({ target: v === '' ? null : Number(v) }) });
    state.settings = settings;
    renderChart();
    toast(settings.target ? `Prix cible enregistré : ${fmtPrice(settings.target)} CHF.` : 'Prix cible supprimé.');
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- Notifications ---------- */

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function renderPush() {
  const btn = $('#pushBtn');
  const help = $('#pushHelp');
  const label = btn.querySelector('span');
  $('#testPush').hidden = true;
  btn.classList.remove('on');
  btn.disabled = false;

  if (isIOS && !isStandalone) {
    btn.disabled = true;
    help.textContent = 'Sur iPhone, ajoutez d’abord l’app à l’écran d’accueil (bandeau en haut), puis ouvrez-la depuis son icône.';
    return;
  }
  if (!pushSupported) { btn.disabled = true; help.textContent = 'Ce téléphone ne permet pas les notifications depuis le navigateur.'; return; }
  if (!state?.push?.enabled) { btn.disabled = true; help.textContent = 'Alertes pas encore configurées sur le serveur.'; return; }
  if (Notification.permission === 'denied') {
    btn.disabled = true;
    help.textContent = 'Les notifications sont bloquées. Autorisez-les dans les réglages du téléphone pour cette app.';
    return;
  }
  const sub = await currentSub().catch(() => null);
  if (sub) {
    btn.classList.add('on');
    btn.querySelector('use').setAttribute('href', '#i-check');
    label.textContent = 'Alertes activées';
    $('#testPush').hidden = false;
    help.textContent = 'Touchez à nouveau pour désactiver.';
  } else {
    btn.querySelector('use').setAttribute('href', '#i-bell');
    label.textContent = 'Activer les alertes';
    help.textContent = '';
  }
}

$('#pushBtn').addEventListener('click', async () => {
  const btn = $('#pushBtn');
  btn.disabled = true;
  try {
    const existing = await currentSub();
    if (existing) {
      await api('/api/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: existing.endpoint }) });
      await existing.unsubscribe();
      toast('Alertes désactivées.');
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Autorisation refusée : les alertes restent désactivées.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(state.push.publicKey) });
      await api('/api/subscribe', { method: 'POST', body: JSON.stringify(sub) });
      toast('Alertes activées. Vous serez prévenu à chaque baisse.');
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    renderPush();
  }
});

$('#testPush').addEventListener('click', async () => {
  try {
    const r = await api('/api/test-push', { method: 'POST' });
    toast(r.sent ? 'Notification d’essai envoyée.' : 'Aucun appareil n’a reçu l’essai.', !r.sent);
  } catch (e) { toast(e.message, true); }
});

/* ---------- Installation ---------- */

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstall();
});

function showInstall() {
  if (isStandalone || load('vol-asmara:installDismissed')) return;
  const el = $('#installBanner');
  if (isIOS) {
    el.innerHTML = `<p><strong>Installer l’app sur l’iPhone</strong>Touchez <svg class="ico" aria-hidden="true"><use href="#i-share"/></svg> Partager en bas de Safari, puis «&nbsp;Sur l’écran d’accueil&nbsp;».</p>
      <button class="link-btn" type="button" data-close>J’ai compris</button>`;
  } else if (deferredPrompt) {
    el.innerHTML = `<p><strong>Installer l’app</strong>Elle s’ouvrira comme une application, avec les alertes.</p>
      <div class="alert-row"><button class="btn primary" type="button" data-install>Installer</button><button class="link-btn" type="button" data-close>Plus tard</button></div>`;
  } else return;
  el.hidden = false;
  el.querySelector('[data-close]').onclick = () => { el.hidden = true; store('vol-asmara:installDismissed', true); };
  const inst = el.querySelector('[data-install]');
  if (inst) inst.onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; el.hidden = true; };
}

/* ---------- Démarrage ---------- */

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

(async () => {
  const cached = load(CACHE_KEY);
  if (cached) { state = cached; render(false); }
  try {
    await fetchStatus();
    render(true);
    if (state.demo) toast('Mode démonstration : prix fictifs.');
  } catch (e) {
    toast('Impossible de charger les prix. Vérifiez la connexion.', true);
  }
  showInstall();
})();
