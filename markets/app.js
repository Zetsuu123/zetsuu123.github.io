'use strict';

// ---------- formatting ----------
const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const pct = (x, d = 1) => (x == null || !isFinite(x)) ? '–' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
const pctPlain = (x, d = 0) => (x == null || !isFinite(x)) ? '–' : (x * 100).toFixed(d) + '%';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${MONTHS[+m - 1]} ${+d}, ${y}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- indicators ----------
function sma(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function rsi(a, n = 14) {
  const out = new Array(a.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function bollingerB(a, n = 20, k = 2) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - n + 1; j <= i; j++) { s += a[j]; s2 += a[j] * a[j]; }
    const m = s / n, sd = Math.sqrt(Math.max(s2 / n - m * m, 0));
    out[i] = sd === 0 ? 0.5 : (a[i] - (m - k * sd)) / (2 * k * sd);
  }
  return out;
}
function drawdowns(a) {
  const out = new Array(a.length); let peak = -Infinity;
  for (let i = 0; i < a.length; i++) { peak = Math.max(peak, a[i]); out[i] = a[i] / peak - 1; }
  return out;
}

// Composite technical score. Positive = conditions that historically favoured buying.
function scoreParts(D, i) {
  const c = D.close[i], s50 = D.sma50[i], s200 = D.sma200[i], r = D.rsi[i], dd = D.dd[i], b = D.bb[i];
  if (s200 == null || r == null || b == null) return null;
  const parts = [];
  let t = 0, tLbl = 'Mixed trend';
  if (c > s200 && s50 > s200) { t = 1; tLbl = 'Uptrend: price and 50-day average above the 200-day'; }
  else if (c < s200 && s50 < s200) { t = -1; tLbl = 'Downtrend: price and 50-day average below the 200-day'; }
  else tLbl = c > s200 ? 'Mixed: price above the 200-day, 50-day still below' : 'Mixed: price below the 200-day, 50-day still above';
  parts.push({ name: 'Trend', value: c > s200 ? 'Above 200d' : 'Below 200d', pts: t, why: tLbl });

  let rp = 0, rw = 'Neutral momentum (30–70)';
  if (r < 30) { rp = 2; rw = 'Oversold: sharp recent selling'; }
  else if (r < 40) { rp = 1; rw = 'Weak momentum, leaning oversold'; }
  else if (r > 80) { rp = -2; rw = 'Very overbought'; }
  else if (r > 70) { rp = -1; rw = 'Overbought'; }
  parts.push({ name: 'RSI (14)', value: r.toFixed(0), pts: rp, why: rw });

  let dp = 0, dw = 'Within 10% of the all-time high';
  if (dd <= -0.2) { dp = 2; dw = 'Bear-market territory, 20%+ below the high'; }
  else if (dd <= -0.1) { dp = 1; dw = 'Correction, 10%+ below the high'; }
  parts.push({ name: 'From high', value: pct(dd), pts: dp, why: dw });

  let bp = 0, bw = 'Inside its 20-day Bollinger band';
  if (b < 0) { bp = 1; bw = 'Closed below the lower band (stretched down)'; }
  else if (b > 1) { bp = -1; bw = 'Closed above the upper band (stretched up)'; }
  parts.push({ name: 'Bollinger %B', value: b.toFixed(2), pts: bp, why: bw });

  const st = c / s200 - 1;
  let sp = 0, sw = 'Normal distance from the 200-day average';
  if (st > 0.12) { sp = -1; sw = 'More than 12% above the 200-day: extended'; }
  else if (st < -0.12) { sp = 1; sw = 'More than 12% below the 200-day: washed out'; }
  parts.push({ name: 'vs 200-day', value: pct(st), pts: sp, why: sw });

  return { parts, total: parts.reduce((s, p) => s + p.pts, 0) };
}
const BUCKETS = [
  { key: 'sbuy', label: 'Strong buy', cls: 'good', icon: '▲▲', test: (s) => s >= 3 },
  { key: 'buy', label: 'Buy', cls: 'good', icon: '▲', test: (s) => s === 2 },
  { key: 'hold', label: 'Hold', cls: 'neutral', icon: '●', test: (s) => s >= -1 && s <= 1 },
  { key: 'trim', label: 'Trim', cls: 'warn', icon: '▼', test: (s) => s === -2 },
  { key: 'sell', label: 'Sell', cls: 'bad', icon: '▼▼', test: (s) => s <= -3 },
];
const bucketOf = (s) => BUCKETS.find((b) => b.test(s));

