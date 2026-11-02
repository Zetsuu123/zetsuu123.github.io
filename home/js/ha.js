// Home Assistant WebSocket client with OAuth sign-in (refresh tokens) or a long-lived access token.
const LS_AUTH = 'hd.auth';

export function loadAuth() {
  try { return JSON.parse(localStorage.getItem(LS_AUTH)) || null; } catch { return null; }
}
export function saveAuth(auth) {
  try { auth ? localStorage.setItem(LS_AUTH, JSON.stringify(auth)) : localStorage.removeItem(LS_AUTH); } catch { /* storage unavailable */ }
}

export function normalizeUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = (location.protocol === 'https:' ? 'https://' : 'http://') + u;
  return u;
}

const clientId = () => location.origin + '/';
const redirectUri = () => location.origin + location.pathname;

export function startLogin(hassUrl) {
  const state = btoa(JSON.stringify({ hassUrl, n: Math.random().toString(36).slice(2) }));
  try { sessionStorage.setItem('hd.state', state); } catch { /* ignore */ }
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId(), redirect_uri: redirectUri(), state });
  location.href = `${hassUrl}/auth/authorize?${q}`;
}

// Completes the OAuth redirect (?code=...&state=...). Returns the saved auth, or null if not a callback.
export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;
  history.replaceState(null, '', redirectUri() + location.hash);
  let expected = null;
  try { expected = sessionStorage.getItem('hd.state'); sessionStorage.removeItem('hd.state'); } catch { /* ignore */ }
  if (expected && expected !== state) throw new Error('Sign-in response did not match the request. Please try again.');
  let hassUrl;
  try { hassUrl = JSON.parse(atob(state)).hassUrl; } catch { throw new Error('Invalid sign-in response.'); }
  const tok = await tokenRequest(hassUrl, { grant_type: 'authorization_code', code, client_id: clientId() });
  const auth = { hassUrl, method: 'oauth', ...tokenFields(tok) };
  saveAuth(auth);
  return auth;
}

function tokenFields(t) {
  const out = { access_token: t.access_token, expires: Date.now() + (t.expires_in || 1800) * 1000 };
  if (t.refresh_token) out.refresh_token = t.refresh_token;
  return out;
}

async function tokenRequest(hassUrl, body) {
  let res;
  try {
    res = await fetch(hassUrl + '/auth/token', { method: 'POST', body: new URLSearchParams(body) });
  } catch {
    const err = new Error(`Could not reach ${hassUrl}. If Home Assistant is reachable, add this site to "cors_allowed_origins" (see the dashboard README) or use a long-lived access token.`);
    err.code = 'network';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(res.status === 400 ? 'Your Home Assistant session expired. Please sign in again.' : `Sign-in failed (${res.status}).`);
    err.code = 'auth';
    throw err;
  }
  return res.json();
}

export class HAConnection {
  constructor(auth, { onStatus, onSnapshot, onState }) {
    this.auth = auth;
    this.cb = { onStatus, onSnapshot, onState };
    this.id = 1;
    this.pending = new Map();
    this.subs = new Map();
    this.ws = null;
    this.closed = false;
    this.retry = 0;
    this.reloadTimer = null;
  }

  get hassUrl() { return this.auth.hassUrl; }

  async token() {
    const a = this.auth;
    if (a.refresh_token && a.expires && Date.now() > a.expires - 60_000) await this.refresh();
    return this.auth.access_token;
  }

  async refresh() {
    const t = await tokenRequest(this.auth.hassUrl, { grant_type: 'refresh_token', refresh_token: this.auth.refresh_token, client_id: clientId() });
    this.auth = { ...this.auth, ...tokenFields(t) };
    saveAuth(this.auth);
  }

  connect() {
    this.closed = false;
    this.cb.onStatus(this.retry ? 'reconnecting' : 'connecting');
    this.open().catch((err) => this.fail(err));
  }

