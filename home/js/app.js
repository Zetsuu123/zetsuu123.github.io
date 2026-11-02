import { icon, areaIcon, weatherIcon, WEATHER_LABEL } from './icons.js';
import { HAConnection, loadAuth, saveAuth, startLogin, handleCallback, normalizeUrl } from './ha.js';
import { DemoBackend } from './demo.js';
import { morphHTML } from './morph.js';

/* ---------------- state ---------------- */
const LS_PREFS = 'hd.prefs';
const prefs = Object.assign(
  { name: '', clock24: false, hiddenAreas: [], wakeLock: false },
  (() => { try { return JSON.parse(localStorage.getItem(LS_PREFS)) || {}; } catch { return {}; } })(),
);
const savePrefs = () => { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch { /* ignore */ } };

const S = {
  backend: null,
  mode: 'demo',
  status: 'idle',
  error: '',
  entities: {},
  areas: [],
  entityArea: {},
  registryHidden: new Set(),
  config: { location_name: 'Home', temp_unit: '°C' },
  view: viewFromHash(),
  optimistic: {},
  pending: {},
  form: { url: '', token: '', showToken: false, busy: false },
  online: navigator.onLine,
};

const app = document.getElementById('app');
const toastsEl = document.getElementById('toasts');

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const domainOf = (id) => id.split('.')[0];
const CONTROL_DOMAINS = ['light', 'fan', 'switch', 'cover', 'climate', 'lock'];

function ent(id) {
  const e = S.entities[id];
  const o = S.optimistic[id];
  if (!e) return null;
  if (o && o.until > Date.now()) return { ...e, state: o.state ?? e.state, attributes: { ...e.attributes, ...(o.attributes || {}) } };
  return e;
}
const isUnavail = (e) => !e || e.state === 'unavailable';
function isOn(e) {
  if (!e) return false;
  switch (domainOf(e.entity_id)) {
    case 'cover': return e.state === 'open' || e.state === 'opening';
    case 'lock': return e.state === 'unlocked' || e.state === 'open';
    case 'climate': return e.state !== 'off' && e.state !== 'unavailable';
    default: return e.state === 'on';
  }
}
function friendly(e, areaName) {
  let n = e.attributes.friendly_name || e.entity_id.split('.')[1].replace(/_/g, ' ');
  if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + ' ') && n.length > areaName.length + 1) {
    n = n.slice(areaName.length + 1);
    n = n.charAt(0).toUpperCase() + n.slice(1);
  }
  return n;
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 1) => (n == null ? '–' : (Math.round(n * 10 ** d) / 10 ** d).toFixed(d));
const pctOf = (e) => (e.attributes.brightness != null ? Math.max(1, Math.round((e.attributes.brightness / 255) * 100)) : null);
const isDimmable = (e) => {
  const m = e.attributes.supported_color_modes;
  if (Array.isArray(m)) return m.some((x) => x !== 'onoff');
  return e.attributes.brightness != null;
};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
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
}
window.addEventListener('popstate', () => { S.view = viewFromHash(); render(); });

/* ---------------- model ---------------- */
function buildModel() {
  const areaById = new Map();
  const areas = S.areas.map((a) => {
    const m = { ...a, lights: [], fans: [], switches: [], covers: [], climates: [], locks: [], temps: [], hums: [], sensors: [], binaries: [] };
    areaById.set(a.id, m);
    return m;
  });
  const other = { id: '_other', name: 'Other', icon: '', picture: '', lights: [], fans: [], switches: [], covers: [], climates: [], locks: [], temps: [], hums: [], sensors: [], binaries: [] };
  let weather = null;

  for (const id of Object.keys(S.entities)) {
    if (S.registryHidden.has(id)) continue;
    const e = ent(id);
    const d = domainOf(id);
    if (d === 'weather') { if (!weather) weather = e; continue; }
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
  for (const a of areas) {
    for (const k of ['lights', 'fans', 'switches', 'covers', 'climates', 'locks', 'temps', 'hums', 'sensors', 'binaries']) a[k].sort(byName);
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
    a.empty = a.controls.length + a.temps.length + a.hums.length + a.sensors.length + a.binaries.length === 0;
  }
  const visible = areas.filter((a) => !a.empty && !prefs.hiddenAreas.includes(a.id));
  return { areas, visible, weather };
}

/* ---------------- rendering ---------------- */
let raf = 0;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }

function draw() {
  const M = buildModel();
  let main;
  if (S.view === 'settings') main = viewSettings(M);
  else if (S.view.startsWith('area:')) {
    const a = M.areas.find((x) => x.id === S.view.slice(5));
    main = a ? viewArea(a, M) : viewHome(M);
  } else main = viewHome(M);
  morphHTML(app, `<div class="shell">${sidebar(M)}<main class="main" data-key="main-${esc(S.view)}">${banner()}${main}</main></div>`);
}

