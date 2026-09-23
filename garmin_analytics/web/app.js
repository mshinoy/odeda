/* Garmin Analytics dashboard.
 *
 * Plain ES2020, no build step, no framework, no CDN. uPlot is the only dependency and
 * it is vendored next to this file.
 *
 * Conventions:
 *  - Colours are read from the CSS custom properties in style.css, so the palette lives
 *    in exactly one place and this file never hard-codes a hex.
 *  - Every chart gets a crosshair and a hover readout; multi-series charts also carry a
 *    static legend in the HTML, so identity is never colour-alone.
 *  - Panels load lazily and cache, so switching tabs does not refetch.
 */

'use strict';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const css = (name) => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim();

const C = {};
function loadTheme() {
  for (const k of ['surface-1', 'surface-2', 'surface-3', 'text-primary', 'text-secondary',
                   'text-muted', 'grid', 'baseline', 'series-1', 'series-2', 'series-3',
                   'series-4', 'series-5', 'series-7', 'good', 'warning', 'serious',
                   'critical']) {
    C[k] = css('--' + k);
  }
}
loadTheme();

const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = {
  n: (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d)),
  signed: (v, d = 1) => (v === null || v === undefined ? '–' : (v > 0 ? '+' : '') + Number(v).toFixed(d)),
  km: (m) => (m === null || m === undefined ? '–' : (m / 1000).toFixed(2)),
  hms: (s) => {
    if (s === null || s === undefined) return '–';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
             : `${m}:${String(sec).padStart(2, '0')}`;
  },
  pace: (mps) => {
    if (!mps || mps <= 0) return '–';
    const spk = 1000 / mps;
    return `${Math.floor(spk / 60)}:${String(Math.round(spk % 60)).padStart(2, '0')}`;
  },
  hours: (s) => (s === null || s === undefined ? '–' : (s / 3600).toFixed(1)),
  /* Pace means something different per sport: min/km running, km/h on a bike,
     min/100 m in the pool. One "pace" column that silently means three things
     (or prints 0.0 for a strength session) is worse than no column. */
  sportPace: (mps, type) => {
    if (!mps || mps <= 0) return '–';
    // Substring match, not equality: Garmin has treadmill_running, indoor_cycling,
    // pool_swimming, trail_running and invents more. Equality here silently fell
    // through to km/h for every one of them.
    const t = String(type || '');
    if (t.includes('cycling') || t.includes('bike')) return `${(mps * 3.6).toFixed(1)} km/h`;
    if (t.includes('swim')) {
      const s = 100 / mps;
      return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100m`;
    }
    if (t.includes('running') || t.includes('walking') || t.includes('hiking')) {
      return `${fmt.pace(mps)} /km`;
    }
    return `${(mps * 3.6).toFixed(1)} km/h`;
  },
  date: (d) => d || '–',
  pct: (v, d = 1) => (v === null || v === undefined ? '–' : `${Number(v).toFixed(d)}%`),
};

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
};

const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

const toTs = (day) => Date.parse(day + 'T00:00:00Z') / 1000;

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) { /* not JSON */ }
    throw new Error(`${path} → ${res.status} ${detail}`);
  }
  return res.json();
}

/* Writes. Every mutation in this app goes through here, so there is one place that
   knows how the server reports a validation failure. */
async function send(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) { /* not JSON */ }
    const err = new Error(`${path} → ${res.status} ${detail}`);
    // Carried so a caller can tell "you got it wrong" from "the server could not":
    // the Garmin login shows a different way forward for each.
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function showError(err) {
  const banner = $('#error-banner');
  banner.textContent = String(err && err.message ? err.message : err);
  banner.classList.add('show');
  console.error(err);
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const charts = [];

/* Crosshair tooltip. uPlot's built-in legend is a table below the plot; on a phone
 * that means looking away from the point you are touching. This puts the readout
 * beside the cursor instead. */
function tooltipPlugin(formatters) {
  let tip, over, bound = false;
  return {
    hooks: {
      init: (u) => {
        over = u.over;
        tip = el('div');
        Object.assign(tip.style, {
          position: 'absolute', zIndex: 10, pointerEvents: 'none', display: 'none',
          background: C['surface-3'], color: C['text-primary'], font: FONT,
          padding: '6px 9px', borderRadius: '7px', whiteSpace: 'nowrap',
          border: `1px solid ${C.baseline}`, boxShadow: '0 4px 14px rgba(0,0,0,.45)',
        });
        over.append(tip);
        if (!bound) {
          bound = true;
          over.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
        }
      },
      setCursor: (u) => {
        const { idx, left, top } = u.cursor;
        if (idx === null || idx === undefined || left < 0) { tip.style.display = 'none'; return; }
        const rows = [];
        const xVal = u.data[0][idx];
        rows.push(`<div style="color:${C['text-muted']};margin-bottom:3px">` +
                  `${new Date(xVal * 1000).toISOString().slice(0, 10)}</div>`);
        for (let s = 1; s < u.series.length; s++) {
          const ser = u.series[s];
          if (ser.show === false || ser._hideInTip) continue;
          const raw = (formatters && formatters[s]) ? formatters[s](u, idx) : u.data[s][idx];
          if (raw === null || raw === undefined) continue;
          rows.push(
            `<div><span style="display:inline-block;width:9px;height:3px;border-radius:2px;` +
            `background:${ser.stroke && ser.stroke.call ? ser.stroke() : ser.stroke};` +
            `vertical-align:middle;margin-right:6px"></span>` +
            `<span style="color:${C['text-secondary']}">${ser.label}</span> ` +
            `<b>${raw}</b></div>`);
        }
        if (rows.length < 2) { tip.style.display = 'none'; return; }
        tip.innerHTML = rows.join('');
        tip.style.display = 'block';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = `${Math.min(Math.max(0, left + 14), u.over.clientWidth - w - 2)}px`;
        tip.style.top = `${Math.min(Math.max(0, top - h - 10), u.over.clientHeight - h - 2)}px`;
      },
    },
  };
}

function axisBase(extra = {}) {
  return Object.assign({
    stroke: C['text-muted'],
    font: FONT,
    grid: { stroke: C.grid, width: 1 },
    ticks: { stroke: C.baseline, width: 1, size: 4 },
  }, extra);
}

/* `xValues` relabels the x axis without changing the underlying numbers — needed
   for the categorical-ish charts (weekday, hour of day, pace buckets) where the
   value is an index or a bucket floor but the tick should read "Sat" or "4:15/km". */
function baseOpts(height, seriesOpts,
                  { fmtters, yLabel, yRange, xIsTime = true, xValues, xSpace } = {}) {
  return {
    height,
    padding: [10, 10, 0, 0],
    cursor: { x: true, y: false, points: { size: 9 }, drag: { x: true, y: false } },
    legend: { show: false },
    scales: { x: { time: xIsTime }, y: yRange ? { range: yRange } : {} },
    axes: [
      axisBase(xValues ? { space: xSpace || 40, values: xValues } : { space: xSpace || 70 }),
      axisBase({ label: yLabel, labelFont: FONT, size: 48 }),
    ],
    series: [{}].concat(seriesOpts),
    plugins: [tooltipPlugin(fmtters)],
  };
}

function mount(id, opts, data) {
  const node = document.getElementById(id);
  if (!node) return null;
  clear(node);
  if (!data || !data[0] || data[0].length === 0) {
    node.append(el('div', { class: 'empty' }, 'No data for this chart yet.'));
    return null;
  }
  const width = Math.max(260, node.clientWidth || node.parentElement.clientWidth - 34);
  const plot = new uPlot(Object.assign({ width }, opts), data, node);
  charts.push({ id, plot, node });
  return plot;
}

const lineSeries = (label, colour, { width = 2, fill = null, points = false, dash = null } = {}) => ({
  label, stroke: colour, width, dash: dash || undefined,
  fill: fill || undefined,
  points: { show: points, size: 8, stroke: colour, fill: C['surface-1'], width: 2 },
});

const barSeries = (label, colour, { round = true, size = 0.65, fill = null } = {}) => ({
  label,
  stroke: colour,
  fill: fill || colour,
  width: 0,
  paths: uPlot.paths.bars({
    size: [size, 60, 1],
    gap: 2,                                // 2px surface gap between adjacent bars
    radius: round ? [0.35, 0] : [0, 0],    // rounded value end, square on the baseline
  }),
  points: { show: false },
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const c of charts) {
      const w = Math.max(260, c.node.clientWidth);
      if (w && Math.abs(w - c.plot.width) > 2) c.plot.setSize({ width: w, height: c.plot.height });
    }
  }, 150);
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Render a table. `cols` is [{key, label, fmt?, cls?, sortable?}].
 * If `sortState` is given the header becomes clickable and calls onSort(key).
 */
