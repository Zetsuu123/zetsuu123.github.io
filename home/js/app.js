import CFG from './config.js';
import { icon, areaIcon, weatherIcon } from './icons.js';
import { makeT, WEATHER } from './i18n.js';
import { HAConnection, loadAuth, saveAuth, startLogin, handleCallback, normalizeUrl } from './ha.js';
import { DemoBackend } from './demo.js';
import { morphHTML } from './morph.js';
import { renderSections, renderCard, domainOf, canToggle } from './cards.js';

/* ---------------- language ---------------- */
const LANG = CFG.lang === 'en' ? 'en' : 'el';
const t = makeT(LANG);
const tOr = (k, fallback) => { const v = t(k); return v === k ? fallback : v; };
const LOCALE = t('locale');
document.documentElement.lang = LANG;

/* ---------------- state ---------------- */
const LS_PREFS = 'hd.prefs';
const prefs = Object.assign(
  { name: '', clock24: null, hiddenAreas: [], wakeLock: false },
  (() => { try { return JSON.parse(localStorage.getItem(LS_PREFS)) || {}; } catch { return {}; } })(),
);
const savePrefs = () => { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch { /* ignore */ } };
const clock24 = () => (prefs.clock24 == null ? LANG === 'el' : prefs.clock24);

const S = {
  backend: null,
  mode: 'demo',
  status: 'idle',
  error: '',
  entities: {},
  areas: [],
  entityArea: {},
  registryHidden: new Set(),
  config: { location_name: CFG.title || 'Home', temp_unit: '°C' },
  view: viewFromHash(),
  optimistic: {},
  pending: {},
  form: { url: '', token: '', showToken: false, busy: false },
  online: navigator.onLine,
  modal: null,
};

const app = document.getElementById('app');
const toastsEl = document.getElementById('toasts');

/* ---------------- names from config ---------------- */
const NAMES = {};
for (const r of CFG.rooms || []) for (const l of r.lights || []) if (l.name) NAMES[l.entity] = l.name;

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CONTROL_DOMAINS = ['light', 'fan', 'switch', 'cover', 'climate', 'lock'];

function ent(id) {
  const e = S.entities[id];
  const o = S.optimistic[id];
  if (!e) return null;
  if (o && o.until > Date.now()) return { ...e, state: o.state ?? e.state, attributes: { ...e.attributes, ...(o.attributes || {}) } };
  return e;
}
const entOrStub = (id) => ent(id) || { entity_id: id, state: 'unavailable', attributes: {}, stub: true };
const isUnavail = (e) => !e || e.state === 'unavailable';
function isOn(e) {
  if (!e) return false;
  switch (domainOf(e.entity_id)) {
    case 'cover': return e.state === 'open' || e.state === 'opening';
    case 'lock': return e.state === 'unlocked' || e.state === 'open';
    case 'climate': return !['off', 'unavailable', 'unknown'].includes(e.state);
    case 'vacuum': return ['cleaning', 'returning'].includes(e.state);
    case 'media_player': return !['off', 'unavailable', 'unknown', 'standby'].includes(e.state);
    default: return e.state === 'on';
  }
}
function friendly(e, areaName) {
  if (!e) return '';
  if (NAMES[e.entity_id]) return NAMES[e.entity_id];
  let n = e.attributes.friendly_name || e.entity_id.split('.')[1].replace(/_/g, ' ');
  if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + ' ') && n.length > areaName.length + 1) {
    n = n.slice(areaName.length + 1);
    n = n.charAt(0).toUpperCase() + n.slice(1);
  }
  return n;
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
function fmtNum(v, digits) {
  if (v == null || !Number.isFinite(+v)) return '–';
  v = +v;
  const d = digits ?? (Math.abs(v) >= 100 ? 0 : Number.isInteger(v) ? 0 : 1);
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: digits ?? 0 }).format(v);
}
const pctOf = (e) => (e.attributes.brightness != null ? Math.max(1, Math.round((e.attributes.brightness / 255) * 100)) : null);
const isDimmable = (e) => {
  const m = e.attributes.supported_color_modes;
  if (Array.isArray(m)) return m.some((x) => x !== 'onoff');
  return e.attributes.brightness != null;
};
function hueFor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 205 + (h % 50);
}
function tintFor(e) {
  const c = e.attributes.rgb_color;
  if (Array.isArray(c) && c.length === 3 && e.attributes.color_mode && !['color_temp', 'brightness', 'onoff'].includes(e.attributes.color_mode)) return c.join(',');
  return '255,190,92';
}
function relTime(iso) {
  const ms = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '–';
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('just_now');
  if (m < 60) return t('mins', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('hours', h);
  return t('days', Math.floor(h / 24));
}

function fmtState(e) {
  if (!e) return '';
  if (e.state === 'unavailable') return t('offline');
  const d = domainOf(e.entity_id);
  const A = e.attributes;
  const s = e.state;
  switch (d) {
    case 'sensor': case 'number': case 'input_number': {
      const v = num(s);
      if (v == null || A.device_class === 'timestamp') return A.device_class === 'timestamp' ? relTimeOrClock(s) : s;
      return `${fmtNum(v)}${A.unit_of_measurement ? ' ' + A.unit_of_measurement : ''}`;
    }
    case 'binary_sensor': {
      const on = s === 'on';
      const dc = A.device_class;
      if (['motion'].includes(dc)) return t(on ? 'motion' : 'clear');
      if (['occupancy', 'presence'].includes(dc)) return t(on ? 'occupied' : 'clear');
      if (['door', 'window', 'opening', 'garage_door'].includes(dc)) return t(on ? 'door_open' : 'door_closed');
      if (dc === 'connectivity') return t(on ? 'connected' : 'disconnected');
      if (dc === 'moisture') return on ? t('wet') : t('ok');
      if (dc === 'smoke') return on ? t('smoke') : t('ok');
      if (dc === 'problem') return on ? t('problem') : t('ok');
      return t(on ? 'on' : 'off');
    }
    case 'automation': case 'input_boolean': return t(s === 'on' ? 'active' : 'inactive');
    case 'light': case 'switch': case 'fan': return t(s === 'on' ? 'on' : 'off');
    case 'climate': return t('hvac_' + s);
    case 'cover': return tOr(s, s);
    case 'lock': return tOr(s, s);
    case 'vacuum': return tOr('vac_' + s, s);
    case 'device_tracker': case 'person': return s === 'home' ? t('home_zone') : s === 'not_home' ? t('away') : s;
    case 'media_player': return isOn(e) ? t('on') : t('off');
    default: return s;
  }
}
function relTimeOrClock(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: !clock24() });
}