// ---------- prepare data ----------
function prepare(raw) {
  const close = raw.close;
  const D = { ...raw, close, n: close.length };
  D.sma50 = sma(close, 50);
  D.sma200 = sma(close, 200);
  D.rsi = rsi(close);
  D.bb = bollingerB(close);
  D.dd = drawdowns(close);
  D.score = close.map((_, i) => { const s = scoreParts(D, i); return s ? s.total : null; });
  D.years = D.dates.map((d) => +d.slice(0, 4));
  return D;
}

// ---------- strategies ----------
// Each returns a desired position (0/1) decided at the close of day i, applied from i to i+1.
const STRATEGIES = [
  { key: 'bh', name: 'Buy & hold', desc: 'Buy on day one, never sell.', rule: () => () => 1 },
  { key: 'ma200', name: 'Above 200-day average', desc: 'Hold while the close is above its 200-day average; cash below it.',
    rule: (D) => (i, p) => D.sma200[i] == null ? p : (D.close[i] > D.sma200[i] ? 1 : 0) },
  { key: 'cross', name: 'Golden / death cross', desc: 'Buy when the 50-day average crosses above the 200-day; sell when it crosses below.',
    rule: (D) => (i, p) => D.sma200[i] == null ? p : (D.sma50[i] > D.sma200[i] ? 1 : 0) },
  { key: 'rsi', name: 'RSI swing (30 / 70)', desc: 'Buy when RSI drops below 30, sell when it rises above 70.',
    rule: (D) => (i, p) => D.rsi[i] == null ? p : (D.rsi[i] < 30 ? 1 : D.rsi[i] > 70 ? 0 : p) },
  { key: 'dip', name: 'Buy 10% dips, sell at RSI 75', desc: 'Buy once the index is 10% below its high; sell when RSI goes above 75.',
    rule: (D) => (i, p) => D.rsi[i] == null ? p : (D.dd[i] <= -0.1 ? 1 : D.rsi[i] > 75 ? 0 : p) },
  { key: 'score', name: 'This page\'s signal', desc: 'Buy when the signal reads Buy or Strong buy; sell when it reads Trim or Sell.',
    rule: (D) => (i, p) => D.score[i] == null ? p : (D.score[i] >= 2 ? 1 : D.score[i] <= -2 ? 0 : p) },
];

function backtest(D, strat, start) {
  const rule = strat.rule(D);
  const pos = new Array(D.n).fill(0);
  let p = strat.key === 'bh' ? 1 : 0;
  const trades = [];
  let eq = 1, peak = 1, mdd = 0, inDays = 0;
  for (let i = start; i < D.n; i++) {
    if (i > start) {
      const r = D.close[i] / D.close[i - 1] - 1;
      if (pos[i - 1]) { eq *= 1 + r; inDays++; }
      peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
    }
    const np = rule(i, p);
    if (np !== p || (i === start && p === 1)) trades.push({ i, side: np ? 'buy' : 'sell' });
    p = np; pos[i] = p;
  }
  const yrs = (Date.parse(D.dates[D.n - 1]) - Date.parse(D.dates[start])) / (365.25 * 864e5);
  return {
    strat, trades, pos, total: eq - 1, cagr: Math.pow(eq, 1 / yrs) - 1, mdd,
    exposure: inDays / Math.max(1, D.n - 1 - start), buys: trades.filter((t) => t.side === 'buy').length,
  };
}

