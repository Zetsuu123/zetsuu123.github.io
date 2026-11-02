/* YGO Card Scanner
 * Camera -> OCR (Tesseract.js, on-device) -> set code / passcode -> YGOPRODeck API -> Cardmarket link.
 */
(() => {
  'use strict';

  const APP_VERSION = '1.2';
  const API = 'https://db.ygoprodeck.com/api/v7/';
  const CARD_RATIO = 59 / 86; // width / height of a Yu-Gi-Oh! card

  // OCR crop regions as fractions of the card frame (x, y, w, h).
  // Deliberately larger than the dashed hint boxes in the UI, to forgive imperfect framing.
  const REGIONS = {
    set:  { x: 0.42, y: 0.66, w: 0.58, h: 0.17 }, // set code under the artwork (right side)
    pass: { x: 0.00, y: 0.89, w: 0.58, h: 0.13 }, // 8-digit passcode, bottom-left
    wide: { x: -0.10, y: 0.45, w: 1.20, h: 0.67 }, // lower half (+ margin): searched for short text lines
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    viewer: $('viewer'), video: $('video'), guide: $('guide'), viewerMsg: $('viewerMsg'),
    startCam: $('startCam'), status: $('status'), torchBtn: $('torchBtn'),
    scanBtn: $('scanBtn'), autoScan: $('autoScan'), fileInput: $('fileInput'),
    manualForm: $('manualForm'), manualInput: $('manualInput'),
    result: $('result'), historySection: $('historySection'), historyList: $('historyList'),
    clearHistory: $('clearHistory'), cmLang: $('cmLang'), work: $('work'),
  };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  };

  let stream = null;
  let torchOn = false;
  let busy = false;
  let autoTimer = null;
  let autoRound = 0;

  /* ------------------------------------------------------------------ */
  /* Status helpers                                                      */
  /* ------------------------------------------------------------------ */
  function setStatus(text, spinning = false) {
    if (!text) { els.status.hidden = true; return; }
    els.status.hidden = false;
    els.status.innerHTML = (spinning ? '<span class="spinner"></span> ' : '') + escapeHtml(text);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ */
  /* Camera                                                              */
  /* ------------------------------------------------------------------ */
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      els.viewerMsg.querySelector('p').textContent =
        'Live camera is not available in this browser. Use "Photo" to take a picture instead.';
      els.startCam.hidden = true;
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      els.video.srcObject = stream;
      await els.video.play().catch(() => {});
      await new Promise((r) => (els.video.readyState >= 1 ? r() : els.video.addEventListener('loadedmetadata', r, { once: true })));
      els.viewer.classList.add('live');
      els.scanBtn.disabled = false;
      store.set('camGranted', true);
      layoutGuide();

      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) els.torchBtn.hidden = false;
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      if (els.autoScan.checked) scheduleAuto(600);
    } catch (err) {
      console.warn(err);
      store.set('camGranted', false);
      els.viewerMsg.querySelector('p').textContent =
        'Could not open the camera (' + (err.name || 'error') + '). Allow camera access, or use "Photo".';
    }
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      els.torchBtn.classList.toggle('on', torchOn);
    } catch { torchOn = !torchOn; }
  }

  // Size and centre the card-shaped guide inside the viewer.
  function layoutGuide() {
    const vw = els.viewer.clientWidth;
    const vh = els.viewer.clientHeight;
    let h = vh * 0.9;
    let w = h * CARD_RATIO;
    if (w > vw * 0.86) { w = vw * 0.86; h = w / CARD_RATIO; }
    Object.assign(els.guide.style, {
      width: w + 'px', height: h + 'px',
      left: (vw - w) / 2 + 'px', top: (vh - h) / 2 + 'px',
    });
  }

  // Map the on-screen guide rectangle to pixel coordinates in the video frame (object-fit: cover).
  function guideInVideo() {
    const v = els.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    const cw = els.viewer.clientWidth, ch = els.viewer.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const offX = (cw - vw * scale) / 2;
    const offY = (ch - vh * scale) / 2;
    const g = els.guide;
    return {
      x: (g.offsetLeft - offX) / scale,
      y: (g.offsetTop - offY) / scale,
      w: g.offsetWidth / scale,
      h: g.offsetHeight / scale,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Image pre-processing                                                */
  /* ------------------------------------------------------------------ */

  // Crop `region` (fractions) of `card` (pixel rect inside `source`) into a new canvas,
  // upscaled and converted to high-contrast greyscale for OCR.
  function cropRegion(source, srcW, srcH, card, region, targetCardHeight = 1500, invert = false) {
    let sx = card.x + region.x * card.w;
    let sy = card.y + region.y * card.h;
    let sw = region.w * card.w;
    let sh = region.h * card.h;
    // clamp to the source image
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(srcW, sx + sw), y1 = Math.min(srcH, sy + sh);
    sx = x0; sy = y0; sw = x1 - x0; sh = y1 - y0;
    if (sw < 8 || sh < 8) return null;

    const scale = Math.min(3, Math.max(0.4, targetCardHeight / card.h));
    const out = document.createElement('canvas');
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
    enhance(ctx, out.width, out.height, invert);
    out.meta = { sx, sy, scale };
    return out;
  }

  // Greyscale + percentile contrast stretch.
  function enhance(ctx, w, h, invert) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const hist = new Uint32Array(256);
    const n = w * h;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = g;
      hist[g]++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let v = ((d[i] - lo) * 255) / range;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (invert) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Text line detection                                                 */
  /* ------------------------------------------------------------------ */
  // Tesseract misses tiny codes when art and borders surround them, so we first
  // locate short runs of glyph-sized blobs (5-14 characters) and OCR each one as a single line.
  function findTextLines(canvas, minH, maxH) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = px[i];

    // integral image for local means
    const W1 = w + 1;
    const integ = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row;
      }
    }
    const r = Math.max(6, Math.round(minH * 1.4)); // small window: tiny text next to dark borders
    const meanAt = (x, y) => {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const sum = integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0];
      return sum / ((x1 - x0) * (y1 - y0));
    };
    const means = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) means[y * w + x] = meanAt(x, y);

    const lines = [];
    for (const dark of [true, false]) {
      const ink = new Uint8Array(w * h);
      for (let i = 0; i < ink.length; i++) {
        const d = gray[i] - means[i];
        ink[i] = dark ? d < -22 : d > 22;
      }
      lines.push(...groupLines(componentsOf(ink, w, h, minH, maxH), dark));
    }
    return lines;
  }

  function componentsOf(ink, w, h, minH, maxH) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    const maxArea = maxH * maxH * 4;
    for (let start = 0; start < ink.length; start++) {
      if (!ink[start] || seen[start]) continue;
      let sp = 0, count = 0;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack[sp++] = start; seen[start] = 1;
      while (sp) {
        const i = stack[--sp];
        const x = i % w, y = (i / w) | 0;
        count++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (ink[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; }
          }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bh < minH || bh > maxH || count > maxArea) continue;
      if (bw > bh * 4) continue;            // long border segments
      const fill = count / (bw * bh);
      if (fill < 0.12 || fill > 0.92) continue;
      comps.push({ x0, x1, y0, y1, bh, cy: (y0 + y1) / 2, n: Math.max(1, Math.round(bw / (bh * 0.75))) });
    }
    return comps;
  }

  function groupLines(comps, dark) {
    comps.sort((a, b) => a.x0 - b.x0);
    const parent = comps.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (let i = 0; i < comps.length; i++) {
      const a = comps[i];
      for (let j = i + 1; j < comps.length; j++) {
        const b = comps[j];
        const hMax = Math.max(a.bh, b.bh);
        if (b.x0 - a.x1 > hMax * 1.6) break;
        if (Math.abs(a.cy - b.cy) > hMax * 0.35) continue;
        const ratio = a.bh / b.bh;
        if (ratio < 0.6 || ratio > 1.67) continue;
        parent[find(j)] = find(i);
      }
    }
    const groups = new Map();
    comps.forEach((c, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(c);
    });
    const lines = [];
    for (const g of groups.values()) {
      const glyphs = g.reduce((s, c) => s + c.n, 0);
      if (glyphs < 5 || glyphs > 14) continue;
      const x0 = Math.min(...g.map((c) => c.x0)), x1 = Math.max(...g.map((c) => c.x1));
      const y0 = Math.min(...g.map((c) => c.y0)), y1 = Math.max(...g.map((c) => c.y1));
      const lh = g.reduce((s, c) => s + c.bh, 0) / g.length;
      if ((x1 - x0) < lh * 2.5) continue;
      lines.push({ x0, x1, y0, y1, h: lh, glyphs, dark });
    }
    return lines;
  }

  // Cut a detected line out of the (enhanced) crop, padded and scaled for Tesseract.
  function lineCanvas(src, line) {
    const padX = line.h * 1.2, padY = line.h * 0.55;
    const x0 = Math.max(0, line.x0 - padX), y0 = Math.max(0, line.y0 - padY);
    const x1 = Math.min(src.width, line.x1 + padX), y1 = Math.min(src.height, line.y1 + padY);
    const scale = Math.min(3, Math.max(1, 30 / line.h));
    const c = document.createElement('canvas');
    c.width = Math.round((x1 - x0) * scale);
    c.height = Math.round((y1 - y0) * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (!line.dark) ctx.filter = 'invert(1)';
    ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* OCR                                                                 */
  /* ------------------------------------------------------------------ */
  let workerPromise = null;
  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        while (!window.Tesseract) await new Promise((r) => setTimeout(r, 100));
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: (m) => {
            if (m.status === 'loading language traineddata' && m.progress < 1) {
              setStatus('Downloading OCR data… ' + Math.round(m.progress * 100) + '%', true);
            }
          },
        });
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
          tessedit_pageseg_mode: '11', // sparse text: find text anywhere in the crop
        });
        return worker;
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  let currentPsm = '11';
  async function ocr(canvas, psm = '11') {
    if (!canvas) return '';
    const worker = await getWorker();
    if (psm !== currentPsm) { await worker.setParameters({ tessedit_pageseg_mode: psm }); currentPsm = psm; }
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  }

  /* ------------------------------------------------------------------ */
  /* Code extraction                                                     */
  /* ------------------------------------------------------------------ */
  const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', J: '1', Z: '2', S: '5', B: '8', G: '6' };
  const TO_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' };
  const SAFE_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1' }; // for the optional section letter slot

  // Parse "XXXX-RRNNN" into { prefix, region, number } fixing common OCR mix-ups.
  function parseSetCode(prefix, tail) {
    if (!/[A-Z]/.test(prefix)) return null;
    if (tail.length < 3 || tail.length > 6) return null;
    let num = tail.slice(-3).split('');
    // last two chars are always digits
    num[1] = TO_DIGIT[num[1]] || num[1];
    num[2] = TO_DIGIT[num[2]] || num[2];
    // first char is a digit or a section letter (e.g. Speed Duel "ENA01");
    // if it looks like a misread digit, prefer the digit but keep the letter as an alternative.
    let alt = null;
    if (SAFE_DIGIT[num[0]]) { alt = num.join(''); num[0] = SAFE_DIGIT[num[0]]; }
    num = num.join('');
    if (!/^[A-Z0-9]\d\d$/.test(num)) return null;
    const region = tail.slice(0, -3).split('').map((c) => TO_LETTER[c] || c).join('');
    if (!/^[A-Z]{0,3}$/.test(region)) return null;
    return { prefix, region, number: num, altNumber: alt, raw: `${prefix}-${region}${num}` };
  }

  function extractCodes(text) {
    const t = text.toUpperCase()
      .replace(/[–—_~=]/g, '-')
      .replace(/[ \t]*-[ \t]*/g, '-');
    const setCodes = [];
    const seen = new Set();
    const push = (p) => { if (p && !seen.has(p.raw)) { seen.add(p.raw); setCodes.push(p); } };

    for (const m of t.matchAll(/(?:^|[^A-Z0-9])([A-Z0-9]{2,4})-([A-Z0-9]{3,6})(?![A-Z0-9])/gm)) {
      push(parseSetCode(m[1], m[2]));
    }
    // dash missed or read as a space by OCR: "LOBEN001", "LOB EN001"
    for (const m of t.matchAll(/(?:^|[^A-Z0-9])([A-Z0-9]{3,4}) ?(EN|DE|FR|IT|SP|PT)([A-Z0-9]{3})(?![A-Z0-9])/gm)) {
      push(parseSetCode(m[1], m[2] + m[3]));
    }

    const passcodes = [];
    for (const m of t.matchAll(/(?:^|[^0-9])([0-9OQDIL]{8})(?![0-9])/gm)) {
      const digits = m[1].split('').map((c) => TO_DIGIT[c] || c).join('');
      // require mostly real digits to avoid matching words
      if ((m[1].match(/[0-9]/g) || []).length >= 6 && !passcodes.includes(digits)) passcodes.push(digits);
    }
    return { setCodes, passcodes };
  }

  // Candidate codes to try against the database for one detected set code.
  // YGOPRODeck stores TCG English codes, so other languages are mapped to "EN".
  function setCodeVariants(p) {
    const prefixes = [p.prefix];
    if (/0/.test(p.prefix)) prefixes.push(p.prefix.replace(/0/g, 'O'));
    if (/O/.test(p.prefix)) prefixes.push(p.prefix.replace(/O/g, '0'));
    if (/1/.test(p.prefix)) prefixes.push(p.prefix.replace(/1/g, 'I'));
    // English first; then the region as read (a few non-EN codes exist) and no region (e.g. "SDY-006").
    const regions = [...new Set(['EN', p.region, ''])];
    const numbers = p.altNumber ? [p.number, p.altNumber] : [p.number];
    const out = [];
    for (const num of numbers) for (const pre of prefixes) for (const r of regions) {
      const c = `${pre}-${r}${num}`;
      if (!out.includes(c)) out.push(c);
    }
    return out.slice(0, 8);
  }

  /* ------------------------------------------------------------------ */
  /* YGOPRODeck API                                                      */
  /* ------------------------------------------------------------------ */
  const apiCache = new Map();
  async function api(path) {
    if (apiCache.has(path)) return apiCache.get(path);
    const p = (async () => {
      const res = await fetch(API + path);
      let json = null;
      try { json = await res.json(); } catch { /* ignore */ }
      if (!res.ok || !json || json.error) return null; // "not found" is a normal outcome
      return json;
    })();
    apiCache.set(path, p);
    p.catch(() => apiCache.delete(path)); // network errors: allow retry
    return p;
  }

  async function cardById(id) {
    const j = await api(`cardinfo.php?id=${encodeURIComponent(id)}`);
    return j?.data?.[0] || null;
  }

  async function lookupSetCode(parsed) {
    for (const code of setCodeVariants(parsed)) {
      const info = await api(`cardsetsinfo.php?setcode=${encodeURIComponent(code)}`);
      if (info?.id) {
        const card = await cardById(info.id);
        if (card) return { card, code, setName: info.set_name, detected: parsed.raw };
      }
    }
    return null;
  }

  async function lookupPasscode(code) {
    const card = await cardById(String(Number(code)));
    return card ? { card, passcode: code, detected: code } : null;
  }

  async function searchByName(q) {
    const j = await api(`cardinfo.php?fname=${encodeURIComponent(q)}&num=15&offset=0`);
    return j?.data || [];
  }

  /* ------------------------------------------------------------------ */
  /* Cardmarket links                                                    */
  /* ------------------------------------------------------------------ */
  const cmLang = () => els.cmLang.value || 'en';

  function cmSearchUrl(query) {
    return `https://www.cardmarket.com/${cmLang()}/YuGiOh/Products/Search?searchString=${encodeURIComponent(query)}`;
  }

  // Set code -> Cardmarket product index, built weekly by tools/build_cm_index.py
  // from Cardmarket's public catalog. One small JSON file per set prefix (LOB.json, MAGO.json, ...).
  const DATA_BASE = location.hostname === 'appassets.androidplatform.net' // offline copy inside the APK
    ? 'https://zetsuu123.github.io/ygo-scanner/data/cm/'
    : 'data/cm/';
  const shardCache = new Map();
  function cmShard(prefix) {
    if (!shardCache.has(prefix)) {
      const p = fetch(DATA_BASE + encodeURIComponent(prefix) + '.json')
        .then((r) => (r.ok ? r.json() : {}));
      p.catch(() => shardCache.delete(prefix));
      shardCache.set(prefix, p);
    }
    return shardCache.get(prefix);
  }

  // -> [{ setName, products: [[idProduct, low, trend], ...] }]
  async function cmProducts(code, cardName) {
    const up = code.toUpperCase();
    const shard = await cmShard(up.split('-')[0]);
    let entries = shard[up] || [];
    const same = entries.filter((e) => e[0].toLowerCase() === cardName.toLowerCase());
    if (same.length) entries = same;
    return entries.map((e) => ({ setName: e[1], products: e[2] }));
  }

  const euro = (v) => (v == null ? '–' : '€' + Number(v).toFixed(2));

  async function renderCardmarket(box, card, code, token) {
    const allVersions = `<a class="btn" href="${cmSearchUrl(card.name)}" target="_blank" rel="noopener">All versions of ${escapeHtml(card.name)}</a>`;

    if (!code) {
      const cmPrice = card.card_prices?.[0]?.cardmarket_price;
      box.innerHTML = `
        ${cmPrice && Number(cmPrice) > 0 ? `<p class="price">Cardmarket trend: <strong>€${escapeHtml(cmPrice)}</strong> <small class="meta">(cheapest version)</small></p>` : ''}
        <a class="btn gold" href="${cmSearchUrl(card.name)}" target="_blank" rel="noopener">Open on Cardmarket</a>`;
      return;
    }

    // Cardmarket's search understands set codes, so search for exactly this printing.
    box.innerHTML = `
      <p class="price cm-price" hidden></p>
      <a class="btn gold" href="${cmSearchUrl(code)}" target="_blank" rel="noopener">Open ${escapeHtml(code)} on Cardmarket</a>
      ${allVersions}`;

    // Show this printing's Cardmarket price when the code maps to a single product.
    let groups = [];
    try { groups = await cmProducts(code, card.name); } catch { groups = []; }
    if (token !== renderToken) return; // a newer result is on screen
    const products = groups.flatMap((g) => g.products);
    if (products.length === 1) {
      const [, low, trend] = products[0];
      const el = box.querySelector('.cm-price');
      el.innerHTML = `Cardmarket: from <strong>${euro(low)}</strong> · trend <strong>${euro(trend)}</strong>`;
      el.hidden = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Scanning                                                            */
  /* ------------------------------------------------------------------ */

  // Run OCR passes over an image source, returning the first code that matches a real card.
  async function scanSource(source, srcW, srcH, card, { quick = false, wholeImage = false } = {}) {
    const tried = new Set();
    const detectedText = [];

    async function tryText(text) {
      detectedText.push(text);
      const { setCodes, passcodes } = extractCodes(text);
      for (const p of setCodes) {
        if (tried.has(p.raw)) continue;
        tried.add(p.raw);
        setStatus('Checking ' + p.raw + '…', true);
        const hit = await lookupSetCode(p);
        if (hit) return hit;
      }
      for (const pc of passcodes) {
        if (tried.has(pc)) continue;
        tried.add(pc);
        setStatus('Checking passcode ' + pc + '…', true);
        const hit = await lookupPasscode(pc);
        if (hit) return hit;
      }
      return null;
    }

    // 1) Find short text lines in the lower half of the card and OCR each one.
    setStatus('Reading card…', true);
    const region = wholeImage ? { x: 0, y: 0, w: 1, h: 1 } : REGIONS.wide;
    const crop = cropRegion(source, srcW, srcH, card, region, wholeImage ? 2000 : 1500);
    if (crop) {
      const { sx, sy, scale } = crop.meta;
      const cardH = card.h * scale;
      const minH = Math.max(6, cardH * (wholeImage ? 0.004 : 0.007));
      const maxH = cardH * 0.03;
      const lines = findTextLines(crop, minH, maxH);
      for (const l of lines) {
        const fx = (sx + (l.x0 + l.x1) / 2 / scale - card.x) / card.w;
        const fy = (sy + (l.y0 + l.y1) / 2 / scale - card.y) / card.h;
        l.score = -Math.abs(l.glyphs - 9) + (l.dark ? 0.5 : 0);
        if (!wholeImage) {
          if (fy > 0.64 && fy < 0.85 && fx > 0.45) l.score += 8;      // set code spot
          else if (fy > 0.86 && fx < 0.5) l.score += 5;               // passcode spot
        }
      }
      lines.sort((a, b) => b.score - a.score);
      for (const line of lines.slice(0, quick ? 4 : 10)) {
        const lc = lineCanvas(crop, line);
        const text = await ocr(lc, '7');
        if (window.__ygoDebug) window.__ygoDebug.push({ name: 'line', score: line.score, text, img: lc.toDataURL('image/png') });
        const hit = await tryText(text);
        if (hit) return { hit };
      }
    }

    // 2) Fallback: OCR whole regions with sparse-text layout analysis.
    if (!quick && !wholeImage) {
      for (const [name, invert] of [['set', false], ['pass', false], ['set', true]]) {
        setStatus('Looking harder…', true);
        const canvas = cropRegion(source, srcW, srcH, card, REGIONS[name], 1500, invert);
        const text = await ocr(canvas, '11');
        if (window.__ygoDebug) window.__ygoDebug.push({ name, invert, text, img: canvas && canvas.toDataURL('image/png') });
        const hit = await tryText(text);
        if (hit) return { hit };
      }
    }
    return { hit: null, tried: [...tried], text: detectedText.join(' ').replace(/\s+/g, ' ').trim() };
  }

  function grabFrame() {
    const v = els.video;
    const c = els.work;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }

  async function scanCamera({ auto = false } = {}) {
    if (busy || !stream) return;
    busy = true;
    els.scanBtn.disabled = true;
    try {
      const frame = grabFrame();
      const card = guideInVideo();
      const quick = auto && (autoRound++ % 3 !== 2); // every 3rd auto round also does the slow passes
      const res = await scanSource(frame, frame.width, frame.height, card, { quick });
      if (res.hit) {
        flashFound();
        showCard(res.hit);
        if (els.autoScan.checked) { els.autoScan.checked = false; store.set('auto', false); }
      } else if (!auto) {
        showNotFound(res);
      }
    } catch (err) {
      console.error(err);
      if (!auto) showError(networkMessage(err));
    } finally {
      busy = false;
      els.scanBtn.disabled = false;
      setStatus('');
      if (els.autoScan.checked) scheduleAuto(400);
    }
  }

  async function scanFile(file) {
    if (!file || busy) return;
    busy = true;
    els.scanBtn.disabled = true;
    stopAuto();
    try {
      const bmp = await loadImage(file);
      // Treat the whole photo as roughly the card; also try the wide region of the full image.
      const W = bmp.width, H = bmp.height;
      let card;
      if (W / H < CARD_RATIO) { const h = W / CARD_RATIO; card = { x: 0, y: (H - h) / 2, w: W, h }; }
      else { const w = H * CARD_RATIO; card = { x: (W - w) / 2, y: 0, w, h: H }; }
      let res = await scanSource(bmp, W, H, card);
      if (!res.hit) {
        // The card may not fill the photo: search the whole picture.
        const res2 = await scanSource(bmp, W, H, { x: 0, y: 0, w: W, h: H }, { wholeImage: true });
        res = res2.hit ? res2 : { hit: null, tried: [...new Set([...(res.tried || []), ...(res2.tried || [])])] };
      }
      if (res.hit) { flashFound(); showCard(res.hit); } else showNotFound(res);
    } catch (err) {
      console.error(err);
      showError(networkMessage(err));
    } finally {
      busy = false;
      els.scanBtn.disabled = !stream;
      setStatus('');
      els.fileInput.value = '';
    }
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function scheduleAuto(ms) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (els.autoScan.checked && stream && !document.hidden) scanCamera({ auto: true });
    }, ms);
  }
  function stopAuto() { clearTimeout(autoTimer); }

  function flashFound() {
    els.guide.classList.add('found');
    setTimeout(() => els.guide.classList.remove('found'), 900);
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function networkMessage(err) {
    return navigator.onLine === false || err instanceof TypeError
      ? 'Network problem — check your internet connection and try again.'
      : 'Something went wrong: ' + (err?.message || err);
  }

  /* ------------------------------------------------------------------ */
  /* Manual search                                                       */
  /* ------------------------------------------------------------------ */
  async function manualSearch(q) {
    q = q.trim();
    if (!q) return;
    els.manualInput.blur();
    showLoading('Searching…');
    try {
      const up = q.toUpperCase().replace(/\s+/g, '');
      if (/^\d{1,8}$/.test(up)) {
        const hit = await lookupPasscode(up);
        if (hit) return showCard(hit);
      }
      const { setCodes } = extractCodes(up);
      for (const p of setCodes) {
        const hit = await lookupSetCode(p);
        if (hit) return showCard(hit);
      }
      const list = await searchByName(q);
      if (list.length === 1) return showCard({ card: list[0], detected: q });
      if (list.length > 1) return showPickList(q, list);
      showError(`Nothing found for “${q}”.`, q);
    } catch (err) {
      console.error(err);
      showError(networkMessage(err));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function showLoading(text) {
    els.result.hidden = false;
    els.result.className = 'result';
    els.result.innerHTML = `<p><span class="spinner"></span> ${escapeHtml(text)}</p>`;
  }

  function showError(msg, query) {
    els.result.hidden = false;
    els.result.className = 'result error';
    els.result.innerHTML = `<p>${escapeHtml(msg)}</p>` + (query
      ? `<div class="actions"><a class="btn" href="${cmSearchUrl(query)}" target="_blank" rel="noopener">Search “${escapeHtml(query)}” on Cardmarket</a></div>`
      : '');
  }

  function showNotFound(res) {
    els.result.hidden = false;
    els.result.className = 'result error';
    const tried = res.tried?.length ? `<p class="detected">Codes read but not found: ${res.tried.map((c) => `<span class="code-pill">${escapeHtml(c)}</span>`).join(' ')}</p>` : '';
    els.result.innerHTML = `
      <p><strong>Couldn't read a card code.</strong></p>
      <p class="meta">Try again closer, with the card filling the frame, steady and well lit (avoid glare on foils).
      Or type the code below the artwork into the search box.</p>
      ${tried}`;
    if (res.tried?.length) {
      els.manualInput.value = res.tried[0];
    }
  }

  function showPickList(q, list) {
    els.result.hidden = false;
    els.result.className = 'result';
    els.result.innerHTML = `<p>${list.length} cards match “${escapeHtml(q)}”:</p><ul class="pick-list"></ul>`;
    const ul = els.result.querySelector('ul');
    for (const c of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>${escapeHtml(c.name)}</span><small>${escapeHtml(c.humanReadableCardType || c.type || '')}</small>`;
      b.addEventListener('click', () => showCard({ card: c, detected: q }));
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  let renderToken = 0;
  function showCard(hit) {
    const { card, code, passcode } = hit;
    const img = card.card_images?.[0]?.image_url_small || '';
    const sets = card.card_sets || [];
    const printings = code ? sets.filter((s) => s.set_code.toUpperCase() === code.toUpperCase()) : [];
    const setName = hit.setName || printings[0]?.set_name || '';
    const rarities = [...new Set(printings.map((s) => s.set_rarity))];
    const typeLine = [card.humanReadableCardType || card.type, card.attribute, card.race]
      .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');

    els.result.hidden = false;
    els.result.className = 'result';
    els.result.innerHTML = `
      <div class="card-row">
        ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(card.name)}" loading="lazy">` : ''}
        <div class="card-info">
          <h2>${escapeHtml(card.name)}</h2>
          <p class="meta">${escapeHtml(typeLine)}</p>
          ${code ? `<p class="meta"><span class="code-pill">${escapeHtml(code)}</span></p>
                    <p class="meta">${escapeHtml(setName)}</p>` : ''}
          ${passcode ? `<p class="meta">Passcode <span class="code-pill">${escapeHtml(passcode)}</span></p>` : ''}
          ${rarities.length ? `<div class="rarities">${rarities.map((r) => `<span>${escapeHtml(r)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="actions">
        <div class="cm-box"><p class="meta"><span class="spinner"></span> Finding it on Cardmarket…</p></div>
        ${!code && sets.length ? `<p class="meta">Pick your printing (code under the artwork) to get its exact Cardmarket page:</p>
          <details open><summary class="meta">${sets.length} printings</summary><ul class="pick-list printings"></ul></details>` : ''}
      </div>
      ${hit.detected && hit.detected !== code ? `<p class="detected">Read as: ${escapeHtml(hit.detected)}</p>` : ''}`;

    // For passcode / name hits, let the user choose the exact printing they hold.
    const pl = els.result.querySelector('.printings');
    if (pl) {
      for (const s of sets) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span>${escapeHtml(s.set_code)} · ${escapeHtml(s.set_name)}</span><small>${escapeHtml(s.set_rarity)}</small>`;
        b.addEventListener('click', () => showCard({ card, code: s.set_code, setName: s.set_name }));
        li.appendChild(b);
        pl.appendChild(li);
      }
    }

    const token = ++renderToken;
    renderCardmarket(els.result.querySelector('.cm-box'), card, code, token);

    addHistory({ id: card.id, name: card.name, code: code || '', setName, img });
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------------ */
  /* History                                                             */
  /* ------------------------------------------------------------------ */
  function addHistory(entry) {
    let h = store.get('history', []);
    h = h.filter((e) => !(e.id === entry.id && e.code === entry.code));
    h.unshift({ ...entry, t: Date.now() });
    store.set('history', h.slice(0, 40));
    renderHistory();
  }

  function renderHistory() {
    const h = store.get('history', []);
    els.historySection.hidden = h.length === 0;
    els.historyList.innerHTML = '';
    for (const e of h) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${e.img ? `<img src="${escapeHtml(e.img)}" alt="" loading="lazy">` : ''}
        <span class="h-name">${escapeHtml(e.name)}</span>
        ${e.code ? `<span class="h-code">${escapeHtml(e.code)}</span>` : ''}`;
      b.addEventListener('click', async () => {
        showLoading('Loading…');
        try {
          const card = await cardById(e.id);
          if (card) showCard({ card, code: e.code || undefined, setName: e.setName });
          else showError('Card not found any more.');
        } catch (err) { showError(networkMessage(err)); }
      });
      li.appendChild(b);
      els.historyList.appendChild(li);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  els.startCam.addEventListener('click', startCamera);
  els.torchBtn.addEventListener('click', toggleTorch);
  els.scanBtn.addEventListener('click', () => scanCamera());
  els.fileInput.addEventListener('change', (e) => scanFile(e.target.files?.[0]));
  els.manualForm.addEventListener('submit', (e) => { e.preventDefault(); manualSearch(els.manualInput.value); });
  els.clearHistory.addEventListener('click', () => { store.set('history', []); renderHistory(); });

  els.autoScan.checked = store.get('auto', false);
  els.autoScan.addEventListener('change', () => {
    store.set('auto', els.autoScan.checked);
    if (els.autoScan.checked) scheduleAuto(200); else stopAuto();
  });

  els.cmLang.value = store.get('cmLang', 'en');
  els.cmLang.addEventListener('change', () => {
    store.set('cmLang', els.cmLang.value);
    // refresh links in the visible result
    els.result.querySelectorAll('a[href*="cardmarket.com/"]').forEach((a) => {
      a.href = a.href.replace(/cardmarket\.com\/[a-z]{2}\//, `cardmarket.com/${els.cmLang.value}/`);
    });
  });

  window.addEventListener('resize', layoutGuide);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && els.autoScan.checked) scheduleAuto(500);
  });

  renderHistory();
  if (store.get('camGranted', false)) startCamera();
  // Warm up OCR in the background so the first scan is quick.
  window.addEventListener('load', () => setTimeout(() => getWorker().then(() => { if (!busy) setStatus(''); }).catch(() => {}), 300));

  // The Android app loads the live site (UA contains "YGOScannerApp"), or its bundled offline copy.
  const bundledCopy = location.hostname === 'appassets.androidplatform.net';
  const inAndroidApp = bundledCopy || /YGOScannerApp/.test(navigator.userAgent);
  $('appVersion').textContent = 'v' + APP_VERSION + (inAndroidApp ? ' · Android app' : '') + (bundledCopy ? ' (offline copy)' : '');
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !bundledCopy) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Offer the APK to Android users of the website.
  if (!inAndroidApp && /Android/i.test(navigator.userAgent)) $('getApp').hidden = false;

  // exposed for testing
  window.__ygo = { extractCodes, setCodeVariants, parseSetCode, cmProducts, findTextLines, componentsOf, cropRegion, REGIONS };
})();
