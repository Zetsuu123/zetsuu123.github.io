// A simulated home built from config.js: every entity the config mentions gets a plausible fake state,
// so the dashboard can be previewed before Home Assistant is connected.
const ENTITY_RE = /\b((?:switch|light|sensor|binary_sensor|climate|cover|fan|vacuum|camera|weather|automation|input_number|number|select|input_select|input_boolean|button|script|device_tracker|media_player|lock)\.[a-z0-9_]+)\b/g;
// Service names that look like entity IDs.
const NOT_ENTITIES = new Set(['button.press', 'climate.turn_off', 'light.turn_on', 'vacuum.set_fan_speed']);

function collect(cfg) {
  const ids = new Set();
  const seen = new WeakSet();
  const walk = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(ENTITY_RE)) ids.add(m[1]); }
    else if (typeof v === 'function') { for (const m of v.toString().matchAll(ENTITY_RE)) ids.add(m[1]); }
    else if (v && typeof v === 'object') { if (seen.has(v)) return; seen.add(v); Object.values(v).forEach(walk); }
  };
  walk(cfg);
  for (const r of cfg.rooms || []) for (const l of r.lights || []) ids.add(l.entity);
  return [...ids].filter((id) => !NOT_ENTITIES.has(id));
}

const pretty = (id) => id.split('.')[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fake(id) {
  const [d, obj] = id.split('.');
  const A = { friendly_name: pretty(id) };
  const st = (state, extra = {}) => ({ entity_id: id, state: String(state), attributes: { ...A, ...extra }, last_changed: new Date(Date.now() - rnd(2, 180) * 60000).toISOString() });
  const has = (...k) => k.some((w) => obj.includes(w));
  switch (d) {
    case 'switch':
      if (has('water_valve')) return st('off');
      if (has('water_heater')) return st('off');
      if (has('100226ea15', '10024f9788', 'wi_fi', 'power_cool')) return st(has('power_cool', 'guest') ? 'off' : 'on');
      return st(Math.random() < 0.35 ? 'on' : 'off');
    case 'light': {
      const on = Math.random() < 0.5;
      return st(on ? 'on' : 'off', { supported_color_modes: obj.startsWith('h') ? ['color_temp', 'hs'] : ['brightness'], color_mode: on ? (obj.startsWith('h') ? 'hs' : 'brightness') : null, brightness: on ? 180 : null, rgb_color: obj.startsWith('h') ? [120, 90, 255] : null });
    }
    case 'automation': case 'input_boolean': return st(Math.random() < 0.7 ? 'on' : 'off');
    case 'script': case 'button': return st('unknown');
    case 'binary_sensor':
      if (has('door')) return st('off', { device_class: 'door' });
      if (has('1001f29270')) return st('off', { device_class: 'door' });
      if (has('occupancy', 'motion')) return st(Math.random() < 0.3 ? 'on' : 'off', { device_class: 'occupancy' });
      if (has('port_')) return st(has('lan4', 'port_5', 'lan3') ? 'off' : 'on', { device_class: 'connectivity', speed_mbps: has('wan') ? 1000 : pick([100, 1000]), uplink: has('wan') });
      if (has('internet', 'online')) return st('on', { device_class: 'connectivity' });
      return st('on');
    case 'climate':
      return st(has('samsung') ? 'heat' : 'off', {
        hvac_modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'], fan_modes: ['auto', 'low', 'medium', 'high'], fan_mode: 'auto',
        current_temperature: has('samsung') ? 21.5 : 23, temperature: 22, min_temp: 16, max_temp: 30, target_temp_step: 1, hvac_action: has('samsung') ? 'heating' : 'off',
      });
    case 'cover': return st('open', { current_position: 60, supported_features: 15, device_class: 'awning' });
    case 'vacuum': return st('docked', { fan_speed: 'Standard', battery_level: 100, filter_left: 118, main_brush_left: 187, side_brush_left: 92, sensor_dirty_left: 21, cleaning_count: 342 });
    case 'camera': return st('idle');
    case 'weather': return st('partlycloudy', { temperature: 17, temperature_unit: '°C', humidity: 62 });
    case 'media_player': return st('on');
    case 'device_tracker': return st('home', { latitude: 37.9838, longitude: 23.7275, gps_accuracy: 12 });
    case 'select': case 'input_select': return st('medium', { options: ['low', 'medium', 'high'] });
    case 'input_number': case 'number': {
      if (has('water_heater_timer')) return st(60, { min: 10, max: 120, step: 5, unit_of_measurement: 'min' });
      if (has('valve_auto_off')) return st(15, { min: 1, max: 60, step: 1, unit_of_measurement: 'min' });
      if (has('fridge_temperature')) return st(3, { min: 1, max: 7, step: 1, unit_of_measurement: '°C' });
      if (has('freezer_temperature')) return st(-19, { min: -23, max: -15, step: 1, unit_of_measurement: '°C' });
      if (has('extruder_target')) return st(220, { min: 0, max: 300, step: 5, unit_of_measurement: '°C' });
      if (has('bed_target')) return st(60, { min: 0, max: 110, step: 5, unit_of_measurement: '°C' });
      if (has('speed_factor')) return st(100, { min: 50, max: 300, step: 10, unit_of_measurement: '%' });
      if (has('timeout')) return st(60, { min: 0, max: 300, step: 10, unit_of_measurement: 's' });
      return st(80, { min: 0, max: 100, step: 1, unit_of_measurement: '%' });
    }
    case 'sensor': {
      const n = (v, unit, dc, extra) => st(v, { unit_of_measurement: unit, device_class: dc, state_class: 'measurement', ...extra });
      if (has('k1c_cfs')) return st('ok', {
        T1: { temperature: 27, dry_and_humidity: 38, color_value: ['0FFFFFF', '0F5A623', '0000000', '-1'] },
        T2: { temperature: 26, dry_and_humidity: 46, color_value: ['01E88E5', 'unknown', '0E53935', '043A047'] },
        same_material: [[0, 0, ['T1A'], 'PLA'], [0, 0, ['T1B'], 'PETG'], [0, 0, ['T1C'], 'PLA'], [0, 0, ['T2A'], 'PLA Silk'], [0, 0, ['T2C'], 'ABS'], [0, 0, ['T2D'], 'TPU']],
      });
      if (has('current_print_state')) return st('printing');
      if (has('filename')) return st('benchy_v2.gcode');
      if (has('print_eta')) return st(new Date(Date.now() + 96 * 60000).toISOString(), { device_class: 'timestamp' });
      if (has('printer_message')) return st('Printing in progress');
      if (has('wan_ip')) return st('203.0.113.24');
      if (has('freezer_temperature')) return n(-18.6, '°C', 'temperature');
      if (has('fridge_temperature', 'cooler_temperature')) return n(3.8, '°C', 'temperature');
      if (has('extruder_temperature')) return n(219.6, '°C', 'temperature');
      if (has('bed_temperature')) return n(60.1, '°C', 'temperature');
      if (has('chamber')) return n(36.4, '°C', 'temperature');
      if (has('mcu_temp')) return n(44.8, '°C', 'temperature');
      if (has('cpu_temp')) return n(48, '°C', 'temperature');
      if (has('gpu_temp')) return n(52, '°C', 'temperature');
      if (has('balcony') && has('temperature')) return n(17.2, '°C', 'temperature');
      if (has('bathroom') && has('temperature')) return n(23.4, '°C', 'temperature');
      if (has('temperature')) return n(21.8, '°C', 'temperature');
      if (has('balcony') && has('humidity')) return n(64, '%', 'humidity');
      if (has('humidity')) return n(has('bathroom') ? 58 : 47, '%', 'humidity');
      if (has('battery')) return n(Math.round(rnd(18, 100)), '%', 'battery');
      if (has('_power')) {
        const w = has('water_heater') ? 0 : has('1002328ae7') ? 860 : has('pc_') ? 185 : has('100226ea15') ? 142 : has('10024f9788') ? 420 : has('1002270788') ? 11 : 60;
        return n(w, 'W', 'power');
      }
      if (has('voltage')) return n(231.4, 'V', 'voltage');
      if (has('current') && !has('currentclock', 'current_layer', 'current_print')) return n(has('1002328ae7') ? 3.8 : 0.6, 'A', 'current');
      if (has('energy_day')) return n(has('1002328ae7') ? 6.4 : 0.8, 'kWh', 'energy');
      if (has('energy_month')) return n(has('1002328ae7') ? 142 : 18, 'kWh', 'energy');
      if (has('progress')) return n(42, '%');
      if (has('current_layer')) return st(126);
      if (has('total_layer')) return st(300);
      if (has('print_duration')) return n(95, 'min');
      if (has('time_left')) return n(1.6, 'h');
      if (has('print_speed')) return n(250, 'mm/s');
      if (has('filament_used')) return n(3.2, 'm');
      if (has('object_height')) return n(18.4, 'mm');
      if (has('latency')) return n(18, 'ms');
      if (has('wi_fi_clients')) return st(17);
      if (has('wired_clients')) return st(5);
      if (has('clients')) return st(22);
      if (has('download')) return n(24.6, 'Mbit/s', 'data_rate');
      if (has('upload')) return n(3.1, 'Mbit/s', 'data_rate');
      if (has('utilization')) return n(has('2_4g') ? 54 : 22, '%');
      if (has('flow')) return n(0, 'L/min');
      if (has('irrigation_volume')) return n(45, 'L');
      if (has('free_space')) return n(Math.round(rnd(80, 900)), 'GB');
      if (has('cpuload', 'gpu_usage', 'memoryusage')) return n(Math.round(rnd(10, 60)), '%');
      if (has('mem_clock')) return n(9501, 'MHz');
      if (has('clock')) return n(Math.round(rnd(3200, 4800)), 'MHz');
      if (has('ram_used')) return n(12.4, 'GB');
      if (has('spx')) return n(5912.4, 'USD');
      if (has('ndx')) return n(20840.7, 'USD');
      if (has('btc')) return n(82450, 'EUR');
      if (has('eth')) return n(2915.3, 'EUR');
      return n(Math.round(rnd(1, 100)), '');
    }
    default: return st('unknown');
  }
}

export class DemoBackend {
  constructor(cfg, { onStatus, onSnapshot, onState }) {
    this.cfg = cfg;
    this.cb = { onStatus, onSnapshot, onState };
    this.entities = {};
  }

  connect() {
    for (const id of collect(this.cfg)) this.entities[id] = fake(id);
    // Keep the demo stories consistent: a print running, the valve closed, freezer cold.
    this.cb.onSnapshot({
      entities: { ...this.entities }, areas: [], entityArea: {}, registryHidden: new Set(),
      config: { location_name: this.cfg.title || 'Demo', temp_unit: '°C', version: 'demo' },
    });
    this.cb.onStatus('connected');
    this.drift = setInterval(() => this.wander(), 15_000);
  }

  wander() {
    for (const s of Object.values(this.entities)) {
      if (!s.entity_id.startsWith('sensor.') || s.attributes.state_class !== 'measurement') continue;
      const v = parseFloat(s.state);
      if (!Number.isFinite(v) || v === 0) continue;
      const nv = v * (1 + (Math.random() - 0.5) * 0.01);
      this.set(s.entity_id, Math.abs(v) >= 100 ? Math.round(nv) : nv.toFixed(1));
    }
  }

  set(id, state, attrs = {}) {
    const old = this.entities[id];
    if (!old) return;
    const next = { ...old, state: String(state), attributes: { ...old.attributes, ...attrs }, last_changed: new Date().toISOString() };
    this.entities[id] = next;
    setTimeout(() => this.cb.onState(id, next), 120);
  }

  async history(ids, hours) {
    const out = {};
    const now = Date.now() / 1000;
    for (const id of ids) {
      const v = parseFloat(this.entities[id]?.state);
      if (!Number.isFinite(v)) { out[id] = []; continue; }
      const n = 96;
      const amp = Math.max(Math.abs(v) * 0.04, 0.5);
      const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 100;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = now - hours * 3600 + (i / n) * hours * 3600;
        const wave = Math.sin(i / 13 + seed) * 0.6 + Math.sin(i / 5.7 + seed * 1.7) * 0.25 + Math.sin(i / 2.3 + seed) * 0.08;
        pts.push([t, v + wave * amp * (i / n < 0.98 ? 1 : 0)]);
      }
      pts[pts.length - 1][1] = v;
      out[id] = pts;
    }
    return out;
  }

  async callService(domain, service, data = {}, target = {}) {
    if (domain === 'script' && service === 'turn_off_lights') {
      for (const r of this.cfg.rooms || []) for (const l of r.lights || []) {
        const e = this.entities[l.entity];
        if (e && e.state === 'on') this.set(l.entity, 'off', { brightness: null });
      }
      return;
    }
    let ids = target.entity_id || data.entity_id || [];
    if (!Array.isArray(ids)) ids = [ids];
    for (const id of ids) {
      const e = this.entities[id];
      if (!e || e.state === 'unavailable') continue;
      const d = id.split('.')[0];
      const svc = service === 'toggle' ? (e.state === 'on' ? 'turn_off' : 'turn_on') : service;
      if (svc === 'turn_off' && d === 'climate') this.set(id, 'off', { hvac_action: 'off' });
      else if (svc === 'turn_off') this.set(id, 'off', d === 'light' ? { brightness: null } : d === 'fan' ? { percentage: 0 } : {});
      else if (svc === 'turn_on' && d === 'light') {
        const dim = (e.attributes.supported_color_modes || []).some((m) => m !== 'onoff');
        const a = {};
        if (dim) a.brightness = data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : e.attributes.brightness || 200;
        if (data.rgb_color) Object.assign(a, { rgb_color: data.rgb_color, color_mode: 'hs' });
        if (data.color_temp_kelvin) Object.assign(a, { color_mode: 'color_temp' });
        this.set(id, 'on', a);
      } else if (svc === 'turn_on') this.set(id, 'on');
      else if (svc === 'set_value') this.set(id, data.value);
      else if (svc === 'select_option') this.set(id, data.option);
      else if (svc === 'set_percentage') this.set(id, data.percentage ? 'on' : 'off', { percentage: data.percentage });
      else if (svc === 'open_cover') this.set(id, 'open', { current_position: 100 });
      else if (svc === 'close_cover') this.set(id, 'closed', { current_position: 0 });
      else if (svc === 'set_cover_position') this.set(id, data.position > 0 ? 'open' : 'closed', { current_position: data.position });
      else if (svc === 'lock' || svc === 'unlock') this.set(id, svc === 'lock' ? 'locked' : 'unlocked');
      else if (svc === 'set_temperature') this.set(id, e.state, { temperature: data.temperature });
      else if (svc === 'set_hvac_mode') this.set(id, data.hvac_mode, { hvac_action: data.hvac_mode === 'off' ? 'off' : data.hvac_mode === 'cool' ? 'cooling' : data.hvac_mode === 'heat' ? 'heating' : 'idle' });
      else if (svc === 'set_fan_mode') this.set(id, e.state, { fan_mode: data.fan_mode });
      else if (svc === 'set_fan_speed') this.set(id, e.state, { fan_speed: data.fan_speed });
      else if (svc === 'start') this.set(id, 'cleaning');
      else if (svc === 'pause') this.set(id, 'paused');
      else if (svc === 'stop') this.set(id, 'idle');
      else if (svc === 'return_to_base') this.set(id, 'returning');
      else if (svc === 'vacuum_clean_segment') this.set(id, 'cleaning');
    }
  }

  close() { clearInterval(this.drift); }
}
