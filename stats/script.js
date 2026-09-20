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
function entryDuration(entry) {
  // Sum per-streamer, then take the max across streamers.
  // (Single streamer = just the sum. Multiple POVs = longest one.)
  const perStreamer = {};
  for (const vod of entry.vods) {
    if (vod.timestamp_seconds == null || vod.timestamp_end_seconds == null) continue;
    const dur = vod.timestamp_end_seconds - vod.timestamp_seconds;
    perStreamer[vod.streamer] = (perStreamer[vod.streamer] || 0) + dur;
  }
  const totals = Object.values(perStreamer);
  return totals.length ? Math.max(...totals) : null;
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

function pct(n, total) {
  return Math.round((n / total) * 100);
}

function makePseudoTitle(entry) {
  const CAP = 5;
  function joinList(arr) {
    if (arr.length <= CAP) {
      if (arr.length === 1) return arr[0];
      return arr.slice(0, -1).join(', ') + ' & ' + arr[arr.length - 1];
    }
    return arr.slice(0, CAP).join(', ') + ` & ${arr.length - CAP} more`;
  }

  const partners = joinList(entry.collab_partners);
  const games    = entry.games || [];
  const acts     = (entry.activities || []).filter(a => a !== 'Gaming');

  let left;
  if (games.length > 0) {
    left = joinList(games);
    if (acts.length > 0) left += ` (+ ${joinList(acts)})`;
  } else {
    left = acts.length > 0 ? joinList(acts) : 'Just Chatting';
  }

  return `${left} w/ ${partners}`;
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
            label: ctx => opts.tooltipFmt ? opts.tooltipFmt(ctx.raw, ctx.dataIndex) : ` ${ctx.raw}`,
          },
        },
      },
      scales: opts.horizontal ? {
        x: { ...yAxisBase, max: opts.maxX, ticks: { ...yAxisBase.ticks, callback: opts.xTickFmt || (v => v) } },
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
            title: () => '',
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${ctx.label}: ${ctx.raw} (${Math.round((ctx.raw / total) * 100)}%)`;
            },
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
  let   safariCount    = 0;

  const SAFARI_LAUNCH = '2023-09-04';

  data.forEach(entry => {
    const year = entry.date ? entry.date.slice(0, 4) : 'Unknown';
    if (!byYear[year]) byYear[year] = { count: 0, secs: 0 };
    byYear[year].count++;

    const safariEligible = entry.date && entry.date >= SAFARI_LAUNCH;
    if (safariEligible && !!(entry.safari)) safariCount++;

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

  // ── Average gap between consecutive sightings per year ─────
  const byYearGap = {};  // year → avg days between consecutive sightings
  const yearDatedEntries = {};  // year → sorted array of date strings
  data.forEach(entry => {
    if (!entry.date) return;
    const year = entry.date.slice(0, 4);
    if (!yearDatedEntries[year]) yearDatedEntries[year] = [];
    yearDatedEntries[year].push(entry.date);
  });
  Object.entries(yearDatedEntries).forEach(([year, dates]) => {
    dates.sort();
    if (dates.length < 2) return; // need at least 2 sightings to compute a gap
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
      if (diff > 0) gaps.push(diff); // skip same-day sightings
    }
    if (gaps.length) byYearGap[year] = parseFloat((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1));
  });

  // ── Longest gaps between consecutive sightings (top 5) ─────
  const datedEntries = data
    .filter(e => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const allGaps = [];
  for (let i = 1; i < datedEntries.length; i++) {
    const prev = datedEntries[i - 1];
    const curr = datedEntries[i];
    const days = (new Date(curr.date) - new Date(prev.date)) / 86400000;
    if (days > 0) allGaps.push({ days, from: prev, to: curr });
  }
  allGaps.sort((a, b) => b.days - a.days);
  const topGapsRaw = allGaps.slice(0, 5);

  const lastSightingDate = datedEntries.length
    ? new Date(datedEntries[datedEntries.length - 1].date)
    : null;
  const daysSinceLastSighting = lastSightingDate
    ? Math.floor((Date.now() - lastSightingDate) / 86400000)
    : null;

  function fmtDate(dateStr) {
    // Adding T12:00:00 avoids timezone-related off-by-one day issues
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function fmtDateShort(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  // ── Derived values ─────────────────────────────────────────
  const totalEntries   = data.length;
  const totalHours     = fmtHours(totalSecs);
  const uniquePartners = Object.keys(byPartnerCount).length;
  const uniqueGames    = Object.keys(byGame).length;
  const safariEligibleCount = data.filter(e => e.date && e.date >= SAFARI_LAUNCH).length;
  const safariFailPct = safariEligibleCount > 0 ? pct(safariEligibleCount - safariCount, safariEligibleCount) : 0;

  const years      = Object.keys(byYear).sort();
  const yearCounts = years.map(y => byYear[y].count);
  const yearSecs   = years.map(y => byYear[y].secs);

  const TOP        = 10;
  const topByCount = topN(byPartnerCount, TOP);
  const topBySecs  = topN(byPartnerSecs,  TOP);

  const topGames = Object.entries(byGame)
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1]);

  // Activities sorted by occurrence rate descending (all shown, no cutoff)
  const actSorted = Object.entries(byActivity).sort((a, b) => b[1] - a[1]);

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
      <div class="summary-pill">
        <div class="summary-pill-value">${safariFailPct}%</div>
        <div class="summary-pill-label">Tutel Safari Failure Rate</div>
      </div>
    </div>

    <div class="chart-group">

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
          <div class="chart-subtitle">Total Vedal on-screen hours on other people's streams by year</div>
        </div>
        <div class="chart-wrap"><canvas id="c-year-time"></canvas></div>
      </div>

      <div class="chart-card">
        <div>
          <div class="chart-title">Avg. time gap per year</div>
          <div class="chart-subtitle">Average number of days between consecutive Vedal sightings by year</div>
        </div>
        <div class="chart-wrap"><canvas id="c-year-gap"></canvas></div>
      </div>

    </div>

    <div class="gap-card">
      <div class="gap-card-header">
        <div>
          <div class="chart-title">Longest gaps between sightings</div>
          <div class="chart-subtitle">Last sighting was ${daysSinceLastSighting !== null ? `${daysSinceLastSighting} day${daysSinceLastSighting === 1 ? '' : 's'} ago` : 'unknown'}</div>
        </div>
      </div>
      <div class="gap-list">
        ${topGapsRaw.map((g, i) => `
          <div class="gap-row">
            <div class="gap-rank">${i + 1}</div>
            <div class="gap-days">${g.days}<span class="gap-days-label">d</span></div>
            <div class="gap-dates-mobile">
              <div class="gap-date-block">
                <div class="gap-date-inner">
                  <span class="gap-date">
                    <span class="date-long">${fmtDate(g.from.date)}</span>
                    <span class="date-short">${fmtDateShort(g.from.date)}</span>
                  </span>
                  <span class="gap-pseudo mobile-hide">${makePseudoTitle(g.from)}</span>
                </div>
              </div>
              <div class="gap-arrow">→</div>
              <div class="gap-date-block">
                <div class="gap-date-inner">
                  <span class="gap-date">
                    <span class="date-long">${fmtDate(g.to.date)}</span>
                    <span class="date-short">${fmtDateShort(g.to.date)}</span>
                  </span>
                  <span class="gap-pseudo mobile-hide">${makePseudoTitle(g.to)}</span>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="chart-group">

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

    </div>

    <div class="chart-group">

      <div class="chart-card chart-card--tall">
        <div>
          <div class="chart-title">Games played</div>
          <div class="chart-subtitle">Number of sightings per game · games with only 1 appearance excluded</div>
        </div>
        <div class="chart-wrap"><canvas id="c-games"></canvas></div>
      </div>

      <div class="chart-card chart-card--tall">
        <div>
          <div class="chart-title">Activities</div>
          <div class="chart-subtitle">% of sightings containing each activity tag</div>
        </div>
        <div class="chart-wrap"><canvas id="c-activities"></canvas></div>
      </div>

    </div>

    <div class="chart-group">

      <div class="chart-card chart-card--donut">
        <div>
          <div class="chart-title">Appearance weight</div>
          <div class="chart-subtitle">Full · Partial · Cameo breakdown</div>
        </div>
        <div class="chart-wrap"><canvas id="c-weight"></canvas></div>
      </div>

      <div class="chart-card chart-card--donut">
        <div>
          <div class="chart-title">Tutel Safari</div>
          <div class="chart-subtitle">Sightings pinged in #tutel-safari since its launch on Sept. 4, 2023</div>
        </div>
        <div class="chart-wrap"><canvas id="c-safari"></canvas></div>
      </div>

    </div>
  `;

  // ── Render charts ──────────────────────────────────────────

  // Years — no colors.json entry, use generic palette
  makeBar('c-year-count', years, yearCounts,
    years.map((_, i) => PALETTE[i % PALETTE.length]),
    {
      tooltipFmt: v => ` ${v} sightings (${pct(v, totalEntries)}% of archive)`,
    }
  );

  const totalHoursRaw = Math.round(totalSecs / 3600);
  makeBar('c-year-time', years, yearSecs.map(s => Math.round(s / 3600)),
    years.map((_, i) => PALETTE[i % PALETTE.length]),
    {
      yTickFmt:   v => v + 'h',
      tooltipFmt: v => ` ${v}h on-screen (${pct(v, totalHoursRaw)}% of total)`,
    }
  );

  // Gap between sightings per year
  const gapYears  = years.filter(y => byYearGap[y] != null);
  const gapValues = gapYears.map(y => byYearGap[y]);
  makeBar('c-year-gap', gapYears, gapValues,
    gapYears.map((_, i) => PALETTE[i % PALETTE.length]),
    {
      tooltipFmt: v => ` ${v} day${v === 1 ? '' : 's'} avg. between sightings`,
    }
  );

  // Partners — occurrence rate in tooltip
  makeBar('c-partner-count',
    topByCount.map(([n])   => n),
    topByCount.map(([, v]) => v),
    topByCount.map(([n])   => getColor('collab_partners', n) + 'cc'),
    {
      horizontal: true,
      tooltipFmt: v => ` ${v} appearances (${pct(v, totalEntries)}% of sightings)`,
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

  // Games — occurrence rate on x-axis and tooltip
  makeBar('c-games',
    topGames.map(([g])   => g),
    topGames.map(([, v]) => v),
    topGames.map(([g])   => getColor('games', g) + 'cc'),
    {
      horizontal: true,
      tooltipFmt: (v, i) => {
        const pctVal = pct(v, totalEntries);
        return ` ${v} sighting${v === 1 ? '' : 's'} (${pctVal}% of archive)`;
      },
    }
  );

  // Activities — occurrence rate on x-axis and tooltip
  makeBar('c-activities',
    actSorted.map(([a])   => a),
    actSorted.map(([, v]) => pct(v, totalEntries)),
    actSorted.map(([a])   => getColor('activities', a) + 'cc'),
    {
      horizontal: true,
      maxX:       100,
      xTickFmt:   v => v + '%',
      tooltipFmt: (v, i) => {
        const count = actSorted[i]?.[1] ?? '';
        return ` ${v}% of sightings (${count})`;
      },
    }
  );

  // Appearance weight — use colors.json appearance_weight
  const weightOrder = ['Full', 'Partial', 'Cameo'];
  makeDonut('c-weight',
    weightOrder,
    weightOrder.map(w  => byWeight[w] || 0),
    weightOrder.map(w  => getColor('appearance_weight', w))
  );

  // Safari status
  makeDonut('c-safari',
    ['Pinged', 'Not pinged'],
    [safariCount, safariEligibleCount - safariCount],
    ['#22c55e', '#4f5670']
  );

  // Pass current query string back to archive link so filters are restored
  const homeLink = document.querySelector('.home-link');
  if (homeLink && window.location.search) {
    homeLink.href = '../' + window.location.search;
  }

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/tutel-sightings/sw.js');
  }
}

init();