// Helper handed to config functions.
const H = {
  state: (id) => entOrStub(id).state,
  is: (id, s) => (Array.isArray(s) ? s.includes(H.state(id)) : H.state(id) === s),
  on: (id) => isOn(ent(id)),
  attr: (id, a) => ent(id)?.attributes?.[a],
  num: (id, d = null) => { const v = parseFloat(H.state(id)); return Number.isFinite(v) ? v : d; },
  round: (v, d = 0) => (v == null || !Number.isFinite(+v) ? '–' : (+v).toFixed(d)),
  ago: (id) => relTime(ent(id)?.last_changed),
  time: (v) => relTimeOrClock(v),
  lightsOn: 0,
};

function viewFromHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return h || 'home';
}
function go(view) {
  if (S.view === view) return;
  S.view = view;
  const h = view === 'home' ? '' : '#/' + encodeURIComponent(view);
  history.pushState(null, '', location.pathname + h);
  render();
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'instant' });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('popstate', () => { S.view = viewFromHash(); render(); });

/* ---------------- history (sparklines) ---------------- */
const HIST = {};
const histQueue = new Map();
function getHist(id, hours) {
  const k = `${id}|${hours}`;
  const rec = HIST[k];
  const fresh = rec && Date.now() - rec.at < 300_000;
  if (!rec || (!fresh && !rec.loading)) {
    HIST[k] = { pts: rec?.pts || null, at: rec?.at || 0, loading: true };
    if (!histQueue.has(hours)) histQueue.set(hours, new Set());
    histQueue.get(hours).add(id);
  }
  return HIST[k].pts;
}
function flushHist() {
  if (!histQueue.size || !S.backend?.history || S.status !== 'connected') return;
  const jobs = [...histQueue.entries()];
  histQueue.clear();
  for (const [hours, set] of jobs) {
    const ids = [...set];
    S.backend.history(ids, hours).then((res) => {
      for (const id of ids) HIST[`${id}|${hours}`] = { pts: res[id] || [], at: Date.now(), loading: false };
      render();
    }).catch(() => {
      for (const id of ids) HIST[`${id}|${hours}`] = { pts: HIST[`${id}|${hours}`]?.pts || [], at: Date.now(), loading: false };
      render();
    });
  }
}
function appendHist(id, state) {
  const v = parseFloat(state?.state);
  if (!Number.isFinite(v)) return;
  for (const k of Object.keys(HIST)) {
    if (!k.startsWith(id + '|') || !HIST[k].pts) continue;
    const hours = +k.split('|')[1];
    const now = Date.now() / 1000;
    HIST[k].pts = [...HIST[k].pts.filter((p) => p[0] > now - hours * 3600), [now, v]];
  }
}

/* ---------------- assets & cameras ---------------- */
const hassUrl = () => S.backend?.auth?.hassUrl || '';
function asset(path) {
  if (!path) return '';
  if (/^https?:/i.test(path)) return path;
  return S.mode === 'live' && hassUrl() ? hassUrl() + path : '';
}
function camUrl(e, live) {
  const p = e?.attributes?.entity_picture;
  if (!p || S.mode !== 'live') return '';
  let u = p.startsWith('/') ? hassUrl() + p : p;
  if (live) return u.replace('/api/camera_proxy/', '/api/camera_proxy_stream/');
  return u + (u.includes('?') ? '&' : '?') + '_=' + Math.floor(Date.now() / 10_000);
}

/* ---------------- model ---------------- */
function emptyArea(base) {
  return { icon: '', picture: '', lights: [], fans: [], switches: [], covers: [], climates: [], locks: [], temps: [], hums: [], sensors: [], binaries: [], cards: [], ...base };
}
function finishArea(a) {
  const avg = (list) => {
    const v = list.filter((e) => !isUnavail(e)).map((e) => num(e.state)).filter((n) => n != null);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  };
  a.temp = avg(a.temps);
  if (a.temp == null && a.climates.length) a.temp = num(a.climates[0].attributes.current_temperature);
  a.hum = avg(a.hums);
  a.controls = [...a.lights, ...a.fans, ...a.switches, ...a.covers, ...a.climates, ...a.locks];
  a.lightsOn = a.lights.filter(isOn).length;
  a.fansOn = a.fans.filter(isOn).length;
  a.offline = a.controls.length > 0 && a.controls.every(isUnavail);
  a.empty = !a.fromConfig && a.controls.length + a.temps.length + a.hums.length + a.sensors.length + a.binaries.length === 0;
  return a;
}

function configAreas() {
  return CFG.rooms.map((r) => finishArea(emptyArea({
    id: r.id, name: r.name, icon: r.icon || '', picture: asset(r.picture), fromConfig: true, cfg: r,
    lights: (r.lights || []).map((l) => entOrStub(l.entity)),
    fans: (r.fans || []).map(entOrStub),
    temps: r.temperature ? [entOrStub(r.temperature)] : [],
    hums: r.humidity ? [entOrStub(r.humidity)] : [],
    binaries: (r.sensors || []).map(entOrStub),
    cards: r.cards || [],
  })));
}

function registryAreas() {
  const areaById = new Map();
  const areas = S.areas.map((a) => { const m = emptyArea({ ...a }); areaById.set(a.id, m); return m; });
  const other = emptyArea({ id: '_other', name: LANG === 'el' ? 'Λοιπά' : 'Other' });
  for (const id of Object.keys(S.entities)) {
    if (S.registryHidden.has(id)) continue;
    const e = ent(id);
    const d = domainOf(id);
    const area = areaById.get(S.entityArea[id]);
    const target = area || (CONTROL_DOMAINS.includes(d) ? other : null);
    if (!target) continue;
    const dc = e.attributes.device_class;
    if (d === 'light') target.lights.push(e);
    else if (d === 'fan') target.fans.push(e);
    else if (d === 'switch') target.switches.push(e);
    else if (d === 'cover') target.covers.push(e);
    else if (d === 'climate') target.climates.push(e);
    else if (d === 'lock') target.locks.push(e);
    else if (d === 'sensor' && dc === 'temperature') target.temps.push(e);
    else if (d === 'sensor' && dc === 'humidity') target.hums.push(e);
    else if (d === 'sensor' && dc && e.attributes.unit_of_measurement) target.sensors.push(e);
    else if (d === 'binary_sensor' && dc) target.binaries.push(e);
  }
  if (other.lights.length + other.fans.length + other.switches.length + other.covers.length + other.climates.length + other.locks.length) areas.push(other);
  const byName = (a, b) => friendly(a).localeCompare(friendly(b), undefined, { numeric: true });
  for (const a of areas) for (const k of ['lights', 'fans', 'switches', 'covers', 'climates', 'locks', 'temps', 'hums', 'sensors', 'binaries']) a[k].sort(byName);
  return areas.map(finishArea);
}

