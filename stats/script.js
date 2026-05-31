// ============================================================
//  TUTEL SIGHTINGS — stats/script.js
// ============================================================

// ── Chart.js global defaults ──────────────────────────────────
Chart.defaults.color                           = '#8b92a8';
Chart.defaults.font.family                     = "'DM Mono', monospace";
Chart.defaults.font.size                       = 11;
Chart.defaults.plugins.legend.display         = false;
Chart.defaults.plugins.tooltip.backgroundColor = '#1c2130';
Chart.defaults.plugins.tooltip.borderColor     = 'rgba(255,255,255,0.13)';
Chart.defaults.plugins.tooltip.borderWidth     = 1;
Chart.defaults.plugins.tooltip.titleColor      = '#f0f2f8';
Chart.defaults.plugins.tooltip.bodyColor       = '#8b92a8';
Chart.defaults.plugins.tooltip.padding         = 10;
Chart.defaults.plugins.tooltip.cornerRadius    = 8;

// Generic palette for things that don't have entries in colors.json (years, etc.)
const PALETTE = [
  '#22c55e','#3b82f6','#f59e0b','#ec4899','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#e11d48','#0ea5e9',
  '#a855f7','#10b981','#eab308','#6366f1','#f43f5e',
];

// ── Color lookup (populated after colors.json loads) ─────────
let colors = {};
function getColor(category, key) {
  return (colors[category] && colors[category][key]) || colors.fallback || '#838c9e';
}

// ── Helpers ───────────────────────────────────────────────────
function vodDuration(vod) {
  if (vod.timestamp_seconds == null || vod.timestamp_end_seconds == null) return null;
  return vod.timestamp_end_seconds - vod.timestamp_seconds;
}

function entryDuration(entry) {
  const durations = entry.vods.map(vodDuration).filter(d => d !== null);
  if (!durations.length) return null;
  if (entry.vods.length === 1 || entry.vod_type === 'parts') {
    return durations.reduce((a, b) => a + b, 0);
  }
  return Math.max(...durations);
}

function fmtHours(secs) {
  const h = secs / 3600;
  return h >= 10 ? Math.round(h) + 'h' : h.toFixed(1) + 'h';
}

function topN(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ── Chart factories ───────────────────────────────────────────
const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#8b92a8';

const xAxisBase = {
  grid:   { color: gridColor },
  ticks:  { color: tickColor },
  border: { color: 'transparent' },
};
const yAxisBase = {
  grid:        { color: gridColor },
  ticks:       { color: tickColor },
  border:      { color: 'transparent' },
  beginAtZero: true,
};

function makeBar(id, labels, values, colors, opts = {}) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: opts.horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => opts.tooltipFmt ? opts.tooltipFmt(ctx.raw) : ` ${ctx.raw}`,
          },
        },
      },
      scales: opts.horizontal ? {
        x: { ...yAxisBase, ticks: { ...yAxisBase.ticks, callback: opts.xTickFmt || (v => v) } },
        y: { ...xAxisBase, ticks: { color: tickColor, font: { size: 11 } } },
      } : {
        x: xAxisBase,
        y: { ...yAxisBase, ticks: { ...yAxisBase.ticks, callback: opts.yTickFmt || (v => v) } },
      },
    },
  });
}

