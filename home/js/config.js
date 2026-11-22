// ============================================================================
//  Dashboard configuration: edit this file to change what the dashboard shows.
// ============================================================================
//
//  Entity IDs come from Home Assistant (Settings → Devices & services → Entities).
//  Any value may be a function `h => ...` that is re-evaluated on every update.
//  `h` gives you the live state:
//     h.state(id)        → state string ('on', '21.5', 'unavailable', …)
//     h.is(id, 'on')     → true/false (the second argument can also be a list)
//     h.on(id)           → true when a switch/light/cover/… is on/open
//     h.num(id, d)       → state as a number (or d when it isn't one)
//     h.attr(id, name)   → an attribute
//     h.round(value, n)  → formatted number with n decimals
//     h.ago(id)          → time since the last change, e.g. "5 λεπτά"
//     h.time(value)      → a timestamp as HH:MM
//     h.lightsOn         → number of room lights currently on
//
//  Card types: tile, light, fan, cover, climate, sensor, history, gauge, number,
//  select, vacuum, camera, info, location, floorplan, batteries, chips.
//  Colours: red, deep-orange, orange, amber, yellow, green, teal, cyan, light-blue,
//  blue, indigo, purple, pink, grey, disabled, or any '#rrggbb'.
// ============================================================================

const onOff = (h, id) => (h.on(id) ? 'Ανοιχτό' : 'Κλειστό');
const openClosed = (h, id) => (h.is(id, 'on') ? 'Ανοιχτή' : 'Κλειστή');
const W = (h, id) => `${h.round(h.num(id, 0))} W`;

// ---- helpers that build repeated cards ------------------------------------
const speedText = (h, id) => {
  const s = parseInt(h.attr(id, 'speed_mbps'), 10) || 0;
  return s === 0 ? '—' : s >= 1000 ? `${Math.floor(s / 1000)} Gb` : `${s} Mb`;
};
const port = (entity, name) => ({
  type: 'tile', entity, name, layout: 'vertical', tap: false,
  icon: (h) => (h.attr(entity, 'uplink') ? 'arrowUpCircle' : 'ethernet'),
  color: (h) => (h.is(entity, 'on') ? 'green' : 'disabled'),
  sub: (h) => speedText(h, entity),
});
const vacRoom = (name, icon, color, segments) => ({
  type: 'tile', name, icon, color, layout: 'vertical',
  tap: { service: 'xiaomi_miio.vacuum_clean_segment', data: { entity_id: 'vacuum.d20_pro_plus', segments }, confirm: `Καθάρισμα: ${name};` },
});
const meter = (title, p) => ({
  title, icon: 'bolt', cols: 3,
  cards: [
    { type: 'sensor', entity: `sensor.${p}_voltage`, name: 'Τάση', color: 'blue' },
    { type: 'sensor', entity: `sensor.${p}_current`, name: 'Ένταση', color: 'cyan' },
    { type: 'sensor', entity: `sensor.${p}_power`, name: 'Κατανάλωση', color: 'amber' },
    { type: 'tile', entity: `sensor.${p}_energy_day`, name: 'Ημέρα', icon: 'calendar', color: 'amber', tap: false },
    { type: 'tile', entity: `sensor.${p}_energy_month`, name: 'Μήνας', icon: 'calendar', color: 'orange', tap: false },
  ],
});
// K1C filament slots (CFS)
const cfsUnit = (n) => ({
  type: 'tile', entity: 'sensor.k1c_cfs', name: `CFS ${n}`, icon: 'printer', tap: false, span: 2,
  sub: (h) => { const u = h.attr('sensor.k1c_cfs', `T${n}`) || {}; return `${u.temperature ?? '–'} °C · υγρασία ${u.dry_and_humidity ?? '–'}%`; },
  color: (h) => ((parseInt((h.attr('sensor.k1c_cfs', `T${n}`) || {}).dry_and_humidity, 10) || 0) > 40 ? 'orange' : 'green'),
});
const cfsSlot = (n, i) => {
  const slot = `T${n}${'ABCD'[i]}`;
  return {
    type: 'tile', entity: 'sensor.k1c_cfs', icon: 'circle', tap: false, key: slot,
    name: (h) => {
      const m = (h.attr('sensor.k1c_cfs', 'same_material') || []).find((x) => String(x?.[2] ?? '').includes(slot));
      return `${slot} · ${m?.[3] || 'Άδειο'}`;
    },
    sub: '',
    color: (h) => {
      const c = String(((h.attr('sensor.k1c_cfs', `T${n}`) || {}).color_value || [])[i] ?? 'unknown');
      return c === 'unknown' || c === '-1' ? 'disabled' : c.slice(-6) === '000000' ? '#555555' : '#' + c.slice(-6);
    },
  };
};
const PRINTER_STATE = {
  printing: ['nozzle', 'Εκτυπώνει'], paused: ['pause', 'Σε παύση'], complete: ['check', 'Ολοκληρώθηκε'],
  cancelled: ['x', 'Ακυρώθηκε'], error: ['alert', 'Σφάλμα'], standby: ['moon', 'Σε αναμονή'],
};
const printing = (h) => h.is('sensor.k1c_current_print_state', ['printing', 'paused', 'complete']);
const motion = (id) => ({
  type: 'tile', entity: id, name: 'Κατάσταση', icon: 'activity', tap: false, color: (h) => (h.is(id, 'on') ? 'amber' : 'blue'),
});
const battery = (entity, name) => ({ entity, name });
const fanSpeedLabels = { Silent: 'Αθόρυβη', Standard: 'Κανονική', Strong: 'Δυνατή', Turbo: 'Turbo' };