function buildModel() {
  const areas = CFG.rooms?.length ? configAreas() : registryAreas();
  const visible = areas.filter((a) => !a.empty && !prefs.hiddenAreas.includes(a.id));
  let weather = CFG.weather ? ent(CFG.weather) : null;
  if (!weather) weather = Object.values(S.entities).find((e) => e.entity_id.startsWith('weather.')) || null;
  H.lightsOn = visible.reduce((n, a) => n + a.lightsOn, 0);
  return { areas, visible, weather };
}

/* ---------------- actions registry (for config-driven cards) ---------------- */
let ACTS = [];
function act(spec, selfId) {
  if (!spec) return null;
  ACTS.push({ spec, selfId });
  return String(ACTS.length - 1);
}
let UID = 0;
function ctx() {
  return {
    h: H, t, tOr, esc, ent: entOrStub, isOn, isUnavail, isDimmable, friendly: (e) => friendly(e), fmtState, fmtNum,
    pct: pctOf, lightTint: tintFor, pending: S.pending, act, hist: getHist, cam: camUrl, asset,
    unit: S.config.temp_unit, uid: () => 'g' + UID++, locale: LOCALE,
  };
}

/* ---------------- rendering ---------------- */
let raf = 0;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }

function draw() {
  ACTS = [];
  UID = 0;
  const M = buildModel();
  const x = ctx();
  let main;
  if (S.view === 'settings') main = viewSettings(M);
  else if (S.view.startsWith('area:')) {
    const a = M.areas.find((z) => z.id === S.view.slice(5));
    main = a ? viewArea(a, M, x) : viewHome(M, x);
  } else if (S.view.startsWith('page:')) {
    const p = (CFG.pages || []).find((z) => z.id === S.view.slice(5));
    main = p ? viewPage(p, M, x) : viewHome(M, x);
  } else main = viewHome(M, x);
  morphHTML(app, `<div class="shell">${sidebar(M)}<main class="main" data-key="main-${esc(S.view)}">${banner()}${main}</main></div>${modal()}`);
  setTimeout(flushHist);
}

function navItem(view, ic, label, extra = '') {
  const active = S.view === view;
  return `<button class="nav-item${active ? ' active' : ''}" data-action="nav" data-view="${esc(view)}" ${active ? 'aria-current="page"' : ''} title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span>${extra}</button>`;
}

function sidebar(M) {
  const areas = M.visible.map((a) => navItem('area:' + a.id, areaIcon(a), a.name, a.lightsOn ? `<i class="dot" aria-label="${a.lightsOn}"></i>` : '')).join('');
  const pages = (CFG.pages || []).map((p) => navItem('page:' + p.id, p.icon || 'grid', p.title)).join('');
  return `<nav class="sidebar" aria-label="Main">
    <div class="brand"><span class="brand-mark">${icon('home')}</span><span class="brand-txt"><strong>${esc(CFG.title || S.config.location_name)}</strong><small>Smart Home</small></span></div>
    <div class="nav-list">${navItem('home', 'grid', t('home'))}
      <div class="nav-scroll">
        ${areas ? `<span class="nav-lbl">${t('areas')}</span>${areas}` : ''}
        ${pages ? `<span class="nav-lbl">${t('pages')}</span>${pages}` : ''}
      </div>
      ${navItem('settings', 'settings', t('settings'))}</div>
  </nav>`;
}

function banner() {
  if (S.mode === 'demo' && S.view !== 'settings') {
    return `<div class="banner">${icon('sparkle')}<span><strong>${t('demo_title')}</strong> ${t('demo_text')}</span><button class="banner-btn" data-action="nav" data-view="settings">${t('connect_ha')}</button></div>`;
  }
  if (S.mode === 'live' && S.status === 'error' && S.view !== 'settings') {
    return `<div class="banner warn">${icon('wifiOff')}<span>${esc(S.error)}</span><button class="banner-btn" data-action="nav" data-view="settings">${t('settings')}</button></div>`;
  }
  return '';
}

function modal() {
  if (!S.modal) return '';
  return `<div class="modal-bg" data-action="modal-no" data-key="modal"><div class="modal" role="alertdialog" aria-modal="true" data-action="noop">
    <span class="modal-ic">${icon('alert')}</span><p>${esc(S.modal.text)}</p>
    <div class="modal-btns"><button class="soft-btn" data-action="modal-no">${t('cancel')}</button><button class="primary-btn" data-action="modal-yes">${t('yes')}</button></div>
  </div></div>`;
}

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? t('good_night') : h < 12 ? t('good_morning') : h < 17 ? t('good_afternoon') : h < 22 ? t('good_evening') : t('good_night');
  return prefs.name ? `${g}, ${prefs.name}` : g;
}

function clockParts() {
  const d = new Date();
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: !clock24() });
  const date = d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return { time, date };
}

function statusLabel() {
  return {
    connected: S.mode === 'demo' ? t('ha_demo') : t('ha_connected'),
    connecting: t('ha_connecting'), reconnecting: t('ha_reconnecting'), error: t('ha_offline'), idle: t('ha_starting'),
  }[S.status] || t('ha_starting');
}

function statusChip() {
  const cls = { connected: 'ok', connecting: 'pending', reconnecting: 'pending', error: 'bad', idle: 'pending' }[S.status] || 'pending';
  return `<button class="chip status ${cls}" data-action="nav" data-view="settings" title="Home Assistant">${icon('home')}<span><small>${t('ha')}</small>${statusLabel()}<i class="led"></i></span></button>`;
}

function topbar(M) {
  const { time, date } = clockParts();
  const w = M.weather;
  let weather = '';
  if (w && !isUnavail(w)) {
    const tt = num(w.attributes.temperature);
    weather = `<div class="chip weather">${icon(weatherIcon(w.state), 'wx')}<span><b>${tt == null ? '–' : Math.round(tt) + (w.attributes.temperature_unit || S.config.temp_unit)}</b><small>${esc(WEATHER[LANG][w.state] || w.state)}</small></span></div>`;
  }
  const net = `<div class="chip ${S.online ? '' : 'bad'}">${icon(S.online ? 'wifi' : 'wifiOff')}<span><small>${t('network')}</small>${S.online ? t('online') : t('offline_short')}</span></div>`;
  return `<div class="top-right">
      <div class="clock"><strong>${esc(time)}</strong><span>${esc(date)}</span></div>
      ${weather}${net}${statusChip()}
    </div>`;
}