function makeDonut(id, labels, values, colorList) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colorList.map(c => c + 'cc'),
        borderColor: colorList,
        borderWidth: 1,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            color: '#8b92a8',
            font: { size: 11, family: "'DM Mono', monospace" },
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 3,
            padding: 10,
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw}`,
          },
        },
      },
    },
  });
}

// ── Main ──────────────────────────────────────────────────────
async function init() {
  let data;
  try {
    const [appearanceRes, colorRes] = await Promise.all([
      fetch('../data/appearances.json'),
      fetch('../data/colors.json'),
    ]);
    if (!appearanceRes.ok || !colorRes.ok) throw new Error('fetch failed');
    data = await appearanceRes.json();
    const colorData = await colorRes.json();
    colors = Array.isArray(colorData) ? colorData[0] : colorData;
  } catch (e) {
    document.getElementById('loading-msg').innerHTML =
      '<span>⚠️</span>Could not load data files.';
    return;
  }

  // ── Crunch ─────────────────────────────────────────────────
  const byYear         = {};  // year → { count, secs }
  const byPartnerCount = {};  // partner → collab count
  const byPartnerSecs  = {};  // partner → screen-time secs
  const byGame         = {};  // game → count
  const byActivity     = {};  // activity → count
  const byWeight       = {};  // weight → count
  let   totalSecs      = 0;

  data.forEach(entry => {
    const year = entry.date ? entry.date.slice(0, 4) : 'Unknown';
    if (!byYear[year]) byYear[year] = { count: 0, secs: 0 };
    byYear[year].count++;

    const dur = entryDuration(entry);
    if (dur != null) {
      byYear[year].secs += dur;
      totalSecs += dur;
      entry.collab_partners.forEach(p => {
        byPartnerSecs[p] = (byPartnerSecs[p] || 0) + dur;
      });
    }

    entry.collab_partners.forEach(p => {
      byPartnerCount[p] = (byPartnerCount[p] || 0) + 1;
    });
    entry.games.forEach(g => {
      byGame[g] = (byGame[g] || 0) + 1;
    });
    entry.activities.forEach(a => {
      byActivity[a] = (byActivity[a] || 0) + 1;
    });
    byWeight[entry.appearance_weight] = (byWeight[entry.appearance_weight] || 0) + 1;
  });

  // ── Derived values ─────────────────────────────────────────
  const totalEntries   = data.length;
  const totalHours     = fmtHours(totalSecs);
  const uniquePartners = Object.keys(byPartnerCount).length;
  const uniqueGames    = Object.keys(byGame).length;

  const years      = Object.keys(byYear).sort();
  const yearCounts = years.map(y => byYear[y].count);
  const yearSecs   = years.map(y => byYear[y].secs);

  const TOP        = 10;
  const topByCount = topN(byPartnerCount, TOP);
  const topBySecs  = topN(byPartnerSecs,  TOP);

  const TOP_GAMES   = 8;
  const gamesSorted = Object.entries(byGame).sort((a, b) => b[1] - a[1]);
  const topGames    = gamesSorted.slice(0, TOP_GAMES);
  const otherGames  = gamesSorted.slice(TOP_GAMES).reduce((s, [, v]) => s + v, 0);
  if (otherGames > 0) topGames.push(['Other', otherGames]);

  // ── Render HTML ────────────────────────────────────────────
  document.getElementById('stats-main').innerHTML = `
    <div class="page-heading">
      <h2>Archive Stats</h2>
      <p>Computed from ${totalEntries} sighting entries · updates automatically as the archive grows</p>
    </div>

    <div class="summary-row">
      <div class="summary-pill">
        <div class="summary-pill-value">${totalEntries}</div>
        <div class="summary-pill-label">Total sightings</div>
      </div>
      <div class="summary-pill">
        <div class="summary-pill-value">${totalHours}</div>
        <div class="summary-pill-label">Screen time</div>
      </div>
      <div class="summary-pill">
        <div class="summary-pill-value">${uniquePartners}</div>
        <div class="summary-pill-label">Collab partners</div>
      </div>
      <div class="summary-pill">
        <div class="summary-pill-value">${uniqueGames}</div>
        <div class="summary-pill-label">Games played</div>
      </div>
    </div>

    <div class="chart-grid">

      <div class="chart-card">
        <div>
          <div class="chart-title">Collabs per year</div>
          <div class="chart-subtitle">Number of Vedal sightings by year</div>
        </div>
        <div class="chart-wrap"><canvas id="c-year-count"></canvas></div>
      </div>

      <div class="chart-card">
        <div>
          <div class="chart-title">Screen time per year</div>
          <div class="chart-subtitle">Total Vedal on-screen hours by year</div>
        </div>
        <div class="chart-wrap"><canvas id="c-year-time"></canvas></div>
      </div>

      <div class="chart-card chart-card--tall">
        <div>
          <div class="chart-title">Top collab partners — by appearances</div>
          <div class="chart-subtitle">How many times each streamer hosted Vedal</div>
        </div>
        <div class="chart-wrap"><canvas id="c-partner-count"></canvas></div>
      </div>

      <div class="chart-card chart-card--tall">
        <div>
          <div class="chart-title">Top collab partners — by screen time</div>
          <div class="chart-subtitle">Total Vedal on-screen hours per streamer</div>
        </div>
        <div class="chart-wrap"><canvas id="c-partner-time"></canvas></div>
      </div>

      <div class="chart-card chart-card--wide chart-card--tall">
        <div>
          <div class="chart-title">Games played</div>
          <div class="chart-subtitle">Number of sightings per game · titles with fewer than 2 sessions grouped into Other</div>
        </div>
        <div class="chart-wrap"><canvas id="c-games"></canvas></div>
      </div>

      <div class="chart-card chart-card--donut">
        <div>
          <div class="chart-title">Activities</div>
          <div class="chart-subtitle">Tag frequency across all sightings</div>
        </div>
        <div class="chart-wrap"><canvas id="c-activities"></canvas></div>
      </div>

      <div class="chart-card chart-card--donut">
        <div>
          <div class="chart-title">Appearance weight</div>
          <div class="chart-subtitle">Full · Partial · Cameo breakdown</div>
        </div>
        <div class="chart-wrap"><canvas id="c-weight"></canvas></div>
      </div>

    </div>
  `;

  // ── Render charts ──────────────────────────────────────────

  // Years — no colors.json entry, use generic palette
  makeBar('c-year-count', years, yearCounts,
    years.map((_, i) => PALETTE[i % PALETTE.length])
  );

  makeBar('c-year-time', years, yearSecs.map(s => Math.round(s / 3600)),
    years.map((_, i) => PALETTE[i % PALETTE.length]),
    {
      yTickFmt:   v => v + 'h',
      tooltipFmt: v => ` ${v}h on-screen`,
    }
  );

  // Partners — use colors.json collab_partners
  makeBar('c-partner-count',
    topByCount.map(([n])   => n),
    topByCount.map(([, v]) => v),
    topByCount.map(([n])   => getColor('collab_partners', n) + 'cc'),
    {
      horizontal: true,
      tooltipFmt: v => ` ${v} appearances`,
    }
  );

  makeBar('c-partner-time',
    topBySecs.map(([n])   => n),
    topBySecs.map(([, v]) => Math.round(v / 3600)),
    topBySecs.map(([n])   => getColor('collab_partners', n) + 'cc'),
    {
      horizontal: true,
      xTickFmt:   v => v + 'h',
      tooltipFmt: v => ` ${v}h on-screen`,
    }
  );

  // Games — use colors.json games; fallback for "Other"
  makeBar('c-games',
    topGames.map(([g])   => g),
    topGames.map(([, v]) => v),
    topGames.map(([g])   => getColor('games', g) + 'cc'),
    {
      horizontal: true,
      tooltipFmt: v => ` ${v} session${v === 1 ? '' : 's'}`,
    }
  );

  // Appearance weight — use colors.json appearance_weight
  const weightOrder = ['Full', 'Partial', 'Cameo'];
  makeDonut('c-weight',
    weightOrder,
    weightOrder.map(w  => byWeight[w] || 0),
    weightOrder.map(w  => getColor('appearance_weight', w))
  );

  // Activities — use colors.json activities
  const actSorted = Object.entries(byActivity).sort((a, b) => b[1] - a[1]);
  makeDonut('c-activities',
    actSorted.map(([a])   => a),
    actSorted.map(([, v]) => v),
    actSorted.map(([a])   => getColor('activities', a))
  );

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/tutel-sightings/sw.js');
  }
}

init();