function navItem(view, ic, label, extra = '') {
  const active = S.view === view;
  return `<button class="nav-item${active ? ' active' : ''}" data-action="nav" data-view="${esc(view)}" ${active ? 'aria-current="page"' : ''} title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span>${extra}</button>`;
}

function sidebar(M) {
  const areas = M.visible.map((a) => {
    const on = a.lightsOn ? `<i class="dot" aria-label="${a.lightsOn} on"></i>` : '';
    return navItem('area:' + a.id, areaIcon(a), a.name, on);
  }).join('');
  return `<nav class="sidebar" aria-label="Main">
    <div class="brand"><span class="brand-mark">${icon('home')}</span><span class="brand-txt"><strong>${esc(S.config.location_name)}</strong><small>Smart Home</small></span></div>
    <div class="nav-list">${navItem('home', 'grid', 'Home')}<div class="nav-areas">${areas}</div>${navItem('settings', 'settings', 'Settings')}</div>
    <div class="side-foot"><span>A smarter</span><span>tomorrow</span><i></i></div>
  </nav>`;
}

function banner() {
  if (S.mode === 'demo' && S.view !== 'settings') {
    return `<div class="banner">${icon('sparkle')}<span><strong>Demo mode.</strong> You're looking at a simulated home.</span><button class="banner-btn" data-action="nav" data-view="settings">Connect Home Assistant</button></div>`;
  }
  if (S.mode === 'live' && S.status === 'error' && S.view !== 'settings') {
    return `<div class="banner warn">${icon('wifiOff')}<span>${esc(S.error)}</span><button class="banner-btn" data-action="nav" data-view="settings">Settings</button></div>`;
  }
  return '';
}

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  return prefs.name ? `${g}, ${prefs.name}` : g;
}

function clockParts() {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !prefs.clock24 });
  const date = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return { time, date };
}

function statusChip() {
  const map = {
    connected: ['ok', S.mode === 'demo' ? 'Demo' : 'Connected'],
    connecting: ['pending', 'Connecting'],
    reconnecting: ['pending', 'Reconnecting'],
    error: ['bad', 'Offline'],
    idle: ['pending', 'Starting'],
  };
  const [cls, label] = map[S.status] || map.idle;
  return `<button class="chip status ${cls}" data-action="nav" data-view="settings" title="Home Assistant connection">${icon('home')}<span><small>Home Assistant</small>${label}<i class="led"></i></span></button>`;
}

function topbar(M) {
  const { time, date } = clockParts();
  const w = M.weather;
  let weather = '';
  if (w && !isUnavail(w)) {
    const t = num(w.attributes.temperature);
    weather = `<div class="chip weather">${icon(weatherIcon(w.state), 'wx')}<span><b>${t == null ? '–' : Math.round(t) + (w.attributes.temperature_unit || S.config.temp_unit)}</b><small>${esc(WEATHER_LABEL[w.state] || w.state)}</small></span></div>`;
  }
  const net = `<div class="chip ${S.online ? '' : 'bad'}">${icon(S.online ? 'wifi' : 'wifiOff')}<span><small>Network</small>${S.online ? 'Online' : 'Offline'}</span></div>`;
  return `<div class="top-right">
      <div class="clock"><strong>${esc(time)}</strong><span>${esc(date)}</span></div>
      ${weather}${net}${statusChip()}
    </div>`;
}

function subtitle(M) {
  const lights = M.visible.reduce((n, a) => n + a.lightsOn, 0);
  const lit = M.visible.filter((a) => a.lightsOn).length;
  const offline = M.visible.reduce((n, a) => n + a.controls.filter(isUnavail).length, 0);
  if (S.status === 'connecting' || S.status === 'idle') return 'Connecting to your home…';
  const parts = [];
  if (lights) parts.push(`${plural(lights, 'light')} on${lit > 1 ? ` across ${lit} areas` : ''}`);
  if (offline) parts.push(`${plural(offline, 'device')} offline`);
  return parts.length ? parts.join(' · ') : 'Everything is under control';
}

