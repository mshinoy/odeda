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
    if (type === 'cycling') return `${(mps * 3.6).toFixed(1)} km/h`;
    if (type === 'swimming') {
      const s = 100 / mps;
      return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100m`;
    }
    if (type === 'running' || type === 'walking') return `${fmt.pace(mps)} /km`;
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

function baseOpts(height, seriesOpts, { fmtters, yLabel, yRange, xIsTime = true } = {}) {
  return {
    height,
    padding: [10, 10, 0, 0],
    cursor: { x: true, y: false, points: { size: 9 }, drag: { x: true, y: false } },
    legend: { show: false },
    scales: { x: { time: xIsTime }, y: yRange ? { range: yRange } : {} },
    axes: [
      axisBase({ space: 70 }),
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
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  if (location.hash.startsWith('#activities/')) history.replaceState(null, '', '#activities');
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
// Boot
// ---------------------------------------------------------------------------

const RENDERERS = {
  overview: renderOverview,
  load: renderLoad,
  recovery: renderRecovery,
  activities: renderActivities,
  performance: renderPerformance,
  race: renderRace,
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
}

document.addEventListener('DOMContentLoaded', boot);