// ---------- historical evidence ----------
function forwardByBucket(D, horizon) {
  const rows = BUCKETS.map((b) => ({ b, sum: 0, pos: 0, n: 0 }));
  const all = { sum: 0, pos: 0, n: 0 };
  for (let i = 0; i + horizon < D.n; i++) {
    if (D.score[i] == null) continue;
    const r = D.close[i + horizon] / D.close[i] - 1;
    const row = rows.find((x) => x.b.test(D.score[i]));
    row.sum += r; row.n++; if (r > 0) row.pos++;
    all.sum += r; all.n++; if (r > 0) all.pos++;
  }
  return { rows, all };
}
function dipStats(D) {
  const th = [0.05, 0.1, 0.15, 0.2, 0.3];
  return th.map((t) => {
    const ev = []; let armed = true; let peak = -Infinity;
    for (let i = 0; i < D.n; i++) {
      if (D.close[i] >= peak) { peak = D.close[i]; armed = true; }
      if (armed && D.dd[i] <= -t) {
        armed = false;
        ev.push({ i, r: i + 252 < D.n ? D.close[i + 252] / D.close[i] - 1 : null, r3: i + 756 < D.n ? Math.pow(D.close[i + 756] / D.close[i], 1 / 3) - 1 : null });
      }
    }
    const done = ev.filter((e) => e.r != null), done3 = ev.filter((e) => e.r3 != null);
    return {
      t, count: ev.length, n1: done.length,
      avg: done.length ? done.reduce((s, e) => s + e.r, 0) / done.length : null,
      win: done.length ? done.filter((e) => e.r > 0).length / done.length : null,
      avg3: done3.length ? done3.reduce((s, e) => s + e.r3, 0) / done3.length : null,
      last: ev.length ? D.dates[ev[ev.length - 1].i] : null,
    };
  });
}
function seasonality(D) {
  // Month-end closes -> monthly returns
  const ends = [];
  for (let i = 0; i < D.n; i++) {
    const m = D.dates[i].slice(0, 7);
    if (i === D.n - 1 || D.dates[i + 1].slice(0, 7) !== m) ends.push(i);
  }
  const lastComplete = D.dates[D.n - 1].slice(0, 7);
  const months = Array.from({ length: 12 }, () => ({ sum: 0, pos: 0, n: 0, vals: [] }));
  let winter = [], summer = [];
  for (let k = 1; k < ends.length; k++) {
    const i = ends[k];
    if (D.dates[i].slice(0, 7) === lastComplete && k === ends.length - 1) continue; // month still running
    const r = D.close[i] / D.close[ends[k - 1]] - 1;
    const m = +D.dates[i].slice(5, 7) - 1;
    const o = months[m]; o.sum += r; o.n++; if (r > 0) o.pos++; o.vals.push(r);
    (m >= 4 && m <= 9 ? summer : winter).push(r);
  }
  const comp = (a) => a.reduce((s, r) => s * (1 + r), 1);
  const yearsW = winter.length / 6, yearsS = summer.length / 6;
  return {
    months: months.map((o, m) => ({ m, avg: o.n ? o.sum / o.n : 0, win: o.n ? o.pos / o.n : 0, n: o.n,
      median: o.vals.length ? o.vals.slice().sort((a, b) => a - b)[Math.floor(o.vals.length / 2)] : 0 })),
    winter: Math.pow(comp(winter), 1 / yearsW) - 1,
    summer: Math.pow(comp(summer), 1 / yearsS) - 1,
  };
}