function viewHome(M) {
  const A = M.visible;
  const allLights = A.flatMap((a) => a.lights);
  const allFans = A.flatMap((a) => a.fans);
  const lightsOn = allLights.filter(isOn).length;
  const fansOn = allFans.filter(isOn).length;
  const temps = A.map((a) => a.temp).filter((n) => n != null);
  const hums = A.map((a) => a.hum).filter((n) => n != null);
  const avg = (l) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : null);
  const tAvg = avg(temps);
  const hAvg = avg(hums);
  const unit = S.config.temp_unit;
  const range = temps.length > 1 ? `${fmt(Math.min(...temps))}° – ${fmt(Math.max(...temps))}°` : temps.length ? 'Indoor' : 'No sensors';
  const comfort = hAvg == null ? 'No sensors' : hAvg < 30 ? 'Dry' : hAvg > 60 ? 'Humid' : 'Comfortable';
  const lightPct = allLights.length ? Math.round((lightsOn / allLights.length) * 100) : 0;
  const entCount = Object.keys(S.entities).length;

  const stats = `<section class="stats">
    <div class="stat"><span class="stat-ic temp">${icon('thermo')}</span><div><small>Temperature</small><strong>${fmt(tAvg)}<em>${esc(unit)}</em></strong><span>${esc(range)}</span></div></div>
    <div class="stat"><span class="stat-ic hum">${icon('droplet')}</span><div><small>Humidity</small><strong>${tAvgOr(hAvg)}<em>%</em></strong><span>${comfort}</span></div></div>
    <div class="stat"><span class="stat-ic light">${icon('bulb')}</span><div><small>Lights on</small><strong>${lightsOn}<em>/ ${allLights.length}</em></strong><span class="meter"><i style="width:${lightPct}%"></i></span></div></div>
    <button class="stat stat-ha ${S.status === 'connected' ? 'ok' : ''}" data-action="nav" data-view="settings"><span class="stat-ic ha">${icon('home')}</span><div><small>Home Assistant</small><strong class="ha-state">${S.status === 'connected' ? (S.mode === 'demo' ? 'Demo' : 'Connected') : S.status === 'error' ? 'Offline' : 'Connecting'}<i class="led"></i></strong><span>${plural(A.length, 'area')} · ${plural(entCount, 'entity', 'entities')}</span></div></button>
  </section>`;

  const cards = A.length
    ? A.map(areaCard).join('')
    : `<div class="empty">${icon('grid')}<p>${S.status === 'connected' ? 'No areas with devices yet. Assign devices to areas in Home Assistant and they will show up here.' : 'Loading your areas…'}</p></div>`;

  return `<header class="top">
      <div class="hello"><h1>${esc(greeting())}</h1><p>${esc(subtitle(M))}</p></div>
      ${topbar(M)}
    </header>
    ${stats}
    <section class="areas-sec">
      <div class="sec-head"><h2>My Areas</h2><span>${plural(A.length, 'area')} · ${plural(allLights.length, 'light')} · ${plural(allFans.length, 'fan')}</span></div>
      <div class="areas">${cards}</div>
    </section>
    <section class="quick">
      <button class="big-btn danger" data-action="all-off" data-domain="light" ${lightsOn ? '' : 'disabled'}>${icon('power')}<span>All Lights Off</span><small>${lightsOn ? `${lightsOn} on` : 'All off'}</small></button>
      <button class="big-btn danger alt" data-action="all-off" data-domain="fan" ${fansOn ? '' : 'disabled'}>${icon('fan', fansOn ? 'spin' : '')}<span>All Fans Off</span><small>${fansOn ? `${fansOn} running` : 'All off'}</small></button>
    </section>`;
}
const tAvgOr = (v) => (v == null ? '–' : Math.round(v));

function areaStyle(a) {
  const glow = a.lights.length ? a.lightsOn / a.lights.length : 0;
  let s = `--hue:${hueFor(a.name)};--glow:${glow.toFixed(2)};`;
  if (a.picture) s += `--pic:url('${a.picture.replace(/['\\()]/g, encodeURIComponent)}');`;
  return s;
}