function subtitle(M) {
  const lights = H.lightsOn;
  const lit = M.visible.filter((a) => a.lightsOn).length;
  const offline = M.visible.reduce((n, a) => n + a.controls.filter(isUnavail).length, 0);
  if (S.status === 'connecting' || S.status === 'idle') return t('connecting_home');
  const parts = [];
  if (lights) parts.push(`${t('lights_on_n', lights)}${lit > 1 ? ' ' + t('across_areas', lit) : ''}`);
  if (offline) parts.push(t('offline_n', offline));
  return parts.length ? parts.join(' · ') : t('all_good');
}

function statCard(cls, ic, label, value, unit, sub, extra = '', nav = '') {
  const tag = nav ? 'button' : 'div';
  return `<${tag} class="stat"${nav ? ` data-action="nav" data-view="${esc(nav)}"` : ''}><span class="stat-ic ${cls}">${icon(ic)}</span><div><small>${esc(label)}</small><strong>${value}<em>${esc(unit)}</em></strong>${extra || `<span>${esc(sub)}</span>`}</div></${tag}>`;
}

function viewHome(M, x) {
  const A = M.visible;
  const allLights = A.flatMap((a) => a.lights);
  const allFans = A.flatMap((a) => a.fans);
  const lightsOn = H.lightsOn;
  const fansOn = allFans.filter(isOn).length;
  const unit = S.config.temp_unit;
  const avg = (l) => (l.length ? l.reduce((p, q) => p + q, 0) / l.length : null);
  const val = (id) => (id ? num(entOrStub(id).state) : null);

  // temperature & humidity: configured indoor sensor, else the average of the rooms
  const temps = A.map((a) => a.temp).filter((n) => n != null);
  const hums = A.map((a) => a.hum).filter((n) => n != null);
  const tIn = CFG.indoor?.temperature ? val(CFG.indoor.temperature) : avg(temps);
  const hIn = CFG.indoor?.humidity ? val(CFG.indoor.humidity) : avg(hums);
  const tOut = val(CFG.outdoor?.temperature);
  const hOut = val(CFG.outdoor?.humidity);
  const tSub = tOut != null ? `${t('outside')} ${fmtNum(tOut, 1)}°` : temps.length > 1 ? `${fmtNum(Math.min(...temps), 1)}° – ${fmtNum(Math.max(...temps), 1)}°` : temps.length ? t('indoor') : t('no_sensors');
  const comfort = hIn == null ? t('no_sensors') : hIn < 30 ? t('dry') : hIn > 60 ? t('humid') : t('comfortable');
  const hSub = hOut != null ? `${comfort} · ${t('outside')} ${Math.round(hOut)}%` : comfort;
  const lightPct = allLights.length ? Math.round((lightsOn / allLights.length) * 100) : 0;

  let fourth;
  if (CFG.energy?.power) {
    const p = val(CFG.energy.power);
    const day = val(CFG.energy.day);
    const month = val(CFG.energy.month);
    const parts = [day != null ? `${t('today')} ${fmtNum(day, 1)} kWh` : '', month != null ? `${t('month')} ${fmtNum(month, 0)} kWh` : ''].filter(Boolean).join(' · ');
    const cls = p == null ? 'light' : p > 3000 ? 'temp' : p > 1500 ? 'light' : 'ha';
    fourth = statCard(cls, 'bolt', t('power_now'), p == null ? '–' : fmtNum(p, 0), 'W', parts, '', CFG.energy.page ? 'page:' + CFG.energy.page : '');
  } else {
    fourth = `<button class="stat stat-ha ${S.status === 'connected' ? 'ok' : ''}" data-action="nav" data-view="settings"><span class="stat-ic ha">${icon('home')}</span><div><small>${t('ha')}</small><strong class="ha-state">${statusLabel()}<i class="led"></i></strong><span>${t('n_areas', A.length)} · ${t('n_entities', Object.keys(S.entities).length)}</span></div></button>`;
  }

  const stats = `<section class="stats">
    ${statCard('temp', 'thermo', t('temperature'), fmtNum(tIn, 1), unit, tSub)}
    ${statCard('hum', 'droplet', t('humidity'), hIn == null ? '–' : Math.round(hIn), '%', hSub)}
    ${statCard('light', 'bulb', t('lights_on'), lightsOn, `/ ${allLights.length}`, '', `<span class="meter"><i style="width:${lightPct}%"></i></span>`)}
    ${fourth}
  </section>`;

  const chips = CFG.chips?.length ? renderCard({ type: 'chips', chips: CFG.chips, key: 'home-chips' }, x) : '';
  const alerts = (CFG.alerts || []).map((a, i) => renderCard({ type: 'tile', cls: 'alert', key: 'alert' + i, ...a }, x)).join('');

  const cards = A.length
    ? A.map(areaCard).join('')
    : `<div class="empty">${icon('grid')}<p>${S.status === 'connected' ? t('no_areas') : t('loading_areas')}</p></div>`;

  const quick = CFG.quick?.length
    ? CFG.quick.map((q, i) => {
      const on = q.active ? !!safeCall(q.active) : true;
      const sub = q.sub ? safeCall(q.sub) : '';
      return `<button class="big-btn danger${i % 2 ? ' alt' : ''}" data-key="q${i}" data-act="${act(q.tap)}" ${on ? '' : 'disabled'}>${icon(q.icon || 'power')}<span>${esc(q.name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
    }).join('')
    : `<button class="big-btn danger" data-act="${act({ action: 'all-off', domain: 'light' })}" ${lightsOn ? '' : 'disabled'}>${icon('power')}<span>${t('all_lights_off')}</span><small>${lightsOn ? t('n_on', lightsOn) : t('all_off')}</small></button>
       <button class="big-btn danger alt" data-act="${act({ action: 'all-off', domain: 'fan' })}" ${fansOn ? '' : 'disabled'}>${icon('fan', fansOn ? 'spin' : '')}<span>${t('all_fans_off')}</span><small>${fansOn ? t('n_running', fansOn) : t('all_off')}</small></button>`;

  return `<header class="top">
      <div class="hello"><h1>${esc(greeting())}</h1><p>${esc(subtitle(M))}</p></div>
      ${topbar(M)}
    </header>
    ${chips ? `<div class="home-chips">${chips}</div>` : ''}
    ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
    ${stats}
    <section class="areas-sec">
      <div class="sec-head"><h2>${t('my_areas')}</h2><span>${t('n_areas', A.length)} · ${t('n_lights', allLights.length)}</span></div>
      <div class="areas">${cards}</div>
    </section>
    ${CFG.home?.length ? renderSections(CFG.home, x) : ''}
    <section class="quick">${quick}</section>`;
}
function safeCall(fn) { try { return typeof fn === 'function' ? fn(H) : fn; } catch { return null; } }

function areaStyle(a) {
  const glow = a.lights.length ? a.lightsOn / a.lights.length : 0;
  let s = `--hue:${hueFor(a.name)};--glow:${glow.toFixed(2)};`;
  if (a.picture) s += `--pic:url('${a.picture.replace(/['\\()]/g, encodeURIComponent)}');`;
  return s;
}