function renderTable(table, cols, rows, { sortState, onSort, onRowClick, emptyText } = {}) {
  clear(table);
  const thead = el('thead');
  const tr = el('tr');
  for (const c of cols) {
    const sortable = onSort && c.sortable !== false;
    const active = sortState && sortState.key === c.key;
    const th = el('th', { class: sortable ? 'sortable' : null, scope: 'col' }, c.label);
    if (active) th.append(el('span', { class: 'arrow' }, sortState.dir === 'asc' ? '▲' : '▼'));
    if (sortable) th.addEventListener('click', () => onSort(c.key));
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = el('tbody');
  if (!rows.length) {
    tbody.append(el('tr', {}, el('td', { colspan: cols.length, class: 'empty' },
      emptyText || 'Nothing here.')));
  }
  for (const row of rows) {
    const trr = el('tr', { class: onRowClick ? 'clickable' : null });
    for (const c of cols) {
      const value = c.fmt ? c.fmt(row[c.key], row) : row[c.key];
      const td = el('td', { class: c.cls || null });
      if (value instanceof Node) td.append(value);
      else td.textContent = (value === null || value === undefined) ? '–' : String(value);
      trr.append(td);
    }
    if (onRowClick) trr.addEventListener('click', () => onRowClick(row));
    tbody.append(trr);
  }
  table.append(tbody);
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const cache = {};
async function once(key, fn) {
  if (!(key in cache)) cache[key] = await fn();
  return cache[key];
}

const statTile = (label, value, detail) =>
  el('div', { class: 'stat' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value),
    detail ? el('div', { class: 'detail' }, detail) : null);

function flagRow(kind, icon, text, trailing) {
  return el('div', { class: `flag ${kind}` },
    el('span', { class: 'icon' }, icon),
    el('span', {}, text),
    trailing ? el('span', { class: 'z' }, trailing) : null);
}

const METRIC_LABELS = {
  resting_hr: 'Resting HR', hrv: 'HRV', sleep_score: 'Sleep score',
  total_sleep_s: 'Sleep duration', bb_high: 'Body Battery high', stress_avg: 'Stress',
};

// --- Overview ---------------------------------------------------------------

async function renderOverview() {
  const [summary, readyHist, reports] = await Promise.all([
    once('summary', () => api('/api/summary')),
    once('readyHist', () => api('/api/readiness/history?days=90')),
    once('reports', () => api('/api/reports')),
  ]);

  // Hero
  const r = summary.readiness || {};
  const hero = $('#readiness-hero');
  clear(hero);
  hero.append(
    el('div', {},
      el('div', { class: 'figure' }, r.score === null || r.score === undefined ? '–' : fmt.n(r.score, 0)),
      el('div', { class: 'band' }, r.band || 'no data')),
    el('div', { class: 'reasons' },
      el('ul', {}, (r.reasons || []).map((x) => el('li', {}, x)))),
  );
  $('#readiness-rec').textContent = r.recommendation || '';

  const meters = $('#readiness-meters');
  clear(meters);
  const compLabels = { sleep: 'Sleep', hrv: 'HRV', tsb: 'Form', rhr: 'Resting HR' };
  for (const [key, label] of Object.entries(compLabels)) {
    const v = (r.components || {})[key];
    meters.append(el('div', { class: 'meter' },
      el('div', { class: 'name' }, label),
      el('div', { class: 'track' },
        el('div', { class: 'fill', style: `width:${v === null || v === undefined ? 0 : v}%` })),
      el('div', { class: 'num' }, v === null || v === undefined ? 'n/a' : fmt.n(v, 0))));
  }

  // Stats
  const stats = $('#overview-stats');
  clear(stats);
  const load = summary.load || {};
  const race = summary.race || {};
  const totals = summary.totals || {};
  const streaks = summary.streaks || {};
  stats.append(
    statTile('CTL (fitness)', fmt.n(load.ctl, 1), load.form),
    statTile('ATL (fatigue)', fmt.n(load.atl, 1), `TSB ${fmt.signed(load.tsb, 1)}`),
    statTile('CTL ramp', summary.ramp_pct === null ? '–' : fmt.pct(summary.ramp_pct),
             summary.ramp_flag ? 'above the 10%/wk flag' : 'within 10%/wk'),
    statTile('Days to race', race.days_to_go, race.date),
    statTile('Projected HM',
             race.projection ? race.projection.projected_time : '–',
             race.projection ? `from ${race.projection.from_label} on ${race.projection.from_day}` : 'no qualifying effort'),
    statTile('Run distance', `${fmt.n(totals.total_run_km, 0)} km`,
             `${totals.activities} activities, ${fmt.n(totals.total_hours, 0)} h`),
    statTile('Longest streak', `${(streaks.longest_active || {}).length || 0} d`,
             (streaks.longest_active || {}).start ? `from ${streaks.longest_active.start}` : null),
    statTile('Tracked days', totals.tracked_days,
             `${summary.day_range.from} → ${summary.day_range.to}`),
  );

  // Flags
  const flags = $('#overview-flags');
  clear(flags);
  const items = summary.flags || [];
  if (summary.ramp_flag) {
    flags.append(flagRow('warning', '▲',
      `Training load is ramping at ${fmt.pct(summary.ramp_pct)} per week — above the 10% guideline.`));
  }
  if (!items.length && !summary.ramp_flag) {
    flags.append(flagRow('good', '●', 'Nothing outside baseline. All monitored metrics within 1.5σ.'));
  }
  for (const f of items) {
    const better = f.verdict === 'better than baseline';
    flags.append(flagRow(better ? 'good' : 'warning', better ? '▲' : '▼',
      `${METRIC_LABELS[f.metric] || f.metric} is ${f.verdict}.`, `z = ${fmt.signed(f.z, 2)}`));
  }

  // Readiness history. The daily series is genuinely noisy — night-to-night HRV
  // scatter is most of it — so a 7-day mean rides on top to carry the trend.
  const hist = (readyHist.series || []).filter((d) => d.score !== null);
  const scores = hist.map((d) => d.score);
  const roll7 = scores.map((_, i) => {
    const chunk = scores.slice(Math.max(0, i - 6), i + 1).filter((v) => v !== null);
    return chunk.length ? +(chunk.reduce((a, b) => a + b, 0) / chunk.length).toFixed(1) : null;
  });
  mount('chart-readiness',
    baseOpts(200, [
      lineSeries('Daily', C['series-1'], { width: 1 }),
      lineSeries('7-day mean', C['series-2'], { width: 2.5 }),
    ], { yRange: [0, 100], yLabel: 'score' }),
    [hist.map((d) => toTs(d.day)), scores, roll7]);

  // Weekly km
  const weeks = (reports.weekly || []).slice(-26);
  mount('chart-weekly-km',
    baseOpts(200, [barSeries('Run km', C['series-1'])], { yLabel: 'km' }),
    [weeks.map((w) => toTs(w.start)), weeks.map((w) => w.run_km)]);
}

// --- Training load ----------------------------------------------------------

async function renderLoad() {
  const [load, reports] = await Promise.all([
    once('load', () => api('/api/load')),
    once('reports', () => api('/api/reports')),
  ]);

  $('#load-warmup').textContent = load.warmup_note || '';

  const curve = load.curve || [];
  const xs = curve.map((d) => toTs(d.day));

  mount('chart-ctl',
    baseOpts(260, [
      lineSeries('CTL', C['series-1'], { width: 2 }),
      lineSeries('ATL', C['series-2'], { width: 2 }),
    ], { yLabel: 'load' }),
    [xs, curve.map((d) => d.ctl), curve.map((d) => d.atl)]);

  // TSB is signed: colour the bar by sign so polarity reads without the axis.
  const tsb = curve.map((d) => d.tsb);
  mount('chart-tsb',
    baseOpts(200, [{
      label: 'TSB',
      stroke: C['series-1'],
      fill: (u, i) => {
        // Diverging: one warm pole, one cool, no rainbow.
        const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
        const zero = u.valToPos(0, 'y', true);
        const f = Math.max(0, Math.min(1, (zero - u.bbox.top) / u.bbox.height));
        grad.addColorStop(0, C['series-1']);
        grad.addColorStop(Math.max(0, f - 0.001), C['series-1']);
        grad.addColorStop(Math.min(1, f + 0.001), C.critical);
        grad.addColorStop(1, C.critical);
        return grad;
      },
      width: 0,
      paths: uPlot.paths.bars({ size: [1, 6, 1], gap: 0 }),
      points: { show: false },
    }], { yLabel: 'TSB' }),
    [xs, tsb]);

  mount('chart-trimp',
    baseOpts(200, [barSeries('TRIMP', C['series-3'], { round: false, size: 1 })],
      { yLabel: 'TRIMP' }),
    [xs, curve.map((d) => d.load || null)]);

  renderTable($('#table-weekly'), [
    { key: 'week', label: 'Week' },
    { key: 'start', label: 'Starting' },
    { key: 'runs', label: 'Runs' },
    { key: 'run_km', label: 'Run km' },
    { key: 'hours', label: 'Hours', fmt: (v) => fmt.n(v, 1) },
    { key: 'trimp', label: 'TRIMP', fmt: (v) => fmt.n(v, 0) },
    { key: 'km_delta_pct', label: 'Δ km', fmt: (v) => (v === null ? '–' : fmt.signed(v, 0) + '%') },
    { key: 'elev_m', label: 'Elev m' },
    { key: 'avg_hr', label: 'Avg HR', fmt: (v) => fmt.n(v, 0) },
    { key: 'rhr', label: 'RHR', fmt: (v) => fmt.n(v, 1) },
    { key: 'hrv', label: 'HRV', fmt: (v) => fmt.n(v, 0) },
    { key: 'sleep_h', label: 'Sleep h', fmt: (v) => fmt.n(v, 1) },
  ], (reports.weekly || []).slice().reverse());
}

// --- Sleep & recovery -------------------------------------------------------

async function renderRecovery() {
  const [trends, daily, reports] = await Promise.all([
    once('trends', () => api('/api/trends?days=548')),
    once('daily', () => api('/api/daily?days=548')),
    once('reports', () => api('/api/reports')),
  ]);

  const stats = $('#recovery-stats');
  clear(stats);
  for (const [metric, t] of Object.entries(trends.metrics || {})) {
    const unit = metric === 'total_sleep_s' ? 'h' : '';
    const val = metric === 'total_sleep_s' ? fmt.hours(t.latest) : fmt.n(t.latest, 1);
    stats.append(statTile(METRIC_LABELS[metric] || metric, `${val}${unit}`,
      `${t.verdict} · z ${fmt.signed(t.z, 2)}`));
  }

  const rows = daily.rows || [];
  const xs = rows.map((d) => toTs(d.day));

  // Sleep stages: stacked bars. Cumulative arrays drawn largest-first; the tooltip
  // reports the per-stage value, not the cumulative one.
  // Windowed to the last SLEEP_WINDOW nights: 550 stacked bars across 1100 px is one
  // bar per two pixels, which renders as texture rather than as composition.
  const SLEEP_WINDOW = 120;
  const sleepRows = rows.slice(-SLEEP_WINDOW);
  const sleepXs = sleepRows.map((d) => toTs(d.day));
  const deep = sleepRows.map((d) => (d.deep_s ? d.deep_s / 3600 : null));
  const rem = sleepRows.map((d) => (d.rem_s ? d.rem_s / 3600 : null));
  const light = sleepRows.map((d) => {
    if (d.total_sleep_s === null || d.total_sleep_s === undefined) return null;
    return Math.max(0, (d.total_sleep_s - (d.deep_s || 0) - (d.rem_s || 0)) / 3600);
  });
  const add = (a, b) => a.map((v, i) => (v === null && b[i] === null ? null : (v || 0) + (b[i] || 0)));
  const cumAll = add(add(deep, rem), light);
  const cumDeepRem = add(deep, rem);
  const stageRaw = { 1: light, 2: rem, 3: deep };

  mount('chart-sleep-stages',
    baseOpts(240, [
      barSeries('Light', C['series-4'], { round: false, size: 0.8 }),
      barSeries('REM', C['series-3'], { round: false, size: 0.8 }),
      barSeries('Deep', C['series-1'], { round: false, size: 0.8 }),
    ], {
      yLabel: 'hours',
      fmtters: {
        1: (u, i) => (stageRaw[1][i] === null ? null : stageRaw[1][i].toFixed(1) + ' h'),
        2: (u, i) => (stageRaw[2][i] === null ? null : stageRaw[2][i].toFixed(1) + ' h'),
        3: (u, i) => (stageRaw[3][i] === null ? null : stageRaw[3][i].toFixed(1) + ' h'),
      },
    }),
    [sleepXs, cumAll, cumDeepRem, deep]);

  const pair = (id, label, values, roll) => mount(id,
    baseOpts(200, [
      lineSeries(label, C['series-1'], { width: 1 }),
      lineSeries('28-day mean', C['series-2'], { width: 2.5 }),
    ], { yLabel: label }),
    [xs, values, roll]);

  const t = (k) => (trends.metrics || {})[k] || {};
  pair('chart-sleep-score', 'Sleep score', rows.map((d) => d.sleep_score), t('sleep_score').roll28);
  pair('chart-hrv', 'HRV (ms)', rows.map((d) => d.hrv), t('hrv').roll28);
  pair('chart-rhr', 'RHR (bpm)', rows.map((d) => d.resting_hr), t('resting_hr').roll28);

  mount('chart-bb',
    baseOpts(200, [
      lineSeries('High', C['series-1'], { width: 1 }),
      lineSeries('Low', C['series-2'], { width: 1 }),
    ], { yLabel: 'Body Battery', yRange: [0, 100] }),
    [xs, rows.map((d) => d.bb_high), rows.map((d) => d.bb_low)]);

  renderTable($('#table-monthly'), [
    { key: 'month', label: 'Month' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'run_km', label: 'Run km' },
    { key: 'hours', label: 'Hours', fmt: (v) => fmt.n(v, 1) },
    { key: 'trimp', label: 'TRIMP', fmt: (v) => fmt.n(v, 0) },
    { key: 'km_delta_pct', label: 'Δ km', fmt: (v) => (v === null ? '–' : fmt.signed(v, 0) + '%') },
    { key: 'rhr', label: 'RHR', fmt: (v) => fmt.n(v, 1) },
    { key: 'hrv', label: 'HRV', fmt: (v) => fmt.n(v, 0) },
    { key: 'sleep_score', label: 'Sleep', fmt: (v) => fmt.n(v, 0) },
    { key: 'weight_kg', label: 'Weight', fmt: (v) => fmt.n(v, 1) },
    { key: 'vo2max', label: 'VO₂max', fmt: (v) => fmt.n(v, 1) },
  ], (reports.monthly || []).slice().reverse());
}

// --- Activities -------------------------------------------------------------

const actState = { limit: 50, offset: 0, sort: 'day', order: 'desc', type: '', q: '', from: '', to: '', total: 0 };

async function loadActivities() {
  const p = new URLSearchParams({
    limit: actState.limit, offset: actState.offset, sort: actState.sort, order: actState.order,
  });
  if (actState.type) p.set('type', actState.type);
  if (actState.q) p.set('q', actState.q);
  if (actState.from) p.set('start', actState.from);
  if (actState.to) p.set('end', actState.to);

  const data = await api('/api/activities?' + p.toString());
  actState.total = data.total;

  const typeSel = $('#filter-type');
  if (typeSel.options.length <= 1) {
    for (const t of data.types) typeSel.append(el('option', { value: t }, t.replace(/_/g, ' ')));
    typeSel.value = actState.type;
  }

  renderTable($('#table-activities'), [
    { key: 'day', label: 'Date' },
    { key: 'activity_name', label: 'Activity', cls: 'name', sortable: false },
    { key: 'activity_type', label: 'Type', fmt: (v) => el('span', { class: 'pill' }, v.replace(/_/g, ' ')) },
    { key: 'distance_m', label: 'km', fmt: fmt.km },
    { key: 'moving_time_s', label: 'Time', fmt: fmt.hms },
    { key: 'avg_speed_mps', label: 'Pace', fmt: (v, r) => fmt.sportPace(v, r.activity_type) },
    { key: 'avg_hr', label: 'Avg HR', fmt: (v) => fmt.n(v, 0) },
    { key: 'max_hr', label: 'Max HR', fmt: (v) => fmt.n(v, 0) },
    { key: 'elevation_gain_m', label: 'Elev', fmt: (v) => fmt.n(v, 0) },
    { key: 'trimp', label: 'TRIMP', fmt: (v) => fmt.n(v, 0) },
  ], data.rows, {
    sortState: { key: actState.sort, dir: actState.order },
    onSort: (key) => {
      if (actState.sort === key) actState.order = actState.order === 'asc' ? 'desc' : 'asc';
      else { actState.sort = key; actState.order = 'desc'; }
      actState.offset = 0;
      loadActivities().catch(showError);
    },
    onRowClick: (row) => openDrawer(row.activity_id).catch(showError),
    emptyText: 'No activities match those filters.',
  });

  $('#activities-count').textContent = `${data.total} activities`;
  const shown = data.rows.length;
  $('#page-info').textContent = shown
    ? `${actState.offset + 1}–${actState.offset + shown} of ${data.total}` : '';
  $('#page-prev').disabled = actState.offset === 0;
  $('#page-next').disabled = actState.offset + actState.limit >= data.total;
}

async function renderActivities() { await loadActivities(); }

const ZONE_COLOURS = [C['series-3'], C['series-1'], C['series-4'], C['series-2'], C.critical];

/* The drawer is addressable: #activities/<id> opens it directly. That makes a
   specific session linkable, and makes the drawer verifiable without a click. */
async function openDrawer(activityId) {
  const body = $('#drawer-body');
  clear(body);
  body.append(el('div', { class: 'loading' }, 'loading…'));
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  history.replaceState(null, '', `#activities/${activityId}`);

  const d = await api(`/api/activities/${encodeURIComponent(activityId)}`);
  const a = d.activity;
  clear(body);

  body.append(
    el('h3', {}, a.activity_name || a.activity_type),
    el('div', { class: 'when' },
      `${a.start_time_local ? a.start_time_local.replace('T', ' ') : a.day} · ${a.activity_type.replace(/_/g, ' ')}`),
    el('div', { class: 'stats' },
      statTile('Distance', `${fmt.km(a.distance_m)} km`),
      statTile('Moving', fmt.hms(a.moving_time_s), `elapsed ${fmt.hms(a.duration_s)}`),
      statTile('Pace', fmt.sportPace(a.avg_speed_mps, a.activity_type)),
      statTile('Avg HR', fmt.n(a.avg_hr, 0), `max ${fmt.n(a.max_hr, 0)}`),
      statTile('TRIMP', fmt.n(a.trimp, 0),
        a.training_effect_aerobic ? `TE ${fmt.n(a.training_effect_aerobic, 1)}` : null),
      statTile('Decoupling', d.decoupling_pct === null ? 'n/a' : fmt.pct(d.decoupling_pct),
        d.efficiency_factor ? `EF ${fmt.n(d.efficiency_factor, 3)}` : null),
    ),
  );

  await drawerEditor(body, d);
  await drawerMap(body, d);

  if (d.hr_zones && d.hr_zones.length) {
    const total = d.hr_zones.reduce((s, z) => s + z.seconds, 0) || 1;
    const zoneWrap = el('div', { class: 'zone-bars' });
    for (const z of d.hr_zones) {
      zoneWrap.append(el('div', { class: 'zone-row' },
        el('span', {}, `Zone ${z.zone}`),
        el('div', { class: 'track' },
          el('div', {
            class: 'fill',
            style: `width:${(z.seconds / total * 100).toFixed(1)}%;background:${ZONE_COLOURS[z.zone - 1]}`,
          })),
        el('span', { class: 'secs' }, fmt.hms(z.seconds))));
    }
    body.append(el('h2', { style: 'margin-top:20px' }, 'Time in heart-rate zones'), zoneWrap);
  }

  const samples = d.samples || [];
  if (samples.length > 3) {
    const t = samples.map((s) => s.elapsed_s / 60);
    body.append(el('h2', { style: 'margin-top:22px' }, 'Heart rate'),
      el('div', { class: 'chart', id: 'drawer-hr' }));
    body.append(el('h2', { style: 'margin-top:16px' }, 'Pace'),
      el('div', { class: 'chart', id: 'drawer-pace' }));

    // Two measures, two charts — never two y-axes on one plot.
    const opts = (label, colour, fmtter) => ({
      width: Math.max(260, body.clientWidth - 4),
      height: 170,
      padding: [8, 10, 0, 0],
      cursor: { x: true, y: false, drag: { x: true, y: false } },
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        axisBase({ space: 60, values: (u, vs) => vs.map((v) => `${v.toFixed(0)}m`) }),
        axisBase({ size: 46 }),
      ],
      series: [{ label: 'min' }, lineSeries(label, colour, { width: 1.5 })],
      plugins: [{
        hooks: {
          setCursor: (u) => {
            const i = u.cursor.idx;
            if (i === null || i === undefined) return;
            u.root.querySelector('.readout').textContent = fmtter(u.data[1][i], t[i]);
          },
        },
      }],
    });

    const hrPlot = new uPlot(opts('HR (bpm)', C.critical,
      (v, tm) => (v === null ? '' : `${v.toFixed(0)} bpm at ${tm.toFixed(1)} min`)),
      [t, samples.map((s) => s.hr)], $('#drawer-hr'));
    hrPlot.root.append(el('div', { class: 'readout', style: `font-size:12px;color:${C['text-muted']}` }));

    const pacePlot = new uPlot(opts('Pace (min/km)', C['series-1'],
      (v, tm) => (v === null ? '' : `${fmt.pace(1000 / (v * 60))} /km at ${tm.toFixed(1)} min`)),
      [t, samples.map((s) => (s.speed_mps > 0.5 ? 1000 / s.speed_mps / 60 : null))],
      $('#drawer-pace'));
    pacePlot.root.append(el('div', { class: 'readout', style: `font-size:12px;color:${C['text-muted']}` }));

    // Link both charts to the map, in both directions.
    if (drawerState.map && drawerState.data) {
      const trackX = drawerState.data.series.elapsed_s.map((s) => s / 60);
      linkChartAndMap(hrPlot, drawerState.map, drawerState.data, t, trackX);
      linkChartAndMap(pacePlot, drawerState.map, drawerState.data, t, trackX);
    }
  }

  if (d.km_splits && d.km_splits.length) {
    body.append(el('h2', { style: 'margin-top:22px' }, 'Kilometre splits'));
    const tbl = el('table');
    body.append(el('div', { class: 'table-wrap' }, tbl));
    renderTable(tbl, [
      { key: 'km', label: 'km' },
      { key: 'pace', label: 'Pace' },
      { key: 'seconds', label: 'Time', fmt: fmt.hms },
      { key: 'avg_hr', label: 'Avg HR', fmt: (v) => fmt.n(v, 0) },
    ], d.km_splits);
  }

  if (d.best_efforts && d.best_efforts.length) {
    body.append(el('h2', { style: 'margin-top:22px' }, 'Best efforts in this activity'));
    const tbl = el('table');
    body.append(el('div', { class: 'table-wrap' }, tbl));
    renderTable(tbl, [
      { key: 'label', label: 'Distance' },
      { key: 'time', label: 'Time' },
      { key: 'pace', label: 'Pace' },
    ], d.best_efforts);
  }

  body.append(el('p', { style: `margin-top:24px;font-size:12px;color:${C['text-muted']}` },
    'Raw archived payload: ',
    el('a', { href: `/api/raw/activities/${encodeURIComponent(activityId)}`, target: '_blank' },
      activityId)));

  /* Leaflet caches the container size at creation. The drawer keeps growing after
     the map is inserted — charts, splits and tables are all appended below it — so
     without this the map believes it is the size it was mid-render, and both the
     tile grid and fitBounds come out wrong. */
  if (drawerState.map && drawerState.data) {
    requestAnimationFrame(() => {
      drawerState.map.invalidateSize();
      GA_MAP.fit(drawerState.map, drawerState.data.latlngs);
    });
  }
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  drawerState.map = null;
  if (location.hash.startsWith('#activities/')) history.replaceState(null, '', '#activities');
}

const drawerState = { map: null, data: null, metric: 'speed_mps' };

/* The edit form is generated from /api/fields rather than hand-written, so adding
   an editable field server-side makes it appear here with no JS change. */
async function drawerEditor(body, d) {
  const [registry, gearData] = await Promise.all([
    once('fields', () => api('/api/fields')),
    api('/api/gear?include_retired=true'),
  ]);
  const a = d.activity;
  const id = a.activity_id;
  const overridden = new Set((d.overrides || []).map((o) => o.field));

  const section = el('details', { class: 'editor', open: overridden.size > 0 });
  section.append(el('summary', {},
    'Edit this activity',
    overridden.size
      ? el('span', { class: 'pill' }, `${overridden.size} edited`)
      : null));

  const inputs = {};
  const grid = el('div', { class: 'edit-grid' });

  for (const f of registry.fields) {
    const current = a[f.name];
    let input;
    if (f.editor === 'select') {
      input = el('select', {});
      const choices = (f.choices || []).slice();
      /* If the activity's real value is not in the suggestion list — Garmin adds
         sports constantly — put it in anyway. Otherwise the browser selects the
         first option, and pressing Save silently retypes the activity to it. */
      if (current !== null && current !== undefined && !choices.includes(String(current))) {
        choices.unshift(String(current));
      }
      for (const c of choices) {
        input.append(el('option', { value: c, selected: c === String(current) ? '' : null },
          c.replace(/_/g, ' ')));
      }
    } else if (f.editor === 'textarea') {
      input = el('textarea', { rows: 3 });
      input.value = current === null || current === undefined ? '' : String(current);
    } else if (f.editor === 'bool') {
      input = el('input', { type: 'checkbox' });
      input.checked = !!current;
    } else if (f.editor === 'number') {
      input = el('input', { type: 'number', min: f.min ?? null, max: f.max ?? null });
      input.value = current === null || current === undefined ? '' : String(current);
    } else {
      input = el('input', { type: 'text' });
      input.value = current === null || current === undefined ? '' : String(current);
    }
    inputs[f.name] = { input, field: f };

    const row = el('label', { class: `edit-row ${overridden.has(f.name) ? 'edited' : ''}` },
      el('span', { class: 'edit-label' },
        f.label,
        overridden.has(f.name)
          ? el('button', {
              class: 'ghost tiny',
              title: 'Reset to the value Garmin supplied',
              onclick: async (e) => {
                e.preventDefault();
                await send('DELETE', `/api/activities/${encodeURIComponent(id)}/overrides/${f.name}`);
                await reopenDrawer(id);
              },
            }, 'revert')
          : null),
      input,
      f.help ? el('span', { class: 'edit-help' }, f.help) : null);
    grid.append(row);
  }
  section.append(grid);

  // --- gear, one dropdown per kind ---
  const assigned = new Map((d.gear || []).map((g) => [g.kind, g.gear_id]));
  const kinds = [...new Set(gearData.gear.map((g) => g.kind))];
  if (kinds.length) {
    const gearGrid = el('div', { class: 'edit-grid' });
    const gearSelects = {};
    for (const kind of kinds) {
      const sel = el('select', {});
      sel.append(el('option', { value: '' }, '— none —'));
      for (const g of gearData.gear.filter((x) => x.kind === kind)) {
        sel.append(el('option', {
          value: g.gear_id,
          selected: assigned.get(kind) === g.gear_id ? '' : null,
        }, `${g.display_name}${g.retired ? ' (retired)' : ''}`));
      }
      gearSelects[kind] = sel;
      gearGrid.append(el('label', { class: 'edit-row' },
        el('span', { class: 'edit-label' }, kind === 'shoe' ? 'Shoes'
          : kind === 'bike' ? 'Bike' : kind.charAt(0).toUpperCase() + kind.slice(1)),
        sel));
    }
    section.append(el('h3', { class: 'edit-head' }, 'Gear'), gearGrid);
    drawerState.gearSelects = gearSelects;
  } else {
    drawerState.gearSelects = {};
    section.append(el('p', { class: 'hint' },
      'No gear defined yet — add some on the Gear tab, then assign it here.'));
  }

  const status = el('span', { class: 'edit-status' });
  section.append(el('div', { class: 'edit-actions' },
    el('button', {
      class: 'primary',
      onclick: async (e) => {
        e.preventDefault();
        status.textContent = 'saving…';
        try {
          const payload = {};
          for (const [name, { input, field }] of Object.entries(inputs)) {
            payload[name] = field.editor === 'bool' ? input.checked : input.value;
          }
          await send('PATCH', `/api/activities/${encodeURIComponent(id)}`, payload);
          const gearIds = Object.values(drawerState.gearSelects)
            .map((s) => s.value).filter(Boolean).map(Number);
          await send('PUT', `/api/activities/${encodeURIComponent(id)}/gear`,
            { gear_ids: gearIds });
          status.textContent = 'saved';
          // Any aggregate could have moved; make the other tabs refetch.
          for (const p of ['activities', 'aggregate', 'gear', 'settings']) rendered.delete(p);
          await reopenDrawer(id);
        } catch (err) {
          status.textContent = String(err.message || err);
        }
      },
    }, 'Save'),
    overridden.size
      ? el('button', {
          class: 'ghost',
          onclick: async (e) => {
            e.preventDefault();
            await send('DELETE', `/api/activities/${encodeURIComponent(id)}/overrides`);
            await reopenDrawer(id);
          },
        }, 'Revert all to Garmin')
      : null,
    status));

  body.append(section);
}

async function reopenDrawer(id) {
  for (const p of ['activities', 'aggregate', 'gear', 'settings']) rendered.delete(p);
  await openDrawer(id);
}

/* The map, plus the two-way link to the charts below it. Indoor activities simply
   do not get this block — they must not produce an empty grey box or an error. */
async function drawerMap(body, d) {
  if (!d.has_gps) {
    body.append(el('p', { class: 'hint no-gps' },
      'No GPS in this activity — treadmill, turbo or a lost signal. '
      + 'Everything below still works.'));
    return;
  }
  const cfg = await mapCfg();
  const track = await api(`/api/activities/${encodeURIComponent(d.activity.activity_id)}/track`);
  drawerState.data = trackSeries(track);

  const metricSel = el('select', {});
  for (const [key, meta] of Object.entries(METRIC_META)) {
    metricSel.append(el('option', { value: key, selected: key === drawerState.metric ? '' : null },
      meta.label));
  }
  const legendNode = el('div', {});
  const mapNode = el('div', { class: 'map', id: 'drawer-map' });

  body.append(
    el('div', { class: 'map-toolbar' },
      el('label', {}, 'Colour by'), metricSel,
      track.route
        ? el('span', { class: 'hint' }, 'Route: ',
            el('a', { href: `#routes/${track.route.route_id}`,
                      onclick: () => showPanel('routes').then(() => openRoute(track.route.route_id)) },
              track.route.name))
        : el('span', { class: 'hint' }, 'Not matched to a route.')),
    mapNode, legendNode);

  // Leaflet measures the container, so it must be in the DOM and laid out first.
  await new Promise((r) => requestAnimationFrame(r));
  drawerState.map = GA_MAP.create(mapNode, cfg);
  drawTrack(drawerState.map, mapNode, legendNode, drawerState.data, drawerState.metric);
  GA_MAP.fit(drawerState.map, drawerState.data.latlngs);

  metricSel.addEventListener('change', () => {
    drawerState.metric = metricSel.value;
    drawTrack(drawerState.map, mapNode, legendNode, drawerState.data, drawerState.metric);
  });
}

// --- Performance ------------------------------------------------------------

async function renderPerformance() {
  const perf = await once('performance', () => api('/api/performance'));

  renderTable($('#table-pbs'), [
    { key: 'label', label: 'Distance' },
    { key: 'time', label: 'Best' },
    { key: 'pace', label: 'Pace' },
    { key: 'day', label: 'When' },
  ], perf.personal_bests || [], { emptyText: 'No sample streams to extract best efforts from.' });

  // Session-to-session decoupling is genuinely scattered (terrain, heat, how hard the
  // session was). Draw it as points, with a 10-session mean carrying the trend — a
  // connecting line between consecutive runs implies a continuity that isn't there.
  const dec = (perf.decoupling || []).filter((d) => d.decoupling_pct !== null);
  const xs = dec.map((d) => toTs(d.day));
  const decVals = dec.map((d) => d.decoupling_pct);
  const decRoll = decVals.map((_, i) => {
    const chunk = decVals.slice(Math.max(0, i - 9), i + 1);
    return +(chunk.reduce((a, b) => a + b, 0) / chunk.length).toFixed(2);
  });
  mount('chart-decoupling',
    baseOpts(210, [
      Object.assign(lineSeries('Decoupling', C['series-1'], { width: 0, points: true }),
        { width: 0 }),
      lineSeries('10-session mean', C['series-2'], { width: 2.5 }),
      lineSeries('5% threshold', C.warning, { width: 1.5, dash: [6, 4] }),
    ], { yLabel: '%' }),
    [xs, decVals, decRoll, dec.map(() => 5)]);

  const ef = (perf.efficiency_trend || []);
  mount('chart-ef',
    baseOpts(210, [lineSeries('Efficiency factor', C['series-3'], { width: 1.5, points: true })],
      { yLabel: 'm/min/bpm' }),
    [ef.map((d) => toTs(d.day)), ef.map((d) => d.ef)]);

  const vo2 = (perf.vo2max || []);
  mount('chart-vo2',
    baseOpts(210, [lineSeries('VO₂max', C['series-1'], { width: 2 })], { yLabel: 'ml/kg/min' }),
    [vo2.map((d) => toTs(d.day)), vo2.map((d) => d.vo2max_run)]);
}

// --- Race -------------------------------------------------------------------

async function renderRace() {
  const [race, load] = await Promise.all([
    once('race', () => api('/api/race')),
    once('load', () => api('/api/load')),
  ]);

  $('#race-title').textContent = race.race.name;

  const hero = $('#race-hero');
  clear(hero);
  const p = race.projection;
  hero.append(
    el('div', {},
      el('div', { class: 'figure' }, race.days_to_go),
      el('div', { class: 'band' }, 'days to go')),
    el('div', { class: 'reasons' },
      el('div', { class: 'stats' },
        statTile('Race day', race.race.date, `${race.race.start_local} ${race.race.timezone}`),
        statTile('Projected', p ? p.projected_time : '–', p ? p.projected_pace : 'no qualifying effort'),
        statTile('Based on', p ? `${p.from_label} ${p.from_time}` : '–', p ? p.from_day : null),
        statTile('CTL now', fmt.n(race.ctl_now, 1), `target ${fmt.n(race.ctl_target, 0)}`),
        statTile('Weekly km', fmt.n(race.weekly_km_avg_4wk, 1), `target ${fmt.n(race.weekly_km_target, 0)}`),
        statTile('Form', fmt.signed(race.tsb_now, 1), 'TSB'),
      )),
  );

  const notes = $('#race-notes');
  clear(notes);
  if (!race.notes.length) notes.append(flagRow('good', '●', 'On track against the plan targets.'));
  for (const n of race.notes) {
    notes.append(flagRow(n.level, n.level === 'good' ? '●' : '▲', n.text));
  }

  const curve = (load.curve || []).slice(-260);
  mount('chart-race-ctl',
    baseOpts(230, [
      lineSeries('CTL', C['series-1'], { width: 2 }),
      lineSeries('Peak target', C['series-2'], { width: 1.5, dash: [6, 4] }),
    ], { yLabel: 'CTL' }),
    [curve.map((d) => toTs(d.day)), curve.map((d) => d.ctl), curve.map(() => race.ctl_target)]);

  const weeks = race.weekly_km || [];
  mount('chart-race-km',
    baseOpts(230, [
      barSeries('Run km', C['series-1']),
      lineSeries('Peak target', C['series-2'], { width: 1.5, dash: [6, 4] }),
    ], { yLabel: 'km' }),
    [weeks.map((w) => toTs(w.start)), weeks.map((w) => w.km), weeks.map(() => race.weekly_km_target)]);

  renderTable($('#table-race-bests'), [
    { key: 'label', label: 'Distance' },
    { key: 'time', label: 'Best (last 120 d)' },
    { key: 'pace', label: 'Pace' },
    { key: 'day', label: 'When' },
  ], race.recent_bests || [], { emptyText: 'No best efforts in the last 120 days.' });
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

const mapCfg = () => once('config', () => api('/api/config')).then((c) => c.map);

/* Turn a track payload into what the map and the charts both need.
   `points` rows are [lat, lon, altitude, distance, elapsed, hr, speed, cadence]. */
function trackSeries(track) {
  const pts = track.points || [];
  const latlngs = pts.map((p) => [p[0], p[1]]);
  const series = {
    altitude_m: pts.map((p) => p[2]),
    distance_m: pts.map((p) => p[3]),
    elapsed_s: pts.map((p) => p[4]),
    hr: pts.map((p) => p[5]),
    speed_mps: pts.map((p) => p[6]),
    cadence_spm: pts.map((p) => p[7]),
  };
  // Gradient is not stored; it is rise over run between consecutive points.
  series.gradient = pts.map((p, i) => {
    if (i === 0) return 0;
    const run = (p[3] ?? 0) - (pts[i - 1][3] ?? 0);
    const rise = (p[2] ?? 0) - (pts[i - 1][2] ?? 0);
    return run > 1 ? (100 * rise) / run : 0;
  });
  return { latlngs, series, points: pts };
}

const METRIC_META = {
  speed_mps: { label: 'Pace', invert: true, fmt: (v) => `${fmt.pace(v)} /km` },
  hr: { label: 'Heart rate', invert: false, fmt: (v) => `${fmt.n(v, 0)} bpm` },
  altitude_m: { label: 'Elevation', invert: false, fmt: (v) => `${fmt.n(v, 0)} m` },
  gradient: { label: 'Gradient', invert: false, fmt: (v) => `${fmt.n(v, 1)} %` },
};

/* Draw a track, coloured by `metric`, and return the handle the caller needs to
   redraw it when the metric changes. */
function drawTrack(map, node, legendNode, data, metric) {
  if (data.__layer) map.removeLayer(data.__layer);
  const meta = METRIC_META[metric] || METRIC_META.speed_mps;
  const values = data.series[metric] || [];
  const { layer, range } = GA_MAP.colouredTrack(map, data.latlngs, values, {
    invert: meta.invert,
  });
  data.__layer = layer;
  if (legendNode) {
    clear(legendNode);
    const lo = meta.invert ? meta.fmt(range[1]) : meta.fmt(range[0]);
    const hi = meta.invert ? meta.fmt(range[0]) : meta.fmt(range[1]);
    legendNode.append(GA_MAP.legend(lo, hi, meta.label).node);
  }
  return layer;
}

/* Chart <-> map, both directions.
 *
 * Hovering the chart moves a dot along the route; moving over the map moves the
 * chart's crosshair. Without the second direction "linked" only means half-linked.
 *
 * The chart and the track are not the same array — the chart plots every sample,
 * the track only the ones that carried a position — so the two are matched on
 * elapsed time rather than on index. Assuming index equality is the obvious bug
 * here and it silently mis-aligns whenever GPS dropped out for a few seconds.
 */
function linkChartAndMap(plot, map, data, chartX, trackX) {
  const cursor = GA_MAP.cursorMarker(map);

  const nearestTrack = (x) => {
    let lo = 0;
    let hi = trackX.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (trackX[mid] < x) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(trackX[lo - 1] - x) < Math.abs(trackX[lo] - x)) return lo - 1;
    return lo;
  };

  // uPlot builds `hooks` from opts + plugins; the array only exists if something
  // already registered for this hook, so create it rather than assume it.
  plot.hooks.setCursor = plot.hooks.setCursor || [];
  plot.hooks.setCursor.push((u) => {
    const i = u.cursor.idx;
    if (i === null || i === undefined) { cursor.hide(); return; }
    const j = nearestTrack(chartX[i]);
    if (j < 0 || !data.latlngs[j]) { cursor.hide(); return; }
    cursor.show(data.latlngs[j]);
  });

  let raf = 0;
  map.on('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const { lat, lng } = e.latlng;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < data.latlngs.length; i++) {
        const dy = data.latlngs[i][0] - lat;
        const dx = data.latlngs[i][1] - lng;
        const d = dy * dy + dx * dx;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      cursor.show(data.latlngs[best]);
      plot.setCursor({ left: plot.valToPos(trackX[best], 'x'), top: 10 });
    });
  });
  map.on('mouseout', () => cursor.hide());
  return cursor;
}