  async open() {
    const token = await this.token();
    const url = this.auth.hassUrl.replace(/^http/i, 'ws') + '/api/websocket';
    const ws = new WebSocket(url);
    this.ws = ws;
    let authed = false;
    let retriedAuth = false;

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (Array.isArray(msg)) { msg.forEach((m) => this.handle(m)); return; }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_ok') {
        authed = true;
        this.retry = 0;
        this.startPing();
        try {
          await this.loadAll();
          this.cb.onStatus('connected');
        } catch (err) {
          this.cb.onStatus('error', err.message || 'Failed to load data from Home Assistant');
        }
      } else if (msg.type === 'auth_invalid') {
        if (this.auth.refresh_token && !retriedAuth) {
          retriedAuth = true;
          try { await this.refresh(); ws.close(); return; } catch { /* fall through */ }
        }
        this.closed = true;
        ws.close();
        this.cb.onStatus('error', this.auth.refresh_token ? 'Your Home Assistant session expired. Please sign in again.' : 'Access token was rejected by Home Assistant.', 'auth');
      } else {
        this.handle(msg);
      }
    };

    ws.onclose = () => {
      this.stopPing();
      for (const { reject } of this.pending.values()) reject(new Error('Connection lost'));
      this.pending.clear();
      this.subs.clear();
      if (this.closed) return;
      if (!authed && this.retry === 0) this.cb.onStatus('error', `Can't reach Home Assistant at ${this.auth.hassUrl}. Retrying…`);
      this.scheduleReconnect();
    };
  }

  fail(err) {
    if (err && err.code === 'auth') {
      this.closed = true;
      this.cb.onStatus('error', err.message, 'auth');
      return;
    }
    this.cb.onStatus('error', err?.message || 'Connection failed');
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delays = [1000, 2000, 5000, 10000, 20000, 30000];
    const d = delays[Math.min(this.retry, delays.length - 1)];
    this.retry++;
    this.cb.onStatus('reconnecting');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { if (!this.closed) this.open().catch((e) => this.fail(e)); }, d);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const t = setTimeout(() => this.ws && this.ws.close(), 10_000);
      this.send({ type: 'ping' }).then(() => clearTimeout(t), () => clearTimeout(t));
    }, 30_000);
  }
  stopPing() { clearInterval(this.pingTimer); }

  handle(msg) {
    if (msg.type === 'result' || msg.type === 'pong') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === 'pong' || msg.success) p.resolve(msg.result);
      else p.reject(new Error(msg.error?.message || 'Request failed'));
    } else if (msg.type === 'event') {
      const fn = this.subs.get(msg.id);
      if (fn) fn(msg.event);
    }
  }

  send(payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('Not connected to Home Assistant')); return; }
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  async subscribe(eventType, fn) {
    const id = this.id;
    this.subs.set(id, fn);
    try { await this.send({ type: 'subscribe_events', event_type: eventType }); }
    catch (e) { this.subs.delete(id); throw e; }
  }

  async loadAll() {
    await this.subscribe('state_changed', (ev) => {
      const d = ev.data || {};
      this.cb.onState(d.entity_id, d.new_state || null);
    });
    const reload = () => { clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => this.loadSnapshot().catch(() => {}), 800); };
    for (const t of ['area_registry_updated', 'entity_registry_updated', 'device_registry_updated']) {
      this.subscribe(t, reload).catch(() => {});
    }
    await this.loadSnapshot();
  }

  async loadSnapshot() {
    const [states, areas, entities, devices, config] = await Promise.all([
      this.send({ type: 'get_states' }),
      this.send({ type: 'config/area_registry/list' }).catch(() => []),
      this.send({ type: 'config/entity_registry/list' }).catch(() => []),
      this.send({ type: 'config/device_registry/list' }).catch(() => []),
      this.send({ type: 'get_config' }).catch(() => ({})),
    ]);
    const devArea = {};
    for (const d of devices) if (d.area_id) devArea[d.id] = d.area_id;
    const entityArea = {};
    const hidden = new Set();
    for (const e of entities) {
      const a = e.area_id || (e.device_id && devArea[e.device_id]);
      if (a) entityArea[e.entity_id] = a;
      if (e.hidden_by || e.disabled_by || e.entity_category) hidden.add(e.entity_id);
    }
    const map = {};
    for (const s of states) map[s.entity_id] = s;
    const base = this.auth.hassUrl;
    this.cb.onSnapshot({
      entities: map,
      areas: areas.map((a) => ({
        id: a.area_id, name: a.name, icon: a.icon || '',
        picture: a.picture ? (a.picture.startsWith('/') ? base + a.picture : a.picture) : '',
      })),
      entityArea,
      registryHidden: hidden,
      config: {
        location_name: config.location_name || 'Home',
        temp_unit: config.unit_system?.temperature || '°C',
        version: config.version || '',
      },
    });
  }

  callService(domain, service, data = {}, target) {
    const msg = { type: 'call_service', domain, service, service_data: data };
    if (target) msg.target = target;
    return this.send(msg);
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (this.ws) this.ws.close();
  }
}
