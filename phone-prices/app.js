/* Phone Prices
 * Search smartphones on Skroutz, BestPrice, Public, Kotsovolos, Plaisio and Germanos and show the cheapest.
 *
 * In the Android app, window.PPBridge (Java) opens each store's search page in a hidden WebView
 * on the phone and runs ppExtract (extract.js) inside it; results come back via PPNative.on().
 * In a normal browser that bridge does not exist (browsers can't read other sites), so the page
 * offers links to each store's search instead.
 */
(() => {
  'use strict';

  const APP_VERSION = '1.2';
  const STORES = window.PP_STORES;
  const N = window.PPBridge || null; // native bridge (Android app only)
  const EXTRACT_SRC = String(window.ppExtract);
  const POLL_MS = 1000;
  const TIMEOUT_MS = 35000;
  const SCROLLS = 3;

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('searchForm'), q: $('q'), recent: $('recent'), stores: $('stores'), best: $('best'),
    results: $('results'), intro: $('intro'), browserNote: $('browserNote'), settingsBtn: $('settingsBtn'),
    settings: $('settings'), sheet: $('storeSheet'), version: $('appVersion'),
  };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const opts = Object.assign({ refurb: false, oos: false, all: false }, store.get('pp.opts', {}));
  let disabled = new Set(store.get('pp.disabled', []));
  let job = 0;
  let query = '';
  const S = {}; // per-store search state

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
  const money = (v) => euro.format(v);
  const storeById = (id) => STORES.find((s) => s.id === id);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

  function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');
  }

  /* ------------------------------------------------------------------ */
  /* Understanding product titles                                         */
  /* ------------------------------------------------------------------ */
  // "Apple iPhone 16 5G (8GB/128GB) Black" -> tokens [apple, iphone, 16, 5g, ram8, 128gb, black]
  function tokens(s) {
    return fold(s)
      .replace(/\+/g, ' plus ')
      .replace(/(\d+)\s*gb\s*ram\b/g, ' ram$1 ')
      .replace(/\bram\s*(\d+)\s*gb\b/g, ' ram$1 ')
      .replace(/(\d+)\s*(?:gb)?\s*\/\s*(\d+)\s*(gb|tb)\b/g, ' ram$1 $2$3 ')
      .replace(/(\d+)\s*(gb|tb)\b/g, ' $1$2 ')
      .split(/[^a-z0-9α-ω]+/)
      .filter(Boolean);
  }
  const STORAGE_RE = /^(\d+)(gb|tb)$/;
  const gb = (t) => { const m = t.match(STORAGE_RE); return m ? (+m[1]) * (m[2] === 'tb' ? 1024 : 1) : 0; };
  // split letter/digit boundaries: s25 -> s 25, flip6 -> flip 6
  const splitAlnum = (t) => t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').split(' ');

  const BRANDS = new Set(['apple', 'samsung', 'galaxy', 'xiaomi', 'huawei', 'honor', 'motorola', 'moto', 'nokia', 'oppo', 'realme', 'oneplus', 'google', 'sony', 'nothing', 'tcl', 'zte', 'alcatel', 'vivo', 'hmd', 'cubot', 'blackview', 'doogee', 'ulefone', 'oukitel', 'asus', 'lenovo', 'cat', 'fairphone', 'infinix', 'tecno', 'meizu']);
  // Brand families: words that name the same maker. A brand typed in a search must agree with the
  // phone's family ("xiaomi 18 pro max" must not find "iPhone 18 Pro Max"), and phones from different
  // families never share a row ("Xiaomi 15" is not "OnePlus 15").
  const FAMILIES = {
    apple: ['apple', 'iphone'], samsung: ['samsung', 'galaxy'], xiaomi: ['xiaomi', 'redmi', 'poco'],
    google: ['google', 'pixel'], motorola: ['motorola', 'moto'], huawei: ['huawei'], honor: ['honor'],
    oppo: ['oppo'], realme: ['realme'], oneplus: ['oneplus'], nothing: ['nothing'], tcl: ['tcl'],
    zte: ['zte', 'nubia'], alcatel: ['alcatel'], vivo: ['vivo'], nokia: ['nokia', 'hmd'], sony: ['sony', 'xperia'],
    cubot: ['cubot'], blackview: ['blackview'], doogee: ['doogee'], ulefone: ['ulefone'], oukitel: ['oukitel'],
    asus: ['asus', 'zenfone'], lenovo: ['lenovo'], cat: ['cat'], fairphone: ['fairphone'], infinix: ['infinix'],
    tecno: ['tecno'], meizu: ['meizu'],
  };
  const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([f, words]) => words.map((w) => [w, f])));
  const familyOf = (tk) => { for (const t of tk) { const f = FAMILY_OF.get(t); if (f) return f; } return ''; };
  const FILLER = new Set(['5g', '4g', 'lte', 'dual', 'sim', 'dualsim', 'ds', 'nfc', 'esim', 'smartphone', 'smartphones', 'κινητο', 'κινητα', 'τηλεφωνο', 'τηλεφωνα', 'mobile', 'phone', 'global', 'version', 'eu', 'rom', 'new', 'νεο', 'με', 'και', 'with', 'and', 'the', 'refurbished', 'grade', 'renewed', 'ανακατασκευασμενο', 'μεταχειρισμενο', 'used', 'nano', 'unlocked']);
  const COLORS = new Set(['black', 'white', 'blue', 'green', 'red', 'pink', 'purple', 'violet', 'yellow', 'gold', 'silver', 'gray', 'grey', 'graphite', 'titanium', 'natural', 'desert', 'ultramarine', 'teal', 'midnight', 'starlight', 'lavender', 'mint', 'cream', 'navy', 'orange', 'coral', 'bronze', 'beige', 'brown', 'sand', 'ice', 'icy', 'mist', 'jade', 'onyx', 'cobalt', 'sapphire', 'emerald', 'lime', 'peach', 'lilac', 'aqua', 'ocean', 'sky', 'cyan', 'rose', 'champagne', 'frost', 'shadow', 'space', 'jet', 'pearl', 'obsidian', 'porcelain', 'hazel', 'iris', 'peony', 'wintergreen', 'moonstone', 'charcoal', 'awesome', 'phantom', 'cosmic', 'deep', 'light', 'dark', 'μαυρο', 'λευκο', 'ασπρο', 'μπλε', 'πρασινο', 'κοκκινο', 'ροζ', 'μωβ', 'κιτρινο', 'χρυσο', 'ασημι', 'ασημενιο', 'γκρι', 'μπεζ', 'πορτοκαλι', 'καφε', 'τιρκουαζ', 'λιλα', 'μεντα', 'σκουρο', 'ανοιχτο']);

  const REFURB_RE = /refurb|renewed|ανακατασκευ|μεταχειρισ|\bused\b|grade [abc]\b|open ?box|εκθεσιακ|επισκευασμ|second hand/;
  const ACCESSORY_RE = /θηκ|\bcase\b|cover|καλυμμ|προστα[τσ]|protector|tempered|τζαμ|μεμβραν|\bfilm\b|φορτιστ|charger|καλωδι|\bcable\b|adapter|αντα[πφ]τορ|ακουστικ|earbud|earphone|headphone|headset|\bbuds|airpods|\bwatch|ρολοι|\bband\b|λουρακ|\bstrap\b|tablet|ipad|\btab\d*\b|\bpad\d*\b|βαση|holder|\bstand\b|stylus|γραφιδ|pencil|power ?bank|magsafe|wallet|πορτοφολ|pouch|\blens\b|\bgrip\b|selfie|tripod|καρτα μνημ|memory card|microsd|laptop|notebook|macbook|chromebook|monitor|τηλεορασ|\btv\b|playstation|xbox|nintendo|κονσολ|console|δωροκαρτ|gift ?card|airtag|tracker|keyboard|πληκτρολ|\bmouse\b|ποντικ|\bskin\b|sticker|αυτοκολλ|drone|gimbal|router|modem|mifi|ηχειο|speaker|smart ?tag|φακος|συμβολαιο|καρτοκινητ/;

  function analyse(it, st) {
    const f = fold(it.t);
    const tk = tokens(it.t);
    let storage = 0;
    for (const t of tk) storage = Math.max(storage, gb(t) >= 16 ? gb(t) : 0);
    const firstSpec = tk.findIndex((t) => STORAGE_RE.test(t) || /^ram\d+$/.test(t));
    const head = firstSpec > 0 ? tk.slice(0, firstSpec) : tk;
    const model = head
      .filter((t) => !BRANDS.has(t) && !FILLER.has(t) && !COLORS.has(t) && !/^ram\d+$/.test(t) && !STORAGE_RE.test(t))
      .flatMap(splitAlnum)
      .filter(Boolean);
    const refurb = REFURB_RE.test(f);
    const accessory = ACCESSORY_RE.test(f);
    const phoneHint = (it.c && /smartphone|κινητ|mobile/i.test(it.c)) || (st.phonePath && new RegExp(st.phonePath, 'i').test(it.u));
    const phone = !accessory && it.p >= 50 && (storage > 0 || phoneHint);
    const fam = familyOf(tk);
    return {
      tk, storage, model, refurb, phone, fam,
      key: (refurb ? 'r:' : '') + fam + ':' + model.join(' ') + '|' + storage,
    };
  }

  // Does a product title match what was searched for?
  function queryTokens(q) {
    const raw = tokens(q);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      // "s 25" -> "s25"
      if (/^[a-z]$/.test(raw[i]) && /^\d+$/.test(raw[i + 1] || '')) { out.push(raw[i] + raw[i + 1]); i++; } else out.push(raw[i]);
    }
    return out.filter((t) => !FILLER.has(t) || /^\d/.test(t));
  }
  function matches(info, qt) {
    const T = info.tk;
    const T2 = T.flatMap(splitAlnum);
    // a brand in the search rules out phones of other brands
    const qFams = qt.map((q) => FAMILY_OF.get(q)).filter(Boolean);
    if (qFams.length && info.fam && !qFams.includes(info.fam)) return false;
    return qt.every((q) => {
      if (T.includes(q)) return true;
      // other brand words of the same maker are optional ("galaxy s25" finds "Samsung S25")
      if (BRANDS.has(q)) return true;
      if (STORAGE_RE.test(q)) return info.storage === gb(q);
      if (/^\d+$/.test(q)) {
        if (info.storage === +q || (+q <= 4 && info.storage === +q * 1024)) return true;
        return T.some((t) => t.length > q.length && t.endsWith(q) && /^[a-z]+$/.test(t.slice(0, -q.length))); // "6" in "flip6", not in "16e"
      }
      if (/^ram\d+$/.test(q)) return T.includes(q);
      if (/[a-z]/.test(q) && /\d/.test(q)) { // s25 vs "S 25", flip6 vs "Flip 6"
        const parts = splitAlnum(q);
        for (let i = 0; i + parts.length <= T2.length; i++) if (parts.every((p, j) => T2[i + j] === p)) return true;
        return false;
      }
      if (q.length >= 3) return T.some((t) => t.startsWith(q)); // "galax", "redm"
      return false;
    });
  }

  // Name to show for a group: the title up to the storage, without colour and filler words.
  function displayName(title, storage, refurb) {
    let t = String(title);
    // first storage spec: "128GB", "(8GB/128GB)", "8/256GB", "12GB RAM 512GB"
    const m = t.match(/\(?\s*(?:\d+\s*(?:GB)?\s*(?:RAM)?\s*[/+]\s*|\d+\s*GB\s+RAM\s+)?\d+\s*(?:GB|TB)\b/i);
    if (m && m.index > 3) t = t.slice(0, m.index);
    t = t.replace(/(^|\s)(?:dual\s*sim|dual|5g|4g|lte|nfc|esim|smartphone|κινητό|κινητο|τηλέφωνο|τηλεφωνο|refurbished|renewed)(?=\s|$)/giu, ' ')
      .replace(/[()[\]|,–-]+\s*$/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .replace(/\b([A-Z]{4,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
    const words = t.split(' ');
    while (words.length > 1 && COLORS.has(fold(words[words.length - 1]))) words.pop();
    t = words.join(' ');
    const cap = storage ? (storage >= 1024 && storage % 1024 === 0 ? storage / 1024 + 'TB' : storage + 'GB') : '';
    return (refurb ? 'Refurbished ' : '') + t + (cap ? ' ' + cap : '');
  }

  /* ------------------------------------------------------------------ */
  /* Searching                                                            */
  /* ------------------------------------------------------------------ */
  function template(st) { return store.get('pp.tpl.' + st.id, null) || st.search; }
  function searchUrl(st, q) {
    return template(st)
      .replace('{q+}', encodeURIComponent(q).replace(/%20/g, '+'))
      .replace('{q}', encodeURIComponent(q));
  }
  // After the extractor used a store's search box, remember the URL it landed on.
  function learnTemplate(st, url, q) {
    if (st.verified || !url) return;
    const enc = encodeURIComponent(q);
    const variants = [[enc.replace(/%20/g, '+'), '{q+}'], [enc, '{q}'], [q.replace(/ /g, '+'), '{q+}'], [q, '{q}']];
    for (const [v, ph] of variants) {
      const i = url.toLowerCase().indexOf(v.toLowerCase());
      if (i > 0 && url.indexOf('?') >= 0 && url.indexOf('?') < i) {
        const tpl = url.slice(0, i) + ph + url.slice(i + v.length);
        if (tpl !== template(st) && tpl.startsWith(st.home)) store.set('pp.tpl.' + st.id, tpl);
        return;
      }
    }
  }

  function search(q) {
    q = q.trim().replace(/\s+/g, ' ');
    if (!q) return;
    query = q;
    els.q.value = q;
    els.q.blur();
    addRecent(q);
    job++;
    const myJob = job;
    for (const id of Object.keys(S)) { clearInterval(S[id].timer); }
    for (const st of STORES) {
      if (disabled.has(st.id)) { S[st.id] = { status: 'off', items: [], job: myJob }; continue; }
      S[st.id] = { status: N ? 'loading' : 'manual', items: [], job: myJob, t0: Date.now(), loadedAt: 0, polls: 0, lastCount: -1, stable: 0, challengeSince: 0, url: searchUrl(st, q) };
      if (N) startStore(st, myJob);
    }
    history.replaceState(null, '', '#q=' + encodeURIComponent(q));
    render();
  }

  function startStore(st, myJob) {
    const s = S[st.id];
    try { N.load(st.id, s.url); } catch (e) { s.status = 'error'; s.note = String(e); return; }
    s.timer = setInterval(() => poll(st, myJob), POLL_MS);
  }

  function poll(st, myJob, debug) {
    const s = S[st.id];
    if (!s || s.job !== myJob) return;
    if (!debug && Date.now() - s.t0 > TIMEOUT_MS) {
      finish(st, s.items.length ? 'done' : (s.challengeSince ? 'blocked' : (s.httpStatus >= 400 ? 'error' : 'timeout')));
      return;
    }
    const cfg = {
      job: myJob, q: query, product: st.product, keyParam: st.keyParam || null, attr: st.attr || null,
      searchBox: !st.verified, sinceLoad: sinceLoad(s), scrolls: SCROLLS, debug: !!debug,
    };
    s.polls++;
    try { N.eval(st.id, myJob + ':' + (debug ? 'debug' : s.polls), '(' + EXTRACT_SRC + ')(' + JSON.stringify(cfg) + ')'); } catch { /* ignore */ }
  }

  function finish(st, status) {
    const s = S[st.id];
    clearInterval(s.timer);
    s.timer = null;
    s.status = status;
    if (status === 'done') learnTemplate(st, s.pageUrl, query);
    // stop the page from loading more (ads, trackers): saves mobile data
    try { if (status !== 'blocked') N.stop(st.id); } catch { /* ignore */ }
    render();
  }

  function onResult(st, s, r) {
    if (!r || r.status === 'stale') return;
    s.pageUrl = r.url;
    s.pageTitle = r.title;
    s.lastNote = r.note || s.lastNote;
    if (r.searchBox) s.searchBoxAt = Date.now();
    if (r.status === 'challenge') {
      if (!s.challengeSince) s.challengeSince = Date.now();
      if (Date.now() - s.challengeSince > 5000 && s.status !== 'blocked') { s.status = 'blocked'; render(); }
      return;
    }
    s.challengeSince = 0;
    if (s.status === 'blocked') s.status = 'loading';
    if (r.status === 'error') { s.note = r.note; return; }
    if (r.status !== 'ok') return;
    const loaded = sinceLoad(s);
    const changed = r.items.length !== s.items.length;
    s.items = r.items;
    if (r.items.length) {
      if (r.items.length === s.lastCount) s.stable++; else { s.stable = 0; s.lastCount = r.items.length; }
      if (s.stable >= 2 && (r.scrolls >= SCROLLS || loaded > 7000)) { finish(st, 'done'); return; }
    } else if (r.noResults && (st.verified || r.searchBoxTried) && loaded > 2500 && (!s.searchBoxAt || Date.now() - s.searchBoxAt > 4000)) {
      finish(st, 'empty'); return;
    } else if (r.searchBoxTried && s.searchBoxAt && Date.now() - s.searchBoxAt > 12000) {
      finish(st, 'empty'); return;
    }
    if (changed) render();
  }

  // Events from the Android app
  window.PPNative = {
    on(id, type, a, b) {
      const st = storeById(id);
      const s = S[id];
      if (!st || !s) return;
      if (type === 'start') { s.loadedAt = 0; s.t0 = Math.max(s.t0, Date.now() - 20000); }
      else if (type === 'page' || type === 'commit') { if (type === 'page' || !s.loadedAt) s.loadedAt = Date.now(); }
      else if (type === 'http') { if (a === '' || +a >= 400) s.httpStatus = +a; }
      else if (type === 'error') { s.note = a; }
      else if (type === 'closed') {
        // the person looked at the page (maybe passed a "verify you are human" check): retry it
        if (s.status === 'blocked' || s.status === 'timeout' || s.status === 'error' || s.status === 'empty') retry(id);
      } else if (type === 'eval') {
        const [j, tag] = String(a).split(':');
        if (+j !== s.job) return;
        let r = null;
        try { r = JSON.parse(b); } catch { return; }
        if (tag === 'debug') { shareDebug(st, r); return; }
        if (s.timer) onResult(st, s, r);
      }
    },
  };

  function retry(id) {
    const st = storeById(id);
    if (!st || !N || !query) return;
    const s = S[id];
    if (s && s.timer) clearInterval(s.timer);
    S[id] = { status: 'loading', items: [], job, t0: Date.now(), loadedAt: 0, polls: 0, lastCount: -1, stable: 0, challengeSince: 0, url: searchUrl(st, query) };
    startStore(st, job);
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Results                                                              */
  /* ------------------------------------------------------------------ */
  function collect() {
    const qt = queryTokens(query);
    const offers = [];
    let hidden = 0;
    for (const st of STORES) {
      const s = S[st.id];
      if (!s || !s.items) continue;
      for (const it of s.items) {
        if (!it.p || !it.t || !safeUrl(it.u)) continue;
        const info = analyse(it, st);
        if (!matches(info, qt)) { hidden++; continue; }
        if (!opts.all && !info.phone) { hidden++; continue; }
        if (!opts.refurb && info.refurb) { hidden++; continue; }
        if (!opts.oos && it.oos) { hidden++; continue; }
        offers.push({ st, it, info });
      }
    }
    const groups = new Map();
    for (const o of offers) {
      let g = groups.get(o.info.key);
      if (!g) groups.set(o.info.key, (g = { key: o.info.key, offers: [], byStore: new Map() }));
      g.offers.push(o);
    }
    const list = [];
    for (const g of groups.values()) {
      // best offer per store (several colours of the same phone)
      for (const o of g.offers) {
        const cur = g.byStore.get(o.st.id);
        if (!cur || rank(o) < rank(cur)) g.byStore.set(o.st.id, o);
      }
      g.rows = [...g.byStore.values()].sort((x, y) => rank(x) - rank(y));
      g.best = g.rows[0];
      const named = g.offers.slice().sort((x, y) => x.it.t.length - y.it.t.length)[0];
      g.name = displayName(named.it.t, named.info.storage, named.info.refurb);
      g.img = (g.rows.find((o) => o.it.i) || {}).it?.i || '';
      list.push(g);
    }
    list.sort((x, y) => rank(x.best) - rank(y.best));
    return { groups: list, hidden, offers };
  }
  // in-stock first, then by price
  const rank = (o) => (o.it.oos ? 1e6 : 0) + o.it.p;
  // most expensive minus cheapest in-stock offer of a phone
  function saving(g) {
    const p = g.rows.filter((o) => !o.it.oos).map((o) => o.it.p);
    return p.length > 1 ? Math.max(...p) - Math.min(...p) : 0;
  }
  // ms since the store page finished loading; pages that never report it count as loaded after 8 s
  const sinceLoad = (s) => (s.loadedAt ? Date.now() - s.loadedAt : Math.max(0, Date.now() - s.t0 - 8000));

  function render() {
    renderStores();
    if (!query) {
      els.best.innerHTML = ''; els.results.innerHTML = ''; els.intro.hidden = false; renderRecent();
      return;
    }
    els.intro.hidden = true;
    els.recent.hidden = true;
    if (!N) { renderManual(); return; }
    const { groups, hidden } = collect();
    const busy = STORES.some((st) => S[st.id] && (S[st.id].status === 'loading'));
    if (!groups.length) {
      els.best.innerHTML = '';
      els.results.innerHTML = busy
        ? '<p class="empty"><span class="spinner"></span> Searching the stores…</p>'
        : `<p class="empty">No smartphones found for <b>${esc(query)}</b>.${hidden ? ` ${hidden} other item${hidden > 1 ? 's' : ''} hidden by the filters (<button class="link-btn" data-act="filters">change</button>).` : ''}</p>`;
      return;
    }
    const top = groups[0];
    const b = top.best;
    const others = top.rows.slice(1);
    els.best.innerHTML = `
      <article class="best">
        <p class="best-label">${busy ? '<span class="spinner"></span> Cheapest so far' : 'Cheapest option'}</p>
        <div class="best-main">
          ${top.img ? `<img src="${esc(top.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <div>
            <h2>${esc(top.name)}</h2>
            <p class="best-price">${money(b.it.p)}</p>
            <p class="best-store"><span class="dot" style="background:${b.st.color}"></span>${esc(b.st.name)}${b.it.oos ? ' · <span class="oos">out of stock</span>' : ''}${b.it.a && !b.it.oos ? ' · ' + esc(b.it.a) : ''}</p>
          </div>
        </div>
        <p class="best-title">${esc(b.it.t)}</p>
        <button class="btn primary wide" data-open="${esc(b.it.u)}">Open on ${esc(b.st.name)}</button>
        ${others.length ? `<p class="cmp">Same phone elsewhere: ${others.map((o) => `<a href="#" data-open="${esc(o.it.u)}">${esc(o.st.name)} ${money(o.it.p)}</a>`).join(' · ')}</p>` : ''}
      </article>`;

    const shown = groups.slice(0, 40);
    els.results.innerHTML = `
      <div class="res-head"><h3>${groups.length} phone${groups.length > 1 ? 's' : ''} found</h3>
        <span class="muted">${hidden ? `${hidden} hidden · ` : ''}<button class="link-btn" data-act="filters">Filters</button></span></div>
      ${shown.map((g, i) => `
        <article class="group${i === 0 ? ' top' : ''}">
          <div class="g-head">
            ${g.img ? `<img src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="noimg"></div>'}
            <div class="g-title"><h4>${esc(g.name)}</h4>
              <p class="muted">${g.rows.length} store${g.rows.length > 1 ? 's' : ''}${saving(g) > 0 ? ` · save up to ${money(saving(g))}` : ''}</p></div>
          </div>
          <ul class="offers">
            ${g.rows.map((o, j) => `
              <li class="${j === 0 && !o.it.oos ? 'cheapest' : ''}${o.it.oos ? ' is-oos' : ''}">
                <a href="#" data-open="${esc(o.it.u)}" title="${esc(o.it.t)}">
                  <span class="dot" style="background:${o.st.color}"></span>
                  <span class="o-store">${esc(o.st.name)}${o.st.aggregator ? '<small>lowest shop</small>' : ''}</span>
                  <span class="o-note">${o.it.oos ? 'out of stock' : (j === 0 ? 'cheapest' : '')}</span>
                  <span class="o-price">${money(o.it.p)}</span>
                </a>
              </li>`).join('')}
          </ul>
        </article>`).join('')}
      ${groups.length > shown.length ? `<p class="muted center">${groups.length - shown.length} more not shown. Make the search more specific.</p>` : ''}`;
  }

  function statusText(st, s) {
    if (!s) return '';
    switch (s.status) {
      case 'loading': return s.items.length ? `${s.items.length}…` : '';
      case 'done': return String(s.items.length);
      case 'empty': return '0';
      case 'blocked': return 'verify';
      case 'timeout': return 'slow';
      case 'error': return 'error';
      case 'off': return 'off';
      case 'manual': return 'open';
      default: return '';
    }
  }
  function renderStores() {
    if (!query || !N) { els.stores.innerHTML = ''; return; }
    els.stores.innerHTML = STORES.map((st) => {
      const s = S[st.id] || {};
      const cls = 'is-' + (s.status || 'idle');
      return `<button class="chip store ${cls}" data-store="${st.id}" type="button">
        <span class="dot" style="background:${st.color}"></span>${esc(st.name)}
        <span class="st">${s.status === 'loading' ? '<span class="spinner sm"></span>' : ''}${esc(statusText(st, s))}</span></button>`;
    }).join('');
  }

  function renderManual() {
    els.best.innerHTML = '';
    els.browserNote.hidden = true;
    els.results.innerHTML = `
      <div class="manual">
        <p>Your browser can't read prices from other websites, so this page can't compare them by itself.
        Get the <a href="phone-prices.apk" download>Android app</a> for automatic price comparison, or open the search on each store:</p>
        <ul class="offers">${STORES.map((st) => `
          <li><a href="${esc(S[st.id].url)}" target="_blank" rel="noopener">
            <span class="dot" style="background:${st.color}"></span><span class="o-store">${esc(st.name)}</span>
            <span class="o-note"></span><span class="o-price">Search ›</span></a></li>`).join('')}</ul>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Recent searches, settings, store sheet                               */
  /* ------------------------------------------------------------------ */
  function addRecent(q) {
    const r = store.get('pp.recent', []).filter((x) => x.toLowerCase() !== q.toLowerCase());
    r.unshift(q);
    store.set('pp.recent', r.slice(0, 8));
  }
  function renderRecent() {
    const r = store.get('pp.recent', []);
    const ideas = ['iPhone 16 128GB', 'Galaxy S25', 'Pixel 9a', 'Redmi Note 14', 'Galaxy A56'];
    const list = r.length ? r : ideas;
    els.recent.hidden = false;
    els.recent.innerHTML = `<span class="muted">${r.length ? 'Recent' : 'Try'}</span>` +
      list.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('') +
      (r.length ? '<button class="link-btn" type="button" data-act="clear-recent">Clear</button>' : '');
  }

  function openSettings() {
    const f = els.settings;
    f.querySelector('#optRefurb').checked = opts.refurb;
    f.querySelector('#optOos').checked = opts.oos;
    f.querySelector('#optAll').checked = opts.all;
    f.querySelector('#storeToggles').innerHTML = STORES.map((st) => `
      <label class="row"><input type="checkbox" data-store-toggle="${st.id}" ${disabled.has(st.id) ? '' : 'checked'}>
        <span class="dot" style="background:${st.color}"></span>${esc(st.name)}
        ${store.get('pp.tpl.' + st.id, null) ? '<small class="muted">learned search URL</small>' : ''}</label>`).join('');
    f.querySelector('#nativeOnly').hidden = !N;
    f.showModal();
  }
  function saveSettings() {
    const f = els.settings;
    opts.refurb = f.querySelector('#optRefurb').checked;
    opts.oos = f.querySelector('#optOos').checked;
    opts.all = f.querySelector('#optAll').checked;
    store.set('pp.opts', opts);
    disabled = new Set([...f.querySelectorAll('[data-store-toggle]')].filter((c) => !c.checked).map((c) => c.dataset.storeToggle));
    store.set('pp.disabled', [...disabled]);
    render();
  }

  function openSheet(id) {
    const st = storeById(id);
    const s = S[id] || {};
    const sh = els.sheet;
    const msg = {
      loading: 'Searching…',
      done: `${s.items.length} products read from the page.`,
      empty: 'The store shows no results for this search.',
      blocked: 'The store wants to check that you are a person. Tap “Show page”, complete the check, then close the page and it searches again.',
      timeout: 'The store took too long to answer or the page could not be read.',
      error: 'The page did not load' + (s.note ? ': ' + s.note : '.'),
      off: 'This store is turned off in Settings.',
      manual: 'Open the store\'s search in your browser.',
    }[s.status] || '';
    sh.querySelector('h3').innerHTML = `<span class="dot" style="background:${st.color}"></span>${esc(st.name)}`;
    sh.querySelector('.sheet-msg').textContent = msg;
    sh.querySelector('.sheet-note').textContent = st.note || '';
    sh.querySelector('[data-sheet="show"]').hidden = !N || !S[id] || s.status === 'off';
    sh.querySelector('[data-sheet="retry"]').hidden = !N || !query || s.status === 'off';
    sh.querySelector('[data-sheet="debug"]').hidden = !N || !S[id] || s.status === 'off';
    sh.dataset.store = id;
    sh.showModal();
  }

  function shareDebug(st, r) {
    const s = S[st.id] || {};
    const report = {
      app: APP_VERSION, store: st.id, query, status: s.status, searchUrl: s.url, template: template(st),
      page: r && { url: r.url, title: r.title, status: r.status, items: r.items && r.items.length, links: r.links, noPrice: r.noPrice, noResults: r.noResults, note: r.note, sample: (r.items || []).slice(0, 5) },
      debug: r && r.debug,
    };
    const text = 'Phone Prices debug info\n' + JSON.stringify(report, null, 1);
    try { N.share(text); } catch { /* ignore */ }
  }

  function openLink(u) {
    u = safeUrl(u);
    if (!u) return;
    if (N) { try { N.open(u); return; } catch { /* fall through */ } }
    window.open(u, '_blank', 'noopener');
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                               */
  /* ------------------------------------------------------------------ */
  els.form.addEventListener('submit', (e) => { e.preventDefault(); search(els.q.value); });
  els.q.addEventListener('search', () => { if (!els.q.value) { query = ''; render(); } });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-q],[data-store],[data-act],[data-sheet]');
    if (!t) return;
    if (t.dataset.open) { e.preventDefault(); openLink(t.dataset.open); return; }
    if (t.dataset.q) { search(t.dataset.q); return; }
    if (t.dataset.store) { openSheet(t.dataset.store); return; }
    const act = t.dataset.act;
    if (act === 'filters') openSettings();
    else if (act === 'clear-recent') { store.del('pp.recent'); renderRecent(); }
    else if (act === 'reset-urls') { STORES.forEach((st) => store.del('pp.tpl.' + st.id)); openSettings(); }
    else if (act === 'clear-data') { try { N.clearData(); } catch { /* ignore */ } t.textContent = 'Cleared'; }
    const sh = t.dataset.sheet;
    if (sh) {
      const id = els.sheet.dataset.store;
      const st = storeById(id);
      if (sh === 'show') { try { N.show(id, st.name); } catch { /* ignore */ } }
      else if (sh === 'retry') retry(id);
      else if (sh === 'debug') poll(st, S[id].job, true);
      else if (sh === 'browser') openLink(S[id] && S[id].pageUrl && /^https?:/.test(S[id].pageUrl) ? S[id].pageUrl : searchUrl(st, query || ''));
      els.sheet.close();
    }
  });

  els.settingsBtn.addEventListener('click', openSettings);
  els.settings.addEventListener('close', saveSettings);
  [els.settings, els.sheet].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  if (els.version) els.version.textContent = 'v' + APP_VERSION + (N ? ' · app' : '');
  els.browserNote.hidden = !!N;
  if ('serviceWorker' in navigator && !N) navigator.serviceWorker.register('sw.js').catch(() => {});

  const m = location.hash.match(/^#q=(.+)$/);
  if (m) search(decodeURIComponent(m[1])); else render();

  // exposed for tests
  window.__pp = { analyse, matches, queryTokens, tokens, displayName, learnTemplate, template, collect, S, search };
})();