// ---------------------------------------------------------------------------
// Routes & maps
// ---------------------------------------------------------------------------

const routeState = { type: '', routeId: null, metric: 'speed_mps', data: null,
                     map: null, compareLayer: null, heatMap: null, heatLayer: null };

async function renderRoutes() {
  const data = await api('/api/routes');
  const types = [...new Set(data.routes.map((r) => r.activity_type))].sort();
  for (const sel of ['#route-type', '#heat-type']) {
    const node = $(sel);
    clear(node);
    node.append(el('option', { value: '' }, 'All types'));
    for (const t of types) node.append(el('option', { value: t }, t.replace(/_/g, ' ')));
    node.value = routeState.type;
  }
  drawRouteList(data.routes);
}

function drawRouteList(routes) {
  const shown = routeState.type
    ? routes.filter((r) => r.activity_type === routeState.type)
    : routes;
  $('#routes-count').textContent =
    `${shown.length} route${shown.length === 1 ? '' : 's'} · ` +
    `${shown.reduce((s, r) => s + r.attempts, 0)} attempts`;
  renderTable($('#table-routes'), [
    { key: 'name', label: 'Route', fmt: (v, r) => el('span', {},
      v, r.pinned ? el('span', { class: 'pill', title: 'You renamed, merged or split this' }, 'pinned') : null) },
    { key: 'activity_type', label: 'Type', fmt: (v) => v.replace(/_/g, ' ') },
    { key: 'attempts', label: 'Attempts', cls: 'num' },
    { key: 'distance_km', label: 'km', cls: 'num', fmt: (v) => fmt.n(v, 2) },
    { key: 'best_moving_time_s', label: 'Best', cls: 'num', fmt: fmt.hms },
    { key: 'avg_moving_time_s', label: 'Average', cls: 'num', fmt: fmt.hms },
    { key: 'avg_hr', label: 'Avg HR', cls: 'num', fmt: (v) => fmt.n(v, 0) },
    { key: 'first_day', label: 'First' },
    { key: 'last_day', label: 'Last' },
  ], shown, {
    onRowClick: (r) => openRoute(r.route_id, { scroll: true }).catch(showError),
    emptyText: 'No routes yet. Routes appear once activities with GPS have been clustered.',
  });
}

