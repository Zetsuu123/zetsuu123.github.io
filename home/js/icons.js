// Inline line icons (24x24, stroke = currentColor).
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
  fan: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2c-.9-3.2-.4-6.6 2.1-7 2.7-.4 3.2 3.6-.6 6.3"/><path transform="rotate(120 12 12)" d="M12 10.2c-.9-3.2-.4-6.6 2.1-7 2.7-.4 3.2 3.6-.6 6.3"/><path transform="rotate(240 12 12)" d="M12 10.2c-.9-3.2-.4-6.6 2.1-7 2.7-.4 3.2 3.6-.6 6.3"/>',
  thermo: '<path d="M14 14.76V4.5a2 2 0 0 0-4 0v10.26a4 4 0 1 0 4 0z"/><path d="M12 17.5V9"/>',
  droplet: '<path d="M12 2.7s-6 6.4-6 11.3a6 6 0 0 0 12 0c0-4.9-6-11.3-6-11.3z"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 16.1a5 5 0 0 1 7 0"/><path d="M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r=".9" fill="currentColor"/>',
  wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.1a5 5 0 0 1 7 0"/><path d="M5 12.6a10 10 0 0 1 4.2-2.4"/><path d="M2 9a15 15 0 0 1 4.4-2.8"/><path d="M14 8.3A15 15 0 0 1 22 9"/><circle cx="12" cy="19.5" r=".9" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0z"/><path d="M4 18v2M20 18v2"/>',
  bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  bath: '<path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.7 3 4 3.7 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M2 12h20"/><path d="M7 19v2M17 19v2"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7 15h10"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  car: '<path d="M5 17H3v-5l2.4-5.2A2 2 0 0 1 7.2 5.6h9.6a2 2 0 0 1 1.8 1.2L21 12v5h-2"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
  tree: '<path d="M12 22v-6"/><path d="M12 16a6 6 0 0 0 5.6-8.2A5 5 0 0 0 12 2a5 5 0 0 0-5.6 5.8A6 6 0 0 0 12 16z"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h20"/><path d="M13 20V3.5a1 1 0 0 0-1.2-1L6 3.8a1 1 0 0 0-.8 1V20"/><circle cx="10" cy="12" r=".7" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/>',
  cloudSun: '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4"/><path d="M15.9 13A4 4 0 0 0 8.1 11"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z"/>',
  rain: '<path d="M16 13.5A4.5 4.5 0 0 0 17.5 5h-.2A6 6 0 1 0 6 12.7"/><path d="M8 15v4M12 13v7M16 15v4"/>',
  snow: '<path d="M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7"/><path d="m9.5 3.5 2.5 2 2.5-2M9.5 20.5l2.5-2 2.5 2"/>',
  fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  blinds: '<path d="M3 3h18"/><path d="M5 3v18M19 3v18"/><path d="M5 7h14M5 11h14M5 15h14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.6 1.3 2.8 2.5 2.8z"/>',
  snowflake: '<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 2l20 20"/><path d="M6.7 6.7C3.9 8.4 2 12 2 12s3.5 7 10 7c2 0 3.8-.7 5.3-1.7M10.6 5.1C11 5 11.5 5 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  washer: '<rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h.01M10 6h.01"/><path d="M9.5 13.5a3 3 0 0 0 5 0"/>',
  printer: '<path d="M4 3h16v4H4z"/><path d="M6 7v11M18 7v11"/><path d="M3 21h18"/><path d="M12 7v5"/><path d="m10 12 2 3 2-3z"/>',
  boiler: '<rect x="6" y="2" width="12" height="16" rx="6"/><path d="M9 22v-4M15 22v-4"/><path d="M12 7c-1.2 1.4-1.6 2.4-1.6 3.2a1.6 1.6 0 0 0 3.2 0c0-.8-.4-1.8-1.6-3.2z"/>',
  valve: '<path d="M2 11h4v6H2zM18 11h4v6h-4z"/><path d="M6 14h12"/><path d="M12 14V8"/><path d="M8 6h8"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14"/><path d="M8.5 6v1.5M8.5 13v3"/>',
  vacuum: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M7 17.5l1.5-1.5M17 17.5 15.5 16"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4M9.5 10v4"/>',
  trending: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="m9 6 1-4h4l1 4M9 18l1 4h4l1-4"/><path d="M12 10v2l1.5 1"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  mapPin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  camera: '<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/><path d="M7 17h.01M11 17h2"/>',
  ethernet: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 16v4h10v-4"/><path d="M9 8v3M12 8v3M15 8v3"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.2-6"/>',
  router: '<rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6.5 17.5h.01M10 17.5h.01"/><path d="M17 14V9"/><path d="M14 6.5a4.2 4.2 0 0 1 6 0"/><path d="M12 4a7.5 7.5 0 0 1 10 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  ac: '<rect x="2" y="4" width="20" height="9" rx="2"/><path d="M6 9h12"/><path d="M7 17c0 1.5-1 2-1 3M12 17v4M17 17c0 1.5 1 2 1 3"/>',
  curtains: '<path d="M3 3h18"/><path d="M5 3c0 6 2 12 5 18H5zM19 3c0 6-2 12-5 18h5z"/>',
  strip: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M8.5 15.5h.01M11.5 12.5h.01M14.5 9.5h.01"/>',
  spot: '<path d="M5 4h14l-2.5 6h-9z"/><path d="M12 14v3M8 13l-1.8 2.6M16 13l1.8 2.6M12 20v1"/>',
  globeLight: '<circle cx="12" cy="10" r="7"/><path d="M9 21h6M12 17v4"/><path d="M9 8a3.5 3.5 0 0 1 3-2"/>',
  circle: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  arrowUpCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 4-4 4 4M12 16V8"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  devices: '<rect x="2" y="4" width="14" height="10" rx="1.5"/><rect x="17" y="8" width="5" height="11" rx="1"/><path d="M6 18h6M9 14v4"/>',
  accessPoint: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  netSwitch: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01"/>',
  speed: '<path d="m12 14 5-5"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/><path d="M12 6v1M6 12H5M19 12h-1"/>',
  nozzle: '<path d="M8 2h8v6l-2 4h-4l-2-4z"/><path d="M11 12h2l-1 3z"/><path d="M7 19c1.5-1 3.5-1 5 0s3.5 1 5 0M5 22h14"/>',
  bed2: '<path d="M3 20V8"/><path d="M3 12h18v8"/><path d="M3 16h18"/><path d="M7 12V9h5v3"/>',
  awning: '<path d="M3 4h18"/><path d="M4 4v4l2 3 2-3 2 3 2-3 2 3 2-3 2 3 2-3V4"/><path d="M5 11v9M19 11v9"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 22 2-6 3 2v4"/><path d="m10 9 4-1 3 4 3 1"/><path d="M14 8l-2 8-3-2-2 3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.home}</svg>`;
}

