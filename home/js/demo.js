// A simulated home that behaves like Home Assistant, used until a real instance is connected.
const AREAS = [
  { id: 'living', name: 'Living Room' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'studio', name: 'Studio' },
  { id: 'lab', name: 'Lab' },
  { id: 'office', name: 'Office' },
  { id: 'bedroom', name: 'Bedroom' },
  { id: 'inventory', name: 'Inventory' },
  { id: 'garden', name: 'Garden' },
];

function st(entity_id, state, attributes = {}) {
  return { entity_id, state, attributes, last_changed: new Date().toISOString() };
}
const light = (area, id, name, on, bri = 180, extra = {}) => [area, st(`light.${id}`, on ? 'on' : 'off', {
  friendly_name: name, supported_color_modes: ['brightness'], color_mode: on ? 'brightness' : null, brightness: on ? bri : null, ...extra,
})];
const onoff = (area, id, name, on) => [area, st(`light.${id}`, on ? 'on' : 'off', { friendly_name: name, supported_color_modes: ['onoff'] })];
const fan = (area, id, name, on, pct = 50) => [area, st(`fan.${id}`, on ? 'on' : 'off', { friendly_name: name, percentage: on ? pct : 0, percentage_step: 25 })];
const temp = (area, id, name, v) => [area, st(`sensor.${id}_temperature`, String(v), { friendly_name: name, device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' })];
const hum = (area, id, name, v) => [area, st(`sensor.${id}_humidity`, String(v), { friendly_name: name, device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement' })];

function buildEntities() {
  return [
    light('living', 'living_ceiling', 'Living Room Ceiling', true, 200),
    light('living', 'living_floor_lamp', 'Living Room Floor Lamp', true, 120, { supported_color_modes: ['color_temp'], color_temp_kelvin: 2700 }),
    light('living', 'living_tv_strip', 'Living Room TV Strip', false, 0, { supported_color_modes: ['hs'], rgb_color: [120, 90, 255] }),
    light('living', 'living_shelf', 'Living Room Shelf', false),
    fan('living', 'living_fan', 'Living Room Fan', false),
    temp('living', 'living', 'Living Room Temperature', 22.4),
    hum('living', 'living', 'Living Room Humidity', 44),
    ['living', st('climate.living_room', 'heat', {
      friendly_name: 'Living Room Thermostat', hvac_modes: ['off', 'heat', 'cool', 'auto'], current_temperature: 22.4,
      temperature: 22.5, min_temp: 7, max_temp: 30, target_temp_step: 0.5, hvac_action: 'idle',
    })],
    ['living', st('lock.front_door', 'locked', { friendly_name: 'Front Door' })],
    ['living', st('binary_sensor.living_motion', 'off', { friendly_name: 'Living Room Motion', device_class: 'motion' })],

    light('kitchen', 'kitchen_ceiling', 'Kitchen Ceiling', false),
    light('kitchen', 'kitchen_island', 'Kitchen Island', true, 230),
    onoff('kitchen', 'kitchen_cabinets', 'Kitchen Cabinets', false),
    ['kitchen', st('switch.coffee_machine', 'off', { friendly_name: 'Coffee Machine' })],
    temp('kitchen', 'kitchen', 'Kitchen Temperature', 23.1),
    hum('kitchen', 'kitchen', 'Kitchen Humidity', 51),

    ...Array.from({ length: 8 }, (_, i) => light('studio', `studio_spot_${i + 1}`, `Studio Spot ${i + 1}`, i < 3, 150 + i * 10)),
    fan('studio', 'studio_fan_1', 'Studio Fan 1', false),
    fan('studio', 'studio_fan_2', 'Studio Fan 2', false),
    temp('studio', 'studio', 'Studio Temperature', 24.0),
    hum('studio', 'studio', 'Studio Humidity', 38),

    ...Array.from({ length: 4 }, (_, i) => light('lab', `lab_${i + 1}`, `Lab Light ${i + 1}`, i === 0, 210)),
    ['lab', st('fan.lab_fan', 'unavailable', { friendly_name: 'Lab Fan' })],
    ['lab', st('switch.soldering_station', 'on', { friendly_name: 'Soldering Station' })],
    temp('lab', 'lab', 'Lab Temperature', 25.3),

    ...Array.from({ length: 4 }, (_, i) => light('office', `office_${i + 1}`, ['Office Desk', 'Office Ceiling', 'Office Monitor Bar', 'Office Lamp'][i], i === 0 || i === 2, 190)),
    fan('office', 'office_fan', 'Office Fan', true, 50),
    ['office', st('cover.office_blinds', 'open', { friendly_name: 'Office Blinds', current_position: 70, supported_features: 15 })],
    temp('office', 'office', 'Office Temperature', 23.6),
    hum('office', 'office', 'Office Humidity', 42),

    light('bedroom', 'bedroom_ceiling', 'Bedroom Ceiling', false),
    light('bedroom', 'bedroom_bedside_left', 'Bedroom Bedside Left', false, 60, { supported_color_modes: ['color_temp'] }),
    light('bedroom', 'bedroom_bedside_right', 'Bedroom Bedside Right', false, 60, { supported_color_modes: ['color_temp'] }),
    ['bedroom', st('cover.bedroom_curtains', 'closed', { friendly_name: 'Bedroom Curtains', current_position: 0, supported_features: 15 })],
    temp('bedroom', 'bedroom', 'Bedroom Temperature', 21.2),
    hum('bedroom', 'bedroom', 'Bedroom Humidity', 47),

    ...Array.from({ length: 4 }, (_, i) => ['inventory', st(`light.inventory_${i + 1}`, 'unavailable', { friendly_name: `Inventory Light ${i + 1}` })]),
    ['inventory', st('fan.inventory_fan', 'unavailable', { friendly_name: 'Inventory Fan' })],

    light('garden', 'garden_path', 'Garden Path', false),
    light('garden', 'garden_porch', 'Garden Porch', false),
    ['garden', st('switch.garden_irrigation', 'off', { friendly_name: 'Garden Irrigation' })],
    ['garden', st('binary_sensor.garden_gate', 'off', { friendly_name: 'Garden Gate', device_class: 'door' })],
    [null, st('weather.home', 'partlycloudy', { friendly_name: 'Home', temperature: 18, temperature_unit: '°C', humidity: 62 })],
  ];
}

export class DemoBackend {
  constructor({ onStatus, onSnapshot, onState }) {
    this.cb = { onStatus, onSnapshot, onState };
    this.entities = {};
    this.entityArea = {};
  }

  connect() {
    for (const [area, s] of buildEntities()) {
      this.entities[s.entity_id] = s;
      if (area) this.entityArea[s.entity_id] = area;
    }
    this.cb.onSnapshot({
      entities: { ...this.entities },
      areas: AREAS.map((a) => ({ ...a, icon: '', picture: '' })),
      entityArea: { ...this.entityArea },
      registryHidden: new Set(),
      config: { location_name: 'Demo Home', temp_unit: '°C', version: 'demo' },
    });
    this.cb.onStatus('connected');
    this.drift = setInterval(() => this.wander(), 20_000);
  }

  wander() {
    for (const s of Object.values(this.entities)) {
      const dc = s.attributes.device_class;
      if (s.entity_id.startsWith('sensor.') && (dc === 'temperature' || dc === 'humidity')) {
        const step = dc === 'temperature' ? 0.1 : 1;
        const v = parseFloat(s.state) + (Math.random() < 0.5 ? -step : step) * (Math.random() < 0.6 ? 1 : 0);
        this.set(s.entity_id, dc === 'temperature' ? v.toFixed(1) : String(Math.round(v)));
      }
    }
  }

  set(id, state, attrs = {}) {
    const old = this.entities[id];
    if (!old) return;
    const next = { ...old, state, attributes: { ...old.attributes, ...attrs }, last_changed: new Date().toISOString() };
    this.entities[id] = next;
    if (id.startsWith('sensor.') && next.attributes.device_class === 'temperature' && this.entityArea[id] === 'living') {
      const c = this.entities['climate.living_room'];
      if (c) this.set('climate.living_room', c.state, { current_temperature: parseFloat(state) });
    }
    setTimeout(() => this.cb.onState(id, next), 120);
  }

  async callService(domain, service, data = {}, target = {}) {
    let ids = target.entity_id || data.entity_id || [];
    if (!Array.isArray(ids)) ids = [ids];
    for (const id of ids) {
      const e = this.entities[id];
      if (!e || e.state === 'unavailable') continue;
      const d = id.split('.')[0];
      const svc = service === 'toggle' ? (e.state === 'on' ? 'turn_off' : 'turn_on') : service;
      if (d === 'light') {
        if (svc === 'turn_off') this.set(id, 'off', { brightness: null });
        else if (svc === 'turn_on') {
          const dimmable = !(e.attributes.supported_color_modes || []).every((m) => m === 'onoff');
          const bri = data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : (e.attributes.brightness || 200);
          this.set(id, 'on', dimmable ? { brightness: bri } : {});
        }
      } else if (d === 'fan') {
        if (svc === 'turn_off' || (svc === 'set_percentage' && data.percentage === 0)) this.set(id, 'off', { percentage: 0 });
        else if (svc === 'turn_on') this.set(id, 'on', { percentage: e.attributes.percentage || 50 });
        else if (svc === 'set_percentage') this.set(id, 'on', { percentage: data.percentage });
      } else if (d === 'switch') {
        if (svc === 'turn_on' || svc === 'turn_off') this.set(id, svc === 'turn_on' ? 'on' : 'off');
      } else if (d === 'cover') {
        if (svc === 'open_cover') this.set(id, 'open', { current_position: 100 });
        else if (svc === 'close_cover') this.set(id, 'closed', { current_position: 0 });
        else if (svc === 'set_cover_position') this.set(id, data.position > 0 ? 'open' : 'closed', { current_position: data.position });
      } else if (d === 'lock') {
        if (svc === 'lock' || svc === 'unlock') this.set(id, svc === 'lock' ? 'locked' : 'unlocked');
      } else if (d === 'climate') {
        if (svc === 'set_temperature') this.set(id, e.state, { temperature: data.temperature, hvac_action: data.temperature > e.attributes.current_temperature && e.state === 'heat' ? 'heating' : 'idle' });
        else if (svc === 'set_hvac_mode') this.set(id, data.hvac_mode, { hvac_action: data.hvac_mode === 'off' ? 'off' : 'idle' });
      }
    }
  }

  close() { clearInterval(this.drift); }
}