async function openRoute(routeId, { scroll = false } = {}) {
  routeState.routeId = routeId;
  const [detail, segments, cfg] = await Promise.all([
    api(`/api/routes/${routeId}`),
    api(`/api/routes/${routeId}/segments`),
    mapCfg(),
  ]);
  const r = detail.route;
  $('#route-detail-card').hidden = false;
  $('#route-title').textContent = r.name;
  location.hash = `routes/${routeId}`;

  clear($('#route-stats'));
  $('#route-stats').append(
    statTile('Attempts', String(detail.attempt_count),
      detail.counted_count !== detail.attempt_count
        ? `${detail.attempt_count - detail.counted_count} excluded from stats` : null),
    statTile('Distance', `${fmt.n(r.distance_km, 2)} km`, r.is_loop ? 'loop' : 'point to point'),
    statTile('Best', fmt.hms(detail.stats.best_time_s),
      detail.best_attempt ? detail.best_attempt.day : null),
    statTile('Median', fmt.hms(detail.stats.median_time_s)),
    statTile('Average pace', detail.stats.avg_pace_s_per_km
      ? `${fmt.pace(1000 / detail.stats.avg_pace_s_per_km)} /km` : '–'),
    statTile('First → last', detail.stats.improvement_s === null ? '–'
      : `${detail.stats.improvement_s > 0 ? '−' : '+'}${fmt.hms(Math.abs(detail.stats.improvement_s))}`,
      detail.stats.improvement_s > 0 ? 'faster' : 'slower'),
  );

  // --- map ---
  const attemptSel = $('#route-attempt');
  clear(attemptSel);
  for (const a of detail.attempts) {
    attemptSel.append(el('option', { value: a.activity_id },
      `${a.day} · ${fmt.hms(a.moving_time_s)}`));
  }
  const compareSel = $('#route-compare');
  clear(compareSel);
  compareSel.append(el('option', { value: '' }, '— none —'));
  for (const a of detail.attempts) {
    compareSel.append(el('option', { value: a.activity_id },
      `${a.day} · ${fmt.hms(a.moving_time_s)}`));
  }
  // Default to the best attempt: it is the one worth looking at.
  if (detail.best_attempt) attemptSel.value = detail.best_attempt.activity_id;

  if (!routeState.map) {
    routeState.map = GA_MAP.create($('#route-map'), cfg);
  }
  // The card was `hidden` until a moment ago, so Leaflet's cached size is stale.
  routeState.map.invalidateSize();
  await showAttempt(attemptSel.value);

  // --- segment profile ---
  drawSegmentProfile(segments);

  const segCols = [
    { key: 'start_m', label: 'At', fmt: (v) => `${(v / 1000).toFixed(1)} km` },
    { key: 'relative_speed', label: 'vs your average',
      fmt: (v) => fmt.pct((v - 1) * 100, 1) },
    { key: 'median_pace_s_per_km', label: 'Median pace',
      fmt: (v) => (v ? `${fmt.pace(1000 / v)} /km` : '–') },
    { key: 'median_gradient_pct', label: 'Gradient', fmt: (v) => `${fmt.n(v, 1)} %` },
    { key: 'median_hr', label: 'HR', fmt: (v) => fmt.n(v, 0) },
  ];
  renderTable($('#table-slowest'), segCols, segments.slowest_segments || []);
  renderTable($('#table-fastest'), segCols, segments.fastest_segments || []);

  renderTable($('#table-attempts'), [
    { key: 'day', label: 'Day' },
    { key: 'activity_name', label: 'Name' },
    { key: 'moving_time_s', label: 'Time', cls: 'num', fmt: fmt.hms },
    { key: 'avg_speed_mps', label: 'Pace', cls: 'num', fmt: (v) => `${fmt.pace(v)} /km` },
    { key: 'avg_hr', label: 'Avg HR', cls: 'num', fmt: (v) => fmt.n(v, 0) },
    { key: 'distance_m', label: 'km', cls: 'num', fmt: fmt.km },
    { key: 'match_score', label: 'Match', cls: 'num', fmt: (v, row) =>
      (row.assigned === 'manual' ? 'manual' : fmt.pct((v || 0) * 100, 0)) },
  ], detail.attempts, { onRowClick: (a) => openDrawer(a.activity_id).catch(showError) });

  // Only scroll when the user actually clicked a row. Following a #routes/<id>
  // link should land at the top of the page, not halfway down it.
  if (scroll) $('#route-detail-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showAttempt(activityId) {
  if (!activityId) return;
  const track = await api(`/api/activities/${encodeURIComponent(activityId)}/track`);
  if (!track.has_gps) {
    clear($('#route-legend'));
    $('#route-legend').append(el('p', { class: 'hint' }, 'That attempt has no GPS track.'));
    return;
  }
  routeState.data = trackSeries(track);
  drawTrack(routeState.map, $('#route-map'), $('#route-legend'),
    routeState.data, routeState.metric);
  GA_MAP.fit(routeState.map, routeState.data.latlngs);
}

function drawSegmentProfile(segments) {
  const segs = segments.segments || [];
  if (!segs.length) {
    clear($('#chart-segments'));
    $('#chart-segments').append(el('p', { class: 'hint' }, 'Not enough attempts to build a profile yet.'));
    return;
  }
  const x = segs.map((s) => s.start_m / 1000);
  const rel = segs.map((s) => (s.relative_speed - 1) * 100);
  const grad = segs.map((s) => s.median_gradient_pct);
  const hr = segs.map((s) => s.median_hr);
  const cad = segs.map((s) => s.median_cadence_spm);

  /* Two charts, not one. Relative speed and gradient are both small percentages and
     belong together — that pairing is the whole point, because the hills explain the
     slow bits. Heart rate is 120-180 bpm and would flatten both of them to a line at
     the bottom of the plot if it shared the axis. */
  const kmAxis = { xIsTime: false, xSpace: 50,
                   xValues: (u, vs) => vs.map((v) => `${v.toFixed(1)}km`) };

  mount('chart-segments', baseOpts(220, [
    barSeries('Speed vs your average (%)', C['series-1']),
    lineSeries('Gradient (%)', C['series-4'], { width: 1.6 }),
  ], {
    ...kmAxis,
    fmtters: { 1: (v) => `${fmt.signed(v, 1)} %`, 2: (v) => `${fmt.n(v, 1)} %` },
  }), [x, rel, grad]);

  mount('chart-segments-hr', baseOpts(190, [
    lineSeries('Median HR (bpm)', C.critical, { width: 1.6 }),
    lineSeries('Median cadence (spm)', C['series-3'], { width: 1.4, dash: [4, 4] }),
  ], {
    ...kmAxis,
    fmtters: { 1: (v) => `${fmt.n(v, 0)} bpm`, 2: (v) => `${fmt.n(v, 0)} spm` },
  }), [x, hr, cad]);
}

async function loadHeatmap() {
  const cfg = await mapCfg();
  const type = $('#heat-type').value;
  $('#heat-count').textContent = 'loading…';
  const data = await api(`/api/heatmap?precision=4${type ? `&type=${encodeURIComponent(type)}` : ''}`);
  if (!routeState.heatMap) routeState.heatMap = GA_MAP.create($('#heat-map'), cfg);
  routeState.heatMap.invalidateSize();
  if (routeState.heatLayer) routeState.heatMap.removeLayer(routeState.heatLayer);
  routeState.heatLayer = GA_MAP.heat(routeState.heatMap, data.points, data.max_count);
  $('#heat-count').textContent =
    `${data.cells.toLocaleString()} cells · busiest visited ${data.max_count.toLocaleString()} times`;
  GA_MAP.fit(routeState.heatMap, data.points.map((p) => [p[0], p[1]]));
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

const aggState = { type: '', gear_id: '', from: '', to: '' };

function aggQuery() {
  const q = new URLSearchParams();
  if (aggState.type) q.set('type', aggState.type);
  if (aggState.gear_id) q.set('gear_id', aggState.gear_id);
  if (aggState.from) q.set('start', aggState.from);
  if (aggState.to) q.set('end', aggState.to);
  return q.toString() ? `?${q}` : '';
}

async function renderAggregate() {
  const filters = await once('aggFilters', () => api('/api/aggregate/filters'));
  const typeSel = $('#agg-type');
  if (typeSel.options.length <= 1) {
    for (const t of filters.types) {
      typeSel.append(el('option', { value: t.value }, `${t.value.replace(/_/g, ' ')} (${t.n})`));
    }
    const gearSel = $('#agg-gear');
    for (const g of filters.gear) {
      const name = g.nickname || [g.brand, g.model].filter(Boolean).join(' ') || `gear ${g.gear_id}`;
      gearSel.append(el('option', { value: g.gear_id }, `${name} (${g.n})`));
    }
  }
  await loadAggregate();
}

async function loadAggregate() {
  const d = await api(`/api/aggregate${aggQuery()}`);
  const t = d.totals;

  clear($('#agg-headline'));
  $('#agg-headline').append(
    statTile('Activities', (t.activities || 0).toLocaleString(),
      t.span_years ? `over ${fmt.n(t.span_years, 1)} years` : null),
    statTile('Distance', `${(t.distance_km || 0).toLocaleString()} km`,
      t.distance_km_per_week ? `${fmt.n(t.distance_km_per_week, 1)} km/week` : null),
    statTile('Moving time', `${fmt.n(t.moving_time_h, 0)} h`),
    /* A single "average pace" across running, cycling and swimming is a number
       with no meaning. Show it, but say so, rather than quietly implying a 2:09/km
       average because rides are in the mix. */
    statTile('Average pace', t.avg_pace || '–',
      aggState.type ? (t.avg_speed_kmh ? `${fmt.n(t.avg_speed_kmh, 1)} km/h` : null)
                    : 'mixed sports — filter by type'),
    statTile('Average HR', fmt.n(t.avg_hr, 0)),
    statTile('Elevation', `${fmt.n(t.elevation_gain_m, 0)} m`),
    statTile('Average distance', t.avg_distance_km ? `${fmt.n(t.avg_distance_km, 2)} km` : '–'),
    statTile('Per week', t.activities_per_week ? fmt.n(t.activities_per_week, 1) : '–', 'activities'),
  );

  const label = aggState.type ? aggState.type.replace(/_/g, ' ') : 'trained';
  $('#agg-sentence').textContent = t.activities
    ? `You have ${label === 'running' ? 'run' : label} ${t.activities.toLocaleString()} times ` +
      `over ${fmt.n(t.span_years, 1)} years, covering ${(t.distance_km || 0).toLocaleString()} km ` +
      `in ${fmt.n(t.moving_time_h, 0)} hours` +
      (t.avg_pace ? ` at an average of ${t.avg_pace}.` : '.')
    : 'Nothing matches those filters.';

  renderTable($('#table-agg-type'), [
    { key: 'activity_type', label: 'Type', fmt: (v) => v.replace(/_/g, ' ') },
    { key: 'activities', label: 'Count', cls: 'num', fmt: (v) => v.toLocaleString() },
    { key: 'distance_km', label: 'km', cls: 'num', fmt: (v) => v.toLocaleString() },
    { key: 'moving_time_h', label: 'Hours', cls: 'num', fmt: (v) => fmt.n(v, 1) },
    { key: 'avg_distance_km', label: 'Avg km', cls: 'num', fmt: (v) => fmt.n(v, 2) },
    // Per-sport units: min/km running, km/h cycling, min/100 m swimming.
    { key: 'avg_speed_mps', label: 'Avg pace', cls: 'num',
      fmt: (v, r) => fmt.sportPace(v, r.activity_type) },
    { key: 'avg_hr', label: 'Avg HR', cls: 'num', fmt: (v) => fmt.n(v, 0) },
    { key: 'elevation_gain_m', label: 'Elev m', cls: 'num', fmt: (v) => fmt.n(v, 0) },
  ], d.by_type);

  const delta = (c) => {
    if (!c) return '–';
    return el('span', { class: c.better ? 'delta good' : 'delta bad' },
      `${c.pct > 0 ? '+' : ''}${fmt.n(c.pct, 1)}%`);
  };
  renderTable($('#table-yoy'), [
    { key: 'period', label: 'Year' },
    { key: 'activities', label: 'Count', cls: 'num' },
    { key: 'distance_km', label: 'km', cls: 'num', fmt: (v) => fmt.n(v, 0) },
    { key: 'distance_km', label: 'vs prev', cls: 'num',
      fmt: (_v, r) => delta(r.changes && r.changes.distance_km) },
    { key: 'avg_pace', label: 'Avg pace', cls: 'num' },
    { key: 'avg_pace_s_per_km', label: 'vs prev', cls: 'num',
      fmt: (_v, r) => delta(r.changes && r.changes.avg_pace_s_per_km) },
    { key: 'avg_hr', label: 'Avg HR', cls: 'num', fmt: (v) => fmt.n(v, 0) },
    { key: 'moving_time_h', label: 'Hours', cls: 'num', fmt: (v) => fmt.n(v, 0) },
  ], d.year_over_year.years);

  // --- charts ---
  const months = d.by_month;
  mount('chart-agg-month', baseOpts(200, [
    barSeries('Distance (km)', C['series-1']),
  ], { xIsTime: true, fmtters: { 1: (v) => `${fmt.n(v, 0)} km` } }),
  [months.map((m) => toTs(`${m.period}-01`)), months.map((m) => m.distance_km)]);

  const ph = d.distributions.pace;
  mount('chart-pace-hist', baseOpts(200, [
    barSeries('Activities', C['series-2']),
  ], { xIsTime: false,
       fmtters: { 1: (v) => `${fmt.n(v, 0)} activities` },
       xValues: (u, vs) => vs.map((v) => fmt.pace(1000 / v)) }),
  [ph.map((b) => b.lo), ph.map((b) => b.count)]);

  const dh = d.distributions.distance_km;
  mount('chart-dist-hist', baseOpts(200, [
    barSeries('Activities', C['series-3']),
  ], { xIsTime: false, fmtters: { 1: (v) => `${fmt.n(v, 0)} activities` } }),
  [dh.map((b) => b.lo), dh.map((b) => b.count)]);

  const zones = d.distributions.hr_zones;
  const zoneWrap = $('#agg-zones');
  clear(zoneWrap);
  const zoneMax = Math.max(1, ...zones.map((z) => z.pct));
  for (const z of zones) {
    zoneWrap.append(el('div', { class: 'zone-row' },
      el('span', {}, `Zone ${z.zone}`),
      el('div', { class: 'track' },
        el('div', { class: 'fill',
          style: `width:${(z.pct / zoneMax * 100).toFixed(1)}%;background:${ZONE_COLOURS[z.zone - 1]}` })),
      el('span', { class: 'secs' }, `${fmt.n(z.hours, 0)} h · ${fmt.pct(z.pct, 0)}`)));
  }

  const dow = d.patterns.day_of_week;
  mount('chart-dow', baseOpts(190, [
    barSeries('Activities', C['series-4']),
  ], { xIsTime: false,
       fmtters: { 1: (v) => `${fmt.n(v, 0)} activities` },
       xValues: (u, vs) => vs.map((v) => DAY_NAMES[v] || '') }),
  [dow.map((x, i) => i), dow.map((x) => x.count)]);

  const hod = d.patterns.hour_of_day;
  mount('chart-hod', baseOpts(190, [
    barSeries('Activities', C['series-5'] || C['series-2']),
  ], { xIsTime: false,
       fmtters: { 1: (v) => `${fmt.n(v, 0)} activities` },
       xValues: (u, vs) => vs.map((v) => `${String(v).padStart(2, '0')}h`) }),
  [hod.map((h) => h.hour), hod.map((h) => h.count)]);

  const season = d.patterns.month_of_year;
  mount('chart-season', baseOpts(190, [
    barSeries('Distance (km)', C['series-7'] || C['series-3']),
  ], { xIsTime: false,
       fmtters: { 1: (v) => `${fmt.n(v, 0)} km` },
       xValues: (u, vs) => vs.map((v) => MONTH_NAMES[v - 1] || '') }),
  [season.map((m) => m.month), season.map((m) => m.distance_km)]);

  drawDowHourHeatmap(d.patterns.dow_hour_matrix);

  const s = d.streaks;
  clear($('#agg-streaks'));
  $('#agg-streaks').append(
    statTile('Current streak', `${s.current} d`),
    statTile('Longest streak', `${s.longest} d`, s.longest_end ? `to ${s.longest_end}` : null),
    statTile('Active days', `${fmt.pct(s.active_pct, 0)}`, `${s.active_days} of ${s.span_days}`),
    statTile('Rest days', String(s.rest_days)),
    s.biggest_week ? statTile('Biggest week', `${fmt.n(s.biggest_week.distance_km, 0)} km`,
      `${s.biggest_week.week} · ${s.biggest_week.activities} activities`) : null,
  );

  renderTable($('#table-records'), [
    { key: 'label', label: 'Distance' },
    { key: 'time', label: 'Time', cls: 'num' },
    { key: 'pace', label: 'Pace', cls: 'num' },
    { key: 'day', label: 'Day' },
  ], d.records.best_efforts, {
    onRowClick: (r) => openDrawer(r.activity_id).catch(showError),
    emptyText: 'No best efforts — those come from activities with sample streams.',
  });

  renderTable($('#table-extremes'), [
    { key: 'label', label: 'Record' },
    { key: 'display', label: 'Value', cls: 'num' },
    { key: 'day', label: 'Day' },
    { key: 'activity_name', label: 'Activity' },
  ], d.records.extremes, {
    onRowClick: (r) => openDrawer(r.activity_id).catch(showError),
  });
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function drawDowHourHeatmap(matrix) {
  const wrap = $('#dow-hour-heatmap');
  clear(wrap);
  if (!matrix || !matrix.length) return;
  const max = Math.max(1, ...matrix.flat());
  const grid = el('div', { class: 'dh-grid' });

  grid.append(el('div', { class: 'dh-corner' }));
  for (let h = 0; h < 24; h++) {
    grid.append(el('div', { class: 'dh-head' }, h % 3 === 0 ? String(h) : ''));
  }
  for (let d = 0; d < 7; d++) {
    grid.append(el('div', { class: 'dh-row-label' }, DAY_NAMES[d]));
    for (let h = 0; h < 24; h++) {
      const n = matrix[d][h];
      grid.append(el('div', {
        class: 'dh-cell',
        title: `${DAY_NAMES[d]} ${String(h).padStart(2, '0')}:00 — ${n} activit${n === 1 ? 'y' : 'ies'}`,
        style: `background:${n ? GA_MAP.rampColour(n / max) : 'var(--surface-3)'};` +
               `opacity:${n ? 0.35 + 0.65 * (n / max) : 0.25}`,
      }));
    }
  }
  wrap.append(grid);
}

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

async function renderGear() {
  const [data, filters] = await Promise.all([
    api('/api/gear'),
    once('aggFilters', () => api('/api/aggregate/filters')),
  ]);
  drawGearCards(data.gear);

  const gearOptions = (node, includeBlank) => {
    clear(node);
    if (includeBlank) node.append(el('option', { value: '' }, '— choose gear —'));
    for (const g of data.gear) {
      node.append(el('option', { value: g.gear_id },
        `${g.display_name}${g.retired ? ' (retired)' : ''}`));
    }
  };
  gearOptions($('#bulk-gear'), true);
  gearOptions($('#default-gear'), true);

  const typeSel = $('#bulk-type');
  clear(typeSel);
  typeSel.append(el('option', { value: '' }, 'All types'));
  const dtSel = $('#default-type');
  clear(dtSel);
  for (const t of filters.types) {
    typeSel.append(el('option', { value: t.value }, t.value.replace(/_/g, ' ')));
    dtSel.append(el('option', { value: t.value }, t.value.replace(/_/g, ' ')));
  }

  renderTable($('#table-defaults'), [
    { key: 'activity_type', label: 'Activity type', fmt: (v) => v.replace(/_/g, ' ') },
    { key: 'display_name', label: 'Gear' },
    { key: 'kind', label: 'Kind' },
    { key: 'gear_id', label: '', fmt: (v, r) => el('button', {
      class: 'ghost small',
      onclick: async (e) => {
        e.stopPropagation();
        await send('DELETE', `/api/gear/defaults/${encodeURIComponent(r.activity_type)}/${v}`);
        refreshPanel('gear');
      },
    }, 'Remove') },
  ], data.defaults, { emptyText: 'No defaults set.' });
}

function drawGearCards(gear) {
  const wrap = $('#gear-cards');
  clear(wrap);
  const showRetired = $('#gear-show-retired').checked;
  const shown = showRetired ? gear : gear.filter((g) => !g.retired);
  if (!shown.length) {
    wrap.append(el('p', { class: 'hint' }, 'No gear yet. Add a pair of shoes or a bike.'));
    return;
  }
  for (const g of shown) {
    const pct = g.retirement_pct;
    const bar = el('div', { class: 'wear' },
      el('div', { class: `wear-fill ${g.state}`,
        style: `width:${Math.min(100, pct || 0).toFixed(1)}%` }));
    wrap.append(el('div', { class: `gear-card ${g.state}` },
      el('div', { class: 'gear-head' },
        el('div', {},
          el('strong', {}, g.display_name),
          el('span', { class: 'pill' }, g.kind),
          g.retired ? el('span', { class: 'pill warn' }, 'retired') : null,
          g.state === 'over' ? el('span', { class: 'pill bad' }, 'past threshold') : null,
          g.state === 'warn' ? el('span', { class: 'pill warn' }, 'near threshold') : null),
        el('div', { class: 'gear-actions' },
          el('button', { class: 'ghost small',
            onclick: () => editGear(g).catch(showError) }, 'Edit'),
          el('button', { class: 'ghost small',
            onclick: () => toggleRetire(g).catch(showError) },
            g.retired ? 'Un-retire' : 'Retire'),
          el('button', { class: 'ghost small danger',
            onclick: () => removeGear(g).catch(showError) }, 'Delete'))),
      el('div', { class: 'gear-sub' },
        [g.brand, g.model].filter(Boolean).join(' ') || '—',
        g.purchase_date ? ` · bought ${g.purchase_date}` : ''),
      el('div', { class: 'stats compact' },
        statTile('Distance', `${fmt.n(g.total_distance_km, 1)} km`,
          g.initial_distance_m ? `incl. ${fmt.n(g.initial_distance_m / 1000, 0)} km offset` : null),
        statTile('Activities', String(g.activity_count)),
        statTile('Hours', fmt.n(g.moving_time_s / 3600, 1)),
        statTile('Per week', g.distance_per_week_km ? `${fmt.n(g.distance_per_week_km, 1)} km` : '–'),
        statTile('Used', g.first_use ? `${g.first_use} →` : '–', g.last_use || null),
        pct === null
          ? statTile('Threshold', 'none set')
          : statTile('Worn', fmt.pct(pct, 0),
              g.remaining_m > 0 ? `${fmt.n(g.remaining_m / 1000, 0)} km left` : 'over threshold')),
      pct === null ? null : bar));
  }
}

async function editGear(g) {
  const form = gearForm(g);
  if (!form) return;
  await send('PATCH', `/api/gear/${g.gear_id}`, form);
  refreshPanel('gear');
}

async function toggleRetire(g) {
  await send('PATCH', `/api/gear/${g.gear_id}`, { retired: !g.retired });
  refreshPanel('gear');
}

async function removeGear(g) {
  if (!window.confirm(
    `Delete "${g.display_name}"? Its ${g.activity_count} activity assignments go too. ` +
    'The activities themselves are untouched.')) return;
  await send('DELETE', `/api/gear/${g.gear_id}`);
  refreshPanel('gear');
}

/* Prompt-driven editing. Not pretty, but it is honest about being a POC and it
   keeps the whole gear CRUD surface inside one no-build page. */
function gearForm(existing) {
  const ask = (label, current) => {
    const v = window.prompt(label, current === null || current === undefined ? '' : String(current));
    return v === null ? undefined : v.trim();
  };
  const nickname = ask('Nickname (what you call it)', existing ? existing.nickname : '');
  if (nickname === undefined) return null;
  const brand = ask('Brand', existing ? existing.brand : '');
  if (brand === undefined) return null;
  const model = ask('Model', existing ? existing.model : '');
  if (model === undefined) return null;
  const kind = ask('Kind: shoe / bike / strap / other', existing ? existing.kind : 'shoe');
  if (kind === undefined) return null;
  const purchase = ask('Purchase date (YYYY-MM-DD, blank for none)',
    existing ? existing.purchase_date : '');
  if (purchase === undefined) return null;
  const initial = ask('Distance already on it, km', existing
    ? (existing.initial_distance_m || 0) / 1000 : 0);
  if (initial === undefined) return null;
  const threshold = ask('Retire at, km (blank for no limit)', existing && existing.retirement_distance_m
    ? existing.retirement_distance_m / 1000 : '');
  if (threshold === undefined) return null;

  return {
    nickname: nickname || null,
    brand: brand || null,
    model: model || null,
    kind: kind || 'other',
    purchase_date: purchase || null,
    initial_distance_m: (parseFloat(initial) || 0) * 1000,
    retirement_distance_m: threshold ? parseFloat(threshold) * 1000 : null,
  };
}

async function bulkAssign(dryRun) {
  const gearId = $('#bulk-gear').value;
  if (!gearId) { $('#bulk-result').textContent = 'Choose a piece of gear first.'; return; }
  const body = {
    activity_type: $('#bulk-type').value || null,
    start: $('#bulk-from').value || null,
    end: $('#bulk-to').value || null,
    only_unassigned: $('#bulk-unassigned').checked,
    dry_run: dryRun,
  };
  const res = await send('POST', `/api/gear/${gearId}/bulk-assign`, body);
  $('#bulk-result').textContent = dryRun
    ? `Would apply to ${res.matched} activities. Press Apply to do it.`
    : `Applied to ${res.applied} activities.`;
  if (!dryRun) refreshPanel('gear');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let syncTimer = null;

async function renderSettings() {
  await Promise.all([refreshGarmin(), refreshSync(), refreshOverrides(), refreshAbout()]);
}

async function refreshGarmin() {
  const s = await api('/api/garmin/status');
  clear($('#garmin-state'));
  $('#garmin-state').append(
    statTile('Garmin account', s.connected ? 'connected' : 'not connected',
      s.tokens_updated_at ? `token refreshed ${s.tokens_updated_at.slice(0, 10)}` : null),
    statTile('Token cache', s.token_dir.length > 34 ? `…${s.token_dir.slice(-32)}` : s.token_dir),
  );
}

async function refreshSync() {
  const [status, estimate] = await Promise.all([
    api('/api/sync/status'), api('/api/sync/estimate'),
  ]);
  clear($('#sync-estimate'));
  $('#sync-estimate').append(
    statTile('History span', `${estimate.days.toLocaleString()} days`,
      `${estimate.first_day} → ${estimate.last_day}`),
    statTile('Streams to fetch', estimate.activities_pending_details.toLocaleString(), 'activities'),
    statTile('Estimated requests', estimate.estimated_requests.toLocaleString()),
    statTile('Estimated time', estimate.estimated_low, `up to ${estimate.estimated_high}`),
    statTile('State', status.state, status.phase || null),
  );

  const running = status.state === 'running';
  $('#sync-progress-wrap').hidden = !(running || status.state === 'done' || status.state === 'error');
  if (!$('#sync-progress-wrap').hidden) {
    $('#sync-progress-fill').style.width = `${status.pct || 0}%`;
    $('#sync-progress-text').textContent =
      `${status.phase || '—'}: ${status.done}/${status.total ?? '?'} ` +
      `${status.eta ? `· ETA ${status.eta}` : ''} ${status.message || ''}`.trim();
  }

  renderTable($('#table-watermarks'), [
    { key: 'endpoint', label: 'Endpoint' },
    { key: 'last_day', label: 'Synced to' },
    { key: 'status', label: 'Status' },
    { key: 'last_run_at', label: 'Last run' },
    { key: 'note', label: 'Note' },
  ], status.watermarks || [], { emptyText: 'Nothing synced yet.' });

  clearTimeout(syncTimer);
  if (running) syncTimer = setTimeout(() => refreshSync().catch(showError), 2000);
}

async function refreshOverrides() {
  const s = await api('/api/overrides');
  clear($('#override-stats'));
  $('#override-stats').append(
    statTile('Edits', String(s.total)),
    statTile('Activities edited', String(s.activities_edited)),
    statTile('Editable fields', String(s.fields.length)),
  );
  renderTable($('#table-override-fields'), [
    { key: 'field', label: 'Field' },
    { key: 'n', label: 'Edits', cls: 'num' },
  ], s.by_field, { emptyText: 'No edits yet.' });
}

async function refreshAbout() {
  const [cfg, health] = await Promise.all([
    once('config', () => api('/api/config')), api('/api/health'),
  ]);
  renderTable($('#table-about'), [
    { key: 'k', label: 'Setting' }, { key: 'v', label: 'Value' },
  ], [
    { k: 'Version', v: cfg.version },
    { k: 'Database', v: health.db },
    { k: 'Data range', v: `${health.day_range.from ?? '?'} → ${health.day_range.to ?? '?'}` },
    { k: 'Data source', v: health.synthetic ? 'synthetic seed' : 'your Garmin account' },
    { k: 'Password protection', v: cfg.auth_required ? 'on' : 'OFF — no APP_PASSWORD set' },
    { k: 'Map tiles', v: cfg.map.tile_url },
    { k: 'Race', v: `${cfg.race.name} · ${cfg.race.date}` },
    { k: 'HR rest / max', v: `${cfg.athlete.hr_rest} / ${cfg.athlete.hr_max}` },
  ]);
}

async function connectGarmin(e) {
  e.preventDefault();
  const result = $('#garmin-result');
  const mfaRow = $('#mfa-row');
  const btn = $('#garmin-connect');
  btn.disabled = true;
  try {
    if (!mfaRow.hidden && $('#garmin-mfa').value.trim()) {
      const res = await send('POST', '/api/garmin/mfa', {
        challenge_id: mfaRow.dataset.challenge,
        code: $('#garmin-mfa').value.trim(),
      });
      result.textContent = `Connected as ${res.display_name}.`;
      mfaRow.hidden = true;
    } else {
      const res = await send('POST', '/api/garmin/login', {
        email: $('#garmin-email').value.trim(),
        password: $('#garmin-password').value,
      });
      if (res.status === 'mfa_required') {
        mfaRow.hidden = false;
        mfaRow.dataset.challenge = res.challenge_id;
        result.textContent = 'Garmin wants a multi-factor code. Enter it and press Connect again.';
        $('#garmin-mfa').focus();
      } else {
        result.textContent = `Connected as ${res.display_name}.`;
      }
    }
  } catch (err) {
    result.textContent = String(err.message || err);
    // A 503 is Garmin refusing this host, not a wrong password. Open the alternative
    // rather than leaving them to retype a password that was never the problem.
    if (err && err.status === 503) $('#garmin-browser').open = true;
  } finally {
    // The password is never kept around after the exchange, not even in the DOM.
    $('#garmin-password').value = '';
    btn.disabled = false;
    await refreshGarmin();
  }
}

// --- browser sign-in ---------------------------------------------------------
//
// Garmin's own page does the part only a browser can do. What comes back is a
// single-use CAS ticket, which the server exchanges for tokens. No password here.

async function openGarminSignin() {
  const { url } = await api('/api/garmin/signin-url');
  const result = $('#garmin-ticket-result');
  // Popup blockers are common and silent; say so rather than appearing to do nothing.
  if (!window.open(url, '_blank', 'noopener')) {
    result.textContent = 'Your browser blocked the popup. Open this address manually: ' + url;
    return;
  }
  result.textContent = 'Sign in on the new tab, then paste the resulting address below.';
}

async function submitGarminTicket() {
  const field = $('#garmin-ticket');
  const result = $('#garmin-ticket-result');
  const btn = $('#garmin-ticket-submit');
  const ticket = field.value.trim();
  if (!ticket) {
    result.textContent = 'Paste the address bar contents first.';
    return;
  }
  btn.disabled = true;
  result.textContent = 'Exchanging the ticket…';
  try {
    const res = await send('POST', '/api/garmin/ticket', { ticket });
    result.textContent = `Connected as ${res.display_name}.`;
  } catch (err) {
    result.textContent = String(err.message || err);
  } finally {
    // The ticket is a credential for as long as it lives. Do not leave it in the DOM.
    field.value = '';
    btn.disabled = false;
    await refreshGarmin();
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Force a panel to re-render next time it is shown, and now if it is visible. */
function refreshPanel(name) {
  rendered.delete(name);
  if (!$(`#panel-${name}`).hidden) showPanel(name).catch(showError);
}

const RENDERERS = {
  overview: renderOverview,
  load: renderLoad,
  recovery: renderRecovery,
  activities: renderActivities,
  routes: renderRoutes,
  performance: renderPerformance,
  aggregate: renderAggregate,
  gear: renderGear,
  race: renderRace,
  settings: renderSettings,
};
const rendered = new Set();

async function showPanel(name) {
  for (const btn of $$('#tabs button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.panel === name));
  }
  for (const panel of $$('.panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  if (!rendered.has(name)) {
    rendered.add(name);
    try {
      await RENDERERS[name]();
    } catch (err) {
      rendered.delete(name);
      showError(err);
    }
  }
  // A chart sized while its panel was hidden has width 0; fix it on reveal.
  requestAnimationFrame(() => {
    for (const c of charts) {
      const w = c.node.clientWidth;
      if (w > 10 && Math.abs(w - c.plot.width) > 2) c.plot.setSize({ width: w, height: c.plot.height });
    }
  });
}

async function boot() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-panel]');
    if (btn) showPanel(btn.dataset.panel).catch(showError);
  });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  const reload = () => { actState.offset = 0; loadActivities().catch(showError); };
  $('#filter-type').addEventListener('change', (e) => { actState.type = e.target.value; reload(); });
  $('#filter-from').addEventListener('change', (e) => { actState.from = e.target.value; reload(); });
  $('#filter-to').addEventListener('change', (e) => { actState.to = e.target.value; reload(); });
  let qTimer;
  $('#filter-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { actState.q = e.target.value.trim(); reload(); }, 220);
  });
  $('#filter-clear').addEventListener('click', () => {
    Object.assign(actState, { type: '', q: '', from: '', to: '', offset: 0 });
    $('#filter-type').value = ''; $('#filter-q').value = '';
    $('#filter-from').value = ''; $('#filter-to').value = '';
    loadActivities().catch(showError);
  });
  $('#page-prev').addEventListener('click', () => {
    actState.offset = Math.max(0, actState.offset - actState.limit);
    loadActivities().catch(showError);
  });
  $('#page-next').addEventListener('click', () => {
    actState.offset += actState.limit;
    loadActivities().catch(showError);
  });

  // --- routes ---
  $('#route-type').addEventListener('change', (e) => {
    routeState.type = e.target.value;
    refreshPanel('routes');
  });
  $('#route-back').addEventListener('click', () => {
    $('#route-detail-card').hidden = true;
    routeState.routeId = null;
    history.replaceState(null, '', '#routes');
  });
  $('#route-metric').addEventListener('change', (e) => {
    routeState.metric = e.target.value;
    if (routeState.data) {
      drawTrack(routeState.map, $('#route-map'), $('#route-legend'),
        routeState.data, routeState.metric);
    }
  });
  $('#route-attempt').addEventListener('change', (e) => {
    showAttempt(e.target.value).catch(showError);
  });
  $('#route-compare').addEventListener('change', async (e) => {
    if (routeState.compareLayer) {
      routeState.map.removeLayer(routeState.compareLayer);
      routeState.compareLayer = null;
    }
    if (!e.target.value) return;
    try {
      const other = await api(`/api/activities/${encodeURIComponent(e.target.value)}/track`);
      if (!other.has_gps) return;
      routeState.compareLayer = GA_MAP.plainTrack(
        routeState.map, other.points.map((p) => [p[0], p[1]]),
        C['text-secondary'], { dash: '6 5', weight: 3, opacity: 0.9 });
    } catch (err) { showError(err); }
  });
  $('#route-rename').addEventListener('click', async () => {
    if (!routeState.routeId) return;
    const name = window.prompt('Name this route', $('#route-title').textContent);
    if (!name) return;
    try {
      await send('PATCH', `/api/routes/${routeState.routeId}`, { name });
      const id = routeState.routeId;
      refreshPanel('routes');
      await openRoute(id);
    } catch (err) { showError(err); }
  });
  $('#route-merge').addEventListener('click', async () => {
    if (!routeState.routeId) return;
    const { routes } = await api('/api/routes');
    const others = routes.filter((r) => r.route_id !== routeState.routeId);
    const list = others.map((r) => `${r.route_id}: ${r.name} (${r.attempts})`).join('\n');
    const pick = window.prompt(
      `Merge which route INTO "${$('#route-title').textContent}"?\nEnter a route id.\n\n${list}`);
    if (!pick) return;
    try {
      await send('POST', `/api/routes/${routeState.routeId}/merge`,
        { route_ids: [parseInt(pick, 10)] });
      const id = routeState.routeId;
      refreshPanel('routes');
      await openRoute(id);
    } catch (err) { showError(err); }
  });
  $('#route-recluster').addEventListener('click', async () => {
    if (!window.confirm('Re-run clustering? Routes you have renamed, merged or split '
      + 'are pinned and will not be touched.')) return;
    try {
      const res = await send('POST', '/api/routes/recluster', {});
      refreshPanel('routes');
      $('#routes-count').textContent =
        `${res.routes} routes · ${res.created} new, ${res.joined} matched, ${res.kept_manual} left alone`;
    } catch (err) { showError(err); }
  });
  $('#heat-load').addEventListener('click', () => loadHeatmap().catch(showError));

  // --- aggregates ---
  const aggReload = () => loadAggregate().catch(showError);
  $('#agg-type').addEventListener('change', (e) => { aggState.type = e.target.value; aggReload(); });
  $('#agg-gear').addEventListener('change', (e) => { aggState.gear_id = e.target.value; aggReload(); });
  $('#agg-from').addEventListener('change', (e) => { aggState.from = e.target.value; aggReload(); });
  $('#agg-to').addEventListener('change', (e) => { aggState.to = e.target.value; aggReload(); });
  $('#agg-clear').addEventListener('click', () => {
    Object.assign(aggState, { type: '', gear_id: '', from: '', to: '' });
    $('#agg-type').value = ''; $('#agg-gear').value = '';
    $('#agg-from').value = ''; $('#agg-to').value = '';
    aggReload();
  });

  // --- gear ---
  $('#gear-show-retired').addEventListener('change', () => refreshPanel('gear'));
  $('#gear-add').addEventListener('click', async () => {
    const form = gearForm(null);
    if (!form) return;
    try {
      await send('POST', '/api/gear', form);
      refreshPanel('gear');
    } catch (err) { showError(err); }
  });
  $('#bulk-preview').addEventListener('click', () => bulkAssign(true).catch(showError));
  $('#bulk-apply').addEventListener('click', () => bulkAssign(false).catch(showError));
  $('#default-add').addEventListener('click', async () => {
    const gearId = $('#default-gear').value;
    if (!gearId) return;
    try {
      await send('POST', '/api/gear/defaults',
        { activity_type: $('#default-type').value, gear_id: Number(gearId) });
      refreshPanel('gear');
    } catch (err) { showError(err); }
  });

  // --- settings ---
  $('#garmin-form').addEventListener('submit', (e) => connectGarmin(e).catch(showError));
  $('#garmin-disconnect').addEventListener('click', async () => {
    if (!window.confirm('Delete the stored Garmin token cache?')) return;
    try {
      await send('POST', '/api/garmin/disconnect');
      await refreshGarmin();
    } catch (err) { showError(err); }
  });
  $('#garmin-signin-url').addEventListener('click', () => openGarminSignin().catch(showError));
  $('#garmin-ticket-submit').addEventListener('click', () => submitGarminTicket().catch(showError));
  $('#sync-start').addEventListener('click', async () => {
    try {
      await send('POST', '/api/sync/start', {});
      await refreshSync();
    } catch (err) { showError(err); }
  });
  $('#sync-stop').addEventListener('click', async () => {
    try { await send('POST', '/api/sync/stop'); await refreshSync(); }
    catch (err) { showError(err); }
  });
  $('#sync-refresh').addEventListener('click', () => refreshSync().catch(showError));
  $('#logout').addEventListener('click', async () => {
    await send('POST', '/api/auth/logout');
    window.location.href = '/login';
  });

  try {
    const health = await api('/api/health');
    $('#subtitle').textContent =
      `${health.day_range.from ?? '?'} → ${health.day_range.to ?? '?'} · v${health.version}`;
    if (health.synthetic) $('#synthetic-banner').classList.add('show');
    document.body.dataset.ready = '1';   // the headless/scripted check keys on this
  } catch (err) {
    showError(err);
  }

  const [initial, deepLinked] = location.hash.slice(1).split('/');
  await showPanel(RENDERERS[initial] ? initial : 'overview');
  if (initial === 'activities' && deepLinked) {
    await openDrawer(decodeURIComponent(deepLinked)).catch(showError);
  }
  if (initial === 'routes' && deepLinked) {
    await openRoute(parseInt(deepLinked, 10)).catch(showError);
  }
}

document.addEventListener('DOMContentLoaded', boot);