// ---------- SVG helpers ----------
const NS = 'http://www.w3.org/2000/svg';
function niceTicks(min, max, count) {
  const span = max - min; if (span <= 0) return [min];
  const step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

// ---------- state ----------
const state = { key: 'spx', range: '1Y', strat: 'score', btStart: '2000', cache: {} };
const RANGES = { '1M': 21, '3M': 63, '6M': 126, 'YTD': 'ytd', '1Y': 252, '5Y': 1260, 'Max': 'max' };
const app = document.getElementById('app');

async function load(key) {
  if (state.cache[key]) return state.cache[key];
  const res = await fetch(`data/${key}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const D = prepare(await res.json());
  state.cache[key] = D;
  return D;
}

function rangeStart(D) {
  const r = RANGES[state.range];
  if (r === 'max') return 0;
  if (r === 'ytd') { const y = D.dates[D.n - 1].slice(0, 4); return Math.max(0, D.dates.findIndex((d) => d.startsWith(y)) - 1); }
  return Math.max(0, D.n - 1 - r);
}
function btStartIndex(D) {
  const from = state.btStart === '2000' ? 200 : D.dates.findIndex((d) => d >= `${state.btStart}-01-01`);
  return Math.max(200, from);
}

// ---------- render ----------
function render() {
  const D = state.cache[state.key];
  const last = D.n - 1;
  const c = D.close[last], prev = D.close[last - 1];
  const s = scoreParts(D, last), bucket = bucketOf(s.total);
  const yi = D.dates.findIndex((d) => d.startsWith(D.dates[last].slice(0, 4))) - 1;
  const w52 = D.close.slice(Math.max(0, last - 251));
  const hi52 = Math.max(...w52), lo52 = Math.min(...w52);
  const ath = Math.max(...D.close);

  const fw3 = forwardByBucket(D, 63), fw12 = forwardByBucket(D, 252);
  const bts = STRATEGIES.map((st) => backtest(D, st, btStartIndex(D)));
  const bh = bts[0];
  const dips = dipStats(D);
  const seas = seasonality(D);
  const cur3 = fw3.rows.find((r) => r.b === bucket), cur12 = fw12.rows.find((r) => r.b === bucket);
  const bestM = seas.months.slice().sort((a, b) => b.avg - a.avg), worstM = bestM.slice().reverse();
  const beatBH = bts.slice(1).filter((b) => b.cagr > bh.cagr);
  const lowerDD = bts.slice(1).filter((b) => b.mdd > bh.mdd).sort((a, b) => b.cagr - a.cagr)[0];
  const dip10 = dips[1], dip20 = dips[3];

  app.innerHTML = `
  <section class="card">
    <div class="quote">
      <span class="price">${fmt2.format(c)}</span>
      <span class="chg ${c >= prev ? 'up' : 'down'}">${c >= prev ? '▲' : '▼'} ${fmt2.format(Math.abs(c - prev))} (${pct(c / prev - 1, 2)})</span>
      <span class="asof">${esc(D.name)} · close of ${fmtDate(D.dates[last])}</span>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Year to date</div><div class="v ${c >= D.close[yi] ? 'up' : 'down'}">${pct(c / D.close[yi] - 1)}</div></div>
      <div class="stat"><div class="k">1 year</div><div class="v ${c >= D.close[last - 252] ? 'up' : 'down'}">${pct(c / D.close[last - 252] - 1)}</div></div>
      <div class="stat"><div class="k">52-week range</div><div class="v">${fmt0.format(lo52)} – ${fmt0.format(hi52)}</div></div>
      <div class="stat"><div class="k">From all-time high</div><div class="v">${pct(c / ath - 1)}</div></div>
    </div>
  </section>

  <div class="grid2 row-gap">
    <section class="card">
      <h2>Today's signal</h2>
      <p class="note">Five technical readings combined into one score. Positive points mean conditions that have tended to reward buying.</p>
      <div class="verdict">
        <span class="badge ${bucket.cls}" aria-label="Signal: ${bucket.label}">${bucket.icon} ${bucket.label}</span>
        <span class="score">Score ${s.total > 0 ? '+' : ''}${s.total}<br>range −5 to +7</span>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Indicator</th><th class="num">Value</th><th class="num">Pts</th><th>Reading</th></tr></thead>
        <tbody>${s.parts.map((p) => `<tr><td>${p.name}</td><td class="num">${p.value}</td>
          <td class="num pts ${p.pts > 0 ? 'up' : p.pts < 0 ? 'down' : ''}">${p.pts > 0 ? '+' : ''}${p.pts}</td><td>${p.why}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="card">
      <h2>Did the signal work before?</h2>
      <p class="note">Every trading day since 2000, grouped by the signal it showed, and what the index did next. Highlighted: today's reading.</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Signal</th><th class="num">Days</th><th class="num">Next 3 mo avg</th><th class="num">Up</th><th class="num">Next 12 mo avg</th><th class="num">Up</th></tr></thead>
        <tbody>${fw3.rows.map((r, k) => { const r12 = fw12.rows[k]; return `<tr class="${r.b === bucket ? 'hl' : ''}">
          <td><span class="${r.b.cls === 'good' ? 'up' : r.b.cls === 'bad' ? 'down' : ''}">${r.b.icon}</span> ${r.b.label}</td>
          <td class="num">${fmt0.format(r.n)}</td>
          <td class="num">${r.n ? pct(r.sum / r.n) : '–'}</td><td class="num">${r.n ? pctPlain(r.pos / r.n) : '–'}</td>
          <td class="num">${r12.n ? pct(r12.sum / r12.n) : '–'}</td><td class="num">${r12.n ? pctPlain(r12.pos / r12.n) : '–'}</td></tr>`; }).join('')}
          <tr><td>Any day</td><td class="num">${fmt0.format(fw3.all.n)}</td><td class="num">${pct(fw3.all.sum / fw3.all.n)}</td><td class="num">${pctPlain(fw3.all.pos / fw3.all.n)}</td>
          <td class="num">${pct(fw12.all.sum / fw12.all.n)}</td><td class="num">${pctPlain(fw12.all.pos / fw12.all.n)}</td></tr>
        </tbody>
      </table></div>
    </section>
  </div>

  <section class="card">
    <div class="chart-controls">
      <h2 style="margin:0">Price</h2>
      <div class="seg" id="rng" role="group" aria-label="Time range">${Object.keys(RANGES).map((r) => `<button data-r="${r}" aria-pressed="${r === state.range}">${r}</button>`).join('')}</div>
    </div>
    <div class="chart-controls">
      <div class="legend">
        <span><i style="background:var(--s1)"></i>${esc(D.name)}</span>
        <span><i style="background:var(--s2)"></i>50-day avg</span>
        <span><i style="background:var(--s3)"></i>200-day avg</span>
        <span><em class="mk" style="color:var(--good)">▲</em>Buy</span>
        <span><em class="mk" style="color:var(--bad)">▼</em>Sell</span>
      </div>
      <label class="asof">Markers from
        <select id="stratSel">${STRATEGIES.filter((s) => s.key !== 'bh').map((s) => `<option value="${s.key}" ${s.key === state.strat ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="chart" id="chart"></div>
  </section>

  <section class="card">
    <div class="chart-controls">
      <div><h2>Timing strategies vs. just holding</h2>
      <p class="note" style="margin:0">Simulated on ${esc(D.name)} closes, buying and selling at the next day's close. Click a row to show its trades on the chart.</p></div>
      <label class="asof">Start
        <select id="btSel">${['2000', '2010', '2015', '2020'].map((y) => `<option value="${y}" ${y === state.btStart ? 'selected' : ''}>${y === '2000' ? 'Oct 2000' : y}</option>`).join('')}</select>
      </label>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Strategy</th><th class="num">Yearly return</th><th class="num">Total</th><th class="num">Worst drop</th><th class="num">Time invested</th><th class="num">Buys</th><th>Now</th></tr></thead>
      <tbody>${bts.map((b) => `<tr class="click ${b.strat.key === state.strat ? 'hl' : ''}" data-s="${b.strat.key}" title="${esc(b.strat.desc)}">
        <td><strong>${esc(b.strat.name)}</strong><br><span class="asof desc">${esc(b.strat.desc)}</span></td>
        <td class="num">${pct(b.cagr)}</td><td class="num">${pct(b.total, 0)}</td><td class="num">${pct(b.mdd)}</td>
        <td class="num">${pctPlain(b.exposure)}</td><td class="num">${b.buys}</td>
        <td style="white-space:nowrap">${b.pos[last] ? '<span class="up">● Invested</span>' : '<span class="down">○ Cash</span>'}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>

  <div class="grid2 row-gap">
    <section class="card">
      <h2>Average return by month</h2>
      <p class="note">Mean monthly change since 2000; bar labels show how often the month finished up.</p>
      <div class="chart" id="season"></div>
    </section>
    <section class="card">
      <h2>Buying the dip</h2>
      <p class="note">The first day each decline from a record high reached the threshold, and what came next.</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Drop from high</th><th class="num">Times</th><th class="num">Next 12 mo avg</th><th class="num">Up after 12 mo</th><th class="num">Next 3 yr, per yr</th></tr></thead>
        <tbody>${dips.map((d) => `<tr><td>−${d.t * 100}%${d.last ? `<br><span class="asof">last ${fmtDate(d.last)}</span>` : ''}</td>
          <td class="num">${d.count}</td><td class="num">${pct(d.avg)}</td><td class="num">${pctPlain(d.win)}</td><td class="num">${pct(d.avg3)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
  </div>

  <section class="card">
    <h2>What the history says</h2>
    <ul class="take">
      <li><strong>Right now:</strong> the signal reads <strong>${bucket.label}</strong>. Since 2000, days with this reading were followed by an average ${pct(cur3.sum / cur3.n)} over 3 months (up ${pctPlain(cur3.pos / cur3.n)} of the time)${cur12.n ? ` and ${pct(cur12.sum / cur12.n)} over 12 months` : ''}, against ${pct(fw3.all.sum / fw3.all.n)} and ${pct(fw12.all.sum / fw12.all.n)} for any day.</li>
      <li>${beatBH.length
        ? `<strong>Some timing beat holding, here.</strong> ${beatBH.map((b) => esc(b.strat.name)).join(', ')} beat buy &amp; hold over this period (best ${pct(Math.max(...beatBH.map((b) => b.cagr)))} vs ${pct(bh.cagr)} a year). Results swing a lot with the start date, so try changing it above before trusting one.`
        : `<strong>Holding was hard to beat.</strong> None of the timing rules beat buy &amp; hold's ${pct(bh.cagr)} a year over this period.`}
        ${lowerDD ? ` The main thing trend rules bought was a smaller worst drop: ${esc(lowerDD.strat.name)} fell at most ${pct(lowerDD.mdd, 0)} vs ${pct(bh.mdd, 0)} for holding.` : ''}</li>
      <li>${(() => { const base = fw12.all.sum / fw12.all.n; const better = [dip10, dip20].filter((d) => d.avg != null && d.avg > base).length;
        const head = better === 2 ? 'Buying after big drops has paid off.' : better === 1 ? 'Deep drops paid off better than shallow ones.' : 'Dip-buying has been no better than buying any day.';
        return `<strong>${head}</strong> After a 10% decline, the next 12 months averaged ${pct(dip10.avg)} (up ${pctPlain(dip10.win)} of the time); after a 20% decline, ${pct(dip20.avg)}${dip20.n1 ? ` (${pctPlain(dip20.win)} up)` : ''}, vs ${pct(base)} for any day. Declines often keep going after the threshold is hit, so buying in steps beats guessing the bottom.`; })()}</li>
      <li><strong>Seasonality is weak.</strong> ${MONTHS[bestM[0].m]} and ${MONTHS[bestM[1].m]} were the strongest months (${pct(bestM[0].avg)}, ${pct(bestM[1].avg)}); ${MONTHS[worstM[0].m]} was the weakest (${pct(worstM[0].avg)}). November–April returned ${pct(seas.winter)} a year vs ${pct(seas.summer)} for May–October, but every month has been up in at least ${pctPlain(Math.min(...seas.months.map((m) => m.win)))} of years.</li>
      <li><strong>When to sell:</strong> ${(() => { const t = fw12.rows.filter((r) => r.b.key === 'trim' || r.b.key === 'sell'); const n = t.reduce((s, r) => s + r.n, 0); const avg = n ? t.reduce((s, r) => s + r.sum, 0) / n : null;
        if (avg == null) return 'there are too few Trim or Sell days to judge.';
        return `Trim and Sell days (overbought, far above the 200-day average) were followed by ${pct(avg)} on average over 12 months, vs ${pct(fw12.all.sum / fw12.all.n)} for any day. ` +
          (avg >= fw12.all.sum / fw12.all.n ? 'Strength has tended to keep going, so overbought readings have not been a good reason to sell; ' : avg > 0 ? 'So they have been a cue to slow down buying or take some profit, not to sell everything; ' : 'So they have been a reasonable cue to take some profit; ') +
          'breaks below the 200-day average are what the defensive strategies above use to step aside.'; })()}</li>
    </ul>
  </section>`;

  drawPrice(D, bts.find((b) => b.strat.key === state.strat));
  drawSeason(seas);
  bind();
}

function bind() {
  document.querySelectorAll('#rng button').forEach((b) => b.onclick = () => { state.range = b.dataset.r; render(); });
  document.getElementById('stratSel').onchange = (e) => { state.strat = e.target.value; render(); };
  document.getElementById('btSel').onchange = (e) => { state.btStart = e.target.value; render(); };
  document.querySelectorAll('tr[data-s]').forEach((tr) => tr.onclick = () => {
    if (tr.dataset.s === 'bh') return;
    state.strat = tr.dataset.s; render();
    document.getElementById('chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------- price chart ----------
function drawPrice(D, bt) {
  const host = document.getElementById('chart');
  const W = host.clientWidth, H = W < 560 ? 260 : 340;
  const m = { l: 4, r: 56, t: 14, b: 24 };
  const s0 = rangeStart(D), s1 = D.n - 1;
  const idx = []; for (let i = s0; i <= s1; i++) idx.push(i);
  let lo = Infinity, hi = -Infinity;
  for (const i of idx) for (const v of [D.close[i], D.sma50[i], D.sma200[i]]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const x = (i) => m.l + (i - s0) / Math.max(1, s1 - s0) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const path = (arr) => { let d = '', on = false; for (const i of idx) { const v = arr[i]; if (v == null) { on = false; continue; } d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); on = true; } return d; };

  // x ticks: pick a unit that suits the visible span
  const span = s1 - s0;
  const unit = span > 4000 ? 'y4' : span > 1500 ? 'y' : span > 400 ? 'q' : span > 80 ? 'm' : 'w';
  const xt = [];
  for (let i = s0 + 1; i <= s1; i++) {
    const a = D.dates[i - 1], b = D.dates[i];
    const yr = +b.slice(0, 4), mo = +b.slice(5, 7);
    const newY = a.slice(0, 4) !== b.slice(0, 4), newM = a.slice(0, 7) !== b.slice(0, 7);
    if (unit === 'y4' ? newY && yr % 4 === 0 : unit === 'y' ? newY : unit === 'q' ? newM && (mo - 1) % 3 === 0 : unit === 'm' ? newM
      : new Date(b + 'T12:00:00Z').getUTCDay() < new Date(a + 'T12:00:00Z').getUTCDay()) xt.push(i);
  }
  const xLabel = (i) => { const d = D.dates[i]; const mo = +d.slice(5, 7);
    if (unit === 'y4' || unit === 'y') return d.slice(0, 4);
    if (unit === 'w') return `${MONTHS[mo - 1]} ${+d.slice(8)}`;
    return mo === 1 ? d.slice(0, 4) : MONTHS[mo - 1]; };
  const minGap = 46; const xtf = []; for (const i of xt) if (!xtf.length || x(i) - x(xtf[xtf.length - 1]) >= minGap) xtf.push(i);

  const yt = niceTicks(lo, hi, H < 300 ? 4 : 5);
  const marks = bt.trades.filter((t) => t.i >= s0 && t.i <= s1);
  const tri = (cx, cy, up) => up ? `M${cx} ${cy - 5}L${cx + 5.5} ${cy + 4.5}L${cx - 5.5} ${cy + 4.5}Z` : `M${cx} ${cy + 5}L${cx + 5.5} ${cy - 4.5}L${cx - 5.5} ${cy - 4.5}Z`;

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(D.name)} price chart, ${state.range}">
    <g class="axis">${yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>
      <text x="${W - m.r + 8}" y="${y(v) + 4}">${fmt0.format(v)}</text>`).join('')}
      ${xtf.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${xLabel(i)}</text>`).join('')}</g>
    <path d="${path(D.sma200)}" fill="none" stroke="var(--s3)" stroke-width="1.5"/>
    <path d="${path(D.sma50)}" fill="none" stroke="var(--s2)" stroke-width="1.5"/>
    <path d="${path(D.close)}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>
    <g>${marks.map((t) => { const up = t.side === 'buy'; const cy = y(D.close[t.i]) + (up ? 14 : -14);
      return `<path d="${tri(x(t.i).toFixed(1), cy.toFixed(1), up)}" fill="${up ? 'var(--good)' : 'var(--bad)'}" stroke="var(--surface)" stroke-width="2"><title>${up ? 'Buy' : 'Sell'} ${fmtDate(D.dates[t.i])} at ${fmt2.format(D.close[t.i])}</title></path>`; }).join('')}</g>
    <line id="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
    <circle id="xd" r="4.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" id="hit"/>
  </svg><div class="tip" id="tip"></div>`;

  const svg = host.querySelector('svg'), tip = host.querySelector('#tip');
  const xh = svg.querySelector('#xh'), xd = svg.querySelector('#xd');
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const i = Math.min(s1, Math.max(s0, Math.round(s0 + (px - m.l) / (W - m.l - m.r) * (s1 - s0))));
    const cx = x(i), cy = y(D.close[i]);
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    xd.setAttribute('cx', cx); xd.setAttribute('cy', cy); xd.setAttribute('visibility', 'visible');
    const sc = D.score[i] != null ? bucketOf(D.score[i]) : null;
    const chg = i > 0 ? D.close[i] / D.close[i - 1] - 1 : 0;
    tip.innerHTML = `<b>${fmtDate(D.dates[i])}</b>
      <div class="r"><span>Close</span><span>${fmt2.format(D.close[i])} (${pct(chg, 2)})</span></div>
      <div class="r"><span>50-day</span><span>${D.sma50[i] ? fmt0.format(D.sma50[i]) : '–'}</span></div>
      <div class="r"><span>200-day</span><span>${D.sma200[i] ? fmt0.format(D.sma200[i]) : '–'}</span></div>
      <div class="r"><span>RSI</span><span>${D.rsi[i] != null ? D.rsi[i].toFixed(0) : '–'}</span></div>
      <div class="r"><span>Signal</span><span>${sc ? sc.label : '–'}</span></div>`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(0, cx + 14 + tw > W ? cx - tw - 14 : cx + 14), W - tw) + 'px';
    tip.style.top = Math.max(0, Math.min(cy - 40, H - tip.offsetHeight)) + 'px';
  };
  const leave = () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); };
  const hit = svg.querySelector('#hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

// ---------- seasonality chart ----------
function drawSeason(seas) {
  const host = document.getElementById('season');
  const W = host.clientWidth, H = 240, m = { l: 40, r: 6, t: 22, b: 24 };
  const vals = seas.months.map((o) => o.avg);
  const ext = Math.max(...vals.map(Math.abs)) * 1.15;
  const lo = Math.min(0, -ext * (Math.min(...vals) < 0 ? 1 : 0.15)), hi = ext;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / 12, gap = Math.max(2, bw * 0.25);
  const yt = niceTicks(lo, hi, 4);
  const bar = (i, v) => {
    const x0 = m.l + i * bw + gap / 2, w = bw - gap, y0 = y(0), y1 = y(v), r = Math.min(4, w / 2, Math.abs(y1 - y0));
    if (v >= 0) return `M${x0} ${y0}V${y1 + r}Q${x0} ${y1} ${x0 + r} ${y1}H${x0 + w - r}Q${x0 + w} ${y1} ${x0 + w} ${y1 + r}V${y0}Z`;
    return `M${x0} ${y0}V${y1 - r}Q${x0} ${y1} ${x0 + r} ${y1}H${x0 + w - r}Q${x0 + w} ${y1} ${x0 + w} ${y1 - r}V${y0}Z`;
  };
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Average monthly return by calendar month">
    <g class="axis">${yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>
      <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${(v * 100).toFixed(1)}%</text>`).join('')}
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>
      ${seas.months.map((o, i) => `<text x="${m.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${W < 420 ? MONTHS[i][0] : MONTHS[i]}</text>`).join('')}</g>
    ${seas.months.map((o, i) => `<g class="sb" data-i="${i}">
      <rect x="${m.l + i * bw}" y="${m.t - 20}" width="${bw}" height="${H - m.b - m.t + 20}" fill="transparent"/>
      <path d="${bar(i, o.avg)}" fill="${o.avg >= 0 ? 'var(--pos)' : 'var(--neg)'}"/>
      ${bw > 26 ? `<text x="${m.l + i * bw + bw / 2}" y="${o.avg >= 0 ? y(o.avg) - 5 : y(o.avg) + 13}" text-anchor="middle" font-size="10" fill="var(--text-2)">${pctPlain(o.win)}</text>` : ''}
    </g>`).join('')}
  </svg><div class="tip" id="stip"></div>`;
  const tip = host.querySelector('#stip');
  host.querySelectorAll('.sb').forEach((g) => {
    const show = () => {
      const o = seas.months[+g.dataset.i];
      tip.innerHTML = `<b>${MONTHS[o.m]}</b><div class="r"><span>Average</span><span>${pct(o.avg, 2)}</span></div>
        <div class="r"><span>Median</span><span>${pct(o.median, 2)}</span></div><div class="r"><span>Up</span><span>${pctPlain(o.win)} of ${o.n} years</span></div>`;
      tip.style.display = 'block';
      const cx = m.l + o.m * bw + bw / 2, tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, cx - tw / 2), W - tw) + 'px';
      tip.style.top = '0px';
    };
    g.addEventListener('pointerenter', show); g.addEventListener('pointerdown', show);
    g.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  });
}

// ---------- boot ----------
async function show(key) {
  state.key = key;
  document.querySelectorAll('#idx button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === key));
  try { await load(key); render(); }
  catch (e) { app.innerHTML = `<div class="card">Couldn't load prices (${esc(e.message)}). Try reloading.</div>`; }
}
document.querySelectorAll('#idx button').forEach((b) => b.onclick = () => show(b.dataset.k));
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.cache[state.key] && render(), 150); });
show(new URLSearchParams(location.search).get('i') === 'ndx' ? 'ndx' : 'spx');
