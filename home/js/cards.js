// Card renderers. Each card is a plain object from config.js, e.g. { type: 'tile', entity: 'switch.x' }.
// Values marked "fn" in config may be functions: (h, entityId) => value, where h is the state helper.
import { icon } from './icons.js';

export const PALETTE = {
  red: '239,68,68', 'deep-orange': '255,112,67', orange: '251,146,60', amber: '255,195,90', yellow: '250,204,21',
  green: '52,211,153', 'light-green': '163,230,53', teal: '45,212,191', cyan: '34,211,238', 'light-blue': '125,211,252',
  blue: '96,165,250', indigo: '129,140,248', purple: '192,132,252', 'deep-purple': '167,139,250', pink: '244,114,182',
  grey: '148,163,184', 'blue-grey': '120,144,156', disabled: '100,116,139', white: '226,232,240',
  primary: '96,165,250', accent: '96,165,250', state: '255,195,90',
};
export function tintOf(c) {
  if (!c) return null;
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isNaN(n) ? null : `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  if (/^\d+,\d+,\d+$/.test(c)) return c;
  return PALETTE[c] || null;
}

export const domainOf = (id) => String(id || '').split('.')[0];
const TOGGLE = new Set(['switch', 'light', 'fan', 'automation', 'input_boolean', 'siren', 'humidifier', 'remote']);
export const canToggle = (id) => TOGGLE.has(domainOf(id));

const safe = (f, d) => { try { return f(); } catch (e) { console.warn('[dashboard] config function failed:', e); return d; } };
const val = (f, x, id) => (typeof f === 'function' ? safe(() => f(x.h, id)) : f);
const full = (c, def = false) => (c.span === 'full' || c.span === 2 || (def && c.span !== 1) ? ' full' : '');
const keyOf = (c, x, extra = '') => x.esc((c.key || c.entity || (typeof c.name === 'string' ? c.name : '') || c.type) + extra);

export function defaultIcon(e) {
  if (!e) return 'sparkle';
  const d = domainOf(e.entity_id);
  const dc = e.attributes?.device_class;
  switch (d) {
    case 'light': return 'bulb';
    case 'switch': return 'plug';
    case 'fan': return 'fan';
    case 'climate': return 'ac';
    case 'cover': return dc === 'awning' ? 'awning' : 'blinds';
    case 'lock': return e.state === 'unlocked' ? 'unlock' : 'lock';
    case 'vacuum': return 'vacuum';
    case 'camera': return 'camera';
    case 'device_tracker': case 'person': return 'mapPin';
    case 'automation': return 'sparkle';
    case 'script': return 'play';
    case 'button': return 'power';
    case 'number': case 'input_number': return 'gauge';
    case 'select': case 'input_select': return 'grid';
    case 'binary_sensor':
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return 'activity';
      if (dc === 'door' || dc === 'opening' || dc === 'garage_door' || dc === 'window') return 'door';
      if (dc === 'connectivity') return 'globe';
      if (dc === 'moisture') return 'droplet';
      return 'gauge';
    case 'sensor':
      if (dc === 'temperature') return 'thermo';
      if (dc === 'humidity' || dc === 'moisture') return 'droplet';
      if (['power', 'energy', 'voltage', 'current', 'apparent_power'].includes(dc)) return 'bolt';
      if (dc === 'battery') return 'battery';
      if (dc === 'timestamp') return 'calendar';
      if (dc === 'data_rate') return 'speed';
      return 'gauge';
    default: return 'gauge';
  }
}
function domainColor(d, e) {
  const dc = e?.attributes?.device_class;
  if (d === 'sensor') return dc === 'temperature' ? 'red' : dc === 'humidity' ? 'cyan' : ['power', 'energy', 'voltage', 'current'].includes(dc) ? 'amber' : dc === 'battery' ? 'green' : 'blue';
  return { light: 'amber', switch: 'amber', fan: 'cyan', automation: 'indigo', input_boolean: 'indigo', cover: 'purple', lock: 'orange', climate: 'orange', vacuum: 'teal', binary_sensor: 'blue' }[d] || 'blue';
}

export function renderSections(sections, x) {
  return `<div class="sections">${(sections || []).map((s, i) => {
    if (s.show && !val(s.show, x)) return '';
    const body = renderCards(s.cards, x);
    if (!body.trim()) return '';
    const title = val(s.title, x);
    return `<section class="sect${s.wide ? ' wide' : ''}" style="--cols:${s.cols || 2}" data-key="sect-${i}-${x.esc(title || '')}">
      ${title ? `<h2 class="sect-title">${s.icon ? icon(s.icon) : ''}<span>${x.esc(title)}</span></h2>` : ''}
      <div class="cards">${body}</div>
    </section>`;
  }).join('')}</div>`;
}

export function renderCards(cards, x) {
  return (cards || []).map((c) => renderCard(c, x)).join('');
}

export function renderCard(c, x) {
  if (!c) return '';
  if (c.show && !val(c.show, x, c.entity)) return '';
  const fn = TYPES[c.type || 'tile'];
  if (!fn) return '';
  try { return fn(c, x); } catch (err) {
    console.error('[dashboard] card failed', c, err);
    return `<div class="tile na" data-key="err-${keyOf(c, x)}"><div class="tile-main"><span class="tile-ic">${icon('alert')}</span><span class="tile-txt"><strong>${x.esc(c.name || c.entity || c.type)}</strong><small>Error</small></span></div></div>`;
  }
}

/* ---------- tile ---------- */
function isToggleSpec(tap) { return tap === 'toggle' || (tap && tap.action === 'toggle'); }

function tile(c, x) {
  const id = c.entity;
  const e = id ? x.ent(id) : null;
  const d = domainOf(id);
  const na = !!id && x.isUnavail(e);
  let tap = c.tap === false ? null : c.tap || (id && canToggle(id) ? 'toggle' : null);
  const toggles = isToggleSpec(tap);
  const active = c.active != null ? !!val(c.active, x, id) : (id && (toggles || ['cover', 'lock', 'vacuum', 'binary_sensor', 'media_player'].includes(d))) ? x.isOn(e) : false;
  const color = val(c.color, x, id) || (e ? domainColor(d, e) : 'blue');
  const tint = tintOf(color) || PALETTE.blue;
  const ic = val(c.icon, x, id) || defaultIcon(e);
  const name = val(c.name, x, id) ?? (e ? x.friendly(e) : '');
  const value = c.value != null ? val(c.value, x, id) : null;
  const sub = na ? x.t('offline') : c.sub != null ? val(c.sub, x, id) : value != null ? '' : e ? x.fmtState(e) : '';
  const dim = (toggles && !active) || na || color === 'disabled';
  const a = tap ? x.act(tap, id) : null;
  const hd = c.hold ? x.act(c.hold, id) : null;
  const tag = a != null || hd != null ? 'button' : 'div';
  const spin = active && (d === 'fan' || (d === 'vacuum' && e.state === 'cleaning') || c.spin);
  const vert = c.layout === 'vertical';
  return `<div class="tile${vert ? ' vert' : ''}${active ? ' on' : ''}${na ? ' na' : ''}${dim ? ' dim' : ''}${c.cls ? ' ' + c.cls : ''}${full(c)}" style="--tint:${tint}" data-key="${keyOf(c, x)}">
    <${tag} class="tile-main"${a != null ? ` data-act="${a}"` : ''}${hd != null ? ` data-hold="${hd}"` : ''}${tag === 'button' && na ? ' disabled' : ''}>
      <span class="tile-ic">${icon(ic, spin ? 'spin' : '')}</span>
      <span class="tile-txt">${value != null ? `<b class="tile-val">${x.esc(value)}</b>` : ''}<strong>${x.esc(name)}</strong>${sub ? `<small>${x.esc(sub)}</small>` : ''}</span>
      ${toggles && !vert ? `<span class="switch${active ? ' on' : ''}" aria-hidden="true"></span>` : ''}
    </${tag}>
  </div>`;
}

/* ---------- light ---------- */
const KELVIN = { 2700: [255, 169, 87], 4000: [255, 209, 163], 6500: [235, 242, 255] };
const COLORS = [[255, 72, 48], [255, 160, 40], [80, 220, 120], [50, 140, 255], [160, 90, 255], [255, 80, 180]];
function light(c, x) {
  const id = c.entity;
  if (domainOf(id) !== 'light') return tile({ ...c, color: c.color || 'amber' }, x);
  const e = x.ent(id);
  const on = x.isOn(e);
  const na = x.isUnavail(e);
  const modes = e.attributes.supported_color_modes || [];
  const dimmable = x.isDimmable(e) && !na;
  const pending = x.pending[id];
  const pct = pending != null ? pending : on ? x.pct(e) ?? 100 : 0;
  const label = na ? x.t('offline') : on ? (dimmable ? `${x.t('on')} · ${pct}%` : x.t('on')) : x.t('off');
  const name = val(c.name, x, id) ?? x.friendly(e);
  const sw = [];
  if (!na && c.colors !== false) {
    if (modes.includes('color_temp')) for (const k of [2700, 4000, 6500]) sw.push([KELVIN[k], { service: 'light.turn_on', target: 'self', data: { color_temp_kelvin: k }, optimistic: { state: 'on' } }, `${k}K`]);
    if (modes.some((m) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m))) for (const rgb of COLORS) sw.push([rgb, { service: 'light.turn_on', target: 'self', data: { rgb_color: rgb }, optimistic: { state: 'on', attributes: { rgb_color: rgb, color_mode: 'rgb' } } }, rgb.join(',')]);
  }
  const ic = val(c.icon, x, id) || 'bulb';
  return `<div class="tile light${on ? ' on' : ' dim'}${na ? ' na' : ''}${full(c, sw.length > 0)}" style="--tint:${x.lightTint(e)}" data-key="${keyOf(c, x)}">
    <button class="tile-main" data-act="${x.act('toggle', id)}" ${na ? 'disabled' : ''} aria-pressed="${on}">
      <span class="tile-ic">${icon(ic)}</span>
      <span class="tile-txt"><strong>${x.esc(name)}</strong><small>${x.esc(label)}</small></span>
      <span class="switch${on ? ' on' : ''}" aria-hidden="true"></span>
    </button>
    ${dimmable ? `<input class="slider" type="range" min="1" max="100" step="1" value="${Math.max(1, pct)}" data-action="brightness" data-entity="${x.esc(id)}" aria-label="${x.esc(name)}" style="--pct:${on || pending != null ? pct : 0}%">` : ''}
    ${sw.length ? `<div class="swatches">${sw.map(([rgb, spec, k]) => `<button class="sw" data-key="${k}" style="background:rgb(${rgb.join(',')})" data-act="${x.act(spec, id)}" aria-label="${k}"></button>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- fan ---------- */
function fan(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const on = x.isOn(e);
  const na = x.isUnavail(e);
  const hasPct = 'percentage' in e.attributes || 'percentage_step' in e.attributes;
  const pending = x.pending[id];
  const pct = pending != null ? pending : on ? (parseFloat(e.attributes.percentage) || 100) : 0;
  const label = na ? x.t('offline') : on ? (hasPct ? `${x.t('running')} · ${pct}%` : x.t('running')) : x.t('off');
  const name = val(c.name, x, id) ?? x.friendly(e);
  const step = parseFloat(e.attributes.percentage_step) || 1;
  return `<div class="tile fan${on ? ' on' : ' dim'}${na ? ' na' : ''}${full(c)}" style="--tint:${tintOf(val(c.color, x, id)) || PALETTE.cyan}" data-key="${keyOf(c, x)}">
    <button class="tile-main" data-act="${x.act('toggle', id)}" ${na ? 'disabled' : ''}>
      <span class="tile-ic">${icon(val(c.icon, x, id) || 'fan', on ? 'spin' : '')}</span>
      <span class="tile-txt"><strong>${x.esc(name)}</strong><small>${x.esc(label)}</small></span>
      <span class="switch${on ? ' on' : ''}" aria-hidden="true"></span>
    </button>
    ${hasPct && !na ? `<input class="slider" type="range" min="0" max="100" step="${step}" value="${pct}" data-action="fan-speed" data-entity="${x.esc(id)}" aria-label="${x.esc(name)}" style="--pct:${pct}%">` : ''}
  </div>`;
}

/* ---------- cover ---------- */
function cover(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const na = x.isUnavail(e);
  const pos = parseFloat(e.attributes.current_position);
  const name = val(c.name, x, id) ?? x.friendly(e);
  const pending = x.pending[id];
  const p = pending != null ? pending : Number.isFinite(pos) ? pos : null;
  const label = na ? x.t('offline') : `${x.fmtState(e)}${p != null && e.state !== 'closed' ? ` · ${p}%` : ''}`;
  const canPos = (e.attributes.supported_features & 4) && p != null && c.position !== false;
  const b = (svc, ic, lbl) => `<button data-act="${x.act({ service: `cover.${svc}`, target: 'self' }, id)}" aria-label="${x.esc(lbl)}">${icon(ic)}</button>`;
  return `<div class="tile cover${x.isOn(e) ? ' on' : ''}${na ? ' na' : ''}${full(c)}" style="--tint:${tintOf(val(c.color, x, id)) || PALETTE.purple}" data-key="${keyOf(c, x)}">
    <div class="tile-main"><span class="tile-ic">${icon(val(c.icon, x, id) || defaultIcon(e))}</span>
      <span class="tile-txt"><strong>${x.esc(name)}</strong><small>${x.esc(label)}</small></span></div>
    ${na ? '' : `${canPos ? `<input class="slider" type="range" min="0" max="100" step="1" value="${p}" data-action="cover-pos" data-entity="${x.esc(id)}" aria-label="${x.esc(x.t('position'))}" style="--pct:${p}%">` : ''}
    <div class="btn-grid">${b('open_cover', 'chevronUp', x.t('cover_open'))}${b('stop_cover', 'stop', x.t('cover_stop'))}${b('close_cover', 'chevronDown', x.t('cover_close'))}</div>`}
  </div>`;
}

/* ---------- climate ---------- */
function climate(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const na = x.isUnavail(e);
  const A = e.attributes;
  const cur = parseFloat(A.current_temperature);
  const target = x.pending[id] ?? (A.temperature != null ? parseFloat(A.temperature) : null);
  const action = A.hvac_action;
  const all = A.hvac_modes || [];
  const modes = (c.modes || all).filter((m) => !all.length || all.includes(m));
  const fanModes = c.fanModes ? A.fan_modes || [] : [];
  const name = val(c.name, x, id) ?? x.friendly(e);
  const mi = { heat: 'flame', cool: 'snowflake', off: 'power', auto: 'sparkle', heat_cool: 'sparkle', fan_only: 'fan', dry: 'droplet' };
  const modeBtns = modes.map((m) => `<button class="mode${e.state === m ? ' active' : ''}" data-key="m-${m}" data-action="hvac" data-mode="${x.esc(m)}" data-entity="${x.esc(id)}">${icon(mi[m] || 'gauge')}<span>${x.esc(x.t('hvac_' + m))}</span></button>`).join('');
  const fanBtns = fanModes.map((m) => `<button class="mode${A.fan_mode === m ? ' active' : ''}" data-key="f-${m}" data-act="${x.act({ service: 'climate.set_fan_mode', target: 'self', data: { fan_mode: m }, optimistic: { attributes: { fan_mode: m } } }, id)}"><span>${x.esc(x.tOr('fan_' + String(m).toLowerCase(), m))}</span></button>`).join('');
  const actLabel = na ? x.t('offline') : action ? x.tOr('act_' + action, action) : x.t('hvac_' + e.state);
  const unit = x.unit;
  return `<div class="tile climate${x.isOn(e) ? ' on' : ''}${na ? ' na' : ''} mode-${x.esc(e.state)} full" data-key="${keyOf(c, x)}">
    <div class="clim-now"><small>${x.esc(name)}</small><strong>${Number.isFinite(cur) ? x.fmtNum(cur, 1) : '–'}<em>${x.esc(unit)}</em></strong><span class="clim-act ${x.esc(action || '')}">${x.esc(actLabel)}</span></div>
    ${target != null && !na && e.state !== 'off' ? `<div class="clim-set">
      <button class="round" data-action="temp-step" data-step="-1" data-entity="${x.esc(id)}" aria-label="${x.t('lower')}">${icon('minus')}</button>
      <div class="clim-target"><small>${x.t('target')}</small><strong>${x.fmtNum(target, 1)}°</strong></div>
      <button class="round" data-action="temp-step" data-step="1" data-entity="${x.esc(id)}" aria-label="${x.t('raise')}">${icon('plus')}</button>
    </div>` : ''}
    ${modeBtns && !na ? `<div class="modes">${modeBtns}</div>` : ''}
    ${fanBtns && !na && e.state !== 'off' ? `<div class="modes fan-modes"><span class="modes-lbl">${icon('fan')}${x.t('fan_mode')}</span>${fanBtns}</div>` : ''}
  </div>`;
}

/* ---------- sensor with sparkline ---------- */
function sensor(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const na = x.isUnavail(e) || e.state === 'unknown';
  const v = parseFloat(e.state);
  const unit = c.unit ?? e.attributes.unit_of_measurement ?? '';
  const disp = na ? '–' : Number.isFinite(v) ? x.fmtNum(v, c.digits) : x.fmtState(e);
  const color = val(c.color, x, id) || domainColor('sensor', e);
  const hours = c.hours ?? 24;
  const name = val(c.name, x, id) ?? x.friendly(e);
  const pts = c.graph === false ? null : x.hist(id, hours);
  return `<div class="card sensor-card${c.tall ? ' tall' : ''}${full(c, !!c.tall)}" style="--tint:${tintOf(color) || PALETTE.blue}" data-key="${keyOf(c, x)}">
    <div class="sc-head"><span class="sc-ic">${icon(val(c.icon, x, id) || defaultIcon(e))}</span><span class="sc-name">${x.esc(name)}</span></div>
    <div class="sc-val"><strong>${x.esc(disp)}</strong>${unit && Number.isFinite(v) ? `<em>${x.esc(unit)}</em>` : ''}</div>
    ${c.graph === false ? '' : spark(pts, hours, x, unit)}
  </div>`;
}

function downsample(P, n = 140) {
  if (P.length <= n) return P;
  const t0 = P[0][0];
  const span = P[P.length - 1][0] - t0 || 1;
  const buckets = Array.from({ length: n }, () => []);
  for (const p of P) buckets[Math.min(n - 1, Math.floor(((p[0] - t0) / span) * n))].push(p);
  return buckets.filter((b) => b.length).map((b) => [b.reduce((s, p) => s + p[0], 0) / b.length, b.reduce((s, p) => s + p[1], 0) / b.length]);
}

function prep(pts, hours) {
  if (!pts) return null;
  const now = Date.now() / 1000;
  const t0 = now - hours * 3600;
  let P = pts.filter((p) => p[0] >= t0);
  const before = pts.filter((p) => p[0] < t0).pop();
  if (before) P.unshift([t0, before[1]]);
  if (!P.length) return [];
  if (P[0][0] > t0 + 60 && P.length === 1) P.unshift([t0, P[0][1]]);
  P.push([now, P[P.length - 1][1]]);
  return { P: downsample(P), t0, now };
}

export function spark(pts, hours, x, unit = '') {
  const d = prep(pts, hours);
  if (d === null) return '<div class="spark-wrap"><div class="spark-load"></div></div>';
  if (!d.P || d.P.length < 2) return `<div class="spark-wrap"><div class="spark-empty">${x.t('no_data')}</div></div>`;
  const { P, t0, now } = d;
  let min = Math.min(...P.map((p) => p[1]));
  let max = Math.max(...P.map((p) => p[1]));
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const X = (t) => (((t - t0) / (now - t0)) * 100).toFixed(2);
  const Y = (v) => (4 + (1 - (v - min) / (max - min)) * 32).toFixed(2);
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('');
  const gid = x.uid();
  return `<div class="spark-wrap"><svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:rgb(var(--tint));stop-opacity:.35"/><stop offset="1" style="stop-color:rgb(var(--tint));stop-opacity:0"/></linearGradient></defs>
      <path d="${line}L${X(P[P.length - 1][0])},40L${X(P[0][0])},40Z" fill="url(#${gid})"/>
      <path d="${line}" fill="none" style="stroke:rgb(var(--tint))" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg><div class="spark-lbl"><span>↓ ${x.fmtNum(min)}${x.esc(unit)}</span><span>${hours}h</span><span>↑ ${x.fmtNum(max)}${x.esc(unit)}</span></div></div>`;
}

/* ---------- multi-line history ---------- */
const SERIES = ['96,165,250', '251,146,60', '52,211,153', '192,132,252', '244,114,182'];
function history(c, x) {
  const hours = c.hours || 24;
  const series = (c.entities || []).map((s, i) => {
    const id = typeof s === 'string' ? s : s.entity;
    const e = x.ent(id);
    return { id, e, name: (typeof s === 'object' && s.name) || x.friendly(e), d: prep(x.hist(id, hours), hours), color: tintOf(s.color) || SERIES[i % SERIES.length] };
  });
  const loading = series.some((s) => s.d === null);
  const all = series.filter((s) => s.d && s.d.P && s.d.P.length > 1);
  let body;
  if (loading) body = '<div class="spark-load tall"></div>';
  else if (!all.length) body = `<div class="spark-empty tall">${x.t('no_data')}</div>`;
  else {
    let min = Math.min(...all.flatMap((s) => s.d.P.map((p) => p[1])));
    let max = Math.max(...all.flatMap((s) => s.d.P.map((p) => p[1])));
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const { t0, now } = all[0].d;
    const X = (t) => (((t - t0) / (now - t0)) * 300).toFixed(1);
    const Y = (v) => (6 + (1 - (v - min) / (max - min)) * 104).toFixed(1);
    const unit = all[0].e.attributes.unit_of_measurement || '';
    const fmtT = (s) => new Date(s * 1000).toLocaleTimeString(x.locale, { hour: '2-digit', minute: '2-digit' });
    body = `<div class="hist-chart"><svg viewBox="0 0 300 116" preserveAspectRatio="none" aria-hidden="true">
        ${[6, 58, 110].map((y) => `<path d="M0,${y}H300" class="hist-grid"/>`).join('')}
        ${all.map((s) => `<path d="${s.d.P.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join('')}" fill="none" style="stroke:rgb(${s.color})" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('')}
      </svg>
      <span class="hist-y top">${x.fmtNum(max)}${x.esc(unit)}</span><span class="hist-y bot">${x.fmtNum(min)}${x.esc(unit)}</span>
      <div class="hist-x"><span>${fmtT(t0)}</span><span>${fmtT(now)}</span></div></div>`;
  }
  const legend = series.map((s) => `<span class="lg"><i style="background:rgb(${s.color})"></i>${x.esc(s.name)} <b>${x.esc(x.isUnavail(s.e) ? '–' : x.fmtState(s.e))}</b></span>`).join('');
  return `<div class="card hist full" data-key="${keyOf(c, x, 'hist')}">${c.title ? `<h3 class="card-title">${x.esc(val(c.title, x))}</h3>` : ''}${body}<div class="legend">${legend}</div></div>`;
}

/* ---------- gauge ---------- */
function gauge(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const na = x.isUnavail(e);
  const v = parseFloat(e.state);
  const min = c.min ?? 0;
  const max = c.max ?? 100;
  const pct = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / (max - min))) * 100 : 0;
  let color = c.color || 'blue';
  if (c.severity && Number.isFinite(v)) for (const [from, col] of [...c.severity].sort((a, b) => a[0] - b[0])) if (v >= from) color = col;
  const unit = c.unit ?? e.attributes.unit_of_measurement ?? '';
  const name = val(c.name, x, id) ?? x.friendly(e);
  return `<div class="card gauge${full(c)}" style="--tint:${tintOf(color) || PALETTE.blue}" data-key="${keyOf(c, x)}">
    <svg viewBox="0 0 120 66" aria-hidden="true"><path class="g-track" d="M10 60 A50 50 0 0 1 110 60" pathLength="100"/><path class="g-val" d="M10 60 A50 50 0 0 1 110 60" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"/></svg>
    <div class="g-txt"><strong>${na || !Number.isFinite(v) ? '–' : x.fmtNum(v, c.digits)}<em>${x.esc(unit)}</em></strong><span>${x.esc(name)}</span></div>
    <div class="g-range"><span>${x.fmtNum(min)}</span><span>${x.fmtNum(max)}</span></div>
  </div>`;
}

/* ---------- number (input_number / number) ---------- */
function number(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const d = domainOf(id);
  const na = x.isUnavail(e);
  const A = e.attributes;
  const min = parseFloat(A.min ?? 0);
  const max = parseFloat(A.max ?? 100);
  const step = parseFloat(A.step ?? 1) || 1;
  const unit = c.unit ?? A.unit_of_measurement ?? '';
  const cur = x.pending[id] ?? parseFloat(e.state);
  const name = val(c.name, x, id) ?? x.friendly(e);
  const tint = tintOf(val(c.color, x, id)) || PALETTE.blue;
  const dec = (String(step).split('.')[1] || '').length;
  const clamp = (v) => Math.min(max, Math.max(min, +(Math.round(v / step) * step).toFixed(dec)));
  const disp = Number.isFinite(cur) ? `${x.fmtNum(cur, dec)}${unit ? ' ' + unit : ''}` : '–';
  const svc = `${d}.set_value`;
  const ctl = na || !Number.isFinite(cur) ? '' : c.mode === 'buttons'
    ? `<div class="num-btns">
        <button class="round" data-act="${x.act({ service: svc, target: 'self', data: { value: clamp(cur - step) }, optimistic: { state: String(clamp(cur - step)) } }, id)}" aria-label="${x.t('lower')}">${icon('minus')}</button>
        <strong>${x.esc(disp)}</strong>
        <button class="round" data-act="${x.act({ service: svc, target: 'self', data: { value: clamp(cur + step) }, optimistic: { state: String(clamp(cur + step)) } }, id)}" aria-label="${x.t('raise')}">${icon('plus')}</button></div>`
    : `<input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${cur}" data-action="number" data-unit="${x.esc(unit)}" data-entity="${x.esc(id)}" aria-label="${x.esc(name)}" style="--pct:${(((cur - min) / (max - min || 1)) * 100).toFixed(1)}%">`;
  return `<div class="tile number${na ? ' na' : ''}${full(c, c.mode !== 'buttons')}" style="--tint:${tint}" data-key="${keyOf(c, x)}">
    <div class="tile-main"><span class="tile-ic">${icon(val(c.icon, x, id) || 'gauge')}</span>
      <span class="tile-txt"><strong>${x.esc(name)}</strong><small>${na ? x.t('offline') : c.mode === 'buttons' ? x.esc(`${x.fmtNum(min)}–${x.fmtNum(max)} ${unit}`) : x.esc(disp)}</small></span></div>
    ${ctl}
  </div>`;
}

/* ---------- select ---------- */
function select(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const d = domainOf(id);
  const na = x.isUnavail(e);
  const options = c.options || e.attributes.options || [];
  const cur = c.attribute ? e.attributes[c.attribute] : e.state;
  const service = c.service || `${d === 'input_select' ? 'input_select' : 'select'}.select_option`;
  const field = c.field || 'option';
  const name = val(c.name, x, id) ?? x.friendly(e);
  const btns = options.map((o) => `<button class="mode${cur === o ? ' active' : ''}" data-key="o-${x.esc(o)}" data-act="${x.act({ service, target: c.service ? undefined : 'self', data: c.service ? { entity_id: id, [field]: o } : { [field]: o }, optimistic: c.attribute ? { attributes: { [c.attribute]: o } } : { state: o } }, id)}">${x.esc(c.labels?.[o] ?? o)}</button>`).join('');
  return `<div class="tile select${na ? ' na' : ''} full" style="--tint:${tintOf(val(c.color, x, id)) || PALETTE.blue}" data-key="${keyOf(c, x)}">
    <div class="tile-main"><span class="tile-ic">${icon(val(c.icon, x, id) || 'grid')}</span><span class="tile-txt"><strong>${x.esc(name)}</strong><small>${na ? x.t('offline') : x.esc(c.labels?.[cur] ?? cur ?? '')}</small></span></div>
    ${na ? '' : `<div class="modes">${btns}</div>`}
  </div>`;
}

/* ---------- vacuum ---------- */
function vacuum(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const na = x.isUnavail(e);
  const st = e.state;
  const cleaning = st === 'cleaning';
  const bat = e.attributes.battery_level;
  const name = val(c.name, x, id) ?? x.friendly(e);
  const b = (svc, ic, lbl) => `<button data-act="${x.act({ service: `vacuum.${svc}`, target: 'self' }, id)}">${icon(ic)}<span>${x.esc(lbl)}</span></button>`;
  return `<div class="tile vac${cleaning ? ' on' : ''}${na ? ' na' : ''} full" style="--tint:${PALETTE.teal}" data-key="${keyOf(c, x)}">
    <div class="tile-main"><span class="tile-ic">${icon('vacuum', cleaning ? 'spin' : '')}</span>
      <span class="tile-txt"><strong>${x.esc(name)}</strong><small>${na ? x.t('offline') : x.esc(x.tOr('vac_' + st, st))}${bat != null ? ` · ${icon('battery')} ${bat}%` : ''}${e.attributes.fan_speed ? ` · ${x.esc(e.attributes.fan_speed)}` : ''}</small></span></div>
    ${na ? '' : `<div class="btn-grid four">${cleaning ? b('pause', 'pause', x.t('vac_pause')) : b('start', 'play', x.t('vac_start'))}${b('stop', 'stop', x.t('vac_stop'))}${b('return_to_base', 'home', x.t('vac_home'))}${b('locate', 'mapPin', x.t('vac_locate'))}</div>`}
  </div>`;
}

/* ---------- camera ---------- */
function camera(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const url = x.isUnavail(e) ? '' : x.cam(e, c.live);
  return `<div class="card cam full" data-key="${keyOf(c, x)}"><div class="cam-frame">
    ${url ? `<img src="${x.esc(url)}" alt="${x.esc(val(c.name, x, id) || '')}">` : `<div class="cam-ph">${icon('camera')}<span>${x.t(x.isUnavail(e) ? 'offline' : 'no_image')}</span></div>`}
    ${c.name ? `<span class="cam-name">${x.esc(val(c.name, x, id))}</span>` : ''}
  </div></div>`;
}

/* ---------- info table ---------- */
function info(c, x) {
  const rows = (c.rows || []).map((r, i) => {
    if (r.show && !val(r.show, x, r.entity)) return '';
    const e = r.entity ? x.ent(r.entity) : null;
    const label = val(r.label, x, r.entity) ?? (e ? x.friendly(e) : '');
    const v = r.value != null ? val(r.value, x, r.entity) : e ? (x.isUnavail(e) ? '–' : r.attribute ? e.attributes[r.attribute] ?? '–' : x.fmtState(e)) : '';
    return `<div class="row-i" data-key="r${i}"><dt>${r.icon ? icon(r.icon) : ''}${x.esc(label)}</dt><dd>${x.esc(v)}${r.unit ? ' ' + x.esc(r.unit) : ''}</dd></div>`;
  }).join('');
  if (!rows) return '';
  return `<div class="card info full" data-key="${keyOf(c, x, 'info')}">${c.title ? `<h3 class="card-title">${x.esc(val(c.title, x))}</h3>` : ''}<dl>${rows}</dl></div>`;
}

/* ---------- location ---------- */
function location(c, x) {
  const id = c.entity;
  const e = x.ent(id);
  const lat = parseFloat(e.attributes.latitude);
  const lon = parseFloat(e.attributes.longitude);
  const has = Number.isFinite(lat) && Number.isFinite(lon);
  const d = 0.006;
  const embed = has ? `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}` : '';
  return `<div class="card loc full" data-key="${keyOf(c, x)}">
    <div class="loc-head"><span class="sc-ic">${icon('mapPin')}</span><div><strong>${x.esc(val(c.name, x, id) ?? x.friendly(e))}</strong><small>${x.esc(x.fmtState(e))}</small></div>
      ${has ? `<a class="soft-btn" href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">${icon('map')}${x.t('map')}</a>` : ''}</div>
    ${has && c.map !== false ? `<iframe class="loc-map" src="${x.esc(embed)}" loading="lazy" title="${x.esc(x.t('map'))}"></iframe>` : ''}
  </div>`;
}

/* ---------- floorplan ---------- */
function floorplan(c, x) {
  const src = x.asset(c.image);
  const items = (c.items || []).map((it, i) => {
    const e = x.ent(it.entity);
    const on = x.isOn(e);
    const na = x.isUnavail(e);
    const nm = it.name || x.friendly(e);
    return `<button class="fp-it${on ? ' on' : ''}${na ? ' na' : ''}" data-key="fp${i}" style="left:${it.x};top:${it.y};--tint:${tintOf(it.color) || PALETTE.amber}" data-act="${x.act(it.tap || 'toggle', it.entity)}" ${na ? 'disabled' : ''} title="${x.esc(nm)}" aria-label="${x.esc(nm)}: ${x.esc(x.fmtState(e))}">${icon(it.icon || 'bulb')}</button>`;
  }).join('');
  return `<div class="card fp full" data-key="${keyOf(c, x, 'fp')}"><div class="fp-wrap${src ? '' : ' ph'}">${src ? `<img src="${x.esc(src)}" alt="">` : ''}${items}</div></div>`;
}

/* ---------- batteries ---------- */
function batteries(c, x) {
  const rows = (c.items || []).map((it, i) => {
    const e = x.ent(it.entity);
    const v = parseFloat(e.state);
    const ok = Number.isFinite(v) && !x.isUnavail(e);
    const col = !ok ? 'grey' : v <= 15 ? 'red' : v <= 30 ? 'amber' : 'green';
    return `<div class="bat" data-key="b${i}" style="--tint:${PALETTE[col]}"><span class="tile-ic sm">${icon(it.icon || 'battery')}</span><span class="bat-name">${x.esc(it.name || x.friendly(e))}</span><span class="bat-bar"><i style="width:${ok ? Math.max(3, v) : 0}%"></i></span><b>${ok ? Math.round(v) + '%' : '–'}</b></div>`;
  }).join('');
  return `<div class="card bats full" data-key="${keyOf(c, x, 'bats')}">${rows}</div>`;
}

/* ---------- chips ---------- */
function chips(c, x) {
  const list = (c.chips || []).map((ch, i) => {
    if (ch.show && !val(ch.show, x, ch.entity)) return '';
    const e = ch.entity ? x.ent(ch.entity) : null;
    const text = ch.text != null ? val(ch.text, x, ch.entity) : e ? x.fmtState(e) : '';
    const tint = tintOf(val(ch.color, x, ch.entity)) || PALETTE.blue;
    const tap = ch.tap ? x.act(ch.tap, ch.entity) : null;
    const tag = tap != null ? 'button' : 'span';
    return `<${tag} class="hchip cchip" data-key="c${i}" style="--tint:${tint}"${tap != null ? ` data-act="${tap}"` : ''}>${icon(val(ch.icon, x, ch.entity) || defaultIcon(e))}<span>${x.esc(text)}</span></${tag}>`;
  }).join('');
  if (!list.trim()) return '';
  return `<div class="chips-row full" data-key="${keyOf(c, x, 'chips')}">${list}</div>`;
}

const TYPES = { tile, light, fan, cover, climate, sensor, history, gauge, number, select, vacuum, camera, info, location, floorplan, batteries, chips };