export default {
  lang: 'el',
  title: 'Σπίτι',

  // Header & stat cards
  weather: 'weather.forecast_home',
  indoor: { temperature: 'sensor.0xa4c138dd530653be_temperature', humidity: 'sensor.0xa4c138dd530653be_humidity' },
  outdoor: { temperature: 'sensor.balcony_temp_sensor_temperature', humidity: 'sensor.balcony_temp_sensor_humidity' },
  energy: { power: 'sensor.sonoff_1002328ae7_power', day: 'sensor.sonoff_1002328ae7_energy_day', month: 'sensor.sonoff_1002328ae7_energy_month', page: 'energy' },

  // Small status chips under the greeting
  chips: [
    { icon: 'bulb', text: (h) => `${h.lightsOn} φώτα`, color: (h) => (h.lightsOn ? 'amber' : 'grey') },
    { entity: 'binary_sensor.sonoff_1001f29270', icon: (h) => 'door', color: (h) => (h.is('binary_sensor.sonoff_1001f29270', 'on') ? 'red' : 'green'), text: (h) => `Πόρτα ${openClosed(h, 'binary_sensor.sonoff_1001f29270').toLowerCase()}` },
    { show: (h) => h.is('switch.sonoff_10024f9788', 'on'), icon: 'washer', color: 'blue', text: (h) => `Πλυντήριο ${W(h, 'sensor.sonoff_10024f9788_power')}` },
    { show: (h) => h.is('switch.sonoff_100226ea15', 'on'), icon: 'printer', color: 'orange', text: (h) => `Printer ${W(h, 'sensor.sonoff_100226ea15_power')}`, tap: { nav: 'page:k1c' } },
    { show: (h) => h.is('switch.water_heater_sonoff_1002ba760e_1', 'on'), icon: 'boiler', color: 'red', text: 'Θερμοσίφωνας', tap: { nav: 'page:boiler' } },
  ],

  // Warnings shown at the top of the home page while their condition is true
  alerts: [
    {
      show: (h) => h.is('switch.water_valve', 'on'), entity: 'switch.water_valve', icon: 'valve', color: 'blue', tap: 'toggle',
      name: 'Η ΒΑΝΑ ΝΕΡΟΥ ΕΙΝΑΙ ΑΝΟΙΧΤΗ', sub: (h) => `Ανοιχτή εδώ και ${h.ago('switch.water_valve')} · πάτα για κλείσιμο`,
    },
    {
      show: (h) => (h.num('sensor.refrigerator_freezer_temperature', -99) > -15), icon: 'alert', color: 'red', tap: { nav: 'page:fridge' },
      name: 'ΚΑΤΑΨΥΞΗ ΖΕΣΤΗ!', sub: (h) => `${h.state('sensor.refrigerator_freezer_temperature')} °C`,
    },
  ],

  // Big buttons pinned at the bottom of the home page
  quick: [
    { name: 'ΚΛΕΙΣΙΜΟ ΦΩΤΩΝ', icon: 'power', tap: { service: 'script.turn_off_lights' }, active: (h) => h.lightsOn > 0, sub: (h) => (h.lightsOn ? `${h.lightsOn} αναμμένα` : 'Όλα σβηστά') },
    {
      name: 'ΚΛΕΙΣΙΜΟ A/C', icon: 'ac', tap: { service: 'climate.turn_off', target: ['climate.samsung_ac', 'climate.chigo_ac'], confirm: 'Κλείσιμο και των δύο κλιματιστικών;' },
      active: (h) => h.on('climate.samsung_ac') || h.on('climate.chigo_ac'),
      sub: (h) => { const n = ['climate.samsung_ac', 'climate.chigo_ac'].filter((id) => h.on(id)).length; return n ? `${n} σε λειτουργία` : 'Κλειστά'; },
    },
  ],

  // Rooms: the cards on the home page. `lights` can be switches or lights.
  rooms: [
    {
      id: 'saloni', name: 'Σαλόνι', icon: 'sofa',
      lights: [{ entity: 'switch.sonoff_10020914d5_1', name: 'Φως σαλονιού', icon: 'bulb' }],
      temperature: 'sensor.0xa4c138dd530653be_temperature', humidity: 'sensor.0xa4c138dd530653be_humidity',
      cards: [{ type: 'climate', entity: 'climate.samsung_ac', name: 'A/C Σαλόνι', modes: ['cool', 'heat', 'off'], fanModes: true }],
    },
    {
      id: 'kouzina', name: 'Κουζίνα', icon: 'utensils',
      lights: [
        { entity: 'switch.sonoff_100169a731_1', name: 'Φως κουζίνας' },
        { entity: 'switch.sonoff_10017950ce', name: 'Σποτ κουζίνας', icon: 'spot' },
      ],
      sensors: ['binary_sensor.kitchen_sensor_occupancy'],
      cards: [
        { type: 'tile', entity: 'sensor.refrigerator_fridge_temperature', name: 'Συντήρηση', icon: 'fridge', tap: { nav: 'page:fridge' }, color: (h) => (h.is('binary_sensor.refrigerator_cooler_door', 'on') || h.num('sensor.refrigerator_fridge_temperature', 0) > 7 ? 'red' : 'light-blue') },
        { type: 'tile', entity: 'sensor.refrigerator_freezer_temperature', name: 'Κατάψυξη', icon: 'snowflake', tap: { nav: 'page:fridge' }, color: (h) => (h.is('binary_sensor.refrigerator_freezer_door', 'on') || h.num('sensor.refrigerator_freezer_temperature', -20) > -15 ? 'red' : 'blue') },
      ],
    },
    {
      id: 'eisodos', name: 'Είσοδος & Διάδρομος', icon: 'door',
      lights: [
        { entity: 'switch.sonoff_10017f4861_1', name: 'Φως εισόδου' },
        { entity: 'switch.sonoff_10017f4177_1', name: 'Φως διαδρόμου' },
      ],
      sensors: ['binary_sensor.sonoff_1001f29270', 'binary_sensor.hall_sensor_occupancy'],
    },
    {
      id: 'mpanio', name: 'Μπάνιο', icon: 'bath',
      lights: [
        { entity: 'switch.sonoff_10015567c5_1', name: 'Απλίκα μπάνιου' },
        { entity: 'switch.sonoff_10015567c5_2', name: 'Σποτ μπάνιου', icon: 'spot' },
      ],
      temperature: 'sensor.bathroom_temp_sensor_temperature', humidity: 'sensor.bathroom_temp_sensor_humidity',
      sensors: ['binary_sensor.bedroom_sensor_occupancy'],
      cards: [{ type: 'tile', entity: 'switch.water_heater_sonoff_1002ba760e_1', name: 'Θερμοσίφωνας', icon: 'boiler', color: 'red', sub: (h, id) => `${h.on(id) ? 'Αναμμένος' : 'Σβηστός'} · ${W(h, 'sensor.water_heater_sonoff_1002ba760e_power')}` }],
    },
    {
      id: 'wc', name: 'Τουαλέτα', icon: 'bath',
      lights: [{ entity: 'switch.sonoff_100169aead_1', name: 'Φως τουαλέτας' }],
      sensors: ['binary_sensor.wc_sensor_occupancy'],
    },
    {
      id: 'ntinos', name: 'Δωμάτιο Ντίνου', icon: 'monitor',
      lights: [
        { entity: 'light.sonoff_10020070d8', name: 'Φως οροφής' },
        { entity: 'light.h80a1', name: 'Φως Ντίνος', icon: 'globeLight' },
        { entity: 'light.h70b1', name: 'Φως κουρτίνας', icon: 'curtains' },
        { entity: 'light.h6609', name: 'Φως οθόνης', icon: 'strip' },
      ],
      cards: [
        { type: 'climate', entity: 'climate.chigo_ac', name: 'A/C Δωμάτιο', modes: ['cool', 'heat', 'off'], fanModes: true },
        {
          type: 'tile', entity: 'media_player.desktop_3pvbuhm', name: 'PC', icon: 'monitor',
          active: (h) => !h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']),
          color: (h) => (h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']) ? 'disabled' : 'green'),
          sub: (h) => (h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']) ? 'Κλειστό · κράτα πατημένο για επανεκκίνηση' : `Ανοιχτό · ${W(h, 'sensor.pc_sonoff_10028f9488_power')}`),
          tap: { service: 'script.pc_on_off', confirm: 'Άνοιγμα/κλείσιμο του PC;' },
          hold: { service: 'button.press', target: 'button.desktop_3pvbuhm_restart', confirm: 'Επανεκκίνηση του PC;' },
        },
      ],
    },
    {
      id: 'ioanna', name: 'Δωμάτιο Ιωάννας', icon: 'bed',
      lights: [{ entity: 'switch.sonoff_10017f270b_1', name: 'Φως Ιωάννα' }],
    },
    {
      id: 'mpalkoni', name: 'Μπαλκόνι', icon: 'tree',
      lights: [
        { entity: 'switch.sonoff_100159d00f', name: 'Σποτ αριστερά', icon: 'spot' },
        { entity: 'switch.sonoff_100140b2b6', name: 'Σποτ δεξιά', icon: 'spot' },
      ],
      temperature: 'sensor.balcony_temp_sensor_temperature', humidity: 'sensor.balcony_temp_sensor_humidity',
      cards: [
        { type: 'cover', entity: 'cover.awning', name: 'Τέντα', icon: 'awning' },
        { type: 'tile', entity: 'switch.water_valve', name: 'Βάνα νερού', icon: 'valve', color: 'blue', sub: (h, id) => (h.on(id) ? `Ανοιχτή · ${h.ago(id)}` : 'Κλειστή') },
      ],
    },
  ],

  // Extra sections on the home page, after the rooms
  home: [
    {
      title: 'Θερμοκρασία', icon: 'thermo', cols: 3,
      cards: [
        { type: 'sensor', entity: 'sensor.0xa4c138dd530653be_temperature', name: 'Σπίτι', color: 'red' },
        { type: 'sensor', entity: 'sensor.balcony_temp_sensor_temperature', name: 'Εξωτερικά', color: 'orange' },
        { type: 'sensor', entity: 'sensor.bathroom_temp_sensor_temperature', name: 'Μπάνιο', color: 'pink' },
      ],
    },
    {
      title: 'Υγρασία', icon: 'droplet', cols: 3,
      cards: [
        { type: 'sensor', entity: 'sensor.0xa4c138dd530653be_humidity', name: 'Σπίτι', color: 'cyan' },
        { type: 'sensor', entity: 'sensor.balcony_temp_sensor_humidity', name: 'Εξωτερικά', color: 'blue' },
        { type: 'sensor', entity: 'sensor.bathroom_temp_sensor_humidity', name: 'Μπάνιο', color: 'indigo' },
      ],
    },
    {
      title: 'Συσκευές', icon: 'plug', cols: 3,
      cards: [
        { type: 'tile', entity: 'switch.water_valve', name: 'Βάνα', icon: 'valve', color: 'blue', layout: 'vertical', sub: onOff },
        { type: 'tile', entity: 'switch.water_heater_sonoff_1002ba760e_1', name: 'Θερμοσίφωνας', icon: 'boiler', color: 'red', layout: 'vertical', sub: (h, id) => `${h.on(id) ? 'On' : 'Off'} · ${W(h, 'sensor.water_heater_sonoff_1002ba760e_power')}` },
        {
          type: 'tile', entity: 'media_player.desktop_3pvbuhm', name: 'PC', icon: 'monitor', layout: 'vertical',
          active: (h) => !h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']),
          color: (h) => (h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']) ? 'disabled' : 'green'),
          sub: (h) => (h.is('media_player.desktop_3pvbuhm', ['unavailable', 'unknown', 'off']) ? 'Off' : `On · ${W(h, 'sensor.pc_sonoff_10028f9488_power')}`),
          tap: { service: 'script.pc_on_off', confirm: 'Άνοιγμα/κλείσιμο του PC;' },
          hold: { service: 'button.press', target: 'button.desktop_3pvbuhm_restart', confirm: 'Επανεκκίνηση του PC;' },
        },
        { type: 'climate', entity: 'climate.samsung_ac', name: 'Samsung A/C', modes: ['cool', 'heat', 'off'] },
        { type: 'climate', entity: 'climate.chigo_ac', name: 'Chigo A/C', modes: ['cool', 'heat', 'off'] },
      ],
    },
    {
      title: 'Ψυγείο & σκούπα', icon: 'fridge', cols: 2,
      cards: [
        { type: 'tile', entity: 'sensor.refrigerator_fridge_temperature', name: 'Συντήρηση', icon: 'fridge', tap: { nav: 'page:fridge' }, sub: (h, id) => `${h.state(id)} °C${h.is('binary_sensor.refrigerator_cooler_door', 'on') ? ' · ΠΟΡΤΑ ΑΝΟΙΧΤΗ' : ''}`, color: (h) => (h.is('binary_sensor.refrigerator_cooler_door', 'on') || h.num('sensor.refrigerator_fridge_temperature', 0) > 7 ? 'red' : 'light-blue') },
        { type: 'tile', entity: 'sensor.refrigerator_freezer_temperature', name: 'Κατάψυξη', icon: 'snowflake', tap: { nav: 'page:fridge' }, sub: (h, id) => `${h.state(id)} °C${h.is('binary_sensor.refrigerator_freezer_door', 'on') ? ' · ΠΟΡΤΑ ΑΝΟΙΧΤΗ' : ''}`, color: (h) => (h.is('binary_sensor.refrigerator_freezer_door', 'on') || h.num('sensor.refrigerator_freezer_temperature', -20) > -15 ? 'red' : 'blue') },
        { type: 'vacuum', entity: 'vacuum.d20_pro_plus', name: 'Σκούπα' },
        { type: 'cover', entity: 'cover.awning', name: 'Τέντα', icon: 'awning', span: 2 },
      ],
    },
  ],

  // Extra pages in the sidebar
  pages: [
    {
      id: 'boiler', title: 'Θερμοσίφωνας', icon: 'boiler',
      sections: [
        {
          title: 'Θερμοσίφωνας', icon: 'boiler',
          cards: [
            { type: 'tile', entity: 'switch.water_heater_sonoff_1002ba760e_1', name: 'Άνοιγμα / κλείσιμο', icon: 'boiler', color: 'red' },
            { type: 'tile', entity: 'automation.water_heater_auto_off', name: 'Αυτόματο κλείσιμο', icon: 'timer', color: 'orange' },
            { type: 'number', entity: 'input_number.water_heater_timer', name: 'Χρόνος θερμοσίφωνα', icon: 'timer', color: 'deep-orange' },
            { type: 'gauge', entity: 'sensor.water_heater_sonoff_1002ba760e_power', name: 'Κατανάλωση', min: 0, max: 4000, severity: [[0, 'green'], [3000, 'amber'], [3800, 'red']], span: 2 },
          ],
        },
        {
          title: 'Μετρήσεις', icon: 'bolt',
          cards: [
            { type: 'tile', entity: 'sensor.water_heater_sonoff_1002ba760e_voltage', name: 'Τάση', tap: false },
            { type: 'tile', entity: 'sensor.water_heater_sonoff_1002ba760e_current', name: 'Ένταση', tap: false },
            { type: 'tile', entity: 'sensor.water_heater_sonoff_1002ba760e_energy_day', name: 'Σήμερα', icon: 'calendar', tap: false },
            { type: 'tile', entity: 'sensor.water_heater_sonoff_1002ba760e_energy_month', name: 'Μήνας', icon: 'calendar', tap: false },
            { type: 'history', title: 'Κατανάλωση ημέρας', hours: 24, entities: [{ entity: 'sensor.water_heater_sonoff_1002ba760e_energy_day', name: 'Κατανάλωση ημέρας', color: 'amber' }] },
          ],
        },
      ],
    },
    {
      id: 'ac', title: 'Κλιματισμός', icon: 'ac',
      sections: [
        { title: 'A/C Σαλόνι', icon: 'sofa', cards: [{ type: 'climate', entity: 'climate.samsung_ac', name: 'A/C Σαλόνι', fanModes: true }] },
        { title: 'A/C Δωμάτιο', icon: 'bed', cards: [{ type: 'climate', entity: 'climate.chigo_ac', name: 'A/C Δωμάτιο', fanModes: true }] },
      ],
    },
    {
      id: 'water', title: 'Πότισμα', icon: 'leaf',
      sections: [
        {
          title: 'Πότισμα φυτών', icon: 'leaf',
          cards: [
            { type: 'tile', entity: 'switch.water_valve', name: 'Βάνα νερού', icon: 'valve', color: 'blue', span: 2, sub: (h, id) => (h.on(id) ? `Ανοιχτή εδώ και ${h.ago(id)}` : 'Κλειστή') },
            { type: 'sensor', entity: 'sensor.water_valve_flow', name: 'Ρυθμός ροής', icon: 'droplet', color: 'cyan', hours: 6 },
            { type: 'sensor', entity: 'sensor.water_valve_daily_irrigation_volume', name: 'Κατανάλωση ημέρας', icon: 'droplet', color: 'blue' },
            { type: 'number', entity: 'input_number.valve_auto_off_minutes', name: 'Χρόνος ποτίσματος', icon: 'timer', color: 'teal' },
          ],
        },
        {
          title: 'Αυτοματισμοί', icon: 'sparkle', cols: 1,
          cards: [
            { type: 'tile', entity: 'automation.winter_valve_on', name: 'Χειμερινό πότισμα', icon: 'snowflake', color: 'light-blue' },
            { type: 'tile', entity: 'automation.summer_valve_on', name: 'Καλοκαιρινό πότισμα', icon: 'sun', color: 'orange' },
            { type: 'tile', entity: 'automation.auto_off_valve', name: 'Αυτόματο κλείσιμο', icon: 'timer', color: 'red' },
          ],
        },
      ],
    },
    {
      id: 'fridge', title: 'Ψυγείο', icon: 'fridge',
      sections: [
        {
          title: 'Θερμοκρασίες', icon: 'thermo',
          cards: [
            { type: 'number', entity: 'number.refrigerator_fridge_temperature', name: 'Συντήρηση', icon: 'thermo', color: 'blue', mode: 'buttons' },
            { type: 'number', entity: 'number.refrigerator_freezer_temperature', name: 'Κατάψυξη', icon: 'snowflake', color: 'blue', mode: 'buttons' },
            {
              type: 'tile', name: 'Συντήρηση τώρα', icon: 'thermo', tap: false,
              sub: (h) => { const t = h.is('sensor.refrigerator_fridge_temperature', ['unknown', 'unavailable']) ? h.state('sensor.refrigerator_cooler_temperature') : h.state('sensor.refrigerator_fridge_temperature'); return `${t} °C`; },
              color: (h) => { const id = h.is('sensor.refrigerator_fridge_temperature', ['unknown', 'unavailable']) ? 'sensor.refrigerator_cooler_temperature' : 'sensor.refrigerator_fridge_temperature'; const v = h.num(id, 0); return v <= 5 ? 'green' : v <= 7 ? 'orange' : 'red'; },
            },
            {
              type: 'tile', name: 'Κατάψυξη τώρα', icon: 'snowflake', tap: false,
              sub: (h) => `${h.state('sensor.refrigerator_freezer_temperature')} °C`,
              color: (h) => { const v = h.num('sensor.refrigerator_freezer_temperature', 0); return v <= -18 ? 'green' : v <= -15 ? 'orange' : 'red'; },
            },
          ],
        },
        {
          title: 'Λειτουργίες & πόρτες', icon: 'fridge',
          cards: [
            { type: 'tile', entity: 'switch.refrigerator_power_cool', name: 'Power Cool', icon: 'snowflake', color: 'cyan' },
            { type: 'tile', entity: 'switch.refrigerator_power_freeze', name: 'Power Freeze', icon: 'snowflake', color: 'cyan' },
            { type: 'tile', entity: 'binary_sensor.refrigerator_cooler_door', name: 'Πόρτα συντήρησης', icon: 'fridge', tap: false, color: (h, id) => (h.is(id, 'on') ? 'red' : 'green'), sub: openClosed },
            { type: 'tile', entity: 'binary_sensor.freezer_door', name: 'Πόρτα κατάψυξης', icon: 'fridge', tap: false, color: (h, id) => (h.is(id, 'on') ? 'red' : 'green'), sub: openClosed },
          ],
        },
      ],
    },
    {
      id: 'k1c', title: 'K1C', icon: 'printer',
      chips: [
        { entity: 'switch.sonoff_100226ea15', icon: 'power', color: (h) => (h.on('switch.sonoff_100226ea15') ? 'green' : 'grey'), text: (h) => `Τροφοδοσία ${h.on('switch.sonoff_100226ea15') ? 'on' : 'off'}`, tap: { action: 'toggle', confirm: 'Σίγουρα; Αν τυπώνει, η εκτύπωση θα χαθεί.' } },
        { icon: 'printer', color: 'orange', text: (h) => `Κατάσταση: ${(PRINTER_STATE[h.state('sensor.k1c_current_print_state')] || [0, h.state('sensor.k1c_current_print_state')])[1]}` },
        { icon: 'thermo', color: 'amber', text: (h) => `Θάλαμος ${h.state('sensor.k1c_chamber_temp')} °C` },
      ],
      sections: [
        {
          title: 'Εκτύπωση', icon: 'nozzle',
          cards: [
            { type: 'tile', entity: 'switch.sonoff_100226ea15', name: 'Ο εκτυπωτής είναι κλειστός — πάτα για άναμμα', icon: 'power', color: 'red', span: 2, show: (h) => h.is('switch.sonoff_100226ea15', 'off'), tap: 'toggle', cls: 'alert' },
            { type: 'camera', entity: 'camera.k1c_k1c', live: true },
            {
              type: 'tile', span: 2, tap: false, key: 'printstate',
              icon: (h) => (PRINTER_STATE[h.state('sensor.k1c_current_print_state')] || ['printer'])[0],
              color: (h) => ({ printing: 'blue', paused: 'amber', complete: 'green', error: 'red' }[h.state('sensor.k1c_current_print_state')] || 'grey'),
              name: (h) => (PRINTER_STATE[h.state('sensor.k1c_current_print_state')] || [0, h.state('sensor.k1c_current_print_state')])[1],
              sub: (h) => (printing(h) ? h.state('sensor.k1c_filename').split('.stl')[0].split('.gcode')[0] : ''),
            },
            {
              type: 'info', show: printing,
              rows: [
                { label: 'Πρόοδος', value: (h) => `${Math.round(h.num('sensor.k1c_progress', 0))}%` },
                { label: 'Στρώση', value: (h) => `${h.state('sensor.k1c_current_layer')} / ${h.state('sensor.k1c_total_layer')}` },
                { label: 'Διάρκεια', value: (h) => { const d = h.num('sensor.k1c_print_duration', 0); return `${Math.floor(d / 60)}ω ${Math.floor(d % 60)}λ`; } },
                { label: 'Απομένουν', value: (h) => { const t = h.num('sensor.k1c_print_time_left', 0); return `${Math.floor(t)}ω ${Math.floor((t * 60) % 60)}λ`; } },
                { label: 'Τελειώνει', value: (h) => (h.is('sensor.k1c_print_eta', ['unknown', 'unavailable', '']) ? '—' : h.time(h.state('sensor.k1c_print_eta'))) },
              ],
            },
            { type: 'gauge', entity: 'sensor.k1c_progress', name: 'Πρόοδος', min: 0, max: 100, color: 'blue', span: 2, show: (h) => h.is('sensor.k1c_current_print_state', ['printing', 'paused']) },
            { type: 'tile', entity: 'button.k1c_pause_print', name: 'Παύση', icon: 'pause', color: 'orange', sub: '', tap: { service: 'button.press', target: 'self' }, show: (h) => h.is('sensor.k1c_current_print_state', 'printing') },
            { type: 'tile', entity: 'button.k1c_resume_print', name: 'Συνέχεια', icon: 'play', color: 'green', sub: '', tap: { service: 'button.press', target: 'self' }, show: (h) => h.is('sensor.k1c_current_print_state', 'paused') },
            { type: 'tile', entity: 'button.k1c_cancel_print', name: 'Ακύρωση', icon: 'stop', color: 'red', sub: '', tap: { service: 'button.press', target: 'self', confirm: 'Να ακυρωθεί η εκτύπωση;' }, show: (h) => h.is('sensor.k1c_current_print_state', ['printing', 'paused']) },
          ],
        },
        {
          title: 'Θερμοκρασίες', icon: 'thermo',
          cards: [
            { type: 'tile', entity: 'sensor.k1c_extruder_temperature', name: 'Ακροφύσιο', icon: 'nozzle', color: 'deep-orange', tap: false },
            { type: 'tile', entity: 'sensor.k1c_bed_temperature', name: 'Πλάκα', icon: 'flame', color: 'orange', tap: false },
            { type: 'tile', entity: 'sensor.k1c_chamber_temp', name: 'Θάλαμος', icon: 'thermo', color: 'amber', tap: false },
            { type: 'tile', entity: 'sensor.k1c_mcu_temp', name: 'Πλακέτα', icon: 'cpu', color: 'grey', tap: false },
            { type: 'number', entity: 'number.k1c_extruder_target', name: 'Στόχος ακροφυσίου', icon: 'nozzle', color: 'deep-orange', mode: 'buttons' },
            { type: 'number', entity: 'number.k1c_bed_target', name: 'Στόχος πλάκας', icon: 'flame', color: 'orange', mode: 'buttons' },
            {
              type: 'history', title: 'Τελευταίες 2 ώρες', hours: 2,
              entities: [
                { entity: 'sensor.k1c_extruder_temperature', name: 'Ακροφύσιο', color: 'deep-orange' },
                { entity: 'sensor.k1c_bed_temperature', name: 'Πλάκα', color: 'orange' },
                { entity: 'sensor.k1c_chamber_temp', name: 'Θάλαμος', color: 'amber' },
              ],
            },
          ],
        },
        {
          title: 'K1C · CFS', icon: 'layers',
          cards: [cfsUnit(1), ...[0, 1, 2, 3].map((i) => cfsSlot(1, i)), cfsUnit(2), ...[0, 1, 2, 3].map((i) => cfsSlot(2, i))],
        },
        {
          title: 'Έλεγχος', icon: 'gauge',
          cards: [
            { type: 'tile', entity: 'switch.sonoff_100226ea15', name: 'Τροφοδοσία', icon: 'power', color: 'green', span: 2, tap: { action: 'toggle', confirm: 'Σίγουρα; Αν τυπώνει, η εκτύπωση θα χαθεί.' } },
            { type: 'number', entity: 'number.k1c_output_pin_led', name: 'Φως θαλάμου', icon: 'bulb', color: 'yellow' },
            { type: 'number', entity: 'number.k1c_output_pin_fan0', name: 'Ανεμιστήρας μοντέλου', icon: 'fan', color: 'blue' },
            { type: 'number', entity: 'number.k1c_output_pin_fan2', name: 'Ανεμιστήρας θαλάμου', icon: 'fan', color: 'cyan' },
            { type: 'number', entity: 'number.k1c_speed_factor', name: 'Ταχύτητα', icon: 'speed', color: 'purple', mode: 'buttons', span: 2 },
            {
              type: 'info', title: 'Στοιχεία',
              rows: [
                { entity: 'sensor.k1c_print_speed', label: 'Ταχύτητα εκτύπωσης' },
                { entity: 'sensor.k1c_filament_used', label: 'Νήμα που χρησιμοποιήθηκε' },
                { entity: 'sensor.k1c_object_height', label: 'Ύψος μοντέλου' },
                { entity: 'binary_sensor.k1c_filament_sensor', label: 'Αισθητήρας νήματος' },
                { entity: 'sensor.k1c_printer_message', label: 'Μήνυμα εκτυπωτή' },
              ],
            },
            { type: 'tile', entity: 'button.k1c_home_all_axes', name: 'Home', icon: 'home', color: 'blue', sub: '', tap: { service: 'button.press', target: 'self', confirm: 'Να γίνει home όλων των αξόνων;' } },
            { type: 'tile', entity: 'button.k1c_emergency_stop', name: 'STOP', icon: 'alert', color: 'red', sub: '', tap: { service: 'button.press', target: 'self', confirm: 'ΕΠΕΙΓΟΥΣΑ ΔΙΑΚΟΠΗ — σίγουρα;' } },
          ],
        },
      ],
    },
    {
      id: 'vacuum', title: 'Σκούπα', icon: 'vacuum',
      sections: [
        {
          title: 'Σκούπα', icon: 'vacuum',
          cards: [
            { type: 'vacuum', entity: 'vacuum.d20_pro_plus', name: 'Σκούπα D20 Pro Plus' },
            { type: 'camera', entity: 'camera.d20_pro_plus_map_1', name: 'Χάρτης' },
            { type: 'select', entity: 'vacuum.d20_pro_plus', name: 'Ισχύς αναρρόφησης', icon: 'fan', color: 'teal', attribute: 'fan_speed', options: ['Silent', 'Standard', 'Strong', 'Turbo'], labels: fanSpeedLabels, service: 'vacuum.set_fan_speed', field: 'fan_speed' },
            {
              type: 'info', title: 'Αναλώσιμα',
              rows: [
                { entity: 'vacuum.d20_pro_plus', label: 'Φίλτρο', attribute: 'filter_left', unit: 'h' },
                { entity: 'vacuum.d20_pro_plus', label: 'Κεντρική βούρτσα', attribute: 'main_brush_left', unit: 'h' },
                { entity: 'vacuum.d20_pro_plus', label: 'Πλαϊνή βούρτσα', attribute: 'side_brush_left', unit: 'h' },
                { entity: 'vacuum.d20_pro_plus', label: 'Αισθητήρες', attribute: 'sensor_dirty_left', unit: 'h' },
                { entity: 'vacuum.d20_pro_plus', label: 'Καθαρισμοί', attribute: 'cleaning_count' },
              ],
            },
          ],
        },
        {
          title: 'Καθάρισμα ανά δωμάτιο', icon: 'grid', cols: 3,
          cards: [
            vacRoom('Σαλόνι', 'sofa', 'teal', [1]),
            vacRoom('Κουζίνα', 'utensils', 'orange', [6]),
            vacRoom('Σαλόνι + κουζίνα', 'home', 'teal', [1, 6]),
            vacRoom('Κύρια κρεβατοκάμαρα', 'bed', 'indigo', [2]),
            vacRoom('Δεύτερη κρεβατοκάμαρα', 'bed2', 'indigo', [7]),
            vacRoom('Κρεβατοκάμαρες', 'bed', 'purple', [2, 7]),
            vacRoom('Μπάνιο', 'bath', 'cyan', [3]),
            vacRoom('WC', 'bath', 'cyan', [8]),
            vacRoom('Μπάνιο + WC', 'droplet', 'blue', [3, 8]),
            vacRoom('Χολ εισόδου', 'door', 'amber', [5]),
            vacRoom('Διάδρομος', 'walk', 'amber', [4]),
            vacRoom('Χολ + διάδρομος', 'walk', 'amber', [4, 5]),
          ],
        },
      ],
    },
    {
      id: 'network', title: 'Δίκτυο', icon: 'router',
      chips: [
        { icon: 'timer', color: (h) => (h.num('sensor.network_eg105g_v2_internet_latency', 999) < 40 ? 'green' : 'orange'), text: (h) => `${h.state('sensor.network_eg105g_v2_internet_latency')} ms` },
        { icon: 'globe', color: (h) => (h.is('binary_sensor.network_eg105g_v2_internet', 'on') ? 'green' : 'red'), text: 'Internet' },
        { icon: 'devices', color: 'blue', text: (h) => `${h.state('sensor.eg105g_v2_clients')} clients` },
        { icon: 'wifi', color: 'cyan', text: (h) => h.state('sensor.eg105g_v2_wi_fi_clients') },
        { icon: 'ethernet', color: 'amber', text: (h) => h.state('sensor.eg105g_v2_wired_clients') },
        { icon: 'accessPoint', color: (h) => (h.is('binary_sensor.ew1800gx_pro_access_point_online', 'on') ? 'green' : 'red'), text: 'AP' },
        { icon: 'netSwitch', color: (h) => (h.is('binary_sensor.rg_es205gc_ruijie_online', 'on') ? 'green' : 'red'), text: 'Switch' },
        { icon: 'globe', color: 'grey', text: (h) => h.state('sensor.eg105g_v2_wan_ip') },
      ],
      sections: [
        {
          title: 'Internet', icon: 'globe',
          cards: [
            { type: 'sensor', entity: 'sensor.eg105g_v2_wan_download', name: 'Download', icon: 'arrowDown', color: 'green', hours: 2 },
            { type: 'sensor', entity: 'sensor.eg105g_v2_wan_upload', name: 'Upload', icon: 'arrowUp', color: 'blue', hours: 2 },
          ],
        },
        {
          title: 'Δίκτυα Wi-Fi', icon: 'wifi', cols: 3,
          cards: [
            { type: 'tile', entity: 'switch.eg105g_v2_wi_fi_boss', name: 'Boss', icon: (h, id) => (h.on(id) ? 'wifi' : 'wifiOff'), color: 'blue', layout: 'vertical', tap: { action: 'toggle', confirm: 'Αλλαγή του κύριου Wi-Fi (Boss);' } },
            { type: 'tile', entity: 'switch.eg105g_v2_wi_fi_smart_home', name: 'Smart Home', icon: (h, id) => (h.on(id) ? 'home' : 'wifiOff'), color: 'teal', layout: 'vertical', tap: { action: 'toggle', confirm: 'Αν το κλείσεις, οι έξυπνες συσκευές θα αποσυνδεθούν. Συνέχεια;' } },
            { type: 'tile', entity: 'switch.eg105g_v2_wi_fi_underlings_guest', name: 'Guest', icon: (h, id) => (h.on(id) ? 'wifi' : 'wifiOff'), color: 'purple', layout: 'vertical', tap: 'toggle' },
          ],
        },
        {
          title: (h) => `Access point · ${h.state('sensor.ew1800gx_pro_access_point_clients')} clients`, icon: 'accessPoint',
          cards: [
            { type: 'gauge', entity: 'sensor.ew1800gx_pro_access_point_2_4g_channel_utilization', name: '2.4 GHz busy', min: 0, max: 100, severity: [[0, 'green'], [50, 'amber'], [80, 'red']] },
            { type: 'gauge', entity: 'sensor.ew1800gx_pro_access_point_5g_channel_utilization', name: '5 GHz busy', min: 0, max: 100, severity: [[0, 'green'], [50, 'amber'], [80, 'red']] },
          ],
        },
        {
          title: 'Θύρες router', icon: 'router', cols: 5, wide: true,
          cards: [
            port('binary_sensor.eg105g_v2_port_wan', 'WAN'), port('binary_sensor.eg105g_v2_port_lan0', 'LAN0'), port('binary_sensor.eg105g_v2_port_lan1', 'LAN1'),
            port('binary_sensor.eg105g_v2_port_lan2', 'LAN2'), port('binary_sensor.eg105g_v2_port_lan3_wan1', 'LAN3'),
          ],
        },
        {
          title: 'Θύρες access point', icon: 'accessPoint', cols: 5, wide: true,
          cards: ['wan', 'lan1', 'lan2', 'lan3', 'lan4'].map((p) => port(`binary_sensor.network_ew1800gx_pro_access_point_port_${p}`, p.toUpperCase())),
        },
        {
          title: 'Θύρες switch', icon: 'netSwitch', cols: 5, wide: true,
          cards: [1, 2, 3, 4, 5].map((n) => port(`binary_sensor.network_rg_es205gc_ruijie_port_${n}`, String(n))),
        },
        {
          title: 'Επανεκκίνηση', icon: 'restart', cols: 3, wide: true,
          cards: [
            { type: 'tile', entity: 'button.network_eg105g_v2_restart', name: 'Router', sub: 'Όλο το δίκτυο', icon: 'restart', color: 'red', layout: 'vertical', tap: { service: 'button.press', target: 'self', confirm: 'Επανεκκίνηση του router; Όλο το δίκτυο πέφτει για 1-2 λεπτά.' } },
            { type: 'tile', entity: 'button.network_ew1800gx_pro_access_point_restart', name: 'Access point', sub: 'Μόνο Wi-Fi', icon: 'restart', color: 'orange', layout: 'vertical', tap: { service: 'button.press', target: 'self', confirm: 'Επανεκκίνηση του access point; Το Wi-Fi πέφτει για 1-2 λεπτά.' } },
            { type: 'tile', entity: 'button.network_rg_es205gc_ruijie_restart', name: 'Switch', sub: '3 ενσύρματες συσκευές', icon: 'restart', color: 'orange', layout: 'vertical', tap: { service: 'button.press', target: 'self', confirm: 'Επανεκκίνηση του switch; Οι συσκευές του πέφτουν για λίγο.' } },
          ],
        },
      ],
    },
    {
      id: 'pc', title: 'Υπολογιστής', icon: 'cpu',
      sections: [
        { title: 'CPU', icon: 'cpu', cards: [
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_cpu_temp', name: 'Θερμοκρασία', color: 'red' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_cpuload', name: 'Φόρτος', color: 'blue' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_currentclockspeed', name: 'Συχνότητα', color: 'purple', span: 2 },
        ] },
        { title: 'GPU', icon: 'monitor', cards: [
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_gpu_temp', name: 'Θερμοκρασία', color: 'red' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_gpu_usage', name: 'Φόρτος', color: 'green' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_gpu_clock', name: 'Συχνότητα', color: 'purple' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_gpu_mem_clock', name: 'Συχνότητα VRAM', color: 'indigo' },
        ] },
        { title: 'RAM', icon: 'layers', cards: [
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_ram_used', name: 'Σε χρήση', color: 'cyan' },
          { type: 'sensor', entity: 'sensor.desktop_3pvbuhm_memoryusage', name: 'Χρήση', color: 'teal' },
        ] },
        { title: 'Ελεύθερος χώρος', icon: 'disk', cards: [
          { type: 'sensor', entity: 'sensor.ssd_c_free_space_gb', name: 'SSD C', icon: 'disk', color: 'amber' },
          { type: 'sensor', entity: 'sensor.ssd_d_free_space_gb', name: 'SSD D', icon: 'disk', color: 'amber' },
          { type: 'sensor', entity: 'sensor.ssd_e_free_space_gb', name: 'SSD E', icon: 'disk', color: 'amber' },
          { type: 'sensor', entity: 'sensor.ssd_h_free_space_gb', name: 'SSD H', icon: 'disk', color: 'amber' },
        ] },
      ],
    },
    {
      id: 'energy', title: 'Καταναλώσεις', icon: 'bolt',
      sections: [
        meter('Μετρητής σπιτιού', 'sonoff_1002328ae7'),
        meter('Μετρητής PC', 'pc_sonoff_10028f9488'),
        meter('Μετρητής πλυντηρίου', 'sonoff_10024f9788'),
        meter('Μετρητής θερμοσίφωνα', 'water_heater_sonoff_1002ba760e'),
        meter('Μετρητής Home Assistant', 'sonoff_1002270788'),
        meter('Μετρητής 3D printer', 'sonoff_100226ea15'),
      ],
    },
    {
      id: 'batteries', title: 'Μπαταρίες', icon: 'battery',
      sections: [
        { title: 'Ανιχνευτές κίνησης', icon: 'activity', cards: [{ type: 'batteries', items: [battery('sensor.kitchen_sensor_battery', 'Κουζίνα'), battery('sensor.hall_sensor_battery', 'Διάδρομος'), battery('sensor.wc_sensor_battery', 'Τουαλέτα')] }] },
        { title: 'Θερμοκρασίας & υγρασίας', icon: 'thermo', cards: [{ type: 'batteries', items: [battery('sensor.balcony_temp_sensor_battery', 'Μπαλκόνι'), battery('sensor.0xa4c138dd530653be_battery', 'Σαλόνι'), battery('sensor.bathroom_temp_sensor_battery', 'Μπάνιο')] }] },
        { title: 'Επαφές & διάφορα', icon: 'door', cards: [{ type: 'batteries', items: [battery('sensor.sonoff_1001f29270_battery', 'Είσοδος'), { entity: 'sensor.water_valve_battery', name: 'Βάνα', icon: 'valve' }] }] },
        { title: 'Κινητά, tablet, ρολόγια', icon: 'phone', cards: [{ type: 'batteries', items: [{ entity: 'sensor.zetsuu_s_s23_ultra_battery_level', name: 'Ντίνος', icon: 'phone' }, { entity: 'sensor.galaxy_watch6_classic_rv1p_battery_level', name: 'Ρολόι', icon: 'watch' }, { entity: 'sensor.home_assistant_tablet_battery_level', name: 'Tablet', icon: 'tablet' }] }] },
      ],
    },
    {
      id: 'sensors', title: 'Αισθητήρες', icon: 'activity',
      sections: [
        { title: 'Κουζίνα', icon: 'utensils', cards: [motion('binary_sensor.kitchen_sensor_occupancy'), { type: 'tile', entity: 'sensor.kitchen_sensor_battery', name: 'Μπαταρία', tap: false }, { type: 'number', entity: 'number.kitchen_sensor_motion_timeout', name: 'Χρόνος ανίχνευσης', icon: 'timer' }] },
        { title: 'Διάδρομος', icon: 'door', cards: [motion('binary_sensor.hall_sensor_occupancy'), { type: 'tile', entity: 'sensor.hall_sensor_battery', name: 'Μπαταρία', tap: false }, { type: 'number', entity: 'number.hall_sensor_motion_timeout', name: 'Χρόνος ανίχνευσης', icon: 'timer' }] },
        { title: 'Τουαλέτα', icon: 'bath', cards: [motion('binary_sensor.wc_sensor_occupancy'), { type: 'tile', entity: 'sensor.wc_sensor_battery', name: 'Μπαταρία', tap: false }, { type: 'number', entity: 'number.wc_sensor_motion_timeout', name: 'Χρόνος ανίχνευσης', icon: 'timer' }] },
        { title: 'Μπάνιο', icon: 'bath', cards: [motion('binary_sensor.bedroom_sensor_occupancy'), { type: 'select', entity: 'select.bedroom_sensor_occupancy_sensitivity', name: 'Ευαισθησία', icon: 'gauge' }, { type: 'number', entity: 'number.bedroom_sensor_occupancy_timeout', name: 'Χρόνος ανίχνευσης', icon: 'timer' }] },
        { title: 'Είσοδος', icon: 'door', cards: [{ type: 'tile', entity: 'binary_sensor.sonoff_1001f29270', name: 'Κατάσταση', icon: 'door', tap: false, sub: openClosed, color: (h, id) => (h.is(id, 'on') ? 'red' : 'green') }, { type: 'tile', entity: 'sensor.sonoff_1001f29270_battery', name: 'Μπαταρία', tap: false }] },
      ],
    },
    {
      id: 'phones', title: 'Κινητά', icon: 'phone',
      sections: [
        { title: 'Τηλέφωνο Ντίνου', icon: 'phone', cards: [
          { type: 'gauge', entity: 'sensor.zetsuu_s_s23_ultra_battery_level', name: 'Μπαταρία', severity: [[0, 'red'], [15, 'amber'], [30, 'green']] },
          { type: 'sensor', entity: 'sensor.zetsuu_s_s23_ultra_battery_level', name: 'Μπαταρία 24h', color: 'green' },
          { type: 'location', entity: 'device_tracker.zetsuu_s_s23_ultra', name: 'Τοποθεσία' },
        ] },
        { title: 'Ρολόι Ντίνου', icon: 'watch', cards: [
          { type: 'gauge', entity: 'sensor.galaxy_watch6_classic_rv1p_battery_level', name: 'Μπαταρία', severity: [[0, 'red'], [15, 'amber'], [30, 'green']] },
          { type: 'sensor', entity: 'sensor.galaxy_watch6_classic_rv1p_battery_level', name: 'Μπαταρία 24h', color: 'green' },
        ] },
        { title: 'Home Assistant tablet', icon: 'tablet', cards: [
          { type: 'gauge', entity: 'sensor.home_assistant_tablet_battery_level', name: 'Μπαταρία', severity: [[0, 'red'], [15, 'amber'], [30, 'green']] },
          { type: 'sensor', entity: 'sensor.home_assistant_tablet_battery_level', name: 'Μπαταρία 24h', color: 'green' },
          { type: 'location', entity: 'device_tracker.home_assistant_tablet', name: 'Τοποθεσία' },
        ] },
      ],
    },
    {
      id: 'stocks', title: 'Μετοχές', icon: 'trending',
      sections: [
        { title: 'S&P 500', icon: 'trending', cols: 1, cards: [{ type: 'sensor', entity: 'sensor.yahoofinance_spx', name: 'S&P 500', color: 'green', hours: 41, tall: true }] },
        { title: 'NASDAQ 100', icon: 'trending', cols: 1, cards: [{ type: 'sensor', entity: 'sensor.yahoofinance_ndx', name: 'NASDAQ 100', color: 'blue', hours: 41, tall: true }] },
        { title: 'Bitcoin', icon: 'trending', cols: 1, cards: [{ type: 'sensor', entity: 'sensor.yahoofinance_btc_eur', name: 'Bitcoin', color: 'orange', hours: 41, tall: true }] },
        { title: 'Ethereum', icon: 'trending', cols: 1, cards: [{ type: 'sensor', entity: 'sensor.yahoofinance_eth_eur', name: 'Ethereum', color: 'purple', hours: 41, tall: true }] },
      ],
    },
    {
      id: 'floorplan', title: 'Κάτοψη', icon: 'map',
      sections: [{
        wide: true, cols: 1,
        cards: [{
          type: 'floorplan', image: '/local/floorplan.svg?v=3',
          items: [
            { entity: 'switch.sonoff_100169aead_1', x: '41%', y: '15%' },
            { entity: 'switch.sonoff_10017f4177_1', x: '65%', y: '51%' },
            { entity: 'switch.sonoff_10017f4861_1', x: '46%', y: '35%' },
            { entity: 'switch.sonoff_100169a731_1', x: '49%', y: '70%' },
            { entity: 'switch.sonoff_10017950ce', x: '56%', y: '79%' },
            { entity: 'switch.sonoff_10020914d5_1', x: '25%', y: '68%' },
            { entity: 'switch.sonoff_100140b2b6', x: '7%', y: '26%' },
            { entity: 'switch.sonoff_100159d00f', x: '7%', y: '75%' },
            { entity: 'light.sonoff_10020070d8', x: '26%', y: '23%' },
            { entity: 'light.h70b1', x: '14%', y: '23%' },
            { entity: 'light.h6609', x: '19%', y: '38%' },
            { entity: 'switch.sonoff_10017f270b_1', x: '88%', y: '38%' },
            { entity: 'switch.sonoff_10015567c5_1', x: '71%', y: '65%' },
            { entity: 'switch.sonoff_10015567c5_2', x: '71%', y: '76%' },
          ],
        }],
      }],
    },
  ],
};