function areaCard(a) {
  const counts = [];
  if (a.lights.length) counts.push(t('n_lights', a.lights.length));
  if (a.fans.length) counts.push(t('n_fans', a.fans.length));
  if (a.switches.length) counts.push(t('n_switches', a.switches.length));
  if (a.covers.length) counts.push(t('n_covers', a.covers.length));
  if (a.cards?.length) counts.push(t('n_devices', a.cards.length));
  if (!counts.length && a.temps.length) counts.push(t('sensors_only'));

  const MAX = 10;
  const bulbs = a.lights.slice(0, MAX).map((l) => {
    const off = isUnavail(l);
    const on = isOn(l);
    const nm = friendly(l, a.name);
    const ic = a.cfg?.lights?.find((z) => z.entity === l.entity_id)?.icon || 'bulb';
    return `<button class="bulb${on ? ' on' : ''}${off ? ' na' : ''}" data-key="${esc(l.entity_id)}" data-action="toggle" data-entity="${esc(l.entity_id)}" ${off ? 'disabled' : ''} title="${esc(nm)}" aria-label="${esc(nm)}: ${off ? t('offline') : on ? t('on') : t('off')}" aria-pressed="${on}" style="--tint:${tintFor(l)}">${icon(ic)}</button>`;
  }).join('') + (a.lights.length > MAX ? `<span class="more">+${a.lights.length - MAX}</span>` : '');

  let fanPill = '';
  if (a.fans.length) {
    const offline = a.fans.every(isUnavail);
    fanPill = offline
      ? `<span class="pill bad">${icon('fan')}<span><small>${t('fan')}</small>${t('offline')}</span></span>`
      : `<button class="pill${a.fansOn ? ' on' : ''}" data-action="area-fans" data-area="${esc(a.id)}">${icon('fan', a.fansOn ? 'spin' : '')}<span><small>${t('fans_running')}</small>${a.fansOn}/${a.fans.length}</span></button>`;
  }
  const active = a.binaries.filter((b) => b.state === 'on');
  const climate = [
    a.temp != null ? `<span>${icon('thermo')}${fmtNum(a.temp, 1)}°</span>` : '',
    a.hum != null ? `<span>${icon('droplet')}${Math.round(a.hum)}%</span>` : '',
    ...active.slice(0, 2).map((b) => `<span class="warn">${icon(['door', 'window', 'opening'].includes(b.attributes.device_class) ? 'door' : 'activity')}${esc(fmtState(b))}</span>`),
  ].join('');
  const badge = a.offline ? `<span class="badge bad">${t('offline')}</span>` : a.lightsOn ? `<span class="badge on">${t('n_on', a.lightsOn)}</span>` : '';

  return `<article class="area-card${a.picture ? ' has-pic' : ''}${a.lightsOn ? ' lit' : ''}${a.offline ? ' offline' : ''}" data-key="area-${esc(a.id)}" style="${areaStyle(a)}" data-action="nav" data-view="area:${esc(a.id)}" tabindex="0" role="link" aria-label="${esc(t('open_area', a.name))}">
    <div class="area-art" aria-hidden="true">${icon(areaIcon(a))}</div>
    <div class="area-top">
      <span class="area-ic">${icon(areaIcon(a))}</span>
      <div class="area-title"><h3>${esc(a.name)}</h3><p>${esc(counts.join(' · ') || t('no_devices'))}</p></div>
      ${badge}
      <span class="open">${icon('arrowUpRight')}</span>
    </div>
    ${climate ? `<div class="area-climate">${climate}</div>` : ''}
    <div class="area-bottom">
      <div class="bulbs">${bulbs}</div>
      ${fanPill}
    </div>
  </article>`;
}

/* ---- area view ---- */
function viewArea(a, M, x) {
  const parts = [];
  if (a.lights.length) parts.push(t('lights_of', a.lightsOn, a.lights.length));
  if (a.fans.length) parts.push(`${a.fansOn}/${a.fans.length} ${t('fans').toLowerCase()}`);
  const chip = (ic, txt, cls = '') => `<span class="hchip${cls}">${icon(ic)}${esc(txt)}</span>`;
  const chips = [
    a.temp != null ? chip('thermo', `${fmtNum(a.temp, 1)}${S.config.temp_unit}`) : '',
    a.hum != null ? chip('droplet', `${Math.round(a.hum)}%`) : '',
    ...a.binaries.map((b) => {
      const dc = b.attributes.device_class;
      return chip(['motion', 'occupancy', 'presence'].includes(dc) ? 'activity' : ['door', 'window', 'opening', 'garage_door'].includes(dc) ? 'door' : 'gauge', `${friendly(b, a.name)}: ${fmtState(b)}`, b.state === 'on' ? ' alert' : '');
    }),
  ].join('');
  const anyOn = a.lightsOn > 0;

  let sections;
  if (a.fromConfig) {
    const lightCards = (a.cfg.lights || []).map((l) => (domainOf(l.entity) === 'light'
      ? { type: 'light', entity: l.entity, name: l.name, icon: l.icon }
      : { type: 'tile', entity: l.entity, name: l.name, icon: l.icon || 'bulb', color: 'amber', tap: 'toggle' }));
    sections = [
      { title: t('lights'), icon: 'bulb', cols: lightCards.some((c) => c.type === 'light') ? 1 : 2, cards: lightCards },
      { title: t('devices'), icon: 'plug', cards: a.cards },
      { title: t('sensors'), icon: 'gauge', cols: 3, cards: [...a.temps, ...a.hums].map((e) => ({ type: 'sensor', entity: e.entity_id })) },
    ];
  } else {
    sections = [
      { title: t('climate'), cards: a.climates.map((c) => ({ type: 'climate', entity: c.entity_id })) },
      { title: t('lights'), cards: a.lights.map((l) => ({ type: 'light', entity: l.entity_id, name: friendly(l, a.name) })) },
      { title: t('fans'), cards: a.fans.map((f) => ({ type: 'fan', entity: f.entity_id, name: friendly(f, a.name) })) },
      { title: t('switches'), cards: a.switches.map((s) => ({ type: 'tile', entity: s.entity_id, name: friendly(s, a.name) })) },
      { title: t('covers'), cards: a.covers.map((c) => ({ type: 'cover', entity: c.entity_id, name: friendly(c, a.name) })) },
      { title: t('locks'), cards: a.locks.map((l) => ({ type: 'tile', entity: l.entity_id, name: friendly(l, a.name), tap: 'toggle' })) },
      { title: t('sensors'), cols: 3, cards: [...a.temps, ...a.hums, ...a.sensors].map((s) => ({ type: 'sensor', entity: s.entity_id, name: friendly(s, a.name) })) },
    ];
  }
  const body = renderSections(sections, x);

  return `<header class="area-head">
      <button class="back" data-action="nav" data-view="home" aria-label="${t('back')}">${icon('chevronLeft')}</button>
      <div class="hello"><h1>${esc(a.name)}</h1><p>${esc(parts.join(' · ') || t('area_overview'))}</p></div>
      ${topbar(M)}
    </header>
    <div class="area-hero${a.picture ? ' has-pic' : ''}${a.lightsOn ? ' lit' : ''}" style="${areaStyle(a)}">
      <div class="area-art" aria-hidden="true">${icon(areaIcon(a))}</div>
      <div class="hero-chips">${chips || `<span class="hchip muted">${t('no_area_sensors')}</span>`}</div>
      ${a.lights.length ? `<div class="hero-actions">
        <button class="soft-btn" data-action="area-lights" data-area="${esc(a.id)}" data-on="1">${icon('bulb')}${t('all_on_btn')}</button>
        <button class="soft-btn ${anyOn ? 'danger' : ''}" data-action="area-lights" data-area="${esc(a.id)}" data-on="0" ${anyOn ? '' : 'disabled'}>${icon('power')}${t('all_off_btn')}</button>
      </div>` : ''}
    </div>
    ${body.includes('class="sect') ? body : `<div class="empty">${icon('grid')}<p>${t('no_devices_area')}</p></div>`}`;
}