function areaCard(a) {
  const counts = [];
  if (a.lights.length) counts.push(plural(a.lights.length, 'Light'));
  if (a.fans.length) counts.push(plural(a.fans.length, 'Fan'));
  if (a.switches.length) counts.push(plural(a.switches.length, 'Switch', 'Switches'));
  if (a.covers.length) counts.push(plural(a.covers.length, 'Cover'));
  if (!counts.length && a.temps.length) counts.push('Sensors');

  const MAX = 10;
  const bulbs = a.lights.slice(0, MAX).map((l) => {
    const off = isUnavail(l);
    const on = isOn(l);
    return `<button class="bulb${on ? ' on' : ''}${off ? ' na' : ''}" data-action="toggle" data-entity="${esc(l.entity_id)}" ${off ? 'disabled' : ''} title="${esc(friendly(l, a.name))}${off ? ' (offline)' : ''}" aria-label="${esc(friendly(l, a.name))}: ${off ? 'offline' : on ? 'on' : 'off'}" aria-pressed="${on}" style="--tint:${tintFor(l)}">${icon('bulb')}</button>`;
  }).join('') + (a.lights.length > MAX ? `<span class="more">+${a.lights.length - MAX}</span>` : '');

  let fanPill = '';
  if (a.fans.length) {
    const offline = a.fans.every(isUnavail);
    fanPill = offline
      ? `<span class="pill bad">${icon('fan')}<span><small>Fan${a.fans.length > 1 ? 's' : ''}</small>Offline</span></span>`
      : `<button class="pill${a.fansOn ? ' on' : ''}" data-action="area-fans" data-area="${esc(a.id)}" title="Toggle fans">${icon('fan', a.fansOn ? 'spin' : '')}<span><small>Fans running</small>${a.fansOn}/${a.fans.length}${a.fansOn ? '' : ' · Off'}</span></button>`;
  }

  const climate = [a.temp != null ? `<span>${icon('thermo')}${fmt(a.temp)}°</span>` : '', a.hum != null ? `<span>${icon('droplet')}${Math.round(a.hum)}%</span>` : ''].join('');
  const badge = a.offline ? '<span class="badge bad">Offline</span>' : a.lightsOn ? `<span class="badge on">${a.lightsOn} on</span>` : '';

  return `<article class="area-card${a.picture ? ' has-pic' : ''}${a.lightsOn ? ' lit' : ''}${a.offline ? ' offline' : ''}" data-key="area-${esc(a.id)}" style="${areaStyle(a)}" data-action="nav" data-view="area:${esc(a.id)}" tabindex="0" role="link" aria-label="Open ${esc(a.name)}">
    <div class="area-art" aria-hidden="true">${icon(areaIcon(a))}</div>
    <div class="area-top">
      <span class="area-ic">${icon(areaIcon(a))}</span>
      <div class="area-title"><h3>${esc(a.name)}</h3><p>${esc(counts.join(' · ') || 'No devices')}</p></div>
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
function viewArea(a, M) {
  const parts = [];
  if (a.lights.length) parts.push(`${a.lightsOn} of ${plural(a.lights.length, 'light')} on`);
  if (a.fans.length) parts.push(`${a.fansOn}/${a.fans.length} fans`);
  const chips = [
    a.temp != null ? `<span class="hchip">${icon('thermo')}${fmt(a.temp)}${esc(S.config.temp_unit)}</span>` : '',
    a.hum != null ? `<span class="hchip">${icon('droplet')}${Math.round(a.hum)}%</span>` : '',
    ...a.binaries.map((b) => binaryChip(b, a)),
  ].join('');
  const anyLightOn = a.lightsOn > 0;
  const section = (title, body, cls = '') => (body ? `<section class="dev-sec"><h2>${title}</h2><div class="tiles ${cls}">${body}</div></section>` : '');

  return `<header class="area-head">
      <button class="back" data-action="nav" data-view="home" aria-label="Back to home">${icon('chevronLeft')}</button>
      <div class="hello"><h1>${esc(a.name)}</h1><p>${esc(parts.join(' · ') || 'Area overview')}</p></div>
      ${topbar(M)}
    </header>
    <div class="area-hero${a.picture ? ' has-pic' : ''}${a.lightsOn ? ' lit' : ''}" style="${areaStyle(a)}">
      <div class="area-art" aria-hidden="true">${icon(areaIcon(a))}</div>
      <div class="hero-chips">${chips || '<span class="hchip muted">No sensors in this area</span>'}</div>
      ${a.lights.length ? `<div class="hero-actions">
        <button class="soft-btn" data-action="area-lights" data-area="${esc(a.id)}" data-on="1">${icon('bulb')}All on</button>
        <button class="soft-btn ${anyLightOn ? 'danger' : ''}" data-action="area-lights" data-area="${esc(a.id)}" data-on="0" ${anyLightOn ? '' : 'disabled'}>${icon('power')}All off</button>
      </div>` : ''}
    </div>
    ${section('Climate', a.climates.map((c) => climateTile(c, a)).join(''), 'wide')}
    ${section('Lights', a.lights.map((l) => lightTile(l, a)).join(''))}
    ${section('Fans', a.fans.map((f) => fanTile(f, a)).join(''))}
    ${section('Switches', a.switches.map((s) => switchTile(s, a)).join(''))}
    ${section('Covers', a.covers.map((c) => coverTile(c, a)).join(''))}
    ${section('Locks', a.locks.map((l) => lockTile(l, a)).join(''))}
    ${section('Sensors', [...a.temps, ...a.hums, ...a.sensors].map((s) => sensorTile(s, a)).join(''), 'small')}
    ${a.controls.length + a.temps.length + a.hums.length + a.sensors.length === 0 ? `<div class="empty">${icon('grid')}<p>No devices in this area yet.</p></div>` : ''}`;
}

function binaryChip(b, a) {
  const dc = b.attributes.device_class;
  const on = b.state === 'on';
  const labels = { door: ['Open', 'Closed'], window: ['Open', 'Closed'], opening: ['Open', 'Closed'], garage_door: ['Open', 'Closed'], motion: ['Motion', 'Clear'], occupancy: ['Occupied', 'Clear'], presence: ['Home', 'Away'], moisture: ['Wet', 'Dry'], smoke: ['Smoke!', 'Clear'] };
  const [y, n] = labels[dc] || ['On', 'Off'];
  const ic = dc === 'motion' || dc === 'occupancy' ? 'activity' : dc === 'door' || dc === 'garage_door' ? 'door' : 'gauge';
  return `<span class="hchip${on ? ' alert' : ''}">${icon(ic)}${esc(friendly(b, a.name))}: ${isUnavail(b) ? 'Offline' : on ? y : n}</span>`;
}

function tileShell(e, a, { ic, on, label, cls = '', extra = '', action = 'toggle', tint, spin = false }) {
  const off = isUnavail(e);
  return `<div class="tile ${cls}${on ? ' on' : ''}${off ? ' na' : ''}" data-key="${esc(e.entity_id)}" style="--tint:${tint || '96,165,255'}">
    <button class="tile-main" data-action="${action}" data-entity="${esc(e.entity_id)}" ${off ? 'disabled' : ''} aria-pressed="${on}">
      <span class="tile-ic">${icon(ic, spin && on ? 'spin' : '')}</span>
      <span class="tile-txt"><strong>${esc(friendly(e, a.name))}</strong><small>${off ? 'Offline' : esc(label)}</small></span>
      ${action === 'toggle' || action === 'lock' ? `<span class="switch${on ? ' on' : ''}" aria-hidden="true"></span>` : ''}
    </button>
    ${extra}
  </div>`;
}

function lightTile(l, a) {
  const on = isOn(l);
  const pending = S.pending[l.entity_id];
  const pct = pending != null ? pending : on ? pctOf(l) ?? 100 : 0;
  const dim = isDimmable(l) && !isUnavail(l);
  const label = on ? (dim ? `On · ${pct}%` : 'On') : 'Off';
  const slider = dim ? `<input class="slider" type="range" min="1" max="100" step="1" value="${Math.max(1, pct)}" data-action="brightness" data-entity="${esc(l.entity_id)}" aria-label="Brightness of ${esc(friendly(l, a.name))}" style="--pct:${on || pending != null ? pct : 0}%">` : '';
  return tileShell(l, a, { ic: 'bulb', on, label, cls: 'light', extra: slider, tint: tintFor(l) });
}

function fanTile(f, a) {
  const on = isOn(f);
  const hasPct = 'percentage' in f.attributes || 'percentage_step' in f.attributes;
  const pending = S.pending[f.entity_id];
  const pct = pending != null ? pending : on ? (num(f.attributes.percentage) ?? 100) : 0;
  const label = on ? (hasPct ? `Running · ${pct}%` : 'Running') : 'Off';
  const step = num(f.attributes.percentage_step) || 1;
  const slider = hasPct && !isUnavail(f) ? `<input class="slider" type="range" min="0" max="100" step="${step}" value="${pct}" data-action="fan-speed" data-entity="${esc(f.entity_id)}" aria-label="Speed of ${esc(friendly(f, a.name))}" style="--pct:${pct}%">` : '';
  return tileShell(f, a, { ic: 'fan', on, label, cls: 'fan', extra: slider, tint: '56,189,248', spin: true });
}

function switchTile(s, a) {
  const on = isOn(s);
  return tileShell(s, a, { ic: 'plug', on, label: on ? 'On' : 'Off', cls: 'switch-t', tint: '52,211,153' });
}

function lockTile(l, a) {
  const unlocked = isOn(l);
  const label = { locked: 'Locked', unlocked: 'Unlocked', locking: 'Locking…', unlocking: 'Unlocking…', jammed: 'Jammed', open: 'Open' }[l.state] || l.state;
  return tileShell(l, a, { ic: unlocked ? 'unlock' : 'lock', on: unlocked, label, cls: 'lock-t', action: 'lock', tint: '251,146,60' });
}

function coverTile(c, a) {
  const pos = num(c.attributes.current_position);
  const label = { open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' }[c.state] || c.state;
  const off = isUnavail(c);
  const id = esc(c.entity_id);
  const extra = off ? '' : `<div class="cover-btns">
      <button data-action="cover" data-svc="open_cover" data-entity="${id}" aria-label="Open">${icon('chevronUp')}</button>
      <button data-action="cover" data-svc="stop_cover" data-entity="${id}" aria-label="Stop">${icon('stop')}</button>
      <button data-action="cover" data-svc="close_cover" data-entity="${id}" aria-label="Close">${icon('chevronDown')}</button>
    </div>`;
  return `<div class="tile cover${isOn(c) ? ' on' : ''}${off ? ' na' : ''}" data-key="${id}" style="--tint:167,139,250">
    <div class="tile-main static"><span class="tile-ic">${icon('blinds')}</span>
      <span class="tile-txt"><strong>${esc(friendly(c, a.name))}</strong><small>${off ? 'Offline' : esc(label) + (pos != null && c.state === 'open' ? ` · ${pos}%` : '')}</small></span></div>
    ${extra}
  </div>`;
}

function climateTile(c, a) {
  const off = isUnavail(c);
  const cur = num(c.attributes.current_temperature);
  const target = S.pending[c.entity_id] ?? num(c.attributes.temperature);
  const action = c.attributes.hvac_action;
  const unit = S.config.temp_unit;
  const modes = (c.attributes.hvac_modes || []).map((m) => {
    const ic = { heat: 'flame', cool: 'snowflake', off: 'power', auto: 'sparkle', heat_cool: 'sparkle', fan_only: 'fan', dry: 'droplet' }[m] || 'gauge';
    return `<button class="mode${c.state === m ? ' active' : ''}" data-action="hvac" data-mode="${esc(m)}" data-entity="${esc(c.entity_id)}">${icon(ic)}<span>${esc(m.replace('_', ' / '))}</span></button>`;
  }).join('');
  const actionLabel = action ? action.charAt(0).toUpperCase() + action.slice(1) : (c.state === 'off' ? 'Off' : c.state);
  return `<div class="tile climate${isOn(c) ? ' on' : ''}${off ? ' na' : ''} mode-${esc(c.state)}" data-key="${esc(c.entity_id)}">
    <div class="clim-now"><small>${esc(friendly(c, a.name))}</small><strong>${fmt(cur)}<em>${esc(unit)}</em></strong><span class="clim-act ${esc(action || '')}">${off ? 'Offline' : esc(actionLabel)}</span></div>
    ${target != null && !off ? `<div class="clim-set">
      <button class="round" data-action="temp-step" data-step="-1" data-entity="${esc(c.entity_id)}" aria-label="Lower target">${icon('minus')}</button>
      <div class="clim-target"><small>Target</small><strong>${fmt(target)}°</strong></div>
      <button class="round" data-action="temp-step" data-step="1" data-entity="${esc(c.entity_id)}" aria-label="Raise target">${icon('plus')}</button>
    </div>` : ''}
    ${modes && !off ? `<div class="modes">${modes}</div>` : ''}
  </div>`;
}

function sensorTile(s, a) {
  const dc = s.attributes.device_class;
  const ic = dc === 'temperature' ? 'thermo' : dc === 'humidity' ? 'droplet' : dc === 'power' || dc === 'energy' ? 'bolt' : 'gauge';
  const v = num(s.state);
  const val = isUnavail(s) ? 'Offline' : v == null ? s.state : `${Number.isInteger(v) ? v : fmt(v)} ${s.attributes.unit_of_measurement || ''}`;
  return `<div class="tile sensor" data-key="${esc(s.entity_id)}"><span class="tile-ic">${icon(ic)}</span><span class="tile-txt"><strong>${esc(friendly(s, a.name))}</strong><small>${esc(val)}</small></span></div>`;
}

/* ---- settings ---- */
function viewSettings(M) {
  const live = S.mode === 'live';
  const auth = S.backend?.auth;
  const statusText = {
    connected: live ? `Connected to ${auth?.hassUrl}` : 'Running the demo home',
    connecting: 'Connecting…', reconnecting: 'Connection lost — reconnecting…', error: S.error || 'Not connected', idle: 'Not connected',
  }[S.status];
  const insecure = location.protocol === 'https:' && /^http:/i.test(normalizeUrl(S.form.url));
  const sameOrigin = location.pathname.includes('/local/');

  const connect = live
    ? `<div class="row"><div><strong>${esc(auth?.hassUrl || '')}</strong><small>${auth?.method === 'oauth' ? 'Signed in with your Home Assistant account' : 'Using a long-lived access token'}${S.config.version ? ` · Home Assistant ${esc(S.config.version)}` : ''}</small></div>
         <button class="soft-btn danger" data-action="logout">${icon('logout')}Disconnect</button></div>`
    : `<form class="connect" data-action="connect-form" autocomplete="on">
        <label class="field"><span>Home Assistant URL</span>
          <input type="url" inputmode="url" data-field="url" placeholder="https://homeassistant.example.com" value="${esc(S.form.url)}" autocomplete="url" required></label>
        ${insecure ? `<p class="note warn">${icon('wifiOff')}This page is served over HTTPS, so browsers block an <b>http://</b> Home Assistant. Use your HTTPS address (e.g. Nabu Casa) or install the dashboard inside Home Assistant — see the README.</p>` : ''}
        <div class="btn-row">
          <button type="submit" class="primary-btn" data-mode="oauth" ${S.form.busy ? 'disabled' : ''}>${icon('home')}Sign in with Home Assistant</button>
          <button type="button" class="link-btn" data-action="toggle-token">${S.form.showToken ? 'Hide token option' : 'Use a long-lived access token'}</button>
        </div>
        ${S.form.showToken ? `<label class="field"><span>Long-lived access token</span>
          <textarea data-field="token" rows="3" placeholder="Profile → Security → Long-lived access tokens → Create token" spellcheck="false">${esc(S.form.token)}</textarea></label>
          <div class="btn-row"><button type="button" class="soft-btn" data-action="connect-token" ${S.form.busy ? 'disabled' : ''}>${icon('check')}Connect with token</button></div>` : ''}
        ${sameOrigin ? '' : `<p class="note">Signing in from this site requires adding <code>${esc(location.origin)}</code> to <code>http: cors_allowed_origins</code> in Home Assistant. A long-lived token works without it.</p>`}
      </form>`;

  const areaRows = M.areas.filter((a) => !a.empty).map((a) => {
    const shown = !prefs.hiddenAreas.includes(a.id);
    return `<button class="area-row${shown ? '' : ' off'}" data-action="toggle-area" data-area="${esc(a.id)}" aria-pressed="${shown}">
      <span class="area-ic sm">${icon(areaIcon(a))}</span><span>${esc(a.name)}</span><small>${plural(a.controls.length, 'device')}</small>${icon(shown ? 'eye' : 'eyeOff')}</button>`;
  }).join('');

  const canWake = 'wakeLock' in navigator;
  return `<header class="top">
      <div class="hello"><h1>Settings</h1><p>Connection, display and areas</p></div>
      ${topbar(M)}
    </header>
    <div class="settings">
      <section class="card">
        <div class="card-head"><span class="stat-ic ha">${icon('home')}</span><div><h2>Home Assistant</h2><p class="st ${S.status}"><i class="led"></i>${esc(statusText)}</p></div></div>
        ${connect}
        ${live ? '' : (S.mode === 'demo' ? '' : `<button class="link-btn" data-action="demo">Explore the demo home</button>`)}
        ${live ? `<button class="link-btn" data-action="demo">Switch to the demo home</button>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><span class="stat-ic light">${icon('monitor')}</span><div><h2>Display</h2><p>Tune the dashboard for a wall tablet</p></div></div>
        <label class="field"><span>Your name (for the greeting)</span><input type="text" data-field="name" value="${esc(prefs.name)}" placeholder="Optional" maxlength="40"></label>
        <div class="row"><div><strong>24-hour clock</strong><small>Show time as 16:02 instead of 4:02 PM</small></div><button class="toggle${prefs.clock24 ? ' on' : ''}" data-action="pref" data-pref="clock24" aria-pressed="${prefs.clock24}"><i></i></button></div>
        <div class="row"><div><strong>Keep screen awake</strong><small>${canWake ? 'Stops the tablet from sleeping while the dashboard is open' : 'Not supported by this browser'}</small></div><button class="toggle${prefs.wakeLock ? ' on' : ''}" data-action="pref" data-pref="wakeLock" aria-pressed="${prefs.wakeLock}" ${canWake ? '' : 'disabled'}><i></i></button></div>
        <div class="row"><div><strong>Full screen</strong><small>Hide the browser chrome for a kiosk look</small></div><button class="soft-btn" data-action="fullscreen">${icon('maximize')}${document.fullscreenElement ? 'Exit' : 'Enter'}</button></div>
      </section>
      <section class="card wide">
        <div class="card-head"><span class="stat-ic hum">${icon('grid')}</span><div><h2>Areas</h2><p>Choose which areas appear on the dashboard. Areas come from Home Assistant.</p></div></div>
        <div class="area-list">${areaRows || '<p class="muted">No areas yet.</p>'}</div>
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
    toast(err.message || 'Action failed', 'bad');
  }
}

function toggleEntity(id) {
  const e = ent(id);
  if (!e || isUnavail(e)) return;
  const d = domainOf(id);
  const on = isOn(e);
  optimistic(id, on ? 'off' : 'on');
  call(d, on ? 'turn_off' : 'turn_on', {}, [id]);
}

function allOff(domain, entities) {
  const ids = entities.filter((e) => isOn(e) && !isUnavail(e)).map((e) => e.entity_id);
  if (!ids.length) return;
  ids.forEach((id) => optimistic(id, 'off'));
  call(domain, 'turn_off', {}, ids);
  toast(`Turned off ${plural(ids.length, domain === 'light' ? 'light' : 'fan')}`);
}

app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled || !app.contains(el)) return;
  const act = el.dataset.action;
  if (act === 'connect-form') return;
  const M = () => buildModel();
  const areaOf = (id) => M().areas.find((a) => a.id === id);

  switch (act) {
    case 'nav': go(el.dataset.view); break;
    case 'toggle': toggleEntity(el.dataset.entity); break;
    case 'lock': {
      const e = ent(el.dataset.entity);
      if (!e) break;
      const unlock = e.state === 'locked';
      optimistic(e.entity_id, unlock ? 'unlocking' : 'locking');
      call('lock', unlock ? 'unlock' : 'lock', {}, [e.entity_id]);
      break;
    }
    case 'all-off': {
      const m = M();
      allOff(el.dataset.domain, m.visible.flatMap((a) => (el.dataset.domain === 'light' ? a.lights : a.fans)));
      break;
    }
    case 'area-lights': {
      const a = areaOf(el.dataset.area);
      if (!a) break;
      if (el.dataset.on === '1') {
        const ids = a.lights.filter((l) => !isOn(l) && !isUnavail(l)).map((l) => l.entity_id);
        ids.forEach((id) => optimistic(id, 'on'));
        if (ids.length) call('light', 'turn_on', {}, ids);
      } else allOff('light', a.lights);
      break;
    }
    case 'area-fans': {
      const a = areaOf(el.dataset.area);
      if (!a) break;
      const live = a.fans.filter((f) => !isUnavail(f));
      if (a.fansOn) allOff('fan', live);
      else { live.forEach((f) => optimistic(f.entity_id, 'on')); call('fan', 'turn_on', {}, live.map((f) => f.entity_id)); }
      break;
    }
    case 'cover': call('cover', el.dataset.svc, {}, [el.dataset.entity]); break;
    case 'hvac': optimistic(el.dataset.entity, el.dataset.mode); call('climate', 'set_hvac_mode', { hvac_mode: el.dataset.mode }, [el.dataset.entity]); break;
    case 'temp-step': stepTemp(el.dataset.entity, +el.dataset.step); break;
    case 'toggle-token': S.form.showToken = !S.form.showToken; render(); break;
    case 'connect-token': connectWithToken(); break;
    case 'logout': logout(); break;
    case 'demo': startDemo(); toast('Demo home loaded'); break;
    case 'pref': {
      const k = el.dataset.pref;
      prefs[k] = !prefs[k];
      savePrefs();
      if (k === 'wakeLock') applyWakeLock();
      render();
      break;
    }
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here', 'bad'));
      break;
    case 'toggle-area': {
      const id = el.dataset.area;
      prefs.hiddenAreas = prefs.hiddenAreas.includes(id) ? prefs.hiddenAreas.filter((x) => x !== id) : [...prefs.hiddenAreas, id];
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
app.addEventListener('pointerdown', (ev) => { if (ev.target.matches('input.slider')) ev.target.dataset.dragging = '1'; });
app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.matches('input.slider')) {
    const v = +t.value;
    S.pending[t.dataset.entity] = v;
    t.style.setProperty('--pct', v + '%');
    const small = t.closest('.tile')?.querySelector('.tile-txt small');
    if (small) small.textContent = t.dataset.action === 'brightness' ? `On · ${v}%` : v ? `Running · ${v}%` : 'Off';
    return;
  }
  if (t.dataset.field === 'name') { prefs.name = t.value.trim(); savePrefs(); render(); }
  else if (t.dataset.field === 'url') { S.form.url = t.value; render(); }
  else if (t.dataset.field === 'token') { S.form.token = t.value; }
});
app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t.matches('input.slider')) return;
  delete t.dataset.dragging;
  const id = t.dataset.entity;
  const v = +t.value;
  S.pending[id] = v;
  if (t.dataset.action === 'brightness') {
    optimistic(id, 'on', { brightness: Math.round(v * 2.55) });
    call('light', 'turn_on', { brightness_pct: v }, [id]);
  } else {
    optimistic(id, v ? 'on' : 'off', { percentage: v });
    call('fan', v ? 'set_percentage' : 'turn_off', v ? { percentage: v } : {}, [id]);
  }
  setTimeout(() => { if (S.pending[id] === v) { delete S.pending[id]; render(); } }, 3000);
});
app.addEventListener('pointerup', (ev) => { if (ev.target.matches('input.slider')) delete ev.target.dataset.dragging; });

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const url = normalizeUrl(S.form.url);
  if (!url) { toast('Enter your Home Assistant URL', 'bad'); return; }
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
  S.status = 'connecting';
  b.connect();
  render();
}

function startDemo() { useBackend(new DemoBackend(callbacks), 'demo'); }
function startLive(auth) { useBackend(new HAConnection(auth, callbacks), 'live'); }

function connectWithToken() {
  const url = normalizeUrl(S.form.url);
  const token = S.form.token.trim();
  if (!url || !token) { toast('Enter both the URL and the access token', 'bad'); return; }
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
  toast('Disconnected from Home Assistant');
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
// Keep the clock and greeting current.
setInterval(render, 15_000);

/* ---------------- boot ---------------- */
(async function boot() {
  try { S.form.url = localStorage.getItem('hd.lastUrl') || ''; } catch { /* ignore */ }
  if (!S.form.url && location.pathname.includes('/local/')) S.form.url = location.origin;
  let auth = null;
  try {
    auth = await handleCallback();
    if (auth) toast('Signed in to Home Assistant');
  } catch (err) {
    S.view = 'settings';
    toast(err.message, 'bad');
  }
  auth = auth || loadAuth();
  if (auth && auth.hassUrl && auth.access_token) startLive(auth);
  else startDemo();
  applyWakeLock();
})();