const AREA_RULES = [
  [/σαλ[οό]ν|καθιστικ/, 'sofa'],
  [/κουζ[ιί]ν|τραπεζαρ/, 'utensils'],
  [/μπ[αά]νι|τουαλ[εέ]τ/, 'bath'],
  [/γραφε[ιί]/, 'monitor'],
  [/μπαλκ[οό]ν|κ[ηή]π|βερ[αά]ντ|ταρ[αά]τσ|αυλ[ηή]/, 'tree'],
  [/διαδρομ|δι[αά]δρομ|ε[ιί]σοδ|χολ/, 'door'],
  [/αποθ[ηή]κ/, 'box'],
  [/γκαρ[αά]ζ/, 'car'],
  [/υπνοδωμ|κρεβατοκ[αά]μ|δωμ[αά]τι/, 'bed'],
  [/living|lounge|family|salon/, 'sofa'],
  [/bed|guest|kid|nursery|master/, 'bed'],
  [/kitchen|dining|cook/, 'utensils'],
  [/bath|toilet|wc|shower|powder/, 'bath'],
  [/office|study|work|desk/, 'monitor'],
  [/lab|workshop|maker/, 'flask'],
  [/studio|media|cinema|theat|tv|game/, 'video'],
  [/inventory|storage|store|pantry|closet|laundry|utility|basement|attic/, 'box'],
  [/garage|car|driveway|carport/, 'car'],
  [/garden|yard|patio|outdoor|balcony|terrace|porch|lawn|pool/, 'tree'],
  [/hall|entr|foyer|corridor|stair|landing|door/, 'door'],
];

const MDI_MAP = {
  sofa: 'sofa', 'sofa-outline': 'sofa', bed: 'bed', 'bed-king': 'bed', 'bed-outline': 'bed',
  'silverware-fork-knife': 'utensils', 'stove': 'utensils', 'fridge': 'utensils',
  'shower': 'bath', 'bathtub': 'bath', 'toilet': 'bath', 'desk': 'monitor', 'monitor': 'monitor',
  'flask': 'flask', 'flask-outline': 'flask', 'video': 'video', 'television': 'video',
  'garage': 'car', 'car': 'car', 'tree': 'tree', 'flower': 'tree', 'door': 'door', 'package-variant': 'box',
};

export const hasIcon = (name) => name in P;

export function areaIcon(area) {
  if (area.icon && P[area.icon]) return area.icon;
  const mdi = (area.icon || '').replace(/^mdi:/, '');
  if (MDI_MAP[mdi]) return MDI_MAP[mdi];
  const n = (area.name || '').toLocaleLowerCase('el');
  for (const [re, ic] of AREA_RULES) if (re.test(n)) return ic;
  return 'home';
}

export function weatherIcon(condition) {
  switch (condition) {
    case 'sunny': return 'sun';
    case 'clear-night': return 'moon';
    case 'partlycloudy': return 'cloudSun';
    case 'cloudy': return 'cloud';
    case 'rainy': case 'pouring': return 'rain';
    case 'snowy': case 'snowy-rainy': case 'hail': return 'snow';
    case 'fog': return 'fog';
    case 'lightning': case 'lightning-rainy': return 'bolt';
    case 'windy': case 'windy-variant': return 'wind';
    default: return 'cloudSun';
  }
}

export const WEATHER_LABEL = {
  sunny: 'Sunny', 'clear-night': 'Clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy',
  rainy: 'Rain', pouring: 'Heavy rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail',
  fog: 'Fog', lightning: 'Thunder', 'lightning-rainy': 'Storms', windy: 'Windy',
  'windy-variant': 'Windy', exceptional: 'Unusual',
};
