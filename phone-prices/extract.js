/* Phone Prices - product extractor.
 *
 * ppExtract(cfg) runs INSIDE a store's web page (a hidden WebView in the Android app) and returns
 * what it can see on that page: product title, current price, link, image, availability.
 * It is sent to the page as source text (ppExtract.toString()), so it must be self-contained
 * and must not use anything from the app's own scripts.
 *
 * Strategies, merged by product link:
 *   1. attributes  - store-specific data-* attributes on product cards (cfg.attr)
 *   2. cards       - any link matching cfg.product (the store's product-page URL pattern),
 *                    its surrounding card, and the most prominent non-struck price in that card
 *   3. JSON-LD     - schema.org Product / ItemList data, when the page has it
 *
 * If the configured search URL turns out wrong (no products), it types the query into the
 * store's own search box once per job (cfg.searchBox), and the app learns the resulting URL.
 */
function ppExtract(cfg) {
  'use strict';
  var doc = document;
  var out = { v: 1, job: cfg.job, status: 'wait', url: location.href, title: doc.title || '', items: [], note: '' };
  try {
    if (!/^https?:/.test(location.href)) { out.status = 'stale'; return out; }
    // Old page from an earlier job still showing (new navigation not committed yet)?
    if (window.__ppJob && window.__ppJob !== cfg.job) { out.status = 'stale'; return out; }
    window.__ppJob = cfg.job;
    var st = window.__ppState;
    if (!st || st.job !== cfg.job) st = window.__ppState = { job: cfg.job, scrolls: 0, clicked: 0 };
    if (!doc.body) return out;

    var PRICE_RE = /^(?:από|απο|apo|from|τώρα|τωρα|τιμή|τιμη|μόνο|μονο|only|now|price)?\s*:?\s*(€\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(€|eur|ευρώ|ευρω)?\s*\*?$/i;
    var NOT_PRICE_CTX = /μήνα|μηνα|μηνιαί|δόσ|δοσ|\/\s*μ\b|month|άτοκ|ατοκ|όφελος|οφελος|κέρδος|κερδος|κερδίζ|εξοικον|γλιτών|save|cashback|επιστροφ|μεταφορικ|shipping|αποστολ|πόντ|ποντ|points|bonus|έκπτωση\s+\d|εκπτωση\s+\d/i;
    var OLD_CLASS = /(^|[-_\s])(old|was|before|initial|original|regular|list|strike|crossed|previous|prev|retail)([-_\s]|price|$)|line-?through|price-?old|old-?price|compare/i;
    var OOS_RE = /μη\s+διαθέσιμο|μη\s+διαθεσιμο|εξαντλήθηκε|εξαντληθηκε|out\s+of\s+stock|sold\s*out|δεν\s+είναι\s+διαθέσιμο|ειδοποίησέ\s+με|ειδοποιησε\s+με|notify\s+me/i;
    var AVAIL_RE = /(μη\s+διαθέσιμο|μη\s+διαθεσιμο|άμεσα\s+διαθέσιμο|αμεσα\s+διαθεσιμο|διαθέσιμο(?:\s+(?:σε|για|online|στο|κατάστημα|καταστήματα)[^.\n\d€]{0,24})?|διαθεσιμο|σε\s+απόθεμα|κατόπιν\s+παραγγελίας|κατοπιν\s+παραγγελιας|προπαραγγελία|προπαραγγελια|παράδοση[^.\n\d€]{0,24}|παραλαβή[^.\n\d€]{0,24}|εξαντλήθηκε|out\s+of\s+stock|in\s+stock|sold\s*out)/i;

    function clean(s) { return String(s == null ? '' : s).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function fold(s) { return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

    function parsePrice(s) {
      s = clean(s);
      if (!s || s.length > 40) return null;
      var m = s.match(PRICE_RE);
      if (!m || (!m[1] && !m[4])) return null; // needs a euro sign
      var v = parseFloat(m[2].replace(/[.\s]/g, '') + '.' + (m[3] ? (m[3].length === 1 ? m[3] + '0' : m[3]) : '00'));
      return v > 0 && v < 100000 ? v : null;
    }
    function num(s) {
      if (s == null) return null;
      s = String(s).trim();
      if (!s) return null;
      if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      var v = parseFloat(s.replace(/[^\d.]/g, ''));
      return v > 0 && v < 100000 ? v : null;
    }
    function visible(el) { return el.getClientRects().length > 0; }
    function struck(el, stop) {
      for (var e = el; e && e !== stop.parentElement; e = e.parentElement) {
        var tn = e.tagName;
        if (tn === 'DEL' || tn === 'S' || tn === 'STRIKE') return true;
        var cs = getComputedStyle(e);
        if (/line-through/.test(cs.textDecorationLine || cs.textDecoration || '')) return true;
        if (typeof e.className === 'string' && OLD_CLASS.test(e.className)) return true;
        if (e === stop) break;
      }
      return false;
    }
    function fontSize(el) {
      var max = parseFloat(getComputedStyle(el).fontSize) || 0;
      var kids = el.querySelectorAll('*');
      for (var i = 0; i < kids.length && i < 20; i++) max = Math.max(max, parseFloat(getComputedStyle(kids[i]).fontSize) || 0);
      return max;
    }
    function weight(el) { return parseInt(getComputedStyle(el).fontWeight, 10) || 400; }
    function ownText(el) {
      var t = '';
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue + ' ';
      return t;
    }
    // The words printed right next to a price ("12 άτοκες δόσεις των", "Όφελος", "/μήνα"):
    // the price's own text, its parent's own text, and short non-price siblings.
    function label(el) {
      var t = el.textContent + ' ';
      var p = el.parentElement;
      if (p) t += ownText(p) + ' ';
      [el.previousElementSibling, el.nextElementSibling].forEach(function (sib) {
        if (sib && sib.textContent.length < 60 && parsePrice(sib.textContent) == null) t += sib.textContent + ' ';
      });
      if (p && clean(p.textContent) === clean(el.textContent)) { // p only wraps this price
        [p.previousElementSibling, p.nextElementSibling].forEach(function (sib) {
          if (sib && sib.textContent.length < 60 && parsePrice(sib.textContent) == null) t += sib.textContent + ' ';
        });
      }
      return t;
    }

    // The selling price inside a product card: the most prominent price that is not struck
    // through, not an instalment, not a saving.
    function cardPrice(card) {
      var els = card.querySelectorAll('*');
      var hits = [];
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
        var t = e.textContent;
        if (!t || t.length > 40 || !/\d/.test(t)) continue;
        var v = parsePrice(t);
        if (v != null) hits.push({ el: e, v: v });
      }
      // keep the deepest element of each price (drop wrappers whose child already matched)
      hits = hits.filter(function (h) {
        return !hits.some(function (o) { return o !== h && h.el.contains(o.el); });
      });
      var best = null;
      hits.forEach(function (h) {
        if (!visible(h.el)) return;
        if (struck(h.el, card)) return;
        if (NOT_PRICE_CTX.test(label(h.el))) return;
        h.fs = fontSize(h.el); h.fw = weight(h.el);
        if (!best || h.fs > best.fs + 0.5 || (Math.abs(h.fs - best.fs) <= 0.5 && (h.fw > best.fw || (h.fw === best.fw && h.v < best.v)))) best = h;
      });
      // no guessing: a card where every price looks like an instalment or a saving has no price
      return best ? best.v : null;
    }

    var qTokens = fold(cfg.q).split(/[^a-z0-9α-ω+]+/).filter(function (t) { return t.length > 1; });
    function cardTitle(card, links) {
      var c = [];
      function add(s, w) {
        s = clean(s);
        if (!s || s.length < 6 || s.length > 220 || parsePrice(s) != null || !/[a-zα-ω]/i.test(s)) return;
        var words = fold(s).split(/[^a-z0-9α-ω+]+/);
        var hit = 0;
        qTokens.forEach(function (t) { if (words.some(function (x) { return x.indexOf(t) === 0; })) hit++; });
        // text that also holds a price or button labels is a whole card, not a title
        if (/€|\d,\d\d\b/.test(s)) w -= 3;
        c.push({ s: s, w: w + hit * 2 });
      }
      var hs = card.querySelectorAll('h1,h2,h3,h4,h5,[itemprop=name],[class*="title" i],[class*="name" i]');
      for (var i = 0; i < hs.length && i < 12; i++) if (!hs[i].querySelector('h1,h2,h3,h4,h5')) add(hs[i].textContent, 3);
      links.forEach(function (a) { add(a.getAttribute('title'), 2); add(a.getAttribute('aria-label'), 2); add(a.textContent, 1); });
      var imgs = card.querySelectorAll('img[alt]');
      for (var j = 0; j < imgs.length && j < 3; j++) add(imgs[j].alt, 0);
      c.sort(function (a, b) { return b.w - a.w || b.s.length - a.s.length; });
      return c.length ? c[0].s : '';
    }
    function cardImg(card) {
      var imgs = card.querySelectorAll('img');
      for (var i = 0; i < imgs.length && i < 4; i++) {
        var im = imgs[i];
        var src = im.getAttribute('data-src') || im.getAttribute('data-lazy-src') || im.getAttribute('data-original') || im.currentSrc || im.getAttribute('src') || '';
        if (!src && im.srcset) src = im.srcset.split(',')[0].trim().split(' ')[0];
        if (src && !/^data:/.test(src) && !/\.svg(\?|$)/i.test(src) && (im.naturalWidth === 0 || im.naturalWidth > 40)) {
          try { return new URL(src, location.href).href; } catch (e) { /* ignore */ }
        }
      }
      return '';
    }
    function availability(card) {
      var t = clean(card.innerText || card.textContent || '').slice(0, 600);
      var m = t.match(AVAIL_RE);
      return { a: m ? clean(m[1]).slice(0, 40) : '', oos: OOS_RE.test(t) };
    }

    var productRe = new RegExp(cfg.product, 'i');
    function keyOf(href) {
      try {
        var u = new URL(href, location.href);
        var k = u.origin + u.pathname.replace(/\/+$/, '');
        if (cfg.keyParam && u.searchParams.get(cfg.keyParam)) k += '?' + cfg.keyParam + '=' + u.searchParams.get(cfg.keyParam);
        return k;
      } catch (e) { return null; }
    }

    var found = {};
    var order = [];
    function put(it) {
      if (!it.u || !it.p || !it.t) return;
      var k = keyOf(it.u);
      if (!k) return;
      if (!found[k]) { order.push(k); found[k] = it; return; }
      var f = found[k];
      for (var x in it) if (it[x] && !f[x]) f[x] = it[x];
    }

    // 1. store-specific attributes
    if (cfg.attr) {
      var aEls = doc.querySelectorAll(cfg.attr.sel);
      for (var ai = 0; ai < aEls.length; ai++) {
        var ae = aEls[ai];
        var price = null;
        for (var pi = 0; pi < cfg.attr.price.length && price == null; pi++) price = num(ae.getAttribute(cfg.attr.price[pi]));
        var card = ae.closest(cfg.attr.card || '*') || ae;
        var av = availability(card);
        put({
          t: clean(ae.getAttribute(cfg.attr.name)), p: price, u: ae.href,
          c: cfg.attr.cat ? clean(ae.getAttribute(cfg.attr.cat)) : '',
          i: cardImg(card), a: av.a, oos: av.oos, s: 'attr',
        });
      }
    }

    // 2. product links + their cards
    var anchors = doc.querySelectorAll('a[href]');
    var byKey = {};
    var keyOrder = [];
    for (var li = 0; li < anchors.length; li++) {
      var a = anchors[li];
      if (!productRe.test(a.href)) continue;
      var k = keyOf(a.href);
      if (!k) continue;
      a.setAttribute('data-ppk', k);
      if (!byKey[k]) { byKey[k] = []; keyOrder.push(k); }
      byKey[k].push(a);
    }
    var noPrice = 0;
    var usedCards = [];
    keyOrder.slice(0, 120).forEach(function (k) {
      var links = byKey[k];
      if (found[k] && found[k].s === 'attr') return;
      // climb to the largest element that holds only this product's links
      var el = links[0];
      for (var d = 0; d < 12; d++) {
        var p = el.parentElement;
        if (!p || p === doc.body || p === doc.documentElement) break;
        var other = false;
        var ks = p.querySelectorAll('a[data-ppk]');
        for (var x = 0; x < ks.length; x++) if (ks[x].getAttribute('data-ppk') !== k) { other = true; break; }
        if (other) break;
        el = p;
      }
      var card = el;
      var price = cardPrice(card);
      if (price == null) {
        // the card may hold links to colour variants: allow a few more levels
        var e2 = card;
        for (var d2 = 0; d2 < 4 && price == null; d2++) {
          var p2 = e2.parentElement;
          if (!p2 || p2 === doc.body) break;
          var keys = {};
          var real = false; // does p2 hold another real product (not just a colour swatch)?
          var ks2 = p2.querySelectorAll('a[data-ppk]');
          for (var y = 0; y < ks2.length; y++) {
            var kk = ks2[y].getAttribute('data-ppk');
            keys[kk] = 1;
            if (kk !== k && (ks2[y].querySelector('img') || clean(ks2[y].textContent).length > 12)) real = true;
          }
          if (real || Object.keys(keys).length > 6) break;
          e2 = p2;
          price = cardPrice(e2);
          if (price != null) card = e2;
        }
      }
      if (price == null) { noPrice++; return; }
      if (usedCards.some(function (c) { return c === card || c.contains(card) || card.contains(c); })) return;
      usedCards.push(card);
      // a card with several product links (colour swatches): it belongs to the link with the most content
      var cardLinks = card.querySelectorAll('a[data-ppk]');
      var score = {};
      for (var z = 0; z < cardLinks.length; z++) {
        var ck = cardLinks[z].getAttribute('data-ppk');
        score[ck] = (score[ck] || 0) + clean(cardLinks[z].textContent).length + (cardLinks[z].querySelector('img') ? 20 : 0);
      }
      var main = k;
      Object.keys(score).forEach(function (ck) { if (score[ck] > score[main]) main = ck; });
      var mainLinks = byKey[main] || links;
      var av = availability(card);
      put({ t: cardTitle(card, mainLinks), p: price, u: mainLinks[0].href, i: cardImg(card), a: av.a, oos: av.oos, s: 'card' });
    });

    // 3. JSON-LD
    var ld = doc.querySelectorAll('script[type="application/ld+json"]');
    function ldWalk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) { o.forEach(function (x) { ldWalk(x, depth + 1); }); return; }
      var type = [].concat(o['@type'] || []).join(' ');
      if (/Product/.test(type) && o.name && o.offers) {
        var offers = [].concat(o.offers);
        var pr = null;
        var oos = false;
        offers.forEach(function (of) {
          var v = num(of.price != null ? of.price : of.lowPrice);
          if (v != null && (pr == null || v < pr)) pr = v;
          if (/OutOfStock|SoldOut|Discontinued/.test(of.availability || '')) oos = true;
        });
        var u = o.url || (o.offers && o.offers.url) || '';
        if (u && productRe.test(new URL(u, location.href).href)) {
          put({ t: clean(o.name), p: pr, u: new URL(u, location.href).href, i: [].concat(o.image || [])[0] || '', oos: oos, s: 'ld' });
        }
      }
      if (o.itemListElement) ldWalk(o.itemListElement, depth + 1);
      if (o.item) ldWalk(o.item, depth + 1);
      if (o['@graph']) ldWalk(o['@graph'], depth + 1);
    }
    for (var ldi = 0; ldi < ld.length; ldi++) {
      try { ldWalk(JSON.parse(ld[ldi].textContent), 0); } catch (e) { /* ignore broken JSON-LD */ }
    }

    order.forEach(function (k) {
      var it = found[k];
      if (it.p && it.t) out.items.push(it);
    });
    out.items = out.items.slice(0, 120);

    var bodyText = clean(doc.body.innerText || '').slice(0, 4000);
    out.links = keyOrder.length;
    out.noPrice = noPrice;
    out.noResults = !out.items.length && /δεν\s+βρέθηκαν|δεν\s+βρεθηκαν|δεν\s+βρήκαμε|δεν\s+βρηκαμε|δεν\s+υπάρχουν\s+(?:αποτελέσματα|προϊόντα)|δεν\s+υπαρχουν|0\s+(?:αποτελέσματα|προϊόντα)|no\s+results|nothing\s+found|δεν\s+ταιριάζει/i.test(bodyText);
    if (!out.items.length && /just a moment|attention required|access denied|captcha|are you a robot|you are human|ρομπότ|pardon our interruption|request unsuccessful|verify|επαλήθευσ|περιμένετε|incident id|blocked/i.test(out.title + ' ' + bodyText.slice(0, 400))) {
      out.status = 'challenge';
      return out;
    }

    // Search box fallback: the search URL we used shows no products, so search like a person would.
    if (!out.items.length && cfg.searchBox && cfg.sinceLoad > 4000 && sessionStorage.getItem('ppsb') !== String(cfg.job)) {
      var inp = doc.querySelector('input[type=search], input[name=q], input[name=query], input[name=text], input[name=search], input[name=keyphrase], input[name=searchTerm], input[placeholder*="ναζήτ" i], input[placeholder*="ναζητ" i], input[aria-label*="ναζήτ" i], input[placeholder*="search" i], input[aria-label*="search" i]');
      if (!inp && st.clicked < 2) {
        var btn = doc.querySelector('[aria-label*="ναζήτ" i], [aria-label*="search" i], [class*="search-toggle" i], [class*="searchToggle" i], [data-testid*="search" i]');
        if (btn) { st.clicked++; btn.click(); out.note = 'opened search'; return out; }
      }
      if (inp) {
        sessionStorage.setItem('ppsb', String(cfg.job));
        inp.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, cfg.q);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
          inp.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        });
        var form = inp.form;
        if (form) setTimeout(function () { try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch (e) { /* ignore */ } }, 400);
        out.note = 'typed into search box';
        out.searchBox = true;
        return out;
      }
      out.note = 'no search box found';
    }
    out.searchBoxTried = sessionStorage.getItem('ppsb') === String(cfg.job);

    // Lazy-loaded lists: scroll a few screens so more products render.
    if (st.scrolls < (cfg.scrolls || 0) && (out.items.length || cfg.sinceLoad > 1500)) {
      st.scrolls++;
      window.scrollBy(0, Math.round(window.innerHeight * 1.8));
    }
    out.scrolls = st.scrolls;
    out.status = 'ok';

    if (cfg.debug) {
      var first = keyOrder.length ? doc.querySelector('a[data-ppk]') : null;
      var dbg = first;
      for (var dd = 0; dbg && dd < 4; dd++) dbg = dbg.parentElement;
      out.debug = {
        ua: navigator.userAgent,
        body: bodyText.slice(0, 1500),
        card: dbg ? dbg.outerHTML.replace(/\s+/g, ' ').slice(0, 6000) : '',
        sampleLinks: [].slice.call(anchors, 0, 400).map(function (x) { return x.href; }).filter(function (h, i, arr) { return /^https?:/.test(h) && arr.indexOf(h) === i; }).slice(0, 60),
      };
    }
    return out;
  } catch (err) {
    out.status = 'error';
    out.note = String(err && err.message || err);
    return out;
  }
}