/* ---- config pages ---- */
function viewPage(p, M, x) {
  const sub = typeof p.subtitle === 'function' ? safeCall(p.subtitle) : p.subtitle;
  return `<header class="top">
      <div class="hello"><h1>${esc(p.title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      ${topbar(M)}
    </header>
    ${p.chips?.length ? `<div class="home-chips">${renderCard({ type: 'chips', chips: p.chips, key: 'page-chips' }, x)}</div>` : ''}
    ${renderSections(p.sections, x)}`;
}

/* ---- settings ---- */
function viewSettings(M) {
  const live = S.mode === 'live';
  const auth = S.backend?.auth;
  const statusText = {
    connected: live ? t('st_connected', auth?.hassUrl) : t('st_demo'),
    connecting: t('st_connecting'), reconnecting: t('st_reconnecting'), error: S.error || t('st_idle'), idle: t('st_idle'),
  }[S.status];
  const insecure = location.protocol === 'https:' && /^http:/i.test(normalizeUrl(S.form.url));
  const sameOrigin = location.pathname.includes('/local/');

  const connect = live
    ? `<div class="row"><div><strong>${esc(auth?.hassUrl || '')}</strong><small>${auth?.method === 'oauth' ? t('via_oauth') : t('via_token')}${S.config.version ? ` · Home Assistant ${esc(S.config.version)}` : ''}</small></div>
         <button class="soft-btn danger" data-action="logout">${icon('logout')}${t('disconnect')}</button></div>`
    : `<form class="connect" data-action="connect-form" autocomplete="on">
        <label class="field"><span>${t('ha_url')}</span>
          <input type="url" inputmode="url" data-field="url" placeholder="http://homeassistant.local:8123" value="${esc(S.form.url)}" autocomplete="url" required></label>
        ${insecure ? `<p class="note warn">${icon('wifiOff')}${t('insecure_note')}</p>` : ''}
        <div class="btn-row">
          <button type="submit" class="primary-btn" ${S.form.busy ? 'disabled' : ''}>${icon('home')}${t('sign_in')}</button>
          <button type="button" class="link-btn" data-action="toggle-token">${S.form.showToken ? t('hide_token') : t('use_token')}</button>
        </div>
        ${S.form.showToken ? `<label class="field"><span>${t('token_label')}</span>
          <textarea data-field="token" rows="3" placeholder="${esc(t('token_ph'))}" spellcheck="false">${esc(S.form.token)}</textarea></label>
          <div class="btn-row"><button type="button" class="soft-btn" data-action="connect-token" ${S.form.busy ? 'disabled' : ''}>${icon('check')}${t('connect_token')}</button></div>` : ''}
        ${sameOrigin ? '' : `<p class="note">${t('cors_note', esc(location.origin))}</p>`}
      </form>`;

  const areaRows = M.areas.filter((a) => !a.empty).map((a) => {
    const shown = !prefs.hiddenAreas.includes(a.id);
    return `<button class="area-row${shown ? '' : ' off'}" data-key="ar-${esc(a.id)}" data-action="toggle-area" data-area="${esc(a.id)}" aria-pressed="${shown}">
      <span class="area-ic sm">${icon(areaIcon(a))}</span><span>${esc(a.name)}</span><small>${t('n_lights', a.lights.length)}</small>${icon(shown ? 'eye' : 'eyeOff')}</button>`;
  }).join('');

  const canWake = 'wakeLock' in navigator;
  return `<header class="top">
      <div class="hello"><h1>${t('settings')}</h1><p>${t('settings_sub')}</p></div>
      ${topbar(M)}
    </header>
    <div class="settings">
      <section class="card">
        <div class="card-head"><span class="stat-ic ha">${icon('home')}</span><div><h2>Home Assistant</h2><p class="st ${S.status}"><i class="led"></i>${esc(statusText)}</p></div></div>
        ${connect}
        ${live ? `<button class="link-btn" data-action="demo">${t('switch_demo')}</button>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><span class="stat-ic light">${icon('monitor')}</span><div><h2>${t('display')}</h2><p>${t('display_sub')}</p></div></div>
        <label class="field"><span>${t('your_name')}</span><input type="text" data-field="name" value="${esc(prefs.name)}" placeholder="${t('optional')}" maxlength="40"></label>
        <div class="row"><div><strong>${t('clock24')}</strong><small>${t('clock24_sub')}</small></div><button class="toggle${clock24() ? ' on' : ''}" data-action="pref" data-pref="clock24" aria-pressed="${clock24()}"><i></i></button></div>
        <div class="row"><div><strong>${t('wake')}</strong><small>${canWake ? t('wake_sub') : t('wake_no')}</small></div><button class="toggle${prefs.wakeLock ? ' on' : ''}" data-action="pref" data-pref="wakeLock" aria-pressed="${prefs.wakeLock}" ${canWake ? '' : 'disabled'}><i></i></button></div>
        <div class="row"><div><strong>${t('fullscreen')}</strong><small>${t('fullscreen_sub')}</small></div><button class="soft-btn" data-action="fullscreen">${icon('maximize')}${document.fullscreenElement ? t('exit') : t('enter')}</button></div>
      </section>
      <section class="card wide">
        <div class="card-head"><span class="stat-ic hum">${icon('grid')}</span><div><h2>${t('areas')}</h2><p>${t('areas_sub')}</p></div></div>
        <div class="area-list">${areaRows || `<p class="muted">${t('no_areas_yet')}</p>`}</div>
      </section>
    </div>`;
}

/* ---------------- toasts ---------------- */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  toastsEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

/* ---------------- actions ---------------- */
function optimistic(id, state, attributes) {
  S.optimistic[id] = { state, attributes, until: Date.now() + 4000 };
  render();
  setTimeout(() => { if (S.optimistic[id] && S.optimistic[id].until <= Date.now()) { delete S.optimistic[id]; render(); } }, 4100);
}

async function call(domain, service, data, entityIds) {
  if (!S.backend) return;
  try {
    await S.backend.callService(domain, service, data || {}, entityIds ? { entity_id: entityIds } : undefined);
  } catch (err) {
    for (const id of [].concat(entityIds || [])) delete S.optimistic[id];
    render();
    toast(err.message || t('action_failed'), 'bad');
  }
}

function toggleEntity(id) {
  const e = ent(id);
  if (!e || isUnavail(e)) return;
  const d = domainOf(id);
  if (d === 'lock') {
    const unlock = e.state === 'locked';
    optimistic(id, unlock ? 'unlocking' : 'locking');
    return call('lock', unlock ? 'unlock' : 'lock', {}, [id]);
  }
  if (d === 'cover') return call('cover', 'toggle', {}, [id]);
  if (d === 'button') return call('button', 'press', {}, [id]);
  if (d === 'script' || d === 'scene') return call(d, 'turn_on', {}, [id]);
  const on = isOn(e);
  if (canToggle(id)) optimistic(id, on ? 'off' : 'on');
  call(d, on ? 'turn_off' : 'turn_on', {}, [id]);
}

function groupCall(entities, service) {
  const by = {};
  for (const e of entities) (by[domainOf(e.entity_id)] ||= []).push(e.entity_id);
  for (const [d, ids] of Object.entries(by)) {
    ids.forEach((id) => optimistic(id, service === 'turn_off' ? 'off' : 'on'));
    call(d, service, {}, ids);
  }
}

function allOff(entities) {
  const live = entities.filter((e) => isOn(e) && !isUnavail(e));
  if (!live.length) return;
  groupCall(live, 'turn_off');
  toast(t('turned_off_n', live.length));
}

function confirmThen(text, fn) {
  S.modal = { text, run: fn };
  render();
}

function runAction(a) {
  if (!a) return;
  const spec = typeof a.spec === 'string' ? { action: a.spec } : a.spec;
  const self = a.selfId;
  const exec = () => {
    if (spec.nav) return go(spec.nav);
    if (spec.action === 'toggle') return toggleEntity(spec.entity || self);
    if (spec.action === 'all-off') {
      const M = buildModel();
      return allOff(M.visible.flatMap((z) => (spec.domain === 'fan' ? z.fans : z.lights)));
    }
    if (spec.service) {
      const [d, svc] = spec.service.split('.');
      const target = spec.target == null ? undefined : spec.target === 'self' ? [self] : [].concat(spec.target);
      if (spec.optimistic && self) optimistic(self, spec.optimistic.state, spec.optimistic.attributes);
      call(d, svc, spec.data || {}, target);
      if (spec.toast) toast(spec.toast);
    }
  };
  if (spec.confirm) confirmThen(spec.confirm, exec);
  else exec();
}

let holdTimer = 0;
let holdFired = false;
app.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('[data-hold]');
  if (ev.target.matches('input.slider')) ev.target.dataset.dragging = '1';
  if (!el) return;
  holdFired = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { holdFired = true; navigator.vibrate?.(30); runAction(ACTS[+el.dataset.hold]); }, 600);
});
for (const evName of ['pointerup', 'pointercancel', 'pointerleave']) app.addEventListener(evName, () => clearTimeout(holdTimer), true);

app.addEventListener('click', (ev) => {
  if (holdFired) { holdFired = false; ev.preventDefault(); return; }
  const actEl = ev.target.closest('[data-act]');
  const el = ev.target.closest('[data-action]');
  // The innermost of the two wins.
  if (actEl && (!el || el.contains(actEl))) {
    if (actEl.disabled) return;
    runAction(ACTS[+actEl.dataset.act]);
    return;
  }
  if (!el || el.disabled || !app.contains(el)) return;
  const action = el.dataset.action;
  if (action === 'connect-form' || action === 'noop') return;
  const areaOf = (id) => buildModel().areas.find((z) => z.id === id);

  switch (action) {
    case 'nav': go(el.dataset.view); break;
    case 'toggle': toggleEntity(el.dataset.entity); break;
    case 'modal-yes': { const m = S.modal; S.modal = null; render(); m?.run(); break; }
    case 'modal-no': S.modal = null; render(); break;
    case 'area-lights': {
      const a = areaOf(el.dataset.area);
      if (!a) break;
      if (el.dataset.on === '1') groupCall(a.lights.filter((l) => !isOn(l) && !isUnavail(l)), 'turn_on');
      else allOff(a.lights);
      break;
    }
    case 'area-fans': {
      const a = areaOf(el.dataset.area);
      if (!a) break;
      const live = a.fans.filter((f) => !isUnavail(f));
      if (a.fansOn) allOff(live); else groupCall(live, 'turn_on');
      break;
    }
    case 'hvac': optimistic(el.dataset.entity, el.dataset.mode); call('climate', 'set_hvac_mode', { hvac_mode: el.dataset.mode }, [el.dataset.entity]); break;
    case 'temp-step': stepTemp(el.dataset.entity, +el.dataset.step); break;
    case 'toggle-token': S.form.showToken = !S.form.showToken; render(); break;
    case 'connect-token': connectWithToken(); break;
    case 'logout': logout(); break;
    case 'demo': startDemo(); toast(t('demo_loaded')); break;
    case 'pref': {
      const k = el.dataset.pref;
      prefs[k] = k === 'clock24' ? !clock24() : !prefs[k];
      savePrefs();
      if (k === 'wakeLock') applyWakeLock();
      render();
      break;
    }
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => toast(t('fs_na'), 'bad'));
      break;
    case 'toggle-area': {
      const id = el.dataset.area;
      prefs.hiddenAreas = prefs.hiddenAreas.includes(id) ? prefs.hiddenAreas.filter((z) => z !== id) : [...prefs.hiddenAreas, id];
      savePrefs();
      render();
      break;
    }
    default: break;
  }
});

app.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('article[data-action]')) {
    ev.preventDefault();
    ev.target.click();
  }
  if (ev.key === 'Escape' && S.modal) { S.modal = null; render(); }
});

const tempTimers = {};
function stepTemp(id, dir) {
  const e = ent(id);
  if (!e) return;
  const step = num(e.attributes.target_temp_step) || (S.config.temp_unit === '°F' ? 1 : 0.5);
  const cur = S.pending[id] ?? num(e.attributes.temperature) ?? 20;
  const min = num(e.attributes.min_temp) ?? 5;
  const max = num(e.attributes.max_temp) ?? 35;
  const next = Math.min(max, Math.max(min, Math.round((cur + dir * step) / step) * step));
  S.pending[id] = next;
  render();
  clearTimeout(tempTimers[id]);
  tempTimers[id] = setTimeout(async () => {
    await call('climate', 'set_temperature', { temperature: next }, [id]);
    setTimeout(() => { if (S.pending[id] === next) { delete S.pending[id]; render(); } }, 2500);
  }, 700);
}

// Sliders: live preview while dragging, send on release.
app.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.matches('input.slider')) {
    const v = +el.value;
    S.pending[el.dataset.entity] = v;
    el.style.setProperty('--pct', (((v - +el.min) / ((+el.max - +el.min) || 1)) * 100) + '%');
    const small = el.closest('.tile')?.querySelector('.tile-txt small');
    if (small) {
      const a = el.dataset.action;
      small.textContent = a === 'brightness' ? `${t('on')} · ${v}%` : a === 'fan-speed' ? (v ? `${t('running')} · ${v}%` : t('off'))
        : a === 'cover-pos' ? `${t('position')} · ${v}%` : `${fmtNum(v)}${el.dataset.unit ? ' ' + el.dataset.unit : ''}`;
    }
    return;
  }
  if (el.dataset.field === 'name') { prefs.name = el.value.trim(); savePrefs(); render(); }
  else if (el.dataset.field === 'url') { S.form.url = el.value; render(); }
  else if (el.dataset.field === 'token') { S.form.token = el.value; }
});
app.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el.matches('input.slider')) return;
  delete el.dataset.dragging;
  const id = el.dataset.entity;
  const v = +el.value;
  S.pending[id] = v;
  const a = el.dataset.action;
  if (a === 'brightness') {
    optimistic(id, 'on', { brightness: Math.round(v * 2.55) });
    call('light', 'turn_on', { brightness_pct: v }, [id]);
  } else if (a === 'fan-speed') {
    optimistic(id, v ? 'on' : 'off', { percentage: v });
    call('fan', v ? 'set_percentage' : 'turn_off', v ? { percentage: v } : {}, [id]);
  } else if (a === 'cover-pos') {
    optimistic(id, v > 0 ? 'open' : 'closed', { current_position: v });
    call('cover', 'set_cover_position', { position: v }, [id]);
  } else if (a === 'number') {
    optimistic(id, String(v));
    call(domainOf(id), 'set_value', { value: v }, [id]);
  }
  setTimeout(() => { if (S.pending[id] === v) { delete S.pending[id]; render(); } }, 3000);
});
app.addEventListener('pointerup', (ev) => { if (ev.target.matches('input.slider')) delete ev.target.dataset.dragging; });

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const url = normalizeUrl(S.form.url);
  if (!url) { toast(t('enter_url'), 'bad'); return; }
  try { localStorage.setItem('hd.lastUrl', url); } catch { /* ignore */ }
  S.form.busy = true;
  render();
  startLogin(url);
});

/* ---------------- backends ---------------- */
const callbacks = {
  onStatus(status, error = '', code = '') {
    S.status = status;
    if (status === 'error') S.error = error; else if (status === 'connected') S.error = '';
    if (status === 'error' && code === 'auth') {
      saveAuth(null);
      toast(error, 'bad');
      S.form.url = S.backend?.auth?.hassUrl || S.form.url;
      S.view = 'settings';
      setTimeout(startDemo);
      return;
    }
    render();
  },
  onSnapshot(snap) {
    Object.assign(S, snap);
    render();
  },
  onState(id, state) {
    if (state) S.entities[id] = state; else delete S.entities[id];
    delete S.optimistic[id];
    appendHist(id, state);
    render();
  },
};

function useBackend(b, mode) {
  if (S.backend) S.backend.close();
  S.backend = b;
  S.mode = mode;
  S.entities = {};
  S.areas = [];
  S.optimistic = {};
  S.pending = {};
  for (const k of Object.keys(HIST)) delete HIST[k];
  S.status = 'connecting';
  b.connect();
  render();
}

function startDemo() { useBackend(new DemoBackend(CFG, callbacks), 'demo'); }
function startLive(auth) { useBackend(new HAConnection(auth, callbacks), 'live'); }

function connectWithToken() {
  const url = normalizeUrl(S.form.url);
  const token = S.form.token.trim();
  if (!url || !token) { toast(t('enter_both'), 'bad'); return; }
  const auth = { hassUrl: url, method: 'token', access_token: token };
  saveAuth(auth);
  try { localStorage.setItem('hd.lastUrl', url); } catch { /* ignore */ }
  S.form.token = '';
  S.form.showToken = false;
  startLive(auth);
  go('home');
}

function logout() {
  saveAuth(null);
  S.form.url = S.backend?.auth?.hassUrl || S.form.url;
  startDemo();
  toast(t('disconnected_toast'));
}

/* ---------------- device niceties ---------------- */
let wakeLock = null;
async function applyWakeLock() {
  try {
    if (prefs.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* denied */ }
}
document.addEventListener('visibilitychange', applyWakeLock);
document.addEventListener('fullscreenchange', render);
window.addEventListener('online', () => { S.online = true; render(); });
window.addEventListener('offline', () => { S.online = false; render(); });
// Keep the clock, relative times and camera snapshots current.
setInterval(render, 15_000);
setInterval(() => { if (document.visibilityState === 'visible' && document.querySelector('.cam img')) render(); }, 10_000);

/* ---------------- boot ---------------- */
(async function boot() {
  try { S.form.url = localStorage.getItem('hd.lastUrl') || ''; } catch { /* ignore */ }
  if (!S.form.url && location.pathname.includes('/local/')) S.form.url = location.origin;
  let auth = null;
  try {
    auth = await handleCallback();
    if (auth) toast(t('signed_in'));
  } catch (err) {
    S.view = 'settings';
    toast(err.message, 'bad');
  }
  auth = auth || loadAuth();
  if (auth && auth.hassUrl && auth.access_token) startLive(auth);
  else startDemo();
  applyWakeLock();
})();

