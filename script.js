/* ============================================================
   TUTEL SIGHTINGS — script.js
   Loads appearances.json + colors.json, renders cards,
   handles filtering, sorting, and all interactions.
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let allAppearances = [];
let appearancesById = new Map();
let colors = {};
let watchedIds  = new Set(JSON.parse(localStorage.getItem('tutel-watched')   || '[]'));
let userProgress =        JSON.parse(localStorage.getItem('tutel-progress')  || '{}');
let viewMode    = localStorage.getItem('tutel-view-mode') || 'grid'; // 'grid' | 'list'

function saveViewMode() { localStorage.setItem('tutel-view-mode', viewMode); }
function saveWatched()      { localStorage.setItem('tutel-watched',  JSON.stringify([...watchedIds])); }
function saveUserProgress() { localStorage.setItem('tutel-progress', JSON.stringify(userProgress));    }

const state = {
  search:  '',
  sort:    'date',
  sortDir: 'desc',
  watch:   'all',
  inProgress: false,
  dateFrom:  null,  // 'YYYY-MM-DD' string or null
  dateTo:    null,
  safari:     'all',
  filters: {
    activities:        new Set(),
    games:             new Set(),
    collab_partners:   new Set(),
    appearance_weight: new Set(),
  },
};

const NEW_ENTRY_CUTOFF = new Date();
NEW_ENTRY_CUTOFF.setDate(NEW_ENTRY_CUTOFF.getDate() - 30);

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  try {
    const [appData, colorData] = await Promise.all([
      fetch('data/appearances.json').then(r => r.json()),
      fetch('data/colors.json').then(r => r.json()),
    ]);
    allAppearances = appData;
    buildEntryMeta(allAppearances);
    appearancesById = new Map(allAppearances.map(e => [e.id, e]));
    // Seed the editor's remote snapshot immediately so suggestions work before any save
    applyEditorLayer._remote = [...allAppearances];
    // Guard against colors.json being accidentally wrapped in an outer array
    colors = Array.isArray(colorData) ? colorData[0] : colorData;
    // Store pristine remote snapshot for the colors editor (revert/export)
    _remoteColors = JSON.parse(JSON.stringify(colors));
    loadStateFromURL();
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('card-grid').innerHTML =
      '<p style="color:var(--text-muted);padding:40px">Failed to load appearances data.</p>';
    return;
  }

  buildFilterSidebar();
  syncUIFromState();
  renderStats();
  render();
  bindEvents();

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/tutel-sightings/sw.js');
  }
}

// ── Entry metadata (computed once at load, read everywhere) ───
const entryMeta = {}; // keyed by entry.id

function buildEntryMeta(entries) {
  entries.forEach(entry => {
    const vods = entry.vods;

    // ── Per-streamer grouping ─────────────────────────────────
    // Build a map of streamer → [array of global vod indices], in order
    const streamerGroups = new Map(); // streamer → [vodIndex, ...]
    vods.forEach((vod, i) => {
      if (!streamerGroups.has(vod.streamer)) streamerGroups.set(vod.streamer, []);
      streamerGroups.get(vod.streamer).push(i);
    });

    const distinctStreamers = streamerGroups.size;

    // ── Per-VOD derived info ──────────────────────────────────
    const vodList = vods.map((vod, i) => {
      const siblings   = streamerGroups.get(vod.streamer); // all indices for this streamer
      const isPart     = siblings.length > 1;              // this streamer has multiple vods
      const isUnique   = distinctStreamers > 1 && !isPart; // sole POV, no parts
      const isBoth     = siblings.length > 1 && distinctStreamers > 1; // parts within a multi-POV

      const partNumber = isPart ? siblings.indexOf(i) + 1 : null;
      const partTotal  = isPart ? siblings.length : null;

      // Label logic
      let label;
      if (vods.length === 1) {
        label = 'Watch';
      } else if (isBoth) {
        label = `${vod.streamer}'s POV · Part ${partNumber}`;
      } else if (isPart) {
        label = `Part ${partNumber}`;
      } else {
        label = `${vod.streamer}'s POV`;
      }

      // Individual VOD duration in seconds (null if either timestamp missing)
      const duration = (vod.timestamp_seconds != null && vod.timestamp_end_seconds != null)
        ? vod.timestamp_end_seconds - vod.timestamp_seconds
        : null;

      return {
        streamer:   vod.streamer,
        label,
        partNumber,
        partTotal,
        isPart,
        isUnique,
        isBoth,
        duration,   // seconds, or null
      };
    });

    // ── Screen time per streamer (sum parts, keep POVs separate) ─
    const screenTimePerStreamer = {};
    streamerGroups.forEach((indices, streamer) => {
      const total = indices.reduce((sum, i) => {
        return sum + (vodList[i].duration ?? 0);
      }, 0);
      // Only include if at least one VOD had a known duration
      const hasAny = indices.some(i => vodList[i].duration !== null);
      screenTimePerStreamer[streamer] = hasAny ? total : null;
    });

    // ── Entry-level max screen time ───────────────────────────
    // Single streamer: sum all parts. Multiple streamers: take the max per-streamer total.
    const streamerTotals = Object.values(screenTimePerStreamer).filter(v => v !== null);
    const maxScreenTime = streamerTotals.length === 0 ? null
      : distinctStreamers === 1 ? streamerTotals[0]
      : Math.max(...streamerTotals);

    // ── Badge label for the multi-vod indicator ───────────────
    let badgeLabel = null;
    if (vods.length > 1) {
      if (distinctStreamers === 1) {
        badgeLabel = `${vods.length} Parts`;
      } else if (vodList.every(v => !v.isPart)) {
        badgeLabel = `${vods.length} POVs`;
      } else {
        badgeLabel = `${vods.length} VODs`; // mixed case
      }
    }

    // ── Duration display string (reuses existing formatDuration) ─
    // For multi-streamer entries: show a min~max range across per-streamer totals.
    // For single-streamer: show the summed total.
    let durationDisplay = null;
    if (maxScreenTime !== null) {
      if (distinctStreamers === 1) {
        durationDisplay = formatDuration(maxScreenTime);
      } else {
        const validTotals = streamerTotals.sort((a, b) => a - b);
        const min = validTotals[0];
        const max = validTotals[validTotals.length - 1];
        durationDisplay = min === max
          ? formatDuration(min)
          : `${formatDuration(min)} ~ ${formatDuration(max)}`;
      }
    }

    entryMeta[entry.id] = {
      // Entry-level
      distinctStreamers,
      isMulti:    vods.length > 1,
      isParts:    vods.length > 1 && distinctStreamers === 1,
      isPovs:     distinctStreamers > 1,
      badgeLabel,
      maxScreenTime,          // seconds, or null
      durationDisplay,        // formatted string, or null
      screenTimePerStreamer,   // { streamer: seconds|null }

      // Per-VOD (parallel to entry.vods)
      vodList,
    };
  });
}

// ── Color helpers ─────────────────────────────────────────────
function getColor(category, key) {
  if (editorMode) {
    const localKey = `${category}::${key}`;
    if (colorsLocal.deleted.includes(localKey)) return colors.fallback || '#4B5563';
    if (colorsLocal.modified[localKey]) return colorsLocal.modified[localKey];
    if (colorsLocal.added[localKey])    return colorsLocal.added[localKey];
  }
  return (colors[category] && colors[category][key]) || colors.fallback || '#4B5563';
}

// Returns an inline style string for a colored chip
function chipStyle(category, key) {
  const hex = getColor(category, key);
  return `background:${hex}22; color:${hex}; border-color:${hex}44;`;
}

function formatDuration(secs) {
  if (secs == null || secs < 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function isNewEntry(entry) {
  return !!entry.date && new Date(entry.date) >= NEW_ENTRY_CUTOFF;
}

// ── Sort ──────────────────────────────────────────────────────
function sortedAppearances(list) {
  const copy = [...list];
  const dir  = state.sortDir === 'asc' ? 1 : -1;

  if (state.sort === 'date') {
    copy.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;   // unknown dates sink to bottom
      if (!b.date) return -1;
      return dir * a.date.localeCompare(b.date);
    });
  } else if (state.sort === 'duration') {
    copy.sort((a, b) => {
      const da = entryMeta[a.id].maxScreenTime;
      const db = entryMeta[b.id].maxScreenTime;
      if (da == null && db == null) return 0;
      if (da == null) return 1;  // no-duration entries sink to bottom
      if (db == null) return -1;
      return dir * (da - db);
    });
  } else if (state.sort === 'partners') {
    copy.sort((a, b) => dir * (a.collab_partners.length - b.collab_partners.length));
  }
  return copy;
}

// ── Filter ────────────────────────────────────────────────────
function passesFilter(entry) {
  // Watch status filter
  const watched = watchedIds.has(entry.id);
  if (state.watch === 'watched'   && !watched) return false;
  if (state.watch === 'unwatched' &&  watched) return false;
  if (state.inProgress && !userProgress[entry.id]) return false;
  const pinged = !!(entry.safari);  // absent/undefined treated as false
  if (state.safari === 'pinged'     && !pinged) return false;
  if (state.safari === 'not-pinged' &&  pinged) return false;

  // Date range filter (tolerant of reversed from/to)
  if (state.dateFrom || state.dateTo) {
    if (!entry.date) return false;
    const lo = state.dateFrom && state.dateTo
      ? (state.dateFrom <= state.dateTo ? state.dateFrom : state.dateTo)
      : state.dateFrom;
    const hi = state.dateFrom && state.dateTo
      ? (state.dateFrom <= state.dateTo ? state.dateTo : state.dateFrom)
      : state.dateTo;
    if (lo && entry.date < lo) return false;
    if (hi && entry.date > hi) return false;
  }

  // Text search — matches title, partners, and games
  if (state.search) {
    const q        = state.search.toLowerCase();
    const title    = (entry.title || entry.vods[0]?.vod_title || '').toLowerCase();
    const partners = entry.collab_partners.map(p => p.toLowerCase()).join(' ');
    const games    = entry.games.map(g => g.toLowerCase()).join(' ');
    if (!title.includes(q) && !partners.includes(q) && !games.includes(q)) return false;
  }

  // Tag filters — AND logic within each category (all selected tags must be present).
  // Exception: appearance_weight is a single value per entry, so multiple selections are OR'd.
  for (const [cat, set] of Object.entries(state.filters)) {
    if (!set.size) continue;
    if (cat === 'appearance_weight') { if (!set.has(entry.appearance_weight)) return false; }
    else {
      const arr = entry[cat]; // activities, games, or collab_partners
      for (const v of set) { if (!arr.includes(v)) return false; }
    }
  }
  return true;
}

function filteredAndSorted() {
  return sortedAppearances(allAppearances.filter(passesFilter));
}

function hasActiveFilters() {
  return Object.values(state.filters).some(s => s.size > 0)
    || !!state.dateFrom || !!state.dateTo
    || !!state.search
    || state.watch !== 'all'
    || state.inProgress
    || state.safari !== 'all';
}

// ── Sidebar filter builder ────────────────────────────────────
function buildFilterSidebar() {
  const container = document.getElementById('filter-groups');
  const sortIgnoreCase = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());

  const allActivities = [...new Set(allAppearances.flatMap(e => e.activities))].sort(sortIgnoreCase);
  const allGames      = [...new Set(allAppearances.flatMap(e => e.games))].filter(Boolean).sort(sortIgnoreCase);
  const allPartners   = [...new Set(allAppearances.flatMap(e => e.collab_partners))].sort(sortIgnoreCase);
  const allWeights    = ['Full', 'Partial', 'Cameo'];

  const counts = { activities: {}, games: {}, collab_partners: {}, appearance_weight: {} };
  allAppearances.forEach(e => {
    e.activities.forEach(a => counts.activities[a] = (counts.activities[a] || 0) + 1);
    e.games.forEach(g => counts.games[g] = (counts.games[g] || 0) + 1);
    e.collab_partners.forEach(p => counts.collab_partners[p] = (counts.collab_partners[p] || 0) + 1);
    counts.appearance_weight[e.appearance_weight] = (counts.appearance_weight[e.appearance_weight] || 0) + 1;
  });

  const sections = [
    { label: 'Activity',          cat: 'activities',        items: allActivities },
    { label: 'Game',              cat: 'games',             items: allGames      },
    { label: 'Collab Partner',    cat: 'collab_partners',   items: allPartners   },
    { label: 'Appearance Weight', cat: 'appearance_weight', items: allWeights    },
  ];

  const chevronSvg = `<svg class="filter-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

  container.innerHTML = sections.map(({ label, cat, items }) => `
    <div class="filter-group" data-cat="${cat}">
      <button class="filter-group-header" onclick="toggleFilterGroup(this)">
        <span class="filter-group-label">${label}</span>
        ${chevronSvg}
      </button>
      <div class="filter-group-content" style="display:none">
        ${items.map(item => {
          const count = counts[cat][item] || 0;
          const color = getColor(cat, item);
          return `
            <button class="filter-chip" data-cat="${cat}" data-value="${item}">
              <span class="filter-chip-dot" style="background:${color}"></span>
              <span class="filter-chip-name">${item}</span>
              <span class="filter-chip-count">${count}</span>
            </button>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function toggleFilterGroup(btn) {
  const content = btn.nextElementSibling;
  const isOpen  = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  btn.classList.toggle('open', !isOpen);
}

function updateFilterChipStates() {
  document.querySelectorAll('.filter-chip').forEach(btn => {
    const { cat, value } = btn.dataset;
    btn.classList.toggle('active', state.filters[cat]?.has(value) ?? false);
  });
  const hasTagFilters = Object.values(state.filters).some(s => s.size > 0);
  document.getElementById('clear-filters').style.display = hasTagFilters ? '' : 'none';
  const hasDateFilters = !!state.dateFrom || !!state.dateTo;
  document.getElementById('date-clear-btn').style.display = hasDateFilters ? '' : 'none';
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const total    = allAppearances.length;
  const partners = new Set(allAppearances.flatMap(e => e.collab_partners)).size;
  document.getElementById('header-stats').innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Sightings</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${partners}</div>
      <div class="stat-label">Streamers</div>
    </div>
  `;
}

// ── Card rendering ────────────────────────────────────────────
function getCardTitle(entry) {
  if (entry.title) return entry.title;
  if (entry.vods.length && entry.vods[0].vod_title) return entry.vods[0].vod_title;
  return entry.id;
}

function getThumbUrl(entry) {
  const first = entry.vods[0];
  if (!first?.video_id) return null;
  return `https://img.youtube.com/vi/${first.video_id}/hqdefault.jpg`;
}

// Builds a YouTube watch URL for a VOD.
function getWatchUrl(vod, entryId, withProgress = true) { 
  if (!vod.video_id) return '#';
  let t = vod.timestamp_seconds;

  if (withProgress && entryId) {
    const entry = appearancesById.get(entryId);
    const p = userProgress?.[entryId];
    if (entry && p != null) {
      const vodIndex = entry.vods.indexOf(vod);
      if (vodIndex !== -1 && p.vodIndex === vodIndex) {
        // null seconds means start from natural VOD beginning
        t = p.seconds ?? vod.timestamp_seconds;
      }
    }
  }

  return t ? `https://youtu.be/${vod.video_id}?t=${t}` : `https://youtu.be/${vod.video_id}`;
}

// NEW
function renderChips(entry) {
  const chips = [];
  if (isNewEntry(entry)) {
    chips.push(`<span class="chip chip--new">New</span>`);
  }
  const addChip = (cat, value) =>
    chips.push(`<button class="chip" data-cat="${escAttr(cat)}" data-value="${escAttr(value)}" style="${chipStyle(cat, value)}" onclick="filterBy('${escAttr(cat)}','${escAttr(value)}')">${escHtml(value)}</button>`);

  entry.activities.forEach(a     => addChip('activities',      a));
  entry.games.forEach(g          => addChip('games',           g));
  entry.collab_partners.forEach(p => addChip('collab_partners', p));
  return chips.join('');
}

// ── Chip overflow ─────────────────────────────────────────────
// After rendering, we measure the chip rows and collapse anything that spills
// past 2 lines into a "+N more" badge. This runs post-paint (requestAnimationFrame)
// so that getBoundingClientRect() returns real layout values.

function applyChipOverflow() {
  document.querySelectorAll('#card-grid .card-chips').forEach(c => applyChipOverflowContainer(c, 2));
  document.querySelectorAll('#card-list .list-chips').forEach(c => applyChipOverflowContainer(c, 1));
}

function applyChipOverflowForCard(card) {
  const container = card.querySelector('.card-chips') || card.querySelector('.list-chips');
  const maxLines  = card.classList.contains('card-list-item') ? 1 : 2;
  if (container) applyChipOverflowContainer(container, maxLines);
}

function applyChipOverflowContainer(container, maxLines = 2) {
  const chips = [...container.querySelectorAll('.chip')];
  if (!chips.length) return;

  // Reset any previous overflow pass so we measure from a clean state
  chips.forEach(c => c.style.display = '');
  container.querySelector('.chip-overflow')?.remove();

  // Single-line containers (list view) wrap horizontally instead of vertically —
  // overflow is detected by container width, not chip Y position.
  const isHorizontal = maxLines === 1 && container.classList.contains('list-chips');

  let overflowFrom;
  let maxBottom; // only used in the vertical branch, for the badge-fit re-check below

  if (isHorizontal) {
    const containerRect = container.getBoundingClientRect();
    const maxRight = containerRect.right;
    overflowFrom = chips.findIndex(c => c.getBoundingClientRect().right > maxRight);
  } else {
    // The allowed vertical space is exactly maxLines chip heights, measured from
    // the top of the first chip (not the container, which has padding above it).
    const firstRect = chips[0].getBoundingClientRect();
    maxBottom = firstRect.top + firstRect.height * maxLines + 8;
    overflowFrom = chips.findIndex(c => c.getBoundingClientRect().bottom > maxBottom);
  }

  if (overflowFrom === -1) return; // Everything fits

  // Hide overflowing chips and collect their data for the tooltip
  const overflowData = chips.slice(overflowFrom).map(c => {
    c.style.display = 'none';
    return { cat: c.dataset.cat, value: c.dataset.value };
  });

  // Build the "+N more" badge and attach tooltip listeners
  const badge = document.createElement('span');
  badge.className = 'chip-overflow';
  badge.dataset.overflow = encodeURIComponent(JSON.stringify(overflowData));
  badge.addEventListener('mouseenter', e => showOverflowTooltip(e, badge));
  badge.addEventListener('mouseleave', hidePartnerTooltip);
  container.appendChild(badge);
  badge.textContent = `+${overflowData.length} more`;

  // If the badge itself overflows, pull one more chip into it and repeat
  // until it fits. Safety counter prevents an infinite loop.
  let safety = chips.length;
  const stillOverflowing = () => isHorizontal
    ? badge.getBoundingClientRect().right > container.getBoundingClientRect().right
    : badge.getBoundingClientRect().bottom > maxBottom;

  while (stillOverflowing() && overflowFrom > 0 && safety-- > 0) {
    overflowFrom--;
    chips[overflowFrom].style.display = 'none';
    overflowData.unshift({ cat: chips[overflowFrom].dataset.cat, value: chips[overflowFrom].dataset.value });
    badge.textContent = `+${overflowData.length} more`;
    badge.dataset.overflow = encodeURIComponent(JSON.stringify(overflowData));
  }
}

function getCardData(entry) {
  const watched  = isWatched(entry);
  const thumbUrl = getThumbUrl(entry);
  const title    = getCardTitle(entry);
  const meta     = entryMeta[entry.id];
  const duration = meta.durationDisplay;
  const isMulti  = meta.isMulti;
  const singleUrl = !isMulti ? getWatchUrl(entry.vods[0], entry.id) : '#';

  let progressBadgeHtml = '';
  let progressHtml      = '';
  let percent           = null;

  if (userProgress[entry.id]) {
    const p   = userProgress[entry.id];
    const vod = entry.vods[p.vodIndex];
    if (vod?.timestamp_end_seconds) {
      const effectiveSecs = p.seconds ?? (vod.timestamp_seconds || 0);
      let progressSecs = effectiveSecs - (vod.timestamp_seconds || 0);
      let totalSecs    = vod.timestamp_end_seconds - (vod.timestamp_seconds || 0);

      const vodMeta = meta.vodList[p.vodIndex];
      if (vodMeta.isPart) {
        const currentPartDur = vod.timestamp_end_seconds - (vod.timestamp_seconds || 0);
        progressSecs = Math.min(progressSecs, currentPartDur);
        // Sum only same-streamer previous parts, not all previous vods
        for (let i = 0; i < p.vodIndex; i++) {
          if (entry.vods[i].streamer === vod.streamer) {
            const prev = entry.vods[i];
            progressSecs += (prev.timestamp_end_seconds || 0) - (prev.timestamp_seconds || 0);
          }
        }
        totalSecs = meta.screenTimePerStreamer[vod.streamer] ?? totalSecs;
      }

      percent = Math.max(0, Math.min(100, Math.floor((progressSecs / totalSecs) * 100)));
      progressBadgeHtml = `<div class="progress-badge">${percent}% Watched</div>`;
      progressHtml      = `<div class="card-progress-bar"><div class="card-progress-fill" style="width:${percent}%"></div></div>`;
    }
  }

  const thumbClick = isMulti
    ? `onclick="openPovDropdown(event,'${entry.id}')" style="cursor:pointer"`
    : `onclick="window.open('${singleUrl}','_blank')" style="cursor:pointer"`;
  const titleClick = isMulti
    ? `onclick="openPovDropdown(event,'${entry.id}')"`
    : `onclick="window.open('${singleUrl}','_blank')"`;

  return {
    watched, thumbUrl, title, duration, isMulti, singleUrl,
    progressBadgeHtml, progressHtml, percent,
    thumbClick, titleClick,
  };
}

function renderCard(entry) {
  const d = getCardData(entry);
  const isDeleted   = editorMode && editorLocal.deleted.has(entry.id);
  const isModified  = editorMode && !isDeleted && !!editorLocal.modified[entry.id];
  const isEditorNew = editorMode && editorLocal.added.some(e => e.id === entry.id);
  const isNew       = isNewEntry(entry);
  // Priority: deleted > editor-new (local) > modified > recently-added (30-day new)
  const stateClass  = isDeleted ? ' card--deleted' : isEditorNew ? ' card--editor-new' : isModified ? ' card--modified' : isNew ? ' card--new' : '';

  return `
    <article class="card${stateClass}" data-id="${entry.id}">
      ${isDeleted ? `<div class="card-deleted-banner"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Marked for deletion</div>` : ''}
      <div class="card-thumb-wrap" ${d.thumbClick}>
        ${d.thumbUrl
          ? `<img class="card-thumb" src="${d.thumbUrl}" alt="${escAttr(d.title)}" loading="lazy"
               onload="if(this.naturalHeight > 90 ) { this.style.removeProperty('opacity'); this.onload=null; return; } var n=this.src.replace('maxres','hq'); this.src=''; this.src=n; this.style.removeProperty('opacity'); this.onload=null;">
             <div class="card-thumb-placeholder" style="display:none">🐢</div>`
          : `<div class="card-thumb-placeholder">🐢</div>`
        }
        <div class="card-thumb-overlay">
          <div class="play-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        ${entryMeta[entry.id].badgeLabel ? `<div class="multi-vod-badge">${entryMeta[entry.id].badgeLabel}</div>` : ''}
        ${d.progressBadgeHtml}
        ${d.progressHtml}
      </div>
      <div class="card-body">
        <div class="card-chips">${renderChips(entry)}</div>
        <div class="card-title" ${d.titleClick}>${escHtml(d.title)}</div>
        <div class="card-meta">
          ${entry.date ? `<span>${entry.date}</span>` : '<span style="opacity:0.4">Date unknown</span>'}
          ${d.duration ? `<span class="card-meta-sep">·</span><span class="card-duration">${d.duration}</span>` : ''}
          ${d.watched ? `<span title="Watched" style="display:flex"><svg class="watched-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}
          <span class="card-menu-wrap">
            <button class="card-menu-btn" onclick="openCardMenu(event,'${entry.id}')" title="More options">···</button>
          </span>
        </div>
      </div>
    </article>
  `;
}

function renderCardList(entry) {
  const d = getCardData(entry);
  const sqThumb = d.thumbUrl ? d.thumbUrl.replace(/\/(maxresdefault|hqdefault)\.jpg/, '/sddefault.jpg') : null;
  const suffix = entryMeta[entry.id].badgeLabel ?? '';
  const isDeleted   = editorMode && editorLocal.deleted.has(entry.id);
  const isModified  = editorMode && !isDeleted && !!editorLocal.modified[entry.id];
  const isEditorNew = editorMode && editorLocal.added.some(e => e.id === entry.id);
  const isNew       = isNewEntry(entry);
  const stateClass  = isDeleted ? ' card--deleted' : isEditorNew ? ' card-list-item--editor-new' : isModified ? ' card-list-item--modified' : isNew ? ' card-list-item--new' : '';

  return `
    <article class="card-list-item${stateClass}" data-id="${entry.id}">
      <div class="list-thumb-wrap" ${d.thumbClick}>
        ${sqThumb
          ? `<img class="list-thumb" src="${sqThumb}" alt="${escAttr(d.title)}" loading="lazy">`
          : `<div class="list-thumb-placeholder">🐢</div>`
        }
        ${d.progressHtml}
      </div>
      <div class="list-body">
        <div class="list-chips">${renderChips(entry)}</div>
        <div class="list-title-row" ${d.titleClick}>
          <span class="list-title-text">${escHtml(d.title)}</span>
          ${suffix ? `<span class="list-title-suffix">${suffix}</span>` : ''}
        </div>
        <div class="card-meta card-meta--list">
          ${entry.date ? `<span>${entry.date}</span>` : '<span style="opacity:0.4">Date unknown</span>'}
          ${d.duration ? `<span class="card-meta-sep">·</span><span class="card-duration">${d.duration}</span>` : ''}
          ${d.percent !== null ? `<span class="card-meta-sep">·</span><span class="list-progress-text">${d.percent}%</span>` : ''}
          ${d.watched ? `<span title="Watched" style="display:flex"><svg class="watched-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}
          <span class="card-menu-wrap card-menu-wrap--list">
            <button class="card-menu-btn" onclick="openCardMenu(event,'${entry.id}')" title="More options">···</button>
          </span>
        </div>
      </div>
    </article>
  `;
}

// ── Main render ───────────────────────────────────────────────
function render() {
  const results    = filteredAndSorted();
  const grid       = document.getElementById('card-grid');
  const empty      = document.getElementById('empty-state');
  const resultsBar = document.getElementById('results-bar');
  const list       = document.getElementById('card-list');

  if (results.length === 0) {
    grid.innerHTML = '';
    list.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display  = 'none';
    if (viewMode === 'list') {
      grid.style.display = 'none';
      list.style.display = '';
      list.innerHTML     = results.map(renderCardList).join('');
      grid.innerHTML      = '';
    } else {
      list.style.display = 'none';
      grid.style.display = '';
      grid.innerHTML      = results.map(renderCard).join('');
      list.innerHTML     = '';
    }
    requestAnimationFrame(applyChipOverflow);
  }

  const total = allAppearances.length;
  const resultsText = results.length === total
    ? `<span class="results-count">${total}</span> sightings`
    : `<span class="results-count">${results.length}</span> of ${total} sightings`;

  const totalSecs = results.reduce((sum, e) => sum + (entryMeta[e.id].maxScreenTime ?? 0), 0);
  const durationText = totalSecs > 0
    ? `<span class="results-separator">·</span><span class="results-count">${formatDuration(totalSecs)}</span> total`
    : '';

  const diceSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><circle cx="15.5" cy="8.5" r="1.5"></circle><circle cx="15.5" cy="15.5" r="1.5"></circle><circle cx="8.5" cy="15.5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>`;

  const clearAllBtn = hasActiveFilters()
    ? `<button class="random-btn desktop-only-btn" onclick="clearAllFilters()">Clear Filters</button>`
    : '';

  const gridIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
  const listIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;

  const desktopViewToggle = `
    <div class="view-toggle-wrap desktop-only-btn">
      <button class="view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}" data-view="grid" onclick="setViewMode('grid')" title="Grid view" aria-label="Grid view">${gridIcon}</button>
      <button class="view-toggle-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" onclick="setViewMode('list')" title="List view" aria-label="List view">${listIcon}</button>
    </div>
  `;

  const newEntryBtn = editorMode ? `
    <button class="new-entry-btn" onclick="openNewEntry()" title="Create a new entry">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span class="new-entry-btn-label">New Entry</span>
    </button>` : '';

  resultsBar.innerHTML = `
    <div class="results-text">${resultsText}${durationText}</div>
    <div class="results-actions">
      ${clearAllBtn}
      <button class="random-btn" onclick="playRandomSighting()" ${results.length === 0 ? 'disabled' : ''} title="Play a random stream from this list">
        ${diceSvg} Random
      </button>
      ${newEntryBtn}
      ${desktopViewToggle}
    </div>
  `;

  document.getElementById('search-clear-btn').style.display = state.search ? '' : 'none';

  const mobileClearAll = document.getElementById('mobile-clear-all-btn');
  if (mobileClearAll) mobileClearAll.style.display = hasActiveFilters() ? '' : 'none';

  updateFilterChipStates();
  updateURLFromState();
}

// ── Random Sighting ──────────────────────────────────────────
function playRandomSighting() {
  const results = filteredAndSorted();
  if (results.length === 0) return;

  const possibleChoices = [];
  
  // Build the pool of valid VODs based on the current list
  results.forEach(entry => {
    if (!entry.vods || entry.vods.length === 0) return;

    const meta = entryMeta[entry.id];
    if (meta.isParts) {
      possibleChoices.push({ entry, vod: entry.vods[0] });
    } else if (meta.isPovs) {
      // For POV entries (possibly with parts within), push only the first VOD per streamer
      const seen = new Set();
      entry.vods.forEach(vod => {
        if (!seen.has(vod.streamer)) {
          seen.add(vod.streamer);
          possibleChoices.push({ entry, vod });
        }
      });
    } else {
      possibleChoices.push({ entry, vod: entry.vods[0] });
    }
  });

  if (possibleChoices.length === 0) return;

  // Pick a random choice
  const choice = possibleChoices[Math.floor(Math.random() * possibleChoices.length)];
  
  // getWatchUrl inherently handles injecting user progress timestamps!
  const url = getWatchUrl(choice.vod, choice.entry.id, true);

  window.open(url, '_blank');
}

// ── POV dropdown ──────────────────────────────────────────────
let dropdownEntry = null;

function openPovDropdown(event, entryId) {
  event.stopPropagation();
  const entry    = appearancesById.get(entryId);
  const dropdown = document.getElementById('pov-dropdown');
  if (!entry) return;

  // Toggle closed if already open for this entry
  if (dropdownEntry === entryId && dropdown.style.display !== 'none') {
    closePovDropdown();
    return;
  }
  dropdownEntry = entryId;

  document.getElementById('pov-dropdown-inner').innerHTML = entry.vods.map((vod, vodIndex) => {
    const baseLabel      = entryMeta[entryId].vodList[vodIndex].label;
    const hasProgress    = userProgress[entryId]?.vodIndex === vodIndex;
    const label          = hasProgress ? `${baseLabel} (Watching)` : baseLabel;
    const url            = getWatchUrl(vod, entryId);
    const color          = vod.streamer ? getColor('collab_partners', vod.streamer) : colors.fallback;
    // Active-progress VOD gets a solid border; others get a translucent one
    const borderHex      = hasProgress ? color : `${color}44`;
    const dur = (vod.timestamp_seconds != null && vod.timestamp_end_seconds != null)
      ? vod.timestamp_end_seconds - vod.timestamp_seconds
      : null;
    const durStr         = dur != null ? ` · ${formatDuration(dur)}` : '';
    return `
      <a class="pov-option" href="${url}" target="_blank" rel="noopener">
        <span class="pov-option-label">${escHtml(vod.vod_title || baseLabel)}</span>
        <span class="pov-chip" style="background:${color}22;color:${color};border:1px solid ${borderHex}">${escHtml(label)}${durStr}</span>
      </a>`;
  }).join('');

  // Position near the click, nudged inward from screen edges
  dropdown.style.display = '';
  const rect = dropdown.getBoundingClientRect();
  dropdown.style.left = Math.min(event.clientX, window.innerWidth  - rect.width  - 12) + 'px';
  dropdown.style.top  = Math.min(event.clientY + 8, window.innerHeight - rect.height - 12) + 'px';
}

function closePovDropdown() {
  document.getElementById('pov-dropdown').style.display = 'none';
  dropdownEntry = null;
}

// ── Overflow tooltip ──────────────────────────────────────────
// Uses a hide delay so the cursor can move from the "+N more" chip onto the
// tooltip without it disappearing. Both elements cancel the timer on mouseenter.
let tooltipHideTimer = null;

function showOverflowTooltip(event, el) {
  clearTimeout(tooltipHideTimer);
  const items   = JSON.parse(decodeURIComponent(el.dataset.overflow));
  const tooltip = document.getElementById('partner-tooltip');

  document.getElementById('partner-tooltip-inner').innerHTML = items.map(({ cat, value }) => {
    const hex = getColor(cat, value);
    return `<button class="chip" style="background:${hex}22;color:${hex};border-color:${hex}44;"
      onclick="filterBy('${escAttr(cat)}','${escAttr(value)}');hidePartnerTooltip()">
      <span class="chip-dot"></span>${escHtml(value)}
    </button>`;
  }).join('');

  tooltip.style.display = '';
  const rect  = el.getBoundingClientRect();
  const tRect = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.min(rect.left,   window.innerWidth  - tRect.width  - 12) + 'px';
  tooltip.style.top  = Math.min(rect.bottom + 6, window.innerHeight - tRect.height - 12) + 'px';
}

function hidePartnerTooltip() {
  tooltipHideTimer = setTimeout(() => {
    document.getElementById('partner-tooltip').style.display = 'none';
  }, 120);
}

function keepPartnerTooltip() { clearTimeout(tooltipHideTimer); }

// ── Watched management ────────────────────────────────────────
function isWatched(entry) { return watchedIds.has(entry.id); }

function toggleWatched(entryId) {
  if (watchedIds.has(entryId)) {
    watchedIds.delete(entryId);
  } else {
    watchedIds.add(entryId);
    // Marking as watched clears any saved progress — it's no longer needed
    if (userProgress[entryId]) {
      delete userProgress[entryId];
      saveUserProgress();
    }
  }
  saveWatched();
  closeCardMenu();

  const entry = appearancesById.get(entryId);
  const card  = document.querySelector(`[data-id="${entryId}"]`);
  if (!entry || !card) return;

  if (passesFilter(entry)) {
    // Card still belongs in the current view — re-render it in place
    const newHtml = viewMode === 'list' ? renderCardList(entry) : renderCard(entry);
    card.outerHTML = newHtml;
    requestAnimationFrame(() => {
      applyChipOverflowForCard(document.querySelector(`[data-id="${entryId}"]`));
    });
  } else {
    // Card no longer passes the filter — animate it out and remove it
    card.style.transition = 'opacity 250ms ease, transform 250ms ease';
    card.style.opacity    = '0';
    card.style.transform  = 'scale(0.96)';
    setTimeout(() => {
      card.remove();
      render();
    }, 260);
  }
}

// ── Data management (export / import / clear) ─────────────────
function exportWatchData() {
  const data = JSON.stringify({ watched: [...watchedIds], progress: userProgress }, null, 2);
  const url  = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'tutel-sightings-data.json' });
  a.click();
  URL.revokeObjectURL(url);
}

function importWatchData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      watchedIds   = new Set(Array.isArray(parsed.watched) ? parsed.watched : []);
      userProgress = (parsed.progress && typeof parsed.progress === 'object') ? parsed.progress : {};
      saveWatched();
      saveUserProgress();
      render();
    } catch {
      alert('Invalid data file. Make sure you are using a valid Tutel Sightings backup.');
    }
  };
  reader.readAsText(file);
}

function clearWatchData() {
  const btn = document.getElementById('footer-clear-btn');
  if (btn.dataset.confirming === 'true') {
    watchedIds   = new Set();
    userProgress = {};
    saveWatched();
    saveUserProgress();
    render();
    btn.textContent        = 'Clear data';
    btn.dataset.confirming = 'false';
    btn.classList.remove('confirming');
  } else {
    btn.textContent        = 'Are you sure?';
    btn.dataset.confirming = 'true';
    btn.classList.add('confirming');
    // Auto-reset after 3 seconds if not confirmed
    setTimeout(() => {
      if (btn.dataset.confirming === 'true') {
        btn.textContent        = 'Clear data';
        btn.dataset.confirming = 'false';
        btn.classList.remove('confirming');
      }
    }, 3000);
  }
}

// ── Card menu (···) ───────────────────────────────────────────
let activeCardMenu = null;

function openCardMenu(event, entryId) {
  event.stopPropagation();
  if (activeCardMenu === entryId) { closeCardMenu(); return; }
  closeCardMenu();

  const entry = appearancesById.get(entryId);
  if (!entry) return;
  activeCardMenu = entryId;

  // SVG icon strings
  const copyIcon      = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const eyeIcon       = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOffIcon    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const progressIcon  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const summaryIcon   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`;
  const timestampIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  const editIcon      = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const restoreIcon   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.45"/></svg>`;

  const isDeleted  = editorLocal.deleted.has(entryId);
  const isLocalEntry = editorLocal.added.some(e => e.id === entryId);

  const watched    = isWatched(entry);
  const divider    = `<div class="card-menu-divider"></div>`;
  // Local-only entries have no valid save-data ID — suppress watch/progress items
  const watchItem  = isLocalEntry ? '' : `<button class="card-menu-item" onclick="toggleWatched('${entry.id}')">${watched ? eyeOffIcon : eyeIcon} ${watched ? 'Mark as unwatched' : 'Mark as watched'}</button>`;
  const progItem   = isLocalEntry || watched ? '' : `<button class="card-menu-item" onclick="openProgressPopup('${escAttr(entry.id)}')">${progressIcon} Set Progress</button>`;
  const tsItem     = (entry.timestamps && entry.timestamps.length > 0) ? `<button class="card-menu-item" onclick="openTimestamps('${escAttr(entry.id)}')">${timestampIcon} Timestamps</button>` : '';
  const summItem   = entry.summary ? `<button class="card-menu-item" onclick="openSummary('${escAttr(entry.id)}')">${summaryIcon} Summary</button>` : '';

  // Copy link — one button for single VOD, one per VOD for multi
  const copyItems = entry.vods.length === 1
    ? `<button class="card-menu-item" onclick="copyLink('${escAttr(getWatchUrl(entry.vods[0], entry.id, false))}')">${copyIcon} Copy link</button>`
    : entry.vods.map((vod, i) => `
        <button class="card-menu-item" onclick="copyLink('${escAttr(getWatchUrl(vod, entry.id))}')">
          ${copyIcon}<span>Copy link<span class="card-menu-label-sub">${escHtml(entryMeta[entry.id].vodList[i].label)}</span></span>
        </button>`).join('');

  const editItem = editorMode ? `<button class="card-menu-item" onclick="openEntryEditor('${escAttr(entry.id)}')">${editIcon} Edit entry</button>` : '';
  const undeleteItem = isDeleted
    ? `<button class="card-menu-item card-menu-item--restore" onclick="unmarkEntryForDeletion('${escAttr(entry.id)}')">${restoreIcon} Unmark for deletion</button>`
    : '';

  // .filter(Boolean) will automatically remove any empty strings (like missing summaries/timestamps) and .join('') mashes the surviving items together without dividers.
  const group1 = [watchItem, progItem].filter(Boolean).join('');
  const group2 = [summItem, tsItem].filter(Boolean).join('');
  const group3 = [copyItems].filter(Boolean).join('');
  const group4 = [editItem, undeleteItem].filter(Boolean).join('');

  // .filter(Boolean) will strip out group2 entirely if it's empty so that .join(divider) puts your divider ONLY between the groups that actually survived.
  const menu = document.createElement('div');
  menu.className = 'card-menu-dropdown';
  menu.id        = 'card-menu-dropdown';
  menu.innerHTML = [group1, group2, group3, group4].filter(Boolean).join(divider);
  
  document.body.appendChild(menu);

  // Align the menu's right edge to the button's right edge, shifted up from screen edge if needed
  const rect = event.currentTarget.getBoundingClientRect();
  const mw   = 200;
  menu.style.left = Math.max(8, Math.min(rect.right - mw, window.innerWidth - mw - 8)) + 'px';
  menu.style.top  = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
}

function closeCardMenu() {
  document.getElementById('card-menu-dropdown')?.remove();
  activeCardMenu = null;
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Fallback for browsers that don't support the Clipboard API
    const ta = Object.assign(document.createElement('textarea'), {
      value: url, style: 'position:fixed;opacity:0'
    });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  closeCardMenu();
}

// ── Sidebar (mobile drawer) ───────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('visible');
  document.body.style.overflow = '';
}

// ── Filters ───────────────────────────────────────────────────
function filterBy(cat, value) {
  const set = state.filters[cat];
  if (set.has(value)) set.delete(value);
  else set.add(value);

  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

function clearTagFilters() {
  Object.values(state.filters).forEach(s => s.clear());
  render();
}

function clearDateFilters() {
  state.dateFrom = null;
  state.dateTo   = null;
  clearDateInputs('from');
  clearDateInputs('to');
  render();
}

function clearAllFilters() {
  Object.values(state.filters).forEach(s => s.clear());
  state.search     = '';
  state.dateFrom   = null;
  state.dateTo     = null;
  state.watch      = 'all';
  state.inProgress = false;
  state.safari     = 'all';
  document.getElementById('search-input').value        = '';
  document.getElementById('mobile-search-input').value = '';
  document.getElementById('search-clear-btn').style.display        = 'none';
  document.getElementById('mobile-search-clear-btn').style.display = 'none';
  const mobileClearAll = document.getElementById('mobile-clear-all-btn');
  if (mobileClearAll) mobileClearAll.style.display = 'none';
  clearDateInputs('from');
  clearDateInputs('to');
  // Reset watch toggle UI
  document.querySelectorAll('.watch-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.watch === 'all'));
  document.querySelectorAll('.safari-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.safari === 'all'));
  const ipBtn = document.getElementById('in-progress-btn');
  ipBtn.style.display  = 'none';
  ipBtn.dataset.active = 'false';
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

// ── Overlay helpers ───────────────────────────────────────────
// Centralised open/close for any popup that uses the shared modal-backdrop.
// Avoids repeating the same three lines in every open/close function.
function openOverlay(popupId) {
  document.getElementById(popupId).style.display        = '';
  document.getElementById('modal-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeOverlay(popupId) {
  document.getElementById(popupId).style.display         = 'none';
  document.getElementById('modal-backdrop').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Summary popup ─────────────────────────────────────────────
function openSummary(entryId) {
  closeCardMenu();
  const entry = appearancesById.get(entryId);
  if (!entry?.summary) return;
  document.getElementById('summary-title').textContent = getCardTitle(entry);
  document.getElementById('summary-text').textContent  = entry.summary;
  openOverlay('summary-popup');
}

function closeSummary() { closeOverlay('summary-popup'); }

// ── Timestamps popup ──────────────────────────────────────────
function openTimestamps(entryId) {
  closeCardMenu();
  const entry = appearancesById.get(entryId);
  if (!entry?.timestamps?.length) return;
  
  document.getElementById('timestamps-title').textContent = getCardTitle(entry);
  
  const listHtml = entry.timestamps.map(hl => {
    const vod = entry.vods[hl.vod_index];
    if (!vod) return '';
    
    // Construct direct timestamped link for YouTube
    const url = `https://youtu.be/${vod.video_id}?t=${hl.timestamp_seconds}`;
    
    // --- 🌟 Calculate Relative Collab Time ---
    let relativeSecs = hl.timestamp_seconds - (vod.timestamp_seconds || 0);

    // If it's a sequential multi-parter, add the durations of all previous parts
    const vodMeta = entryMeta[entry.id].vodList[hl.vod_index];
    if (vodMeta.isPart) {
      for (let i = 0; i < hl.vod_index; i++) {
        if (entry.vods[i].streamer === vod.streamer) {
          const prevDuration = (entry.vods[i].timestamp_end_seconds || 0) - (entry.vods[i].timestamp_seconds || 0);
          if (prevDuration > 0) relativeSecs += prevDuration;
        }
      }
    }
    
    // Prevent negative timestamps just in case the data is weird
    const timeStr = formatDuration(Math.max(0, relativeSecs));

    // If it's a multi-POV/multi-part stream, tell them which VOD it belongs to
    const streamerLabel = entry.vods.length > 1;
    
    return `
      <a href="${url}" target="_blank" rel="noopener" class="timestamp-item">
        <div class="timestamp-title">${escHtml(hl.title)}</div>
        <div class="timestamp-time">${streamerLabel ? `<span class="timestamp-streamer">${escHtml(entryMeta[entry.id].vodList[hl.vod_index].label)}</span><span class="timestamp-time-sep">·</span>` : ''}${timeStr}</div>
      </a>
    `;
  }).join('');
  
  document.getElementById('timestamps-list').innerHTML = listHtml;
  openOverlay('timestamps-popup');
}

function closeTimestamps() { closeOverlay('timestamps-popup'); }

// ── About modal ───────────────────────────────────────────────
function openModal()  { openOverlay('modal'); }
function closeModal() { closeOverlay('modal'); }

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t   => t.classList.toggle('active', t.dataset.tab   === tab));
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}

// ── Progress popup ─────────────────────────────────────────────
let currentProgressEntry   = null;
let pendingProgressSeconds = null;
let pendingProgressVodIndex = null;

function openProgressPopup(entryId) {
  closeCardMenu();
  const entry = appearancesById.get(entryId);
  if (!entry) return;
  currentProgressEntry = entry;

  document.getElementById('progress-title').textContent = getCardTitle(entry);
  document.getElementById('prog-hh').value              = '';
  document.getElementById('prog-mm').value              = '';
  document.getElementById('prog-ss').value              = '';
  document.getElementById('progress-watched-prompt').style.display = 'none';
  document.getElementById('progress-actions').style.display        = 'flex';

  // Show VOD selector and hint only for multi-part entries
  const select = document.getElementById('progress-vod-select');
  const meta    = entryMeta[entry.id];
  const isParts = meta.isParts;
  select.style.display = meta.isMulti ? '' : 'none';
  document.querySelector('.progress-hint').style.display = isParts ? '' : 'none';
  select.innerHTML = entry.vods.map((v, i) =>
    `<option value="${i}">${escHtml(meta.vodList[i].label)}</option>`
  ).join('');

  // Pre-fill with existing progress if present
  const p = userProgress[entryId];
  if (p) {
    select.value = p.vodIndex ?? 0;
    if (p.seconds !== null && p.seconds !== undefined) {
      const h = Math.floor(p.seconds / 3600);
      const m = Math.floor((p.seconds % 3600) / 60);
      const s = p.seconds % 60;
      if (h)      document.getElementById('prog-hh').value = String(h).padStart(2, '0');
      if (m || h) document.getElementById('prog-mm').value = String(m).padStart(2, '0');
      document.getElementById('prog-ss').value = String(s).padStart(2, '0');
    }
    // If seconds is null, leave fields blank — user only saved a part marker
  }

  openOverlay('progress-popup');
}

function closeProgress() {
  closeOverlay('progress-popup');
  currentProgressEntry   = null;
  pendingProgressSeconds = 0;
  pendingProgressVodIndex = null;
}

// Auto-advance focus to next input after 2 digits are entered
function handleProgressInput(el, nextId) {
  el.value = el.value.replace(/\D/g, '');
  if (el.value.length === 2 && nextId) document.getElementById(nextId).focus();
}

// Move focus back to previous input on backspace when current is empty
function handleProgressBackspace(e, prevId) {
  if (e.key === 'Backspace' && e.target.value === '' && prevId) {
    document.getElementById(prevId).focus();
  }
}

function saveProgressFromPopup() {
  if (!currentProgressEntry) return;

  const hhRaw = document.getElementById('prog-hh').value.trim();
  const mmRaw = document.getElementById('prog-mm').value.trim();
  const ssRaw = document.getElementById('prog-ss').value.trim();
  const allBlank = !hhRaw && !mmRaw && !ssRaw;

  const hh = parseInt(hhRaw || '0', 10);
  const mm = parseInt(mmRaw || '0', 10);
  const ss = parseInt(ssRaw || '0', 10);
  const totalSec = allBlank ? null : hh * 3600 + mm * 60 + ss;
  const vodIndex = parseInt(document.getElementById('progress-vod-select').value, 10) || 0;

  // If the timestamp is past the VOD's known end, ask if they want to mark it watched instead.
  // Skip this check for parts entries — an "over end" timestamp on one part doesn't mean
  // the whole stream is done, and the progress bar clamps it anyway.
  const meta       = entryMeta[currentProgressEntry.id];
  const vodMeta    = meta.vodList[vodIndex];
  const isLastPart = vodMeta.isPart && vodMeta.partNumber === vodMeta.partTotal;
  if (totalSec !== null && (!vodMeta.isPart || isLastPart)) {
    const vod = currentProgressEntry.vods[vodIndex];
    if (vod?.timestamp_end_seconds && totalSec >= vod.timestamp_end_seconds) {
      pendingProgressSeconds  = totalSec;
      pendingProgressVodIndex = vodIndex;
      document.getElementById('progress-watched-prompt').style.display = 'block';
      document.getElementById('progress-actions').style.display        = 'none';
      return;
    }
  }

  finalizeProgressSave(totalSec, vodIndex);
}

function confirmProgressWatched(markWatched) {
  if (markWatched) {
    if (!watchedIds.has(currentProgressEntry.id)) toggleWatched(currentProgressEntry.id);
    closeProgress();
  } else {
    finalizeProgressSave(pendingProgressSeconds, pendingProgressVodIndex);
  }
}

function cancelProgressPrompt() {
  document.getElementById('progress-watched-prompt').style.display = 'none';
  document.getElementById('progress-actions').style.display        = 'flex';
  pendingProgressSeconds = null;
  pendingProgressVodIndex = null;
}

function finalizeProgressSave(seconds, vodIndex) {
  userProgress[currentProgressEntry.id] = { vodIndex, seconds };
  saveUserProgress();
  render();
  closeProgress();
}

function clearProgressFromPopup() {
  if (currentProgressEntry) {
    delete userProgress[currentProgressEntry.id];
    saveUserProgress();
    render();
  }
  closeProgress();
}

function setViewMode(mode) {
  viewMode = mode;
  saveViewMode();
  document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  render();
}

// ── Event bindings ────────────────────────────────────────────
function bindEvents() {
  // Search — desktop and mobile inputs stay in sync
  document.getElementById('search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('mobile-search-input').value = state.search;
    document.getElementById('search-clear-btn').style.display = state.search ? '' : 'none';
    document.getElementById('mobile-search-clear-btn').style.display = state.search ? '' : 'none';
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });
  document.getElementById('mobile-search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('search-input').value = state.search;
    document.getElementById('mobile-search-clear-btn').style.display = state.search ? '' : 'none';
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });

  document.getElementById('mobile-search-clear-btn').addEventListener('click', () => {
    state.search = '';
    document.getElementById('search-input').value        = '';
    document.getElementById('mobile-search-input').value = '';
    document.getElementById('search-clear-btn').style.display        = 'none';
    document.getElementById('mobile-search-clear-btn').style.display = 'none';
    render();
  });

  document.getElementById('search-clear-btn').addEventListener('click', () => {
    state.search = '';
    document.getElementById('search-input').value        = '';
    document.getElementById('mobile-search-input').value = '';
    document.getElementById('search-clear-btn').style.display = 'none';
    render();
  });

  document.getElementById('date-clear-btn').addEventListener('click', clearDateFilters);

  // Mobile sidebar
  document.getElementById('hamburger-btn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  // Sort buttons — clicking the active sort flips direction; clicking a new one resets to desc
  document.getElementById('sort-options').addEventListener('click', e => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const newSort = btn.dataset.sort;
    state.sortDir = newSort === state.sort ? (state.sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
    state.sort    = newSort;
    document.querySelectorAll('.sort-btn').forEach(b => {
      const active = b.dataset.sort === state.sort;
      b.classList.toggle('active', active);
      const arrow = b.querySelector('.sort-arrow');
      if (arrow) {
        arrow.style.display = active ? '' : 'none';
        arrow.classList.toggle('asc', state.sortDir === 'asc');
      }
    });
    render();
  });

  // Watch status toggle
  document.querySelector('.watch-toggle-wrap').addEventListener('click', e => {
    const btn = e.target.closest('.watch-toggle-btn');
    if (!btn) return;
    state.watch = btn.dataset.watch;
    document.querySelectorAll('.watch-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    const ipBtn = document.getElementById('in-progress-btn');
    if (state.watch === 'unwatched') {
      ipBtn.style.display = '';
    } else {
      ipBtn.style.display = 'none';
      state.inProgress = false;
      ipBtn.dataset.active = 'false';
    }
    render();
  });

  // Safari toggle
  document.querySelector('.safari-toggle-wrap').addEventListener('click', e => {
    const btn = e.target.closest('.safari-toggle-btn');
    if (!btn) return;
    state.safari = btn.dataset.safari;
    document.querySelectorAll('.safari-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  
  document.getElementById('in-progress-btn').addEventListener('click', () => {
    const ipBtn = document.getElementById('in-progress-btn');
    state.inProgress = ipBtn.dataset.active !== 'true';
    ipBtn.dataset.active = String(state.inProgress);
    render();
  });

  // Sidebar filter chips
  document.getElementById('filter-groups').addEventListener('click', e => {
    const btn = e.target.closest('.filter-chip');
    if (btn) filterBy(btn.dataset.cat, btn.dataset.value);
  });

  document.getElementById('clear-filters').addEventListener('click', clearTagFilters);

  // Close POV dropdown and card menu on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('pov-dropdown').contains(e.target)) closePovDropdown();
    if (activeCardMenu && !e.target.closest('#card-menu-dropdown') && !e.target.closest('.card-menu-btn')) closeCardMenu();
    // Close progress/summary/modal popups when clicking the backdrop
    if (e.target.id === 'modal-backdrop') {
      closeProgress();
      closeSummary();
      closeModal();
      closeSettings();
      closeTimestamps();
    }
  });

  window.addEventListener('scroll', () => {
    closePovDropdown();
    closeCardMenu();
  }, { passive: true });

  // Modal tab switching
  document.getElementById('modal')?.addEventListener('click', e => {
    const tab = e.target.closest('.modal-tab');
    if (tab) switchModalTab(tab.dataset.tab);
  });

  // Settings modal tab switching
  document.getElementById('settings-modal')?.addEventListener('click', e => {
    const tab = e.target.closest('.modal-tab');
    if (tab) switchSettingsTab(tab.dataset.tab);
  });

  // Escape closes any open overlay
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeModal();
    closeSettings();
    closeSummary();
    closeProgress();
    closeTimestamps();
  });

  // Re-measure chip overflow when the window is resized
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyChipOverflow, 150);
  }, { passive: true });
  
  // Mobile view toggle
  document.querySelector('.mobile-view-toggle-wrap').addEventListener('click', e => {
    const btn = e.target.closest('.view-toggle-btn');
    if (btn) setViewMode(btn.dataset.view);
  });

  bindDateRangeEvents();
}

// ── Escape helpers ────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  if (!str) return '';
  // Only double-quotes need escaping inside value="..." HTML attributes.
  // Single quotes are safe as-is — escaping them to \' corrupts the value
  // when it's read back from the DOM (the backslash becomes part of the string).
  return str.replace(/"/g, '&quot;');
}

// ── Sync UI Controls from Loaded State ────────────────────────
function syncUIFromState() {
  // 1. Fill the search fields with the loaded search parameter
  const searchInput = document.getElementById('search-input');
  const mobileSearchInput = document.getElementById('mobile-search-input');
  if (searchInput) searchInput.value = state.search;
  if (mobileSearchInput) mobileSearchInput.value = state.search;

  // 2. Set the active class and arrow directions on the sort buttons
  document.querySelectorAll('.sort-btn').forEach(b => {
    const active = b.dataset.sort === state.sort;
    b.classList.toggle('active', active);
    const arrow = b.querySelector('.sort-arrow');
    if (arrow) {
      arrow.style.display = active ? '' : 'none';
      arrow.classList.toggle('asc', state.sortDir === 'asc');
    }
  });

  // 3. Highlight the correct watch status toggle button (All, Watched, Unwatched)
  document.querySelectorAll('.watch-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.watch === state.watch);
  });

  // 4. Highlight the correct in-progress button
  const ipBtn = document.getElementById('in-progress-btn');

  // 5. Highlight the correct Safari toggle
  document.querySelectorAll('.safari-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.safari === state.safari);
  });

  if (state.watch === 'unwatched') {
    ipBtn.style.display = '';
    ipBtn.dataset.active = String(state.inProgress);
  } else {
    ipBtn.style.display = 'none';
  }

  // 5. Restore date range inputs
  if (state.dateFrom) fillDateInputs('from', state.dateFrom);
  if (state.dateTo)   fillDateInputs('to',   state.dateTo);

  // 6. Highlight the correct view-mode toggle (grid/list, both desktop and mobile)
  document.querySelectorAll('.view-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewMode);
  });
}

// URL PARAMS HANDING!!!!!
// 1. Take whatever is currently in 'state' and update the browser's URL bar
function updateURLFromState() {
  const params = new URLSearchParams();

  // Handle simple strings
  if (state.search) params.set('search', state.search);
  if (state.sort !== 'date') params.set('sort', state.sort); // only add if not default
  if (state.sortDir !== 'desc') params.set('sortDir', state.sortDir);
  if (state.watch  !== 'all') params.set('watch',  state.watch);
  if (state.safari !== 'all') params.set('safari', state.safari);
  if (state.inProgress) params.set('inProgress', '1');
  if (state.dateFrom) params.set('dateFrom', state.dateFrom);
  if (state.dateTo)   params.set('dateTo',   state.dateTo);

  // Handle filter Sets (convert Set -> Array -> comma-separated string)
  for (const [key, set] of Object.entries(state.filters)) {
    if (set.size > 0) {
      params.set(key, Array.from(set).join(','));
    }
  }

  // Construct the new URL string
  const queryString = params.toString();
  const newUrl = `${window.location.pathname}${queryString ? '?' + queryString : ''}`;

  // Update the URL bar without reloading the page
  window.history.replaceState(null, '', newUrl);

  // Update the stats page link
  const statsLink = document.querySelector('.stats-page-link');
  if (statsLink) statsLink.href = 'stats/' + window.location.search;
}

// 2. Look at the URL bar and overwrite 'state' with what we find
function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('search')) state.search = params.get('search');
  if (params.has('sort'))   state.sort = params.get('sort');
  if (params.has('sortDir')) state.sortDir = params.get('sortDir');
  if (params.has('watch'))  state.watch  = params.get('watch');
  if (params.has('safari')) state.safari = params.get('safari');
  if (params.has('inProgress')) state.inProgress = params.get('inProgress') === '1';
  if (params.has('dateFrom'))   state.dateFrom   = params.get('dateFrom');
  if (params.has('dateTo'))     state.dateTo     = params.get('dateTo');

  // Convert comma-separated strings back into Sets for your filters
  for (const key of Object.keys(state.filters)) {
    if (params.has(key)) {
      const values = params.get(key).split(',');
      state.filters[key] = new Set(values);
    }
  }
}

// ── Date range filter ─────────────────────────────────────────
function fillDateInputs(side, iso) {
  // iso is 'YYYY-MM-DD'
  const [y, m, d] = iso.split('-');
  document.getElementById(`dr-${side}-yyyy`).value = y || '';
  document.getElementById(`dr-${side}-mm`).value   = m || '';
  document.getElementById(`dr-${side}-dd`).value   = d || '';
}

function clearDateInputs(side) {
  ['yyyy','mm','dd'].forEach(p => {
    document.getElementById(`dr-${side}-${p}`).value = '';
  });
}

function readDateInputs(side) {
  // Returns 'YYYY-MM-DD' if the inputs form a plausible date, else null
  const y = document.getElementById(`dr-${side}-yyyy`).value.trim();
  const m = document.getElementById(`dr-${side}-mm`).value.trim();
  const d = document.getElementById(`dr-${side}-dd`).value.trim();
  if (!y && !m && !d) return null;
  // Pad and build — allow partial (year-only, year+month) for fuzzy range edges
  const yy = y.padStart(4, '0');
  const mm = m ? m.padStart(2, '0') : '01';
  const dd = d ? d.padStart(2, '0') : (m ? '01' : '01');
  // Basic sanity check
  const iso = `${yy}-${mm}-${dd}`;
  if (isNaN(Date.parse(iso))) return null;
  return iso;
}

function onDateInputChange(side) {
  if (side === 'from') state.dateFrom = readDateInputs('from');
  else                 state.dateTo   = readDateInputs('to');
  document.getElementById('clear-filters').style.display = hasActiveFilters() ? '' : 'none';
  render();
}

function bindDateRangeEvents() {
  ['from', 'to'].forEach(side => {
    const yyyy = document.getElementById(`dr-${side}-yyyy`);
    const mm   = document.getElementById(`dr-${side}-mm`);
    const dd   = document.getElementById(`dr-${side}-dd`);

    // Auto-advance on full value, backtrack on empty backspace
    yyyy.addEventListener('input', () => {
      yyyy.value = yyyy.value.replace(/\D/g, '');
      if (yyyy.value.length === 4) mm.focus();
      onDateInputChange(side);
    });
    mm.addEventListener('input', () => {
      mm.value = mm.value.replace(/\D/g, '');
      if (mm.value.length === 2) dd.focus();
      onDateInputChange(side);
    });
    dd.addEventListener('input', () => {
      dd.value = dd.value.replace(/\D/g, '');
      onDateInputChange(side);
    });
    mm.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && mm.value === '') yyyy.focus();
    });
    dd.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && dd.value === '') mm.focus();
    });

    // Flatpickr calendar on the button
    const fp = flatpickr(document.getElementById(`dr-${side}-cal`), {
      disableMobile: true,
      clickOpens:    false,   // we manage open ourselves
      allowInput:    false,
      dateFormat:    'Y-m-d',
      minDate:       '2023-01-01',
      maxDate:       'today',
      onChange: (selectedDates, dateStr) => {
        fillDateInputs(side, dateStr);
        onDateInputChange(side);
      },
    });

    document.getElementById(`dr-${side}-cal`).addEventListener('click', e => {
      e.stopPropagation();
      fp.toggle();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY EDITOR — storage bootstrap
//  Must be initialised before init() runs, because render functions
//  (renderCard, renderCardList, openCardMenu) read editorLocal.deleted.
// ═══════════════════════════════════════════════════════════════

const EDITOR_STORAGE_KEY = 'tutel-editor-local';

function loadEditorLocal() {
  try {
    const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
    if (!raw) return { added: [], modified: {}, deleted: new Set() };
    const parsed = JSON.parse(raw);
    return {
      added:    Array.isArray(parsed.added)    ? parsed.added    : [],
      modified: parsed.modified && typeof parsed.modified === 'object' ? parsed.modified : {},
      deleted:  new Set(Array.isArray(parsed.deleted) ? parsed.deleted : []),
    };
  } catch {
    return { added: [], modified: {}, deleted: new Set() };
  }
}

function saveEditorLocal() {
  const toStore = {
    added:    editorLocal.added,
    modified: editorLocal.modified,
    deleted:  [...editorLocal.deleted],
  };
  localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(toStore));
}

// Initialise editor state at load time — must precede init()
const editorLocal = loadEditorLocal();

// Editor mode — off by default, not persisted
let editorMode = false;

function openSettings() {
  // Reset settings modal tabs to Data on every open
  switchSettingsTab('data');
  openOverlay('settings-modal');
}
function closeSettings() { closeOverlay('settings-modal'); }

function switchSettingsTab(tab) {
  document.querySelectorAll('#settings-modal .modal-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('#settings-modal .modal-panel').forEach(p =>
    p.classList.toggle('active', p.dataset.panel === tab));
}

function toggleEditorMode() {
  editorMode = !editorMode;
  const toggle = document.getElementById('editor-mode-toggle');
  toggle.classList.toggle('settings-toggle--on', editorMode);
  toggle.setAttribute('aria-checked', String(editorMode));
  // Show/hide the Edit Colors sidebar button
  const editorBtns = document.getElementById('sidebar-editor-btns');
  if (editorBtns) editorBtns.style.display = editorMode ? '' : 'none';
  // Re-merge and re-render so editor visual markers (deleted/modified/new)
  // appear or disappear without closing the settings popup
  applyEditorLayer();
}

function exportAppearancesJson() {
  // Build the export array: remote data with modifications applied, deleted entries
  // removed, and locally-added entries appended — sorted by date (nulls last).
  const remote = applyEditorLayer._remote || [];
  const merged = [
    // Remote entries: apply modifications, skip deleted
    ...remote
      .filter(e => !editorLocal.deleted.has(e.id))
      .map(e => editorLocal.modified[e.id] ?? e),
    // Locally-added entries
    ...editorLocal.added,
  ].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  // Rebuild every entry with keys in the canonical schema order.
  // JSON.stringify preserves insertion order, so this guarantees consistent
  // output regardless of what order keys arrived in from the original fetch
  // or from readEditorForm on a modified entry.
  const canonicalise = e => ({
    id:                e.id,
    title:             e.title             ?? null,
    date:              e.date              ?? null,
    activities:        e.activities        ?? [],
    games:             e.games             ?? [],
    collab_partners:   e.collab_partners   ?? [],
    appearance_weight: e.appearance_weight ?? 'Full',
    summary:           e.summary           ?? null,
    safari:            e.safari            ?? false,
    vods:              e.vods              ?? [],
    timestamps:        e.timestamps        ?? null,
  });

  const data = JSON.stringify(merged.map(canonicalise), null, 2);
  const url  = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'appearances.json' });
  a.click();
  URL.revokeObjectURL(url);
}

function clearEditorData() {
  const btn = document.getElementById('clear-editor-btn');
  if (btn.dataset.confirming === 'true') {
    editorLocal.added    = [];
    editorLocal.modified = {};
    editorLocal.deleted  = new Set();
    saveEditorLocal();
    colorsLocal.modified = {};
    colorsLocal.added    = {};
    colorsLocal.deleted  = [];
    saveColorsLocal();
    applyEditorLayer();
    buildFilterSidebar();
    render();
    btn.textContent        = 'Clear all editor data';
    btn.dataset.confirming = 'false';
    btn.classList.remove('confirming');
  } else {
    btn.textContent        = 'Are you sure?';
    btn.dataset.confirming = 'true';
    btn.classList.add('confirming');
    setTimeout(() => {
      if (btn.dataset.confirming === 'true') {
        btn.textContent        = 'Clear all editor data';
        btn.dataset.confirming = 'false';
        btn.classList.remove('confirming');
      }
    }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY EDITOR — full modal logic
// ═══════════════════════════════════════════════════════════════

// Apply editor local layer on top of allAppearances and rebuild indexes.
// Call this after any editor save operation.
function applyEditorLayer() {
  // Start from the remote data stored before any editor layer was applied.
  // We store the pristine remote array on first call.
  if (!applyEditorLayer._remote) {
    applyEditorLayer._remote = [...allAppearances];
  }
  const remote = applyEditorLayer._remote;

  // Build merged array:
  // 1. Remote entries (apply modifications; deleted entries stay in the array
  //    so they remain visible in the grid — they're just visually marked)
  const merged = remote.map(e => {
    const mod = editorMode && editorLocal.modified[e.id];
    if (!mod) return e;
    // Merge the modification onto the remote entry, but always keep the real
    // original id. Any id the user typed in the editor is stored as _pendingId
    // and only materialises in the exported JSON — it must never replace e.id
    // here, because everything (card data-id, appearancesById, deleted set, etc.)
    // keys off the real id throughout the session.
    const pendingId = mod.id !== e.id ? mod.id : undefined;
    return { ...mod, id: e.id, ...(pendingId ? { _pendingId: pendingId } : {}) };
  });

  // 2. Append locally-added entries (only shown in editor mode)
  if (editorMode) editorLocal.added.forEach(e => merged.push(e));

  allAppearances = merged;
  buildEntryMeta(allAppearances);
  appearancesById = new Map(allAppearances.map(e => [e.id, e]));
  buildFilterSidebar();
  renderStats();
  render();
}

// ── Deletion helpers ──────────────────────────────────────────
function unmarkEntryForDeletion(entryId) {
  closeCardMenu();
  editorLocal.deleted.delete(entryId);
  saveEditorLocal();
  // Re-render the card in place
  const card = document.querySelector(`[data-id="${entryId}"]`);
  if (card) {
    const entry = appearancesById.get(entryId);
    if (entry) {
      const newHtml = viewMode === 'list' ? renderCardList(entry) : renderCard(entry);
      card.outerHTML = newHtml;
      requestAnimationFrame(() => {
        applyChipOverflowForCard(document.querySelector(`[data-id="${entryId}"]`));
      });
    }
  }
}

// ── Editor modal state ────────────────────────────────────────
let editorEntryId    = null;  // id of the entry being edited (null = new)
let editorIsRemote   = false; // true if editing a GitHub/remote entry
let editorActiveTab  = 'general';

// These hold the live working state of the editor form
let editorVods       = [];    // array of vod draft objects
let editorTimestamps = [];    // array of timestamp draft objects

// Drag state for VOD reordering
let dragSrcIndex = null;

// ── Open blank editor for a new entry ────────────────────────
// Holds the in-progress draft for a brand-new entry that hasn't been saved yet.
// Kept separate from editorLocal.added so that cancelling leaves no trace anywhere.
let _newEntryDraft = null;

function openNewEntry() {
  if (!editorMode) return;
  closeCardMenu();

  // Build a blank draft — NOT pushed to editorLocal.added yet.
  // It only gets committed there when the user actually hits Save.
  _newEntryDraft = {
    id: '',
    title: null,
    date: null,
    activities: [],
    collab_partners: [],
    games: [],
    appearance_weight: 'Full',
    safari: false,
    summary: null,
    vods: [],
    timestamps: null,
  };

  // null signals "this is a new entry with no real id yet"
  editorEntryId   = null;
  editorIsRemote  = false;
  editorActiveTab = 'general';
  editorVods      = [];
  editorTimestamps = [];

  populateEditorGeneral(_newEntryDraft);
  populateEditorVods();
  populateEditorTimestamps();
  populateEditorOther(_newEntryDraft);
  switchEditorTab('general');

  document.getElementById('entry-editor-modal').style.display = '';
  document.getElementById('editor-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
  document.getElementById('editor-modal-title').textContent = 'New Entry';
  ensureEditorFlatpickr();
  if (_editorFlatpickr) _editorFlatpickr.clear();
}

// ── Open editor ───────────────────────────────────────────────
function openEntryEditor(entryId) {
  closeCardMenu();

  const entry = appearancesById.get(entryId);
  if (!entry) return;

  editorEntryId  = entryId;
  editorIsRemote = !editorLocal.added.some(e => e.id === entryId);
  editorActiveTab = 'general';

  // Deep-copy vods and timestamps so we edit clones, not the live data
  editorVods       = entry.vods.map(v => ({ ...v }));
  editorTimestamps = entry.timestamps ? entry.timestamps.map(t => ({ ...t })) : [];

  // Populate all fields
  populateEditorGeneral(entry);
  populateEditorVods();
  populateEditorTimestamps();
  populateEditorOther(entry);

  // Switch to General tab
  switchEditorTab('general');

  document.getElementById('entry-editor-modal').style.display = '';
  document.getElementById('editor-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';

  // Set modal header title and init flatpickr
  initEditorOnOpen(entryId);
}

function closeEntryEditor(force = false) {
  if (!force) {
    const btn = document.getElementById('editor-cancel-btn');
    if (btn && btn.dataset.confirming !== 'true') {
      btn.textContent = 'Are you sure?';
      btn.dataset.confirming = 'true';
      setTimeout(() => {
        if (btn.dataset.confirming === 'true') {
          btn.textContent = 'Cancel';
          btn.dataset.confirming = 'false';
        }
      }, 3000);
      return;
    }
  }
  // Actually close
  const btn = document.getElementById('editor-cancel-btn');
  if (btn) { btn.textContent = 'Cancel'; btn.dataset.confirming = 'false'; }
  document.getElementById('entry-editor-modal').style.display = 'none';
  document.getElementById('editor-backdrop').style.display = 'none';
  document.body.style.overflow = '';
  editorEntryId = null;
}

function editorHasUnsavedChanges() {
  // Simple check: always warn when open. Could be smarter later.
  return true;
}

// ── Tab switching ─────────────────────────────────────────────
function switchEditorTab(tab) {
  editorActiveTab = tab;
  document.querySelectorAll('.editor-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.editor-panel').forEach(p =>
    p.classList.toggle('active', p.dataset.panel === tab));
}

// ── General tab ───────────────────────────────────────────────
function populateEditorGeneral(entry) {
  // For remote entries with a pending rename, show the proposed new id in the
  // field — not the real id — so the user can keep editing their draft rename.
  document.getElementById('editor-id').value      = entry._pendingId ?? entry.id ?? '';
  document.getElementById('editor-title').value   = entry.title || '';
  const [ey = '', em = '', ed = ''] = (entry.date || '').split('-');
  document.getElementById('editor-date-yyyy').value = ey;
  document.getElementById('editor-date-mm').value   = em;
  document.getElementById('editor-date-dd').value   = ed;
  document.getElementById('editor-safari').checked = !!entry.safari;

  // Weight
  document.querySelectorAll('.weight-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.weight === entry.appearance_weight);
  });

  // Tag fields
  renderEditorTags('activities',      entry.activities || []);
  renderEditorTags('collab_partners', entry.collab_partners || []);
  renderEditorTags('games',           entry.games || []);

  // Update revert/delete button states
  const revertBtn = document.getElementById('editor-revert-btn');
  const deleteBtn = document.getElementById('editor-delete-btn');
  if (editorIsRemote) {
    revertBtn.style.display = '';
    const isModified = !!editorLocal.modified[editorEntryId];
    revertBtn.disabled = !isModified;
    revertBtn.title = isModified ? 'Revert all changes to the original remote data' : 'No local changes to revert';
    deleteBtn.textContent = editorLocal.deleted.has(editorEntryId) ? 'Unmark for deletion' : 'Mark for deletion';
  } else {
    revertBtn.style.display = 'none';
    deleteBtn.textContent = 'Delete entry';
  }

  // Update auto-ID preview
  updateEditorIdPreview();
}

// ── Tag chip system ───────────────────────────────────────────
// Each tag field is: a chip container + an autocomplete input
function getEditorTags(fieldKey) {
  const container = document.getElementById(`editor-tags-${fieldKey}`);
  return [...container.querySelectorAll('.editor-tag-chip')].map(c => c.dataset.value);
}

function renderEditorTags(fieldKey, values) {
  const container = document.getElementById(`editor-tags-${fieldKey}`);
  container.innerHTML = values.map(v => buildTagChip(fieldKey, v)).join('');
}

function buildTagChip(fieldKey, value) {
  const color = getColor(fieldKey, value);
  const style = `background:${color}22;color:${color};border-color:${color}44;`;
  return `<span class="editor-tag-chip" data-field="${escAttr(fieldKey)}" data-value="${escAttr(value)}" style="${style}">
    ${escHtml(value)}<button class="editor-tag-remove" onclick="removeEditorTag('${escAttr(fieldKey)}','${escAttr(value)}')" title="Remove">×</button>
  </span>`;
}

function removeEditorTag(fieldKey, value) {
  const tags = getEditorTags(fieldKey).filter(v => v !== value);
  renderEditorTags(fieldKey, tags);
  // If removing a collab partner, refresh streamer autocomplete scope
  if (fieldKey === 'collab_partners') refreshVodStreamerOptions();
}

function addEditorTag(fieldKey, value) {
  value = value.trim();
  if (!value) return;
  const existing = getEditorTags(fieldKey);
  if (existing.includes(value)) return; // no duplicates
  renderEditorTags(fieldKey, [...existing, value]);
  if (fieldKey === 'collab_partners') refreshVodStreamerOptions();
}

function handleTagInput(event, fieldKey) {
  const input = event.target;
  const val   = input.value;

  // Tab autocompletes the top suggestion
  if (event.type === 'keydown' && event.key === 'Tab') {
    if (_suggestionEl && _suggestionEl.style.display !== 'none' && _suggestionField === fieldKey) {
      const first = _suggestionEl.querySelector('.editor-suggestion-item');
      if (first) {
        event.preventDefault();
        first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        // Re-show suggestions for the next tag after a short tick
        setTimeout(() => showTagSuggestions(fieldKey, ''), 0);
        return;
      }
    }
    // No suggestions open — let Tab move focus naturally
  }

  // Enter or comma commits the typed value
  if (event.type === 'keydown' && (event.key === 'Enter' || event.key === ',')) {
    event.preventDefault();
    const typed = val.replace(/,$/, '').trim();
    if (typed) {
      addEditorTag(fieldKey, typed);
      input.value = '';
    }
    // Re-show full suggestion list so user can keep picking without re-clicking
    setTimeout(() => showTagSuggestions(fieldKey, ''), 0);
    return;
  }

  // Backspace on empty input removes last tag
  if (event.type === 'keydown' && event.key === 'Backspace' && val === '') {
    const tags = getEditorTags(fieldKey);
    if (tags.length) {
      renderEditorTags(fieldKey, tags.slice(0, -1));
      if (fieldKey === 'collab_partners') refreshVodStreamerOptions();
    }
    return;
  }

  // Typing — show suggestions
  if (event.type === 'input') {
    showTagSuggestions(fieldKey, val);
  }
}

function getKnownValues(fieldKey) {
  // Collect all known values for this field from the remote dataset
  if (!applyEditorLayer._remote) return [];
  const remote = applyEditorLayer._remote;
  return [...new Set(remote.flatMap(e => e[fieldKey] || []))].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()));
}

// Single shared suggestion popup, appended to <body> so CSS transform on the
// modal doesn't corrupt fixed positioning.
let _suggestionEl   = null;
let _suggestionField = null; // which fieldKey is currently shown

function getOrCreateSuggestionEl() {
  if (!_suggestionEl) {
    _suggestionEl = document.createElement('div');
    _suggestionEl.className = 'editor-suggestions';
    _suggestionEl.style.display = 'none';
    document.body.appendChild(_suggestionEl);
  }
  return _suggestionEl;
}

function showTagSuggestions(fieldKey, query) {
  const list = getOrCreateSuggestionEl();
  _suggestionField = fieldKey;

  const q = query.toLowerCase().trim();
  const existing = new Set(getEditorTags(fieldKey));
  const matches = getKnownValues(fieldKey).filter(v =>
    !existing.has(v) && (q === '' || v.toLowerCase().includes(q))
  );
  if (!matches.length) { hideTagSuggestions(); return; }

  list.innerHTML = matches.map((v, i) => {
    const color = getColor(fieldKey, v);
    return `<button class="editor-suggestion-item${i === 0 ? ' editor-suggestion-item--top' : ''}" onmousedown="event.preventDefault();addEditorTag('${escAttr(fieldKey)}','${escAttr(v)}');document.getElementById('editor-tag-input-${fieldKey}').value='';hideTagSuggestions()">
      <span class="editor-suggestion-dot" style="background:${color}"></span>${escHtml(v)}${i === 0 ? '<span class="editor-suggestion-tab-hint">Tab</span>' : ''}
    </button>`;
  }).join('');

  // Anchor to the tag field box so width/left are stable regardless of chip count.
  // getBoundingClientRect() is viewport-space; since the suggestion el is a direct
  // child of <body> with no transformed ancestor, fixed coords map 1:1 to viewport.
  const anchor = document.getElementById(`editor-tagfield-${fieldKey}`);
  if (!anchor) { list.style.display = 'none'; return; }

  const rect = anchor.getBoundingClientRect();
  const gap  = 6;

  list.style.left    = rect.left + 'px';
  list.style.width   = rect.width + 'px';
  list.style.top     = '-9999px';
  list.style.display = '';

  const popupHeight = Math.min(list.scrollHeight, 240);
  const spaceBelow  = window.innerHeight - rect.bottom - gap;
  list.style.top = (spaceBelow >= popupHeight || rect.top < popupHeight + gap)
    ? (rect.bottom + gap) + 'px'              // below (preferred)
    : (rect.top - popupHeight - gap) + 'px';  // above (fallback)
}

function hideTagSuggestions() {
  if (_suggestionEl) _suggestionEl.style.display = 'none';
  _suggestionField = null;
}

// ── ID auto-generation ────────────────────────────────────────
function updateEditorIdPreview() {
  // Only auto-update if the user hasn't manually changed the ID for a new entry.
  // For existing entries, show validation state only.
  const idInput = document.getElementById('editor-id');
  validateEditorId(idInput.value);
}

function autoGenerateId() {
  // Build slug from title override, or first VOD title, or partners
  let source = document.getElementById('editor-title').value.trim();
  if (!source && editorVods.length && editorVods[0].vod_title) {
    source = editorVods[0].vod_title;
  }
  if (!source) {
    const partners = getEditorTags('collab_partners');
    source = partners.join(' ');
  }
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '');
  document.getElementById('editor-id').value = slug;
  validateEditorId(slug);
}

function validateEditorId(value) {
  const indicator = document.getElementById('editor-id-indicator');
  if (!value) {
    indicator.textContent = '';
    indicator.className = 'editor-id-indicator';
    return false;
  }
  const idPattern = /^[a-z0-9-]+$/;
  if (!idPattern.test(value)) {
    indicator.textContent = 'Only lowercase letters, numbers, and hyphens';
    indicator.className = 'editor-id-indicator editor-id-indicator--error';
    return false;
  }
  // Check uniqueness — allow the current entry's own real id and its own pending rename.
  // We check both e.id (real ids in allAppearances) and e._pendingId (other entries'
  // pending renames) so we catch collisions in both directions.
  const isDuplicate = allAppearances.some(e => {
    if (e.id === editorEntryId) return false; // this is the entry being edited — skip it
    return e.id === value || e._pendingId === value;
  });
  if (isDuplicate) {
    indicator.textContent = 'ID already in use';
    indicator.className = 'editor-id-indicator editor-id-indicator--error';
    return false;
  }
  indicator.textContent = '✓';
  indicator.className = 'editor-id-indicator editor-id-indicator--ok';
  return true;
}

// ── Shared drag-to-reorder engine ────────────────────────────
// Works for any list: pass the container, the data array to mutate, and a callback to re-render after a successful drop.
// Rows must have [draggable="true"] on their handle child (.drag-handle),
function moveVodRow(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= editorVods.length) return;
  const moved = editorVods.splice(index, 1)[0];
  editorVods.splice(newIndex, 0, moved);
  // Fix timestamp vod_index references
  editorTimestamps = editorTimestamps.map(t => {
    if (t.vod_index === index)    return { ...t, vod_index: newIndex };
    if (direction === -1 && t.vod_index === newIndex) return { ...t, vod_index: index };
    if (direction ===  1 && t.vod_index === newIndex) return { ...t, vod_index: index };
    return t;
  });
  renderVodList();
  syncTimestampVodDropdowns();
}

function moveTsRow(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= editorTimestamps.length) return;
  const moved = editorTimestamps.splice(index, 1)[0];
  editorTimestamps.splice(newIndex, 0, moved);
  renderTimestampList();
}

// ── VODs tab ──────────────────────────────────────────────────
function populateEditorVods() {
  renderVodList();
}

function renderVodList() {
  const container = document.getElementById('editor-vods-list');
  if (!editorVods.length) {
    container.innerHTML = `<p class="editor-empty-hint">No VODs yet. Add one below.</p>`;
    syncTimestampVodDropdowns();
    return;
  }
  container.innerHTML = editorVods.map((vod, i) => buildVodRow(vod, i)).join('');
  syncTimestampVodDropdowns();
}

function buildVodRow(vod, index) {
  const startHms = secsToHms(vod.timestamp_seconds);
  const endHms   = secsToHms(vod.timestamp_end_seconds);

  // Streamer options: all current collab_partners
  const partners = getEditorTags('collab_partners');
  const streamerOptions = partners.map(p =>
    `<option value="${escAttr(p)}" ${p === vod.streamer ? 'selected' : ''}>${escHtml(p)}</option>`
  ).join('');
  const noPartnersNote = partners.length === 0
    ? `<option value="">— add partners first —</option>`
    : `<option value="" ${!vod.streamer ? 'selected' : ''}>— select —</option>`;

  return `
    <div class="vod-row" data-drag-index="${index}">
      <div class="vod-row-handle">
        <span class="vod-index-badge">${index}</span>
        <button class="row-move-btn" onclick="moveVodRow(${index},-1)" title="Move up" ${index === 0 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="row-move-btn" onclick="moveVodRow(${index},1)" title="Move down" ${index === editorVods.length - 1 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="vod-row-fields">
        <div class="vod-field vod-field--title">
          <label class="vod-field-label">VOD Title</label>
          <input class="vod-input vod-input--scrollable" type="text" value="${escAttr(vod.vod_title || '')}"
            placeholder="Paste the exact YouTube title"
            onchange="updateVodField(${index},'vod_title',this.value)">
        </div>
        <div class="vod-row-lower">
          <div class="vod-field vod-field--streamer">
            <label class="vod-field-label">Streamer</label>
            <select class="vod-select" onchange="updateVodField(${index},'streamer',this.value)">
              ${noPartnersNote}${streamerOptions}
            </select>
          </div>
          <div class="vod-field vod-field--videoid">
            <label class="vod-field-label">Video ID</label>
            <input class="vod-input" type="text" value="${escAttr(vod.video_id || '')}"
              placeholder="e.g. dQw4w9WgXcQ"
              onchange="updateVodField(${index},'video_id',this.value)">
          </div>
          <div class="vod-field vod-field--ts">
            <label class="vod-field-label">Start</label>
            ${buildHmsInput(`vod-start-${index}`, startHms, `onVodHmsChange(${index},'start')`)}
          </div>
          <div class="vod-field vod-field--ts">
            <label class="vod-field-label">End</label>
            ${buildHmsInput(`vod-end-${index}`, endHms, `onVodHmsChange(${index},'end')`)}
          </div>
        </div>
      </div>
      <button class="vod-remove-btn" onclick="removeVodRow(${index})" title="Remove VOD">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function buildHmsInput(id, hms, onchangeCall) {
  return `<div class="hms-input" id="${id}">
    <input class="hms-field" type="text" maxlength="2" placeholder="HH" value="${hms.h}"
      oninput="this.value=this.value.replace(/\\D/g,'');if(this.value.length===2)this.nextElementSibling.nextElementSibling.focus();${onchangeCall}"
      onkeydown="if(event.key==='Backspace'&&this.value===''){}" >
    <span class="hms-sep">:</span>
    <input class="hms-field" type="text" maxlength="2" placeholder="MM" value="${hms.m}"
      oninput="this.value=this.value.replace(/\\D/g,'');if(this.value.length===2)this.nextElementSibling.nextElementSibling.focus();${onchangeCall}"
      onkeydown="if(event.key==='Backspace'&&this.value==='')this.previousElementSibling.previousElementSibling.focus()">
    <span class="hms-sep">:</span>
    <input class="hms-field" type="text" maxlength="2" placeholder="SS" value="${hms.s}"
      oninput="this.value=this.value.replace(/\\D/g,'');${onchangeCall}"
      onkeydown="if(event.key==='Backspace'&&this.value==='')this.previousElementSibling.previousElementSibling.focus()">
  </div>`;
}

function updateVodField(index, field, value) {
  if (editorVods[index]) editorVods[index][field] = value;
}

function onVodHmsChange(index, side) {
  const prefix = `vod-${side}-${index}`;
  const secs   = hmsInputToSecs(prefix);
  if (side === 'start') editorVods[index].timestamp_seconds     = secs;
  else                  editorVods[index].timestamp_end_seconds = secs;
}

function hmsInputToSecs(prefix) {
  const el = document.getElementById(prefix);
  if (!el) return null;
  const inputs = el.querySelectorAll('.hms-field');
  const hh = parseInt(inputs[0]?.value || '0', 10) || 0;
  const mm = parseInt(inputs[1]?.value || '0', 10) || 0;
  const ss = parseInt(inputs[2]?.value || '0', 10) || 0;
  const allBlank = !inputs[0]?.value && !inputs[1]?.value && !inputs[2]?.value;
  return allBlank ? null : hh * 3600 + mm * 60 + ss;
}

function secsToHms(secs) {
  if (secs == null) return { h: '', m: '', s: '' };
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return {
    h: h > 0 ? String(h).padStart(2, '0') : '',
    m: (h > 0 || m > 0) ? String(m).padStart(2, '0') : '',
    s: String(s).padStart(2, '0'),
  };
}

function addVodRow() {
  const partners = getEditorTags('collab_partners');
  editorVods.push({
    vod_title:            '',
    streamer:             partners[0] || '',
    video_id:             '',
    timestamp_seconds:    null,
    timestamp_end_seconds: null,
  });
  renderVodList();
}

function removeVodRow(index) {
  editorVods.splice(index, 1);
  // Fix any timestamp vod_index references that pointed at removed/shifted vods
  editorTimestamps = editorTimestamps.map(t => {
    if (t.vod_index === index) return { ...t, vod_index: Math.max(0, index - 1) };
    if (t.vod_index > index)  return { ...t, vod_index: t.vod_index - 1 };
    return t;
  });
  renderVodList();
  renderTimestampList();
}

function refreshVodStreamerOptions() {
  // When collab partners change, re-render the vod list so streamer dropdowns update
  renderVodList();
}

// ── Timestamps tab ────────────────────────────────────────────
function populateEditorTimestamps() {
  renderTimestampList();
}

function renderTimestampList() {
  const container = document.getElementById('editor-timestamps-list');
  if (!editorTimestamps.length) {
    container.innerHTML = `<p class="editor-empty-hint">No timestamps yet. Add one below.</p>`;
    return;
  }
  container.innerHTML = editorTimestamps.map((ts, i) => buildTimestampRow(ts, i)).join('');
}

function buildTimestampRow(ts, index) {
  const hms = secsToHms(ts.timestamp_seconds);
  // VOD index dropdown: options 0..N-1 based on current editorVods length
  const vodCount   = Math.max(1, editorVods.length);
  const vodOptions = Array.from({ length: vodCount }, (_, i) =>
    `<option value="${i}" ${ts.vod_index === i ? 'selected' : ''}>${i}</option>`
  ).join('');

  return `
    <div class="ts-row" data-drag-index="${index}">
      <div class="ts-move-btns">
        <button class="row-move-btn" onclick="moveTsRow(${index},-1)" title="Move up" ${index === 0 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="row-move-btn" onclick="moveTsRow(${index},1)" title="Move down" ${index === editorTimestamps.length - 1 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="ts-row-fields">
        <div class="ts-field ts-field--title">
          <label class="vod-field-label">Title</label>
          <input class="vod-input vod-input--scrollable" type="text" value="${escAttr(ts.title || '')}"
            placeholder="e.g. That's the eject button, Layna."
            onchange="updateTsField(${index},'title',this.value)">
        </div>
        <div class="ts-row-lower">
          <div class="ts-field ts-field--time">
            <label class="vod-field-label">Timestamp</label>
            ${buildHmsInput(`ts-time-${index}`, hms, `onTsHmsChange(${index})`)}
          </div>
          <div class="ts-field ts-field--vod">
            <label class="vod-field-label">VOD #</label>
            <select class="vod-select ts-vod-select" onchange="updateTsField(${index},'vod_index',parseInt(this.value))">
              ${vodOptions}
            </select>
          </div>
        </div>
      </div>
      <button class="vod-remove-btn ts-remove-btn" onclick="removeTsRow(${index})" title="Remove timestamp">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

function updateTsField(index, field, value) {
  if (editorTimestamps[index]) editorTimestamps[index][field] = value;
}

function onTsHmsChange(index) {
  const secs = hmsInputToSecs(`ts-time-${index}`);
  if (editorTimestamps[index]) editorTimestamps[index].timestamp_seconds = secs;
}

function addTimestampRow() {
  editorTimestamps.push({ title: '', timestamp_seconds: null, vod_index: 0 });
  renderTimestampList();
}

function removeTsRow(index) {
  editorTimestamps.splice(index, 1);
  renderTimestampList();
}

function syncTimestampVodDropdowns() {
  // After vod reorder/add/remove, re-render the timestamps tab so VOD dropdowns update
  renderTimestampList();
}

// ── Other tab ─────────────────────────────────────────────────
function populateEditorOther(entry) {
  document.getElementById('editor-summary').value = entry.summary || '';
}

// ── Read current form state into an entry object ──────────────
function readEditorForm() {
  // Commit any pending HMS changes from VODs
  editorVods.forEach((_, i) => {
    editorVods[i].timestamp_seconds     = hmsInputToSecs(`vod-start-${i}`);
    editorVods[i].timestamp_end_seconds = hmsInputToSecs(`vod-end-${i}`);
    const titleInput     = document.querySelector(`[data-drag-index="${i}"].vod-row .vod-input--scrollable`);
    const videoIdInput   = document.querySelector(`[data-drag-index="${i}"].vod-row .vod-input:not(.vod-input--scrollable)`);
    const streamerSelect = document.querySelector(`[data-drag-index="${i}"].vod-row .vod-select`);
    if (titleInput)     editorVods[i].vod_title = titleInput.value;
    if (videoIdInput)   editorVods[i].video_id  = videoIdInput.value;
    if (streamerSelect) editorVods[i].streamer   = streamerSelect.value;
  });
  editorTimestamps.forEach((_, i) => {
    editorTimestamps[i].timestamp_seconds = hmsInputToSecs(`ts-time-${i}`);
    const titleInput  = document.querySelector(`[data-drag-index="${i}"].ts-row .vod-input--scrollable`);
    const vodSelect   = document.querySelector(`[data-drag-index="${i}"].ts-row .ts-vod-select`);
    if (titleInput) editorTimestamps[i].title     = titleInput.value;
    if (vodSelect)  editorTimestamps[i].vod_index = parseInt(vodSelect.value, 10) || 0;
  });

  const activeWeight = document.querySelector('.weight-option.active');

  // Key order matches the canonical schema in appearances.json exactly.
  // JSON.stringify preserves insertion order, so this determines export order.
  return {
    id:                document.getElementById('editor-id').value.trim(),
    title:             document.getElementById('editor-title').value.trim() || null,
    date:              readEditorDate(),
    activities:        getEditorTags('activities'),
    games:             getEditorTags('games'),
    collab_partners:   getEditorTags('collab_partners'),
    appearance_weight: activeWeight ? activeWeight.dataset.weight : 'Full',
    summary:           document.getElementById('editor-summary').value.trim() || null,
    safari:            document.getElementById('editor-safari').checked,
    vods:              editorVods,
    timestamps:        editorTimestamps.length ? editorTimestamps : null,
  };
}

// ── Validation ────────────────────────────────────────────────
function clearEditorValidationErrors() {
  document.querySelectorAll('.editor-field--error').forEach(el => el.classList.remove('editor-field--error'));
  document.querySelectorAll('.vod-input--error, .vod-select--error').forEach(el => el.classList.remove('vod-input--error', 'vod-select--error'));
  const errEl = document.getElementById('editor-save-error');
  if (errEl) errEl.style.display = 'none';
}

function showEditorSaveError(msg) {
  const errEl = document.getElementById('editor-save-error');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = '';
}

function validateEditorForm(entry) {
  const errors = []; // { tab, message, focusId? }

  // ID
  if (!validateEditorId(entry.id)) {
    errors.push({ tab: 'general', message: 'Entry ID is missing or invalid.', focusId: 'editor-id' });
  }

  // Date — year is the minimum requirement
  if (!document.getElementById('editor-date-yyyy').value.trim()) {
    document.getElementById('editor-date-yyyy').classList.add('editor-field--error');
    errors.push({ tab: 'general', message: 'Date is required (at least a year).' });
  }

  // Appearance weight — one must be active
  if (!document.querySelector('.weight-option.active')) {
    errors.push({ tab: 'general', message: 'Appearance Weight must be selected.' });
  }

  // At least one activity tag
  if (!getEditorTags('activities').length) {
    document.getElementById('editor-tagfield-activities').classList.add('editor-field--error');
    errors.push({ tab: 'general', message: 'At least one Activity tag is required.' });
  }

  // At least one collab partner
  if (!getEditorTags('collab_partners').length) {
    document.getElementById('editor-tagfield-collab_partners').classList.add('editor-field--error');
    errors.push({ tab: 'general', message: 'At least one Collab Partner is required.' });
  }

  // VODs
  if (!entry.vods.length) {
    errors.push({ tab: 'vods', message: 'At least one VOD is required.' });
  } else {
    entry.vods.forEach((vod, i) => {
      // Streamer
      if (!vod.streamer) {
        const sel = document.querySelector(`[data-drag-index="${i}"].vod-row .vod-select`);
        if (sel) sel.classList.add('vod-select--error');
        errors.push({ tab: 'vods', message: `VOD ${i}: Streamer must be selected.` });
      }
      // Video ID
      if (!vod.video_id || !vod.video_id.trim()) {
        const inp = document.querySelector(`[data-drag-index="${i}"].vod-row .vod-field--videoid .vod-input`);
        if (inp) inp.classList.add('vod-input--error');
        errors.push({ tab: 'vods', message: `VOD ${i}: Video ID is required.` });
      }
      // Start time
      if (vod.timestamp_seconds == null) {
        const startEl = document.getElementById(`vod-start-${i}`);
        if (startEl) startEl.classList.add('editor-field--error');
        errors.push({ tab: 'vods', message: `VOD ${i}: Start time is required.` });
      }
      // End time
      if (vod.timestamp_end_seconds == null) {
        const endEl = document.getElementById(`vod-end-${i}`);
        if (endEl) endEl.classList.add('editor-field--error');
        errors.push({ tab: 'vods', message: `VOD ${i}: End time is required.` });
      }
    });
  }

  return errors;
}

// ── Save ──────────────────────────────────────────────────────
function saveEditorEntry() {
  clearEditorValidationErrors();
  const entry = readEditorForm();
  const errors = validateEditorForm(entry);

  if (errors.length) {
    // Switch to the tab of the first error
    switchEditorTab(errors[0].tab);
    if (errors[0].focusId) document.getElementById(errors[0].focusId)?.focus();
    // Show summary message in footer
    showEditorSaveError(`Not all required (*) fields are filled. ${errors[0].message}`);
    return;
  }

  // Apply to local layer
  if (editorIsRemote) {
    // Always key by the real original ID so applyEditorLayer can find and replace
    // the correct remote entry. The entry object stores whatever id the user typed
    // (which may differ from editorEntryId), but applyEditorLayer will keep the
    // real id on the merged entry and stash any rename in _pendingId.
    editorLocal.modified[editorEntryId] = entry;
  } else if (editorEntryId === null) {
    // Brand-new entry being saved for the first time — push it into added and
    // clear the temporary draft. From here on it lives in editorLocal.added.
    editorLocal.added.push(entry);
    _newEntryDraft = null;
  } else {
    // Re-edit of an existing local entry — find by its current id and replace.
    const idx = editorLocal.added.findIndex(e => e.id === editorEntryId);
    if (idx !== -1) editorLocal.added[idx] = entry;
    else            editorLocal.added.push(entry); // shouldn't happen, but safe fallback
  }

  saveEditorLocal();
  applyEditorLayer();

  // Close without asking for discard confirmation
  document.getElementById('entry-editor-modal').style.display = 'none';
  document.getElementById('editor-backdrop').style.display = 'none';
  document.body.style.overflow = '';
  editorEntryId = null;
}

// ── Delete / revert ───────────────────────────────────────────
function editorDeleteOrToggle() {
  if (editorIsRemote) {
    const alreadyDeleted = editorLocal.deleted.has(editorEntryId);
    if (alreadyDeleted) {
      editorLocal.deleted.delete(editorEntryId);
    } else {
      editorLocal.deleted.add(editorEntryId);
    }
    saveEditorLocal();
    applyEditorLayer();
    // Close without discard warning since delete is a deliberate action
    document.getElementById('entry-editor-modal').style.display = 'none';
    document.getElementById('editor-backdrop').style.display = 'none';
    document.body.style.overflow = '';
    editorEntryId = null;
  } else {
    // Local-only entry.
    if (editorEntryId === null) {
      // This is an unsaved new-entry draft — nothing has been committed yet,
      // so just discard the draft and close without any confirmation needed.
      _newEntryDraft = null;
      document.getElementById('entry-editor-modal').style.display = 'none';
      document.getElementById('editor-backdrop').style.display = 'none';
      document.body.style.overflow = '';
      editorEntryId = null;
      return;
    }
    // Saved local entry — actually remove it from added.
    if (!confirm('Permanently delete this local entry? This cannot be undone.')) return;
    editorLocal.added = editorLocal.added.filter(e => e.id !== editorEntryId);
    saveEditorLocal();
    applyEditorLayer();
    document.getElementById('entry-editor-modal').style.display = 'none';
    document.getElementById('editor-backdrop').style.display = 'none';
    document.body.style.overflow = '';
    editorEntryId = null;
  }
}

function editorRevertToOriginal() {
  if (!editorIsRemote) return;
  if (!confirm('Revert all changes to this entry? Your edits will be permanently discarded.')) return;
  delete editorLocal.modified[editorEntryId];
  saveEditorLocal();
  applyEditorLayer();
  closeEntryEditor(true);
}

function readEditorDate() {
  const y = document.getElementById('editor-date-yyyy').value.trim();
  const m = document.getElementById('editor-date-mm').value.trim();
  const d = document.getElementById('editor-date-dd').value.trim();
  if (!y) return null;
  const mm = m ? m.padStart(2, '0') : '01';
  const dd = d ? d.padStart(2, '0') : '01';
  return `${y}-${mm}-${dd}`;
}

function selectWeight(btn) {
  document.querySelectorAll('.weight-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Initialise the editor date flatpickr once (lazily, on first open)
let _editorFlatpickr = null;
function ensureEditorFlatpickr() {
  if (_editorFlatpickr) return;
  _editorFlatpickr = flatpickr(document.getElementById('editor-cal-btn'), {
    disableMobile: true,
    clickOpens: false,
    allowInput: false,
    dateFormat: 'Y-m-d',
    minDate: '2023-01-01',
    onChange: (selectedDates, dateStr) => {
      const [y, m, d] = dateStr.split('-');
      document.getElementById('editor-date-yyyy').value = y || '';
      document.getElementById('editor-date-mm').value   = m || '';
      document.getElementById('editor-date-dd').value   = d || '';
    },
  });
  document.getElementById('editor-cal-btn').addEventListener('click', e => {
    e.stopPropagation();
    _editorFlatpickr.toggle();
  });
}

function initEditorOnOpen(entryId) {
  const entry = appearancesById.get(entryId);
  if (entry) {
    document.getElementById('editor-modal-title').textContent = getCardTitle(entry);
  }
  ensureEditorFlatpickr();
  if (_editorFlatpickr) {
    const dateVal = readEditorDate();
    if (dateVal) _editorFlatpickr.setDate(dateVal, false);
    else _editorFlatpickr.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
//  COLORS EDITOR
// ═══════════════════════════════════════════════════════════════

// ── Colors local storage layer ────────────────────────────────
const COLORS_STORAGE_KEY = 'tutel-colors-local';

function loadColorsLocal() {
  try {
    const raw = localStorage.getItem(COLORS_STORAGE_KEY);
    if (!raw) return { modified: {}, added: {}, deleted: [] };
    const p = JSON.parse(raw);
    return {
      modified: p.modified && typeof p.modified === 'object' ? p.modified : {},
      added:    p.added    && typeof p.added    === 'object' ? p.added    : {},
      deleted:  Array.isArray(p.deleted) ? p.deleted : [],
    };
  } catch { return { modified: {}, added: {}, deleted: [] }; }
}

function saveColorsLocal() {
  localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(colorsLocal));
}

const colorsLocal = loadColorsLocal();

// Store the remote colors snapshot for revert/export (set during init)
let _remoteColors = null;

function getRemoteColor(category, key) {
  if (!_remoteColors) return null;
  return (_remoteColors[category] && _remoteColors[category][key]) || null;
}

// ── Colors export ─────────────────────────────────────────────
function exportColorsJson() {
  if (!_remoteColors) return;
  // Deep-clone remote, apply local layer
  const out = JSON.parse(JSON.stringify(_remoteColors));
  const EXCLUDED = new Set(['fallback', 'appearance_weight']);

  // Apply modifications and additions
  Object.entries(colorsLocal.modified).forEach(([k, hex]) => {
    const [cat, tag] = k.split('::');
    if (EXCLUDED.has(cat)) return;
    if (!out[cat]) out[cat] = {};
    out[cat][tag] = hex;
  });
  Object.entries(colorsLocal.added).forEach(([k, hex]) => {
    const [cat, tag] = k.split('::');
    if (EXCLUDED.has(cat)) return;
    if (!out[cat]) out[cat] = {};
    out[cat][tag] = hex;
  });
  // Remove deletions
  colorsLocal.deleted.forEach(k => {
    const [cat, tag] = k.split('::');
    if (out[cat]) delete out[cat][tag];
  });
  // Sort each category alphabetically
  const CATS = ['activities', 'games', 'collab_partners'];
  CATS.forEach(cat => {
    if (out[cat]) {
      out[cat] = Object.fromEntries(
        Object.entries(out[cat]).sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      );
    }
  });

  const data = JSON.stringify(out, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'colors.json' });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Colors editor modal state ─────────────────────────────────
const COLORS_CATEGORIES = [
  { key: 'activities',      label: 'Activities' },
  { key: 'games',           label: 'Games' },
  { key: 'collab_partners', label: 'Collab Partners' },
];
const COLORS_COLLAPSED = new Set(); // category keys that are collapsed

let selectedColorKey = null; // "category::tag" or null
let _colorPicker     = null; // vanilla-picker instance
let _pickerSuppressCallback = false;

function openColorsEditor() {
  renderColorsBrowser();
  colorsShowBrowser();
  document.getElementById('colors-editor-modal').style.display = '';
  document.getElementById('colors-editor-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeColorsEditor() {
  document.getElementById('colors-editor-modal').style.display = 'none';
  document.getElementById('colors-editor-backdrop').style.display = 'none';
  document.body.style.overflow = '';
  selectedColorKey = null;
}

// ── Tag browser ───────────────────────────────────────────────
function renderColorsBrowser() {
  const container = document.getElementById('colors-tag-browser');
  container.innerHTML = COLORS_CATEGORIES.map(cat => {
    const collapsed = COLORS_COLLAPSED.has(cat.key);
    // Gather tags: remote tags + locally added
    const remoteTags = _remoteColors && _remoteColors[cat.key]
      ? Object.keys(_remoteColors[cat.key])
      : [];
    const addedTags = Object.keys(colorsLocal.added)
      .filter(k => k.startsWith(cat.key + '::'))
      .map(k => k.slice(cat.key.length + 2));
    const allTags = [...new Set([...remoteTags, ...addedTags])]
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const tagItems = allTags.map(tag => {
      const localKey = `${cat.key}::${tag}`;
      const isDeleted  = colorsLocal.deleted.includes(localKey);
      const isModified = !isDeleted && !!colorsLocal.modified[localKey];
      const isNew      = !!colorsLocal.added[localKey];
      const currentColor = getColor(cat.key, tag);
      const isSelected = selectedColorKey === localKey;

      let indicators = '';
      if (isNew)      indicators += `<span class="ctag-indicator ctag-indicator--new" title="New tag"></span>`;
      else if (isModified) indicators += `<span class="ctag-indicator ctag-indicator--modified" title="Modified"></span>`;
      if (isDeleted)  indicators += `<span class="ctag-indicator ctag-indicator--deleted" title="Marked for deletion"></span>`;

      return `<button class="ctag-item${isSelected ? ' ctag-item--active' : ''}${isDeleted ? ' ctag-item--deleted' : ''}"
        onclick="selectColorTag('${escAttr(localKey)}')" title="${escAttr(tag)}">
        <span class="ctag-dot" style="background:${currentColor}"></span>
        <span class="ctag-name">${escHtml(tag)}</span>
        ${indicators}
      </button>`;
    }).join('');

    return `
      <div class="ctag-section">
        <button class="ctag-section-header" onclick="toggleColorsSection('${cat.key}')">
          <svg class="ctag-chevron${collapsed ? ' ctag-chevron--collapsed' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          ${escHtml(cat.label)}
          <span class="ctag-section-count">${allTags.length}</span>
        </button>
        <div class="ctag-list${collapsed ? ' ctag-list--collapsed' : ''}">
          ${tagItems}
          <button class="ctag-add-btn" onclick="promptAddColorTag('${escAttr(cat.key)}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add tag
          </button>
        </div>
      </div>`;
  }).join('');
}

function toggleColorsSection(catKey) {
  if (COLORS_COLLAPSED.has(catKey)) COLORS_COLLAPSED.delete(catKey);
  else COLORS_COLLAPSED.add(catKey);
  renderColorsBrowser();
}

function selectColorTag(localKey) {
  selectedColorKey = localKey;
  renderColorsBrowser();
  showColorsPickerForKey(localKey);
  // On mobile, switch to picker view
  if (window.innerWidth <= 650) colorsShowPicker();
}

function promptAddColorTag(catKey) {
  const name = prompt(`New tag name for "${COLORS_CATEGORIES.find(c=>c.key===catKey)?.label}":`);
  if (!name || !name.trim()) return;
  const tag = name.trim();
  const localKey = `${catKey}::${tag}`;
  if (colorsLocal.added[localKey] || (
    _remoteColors && _remoteColors[catKey] && _remoteColors[catKey][tag]
  )) {
    alert('That tag already exists.');
    return;
  }
  // Add with a neutral default color
  colorsLocal.added[localKey] = colors.fallback || '#838c9e';
  saveColorsLocal();
  selectedColorKey = localKey;
  renderColorsBrowser();
  showColorsPickerForKey(localKey);
  refreshAfterColorChange();
}

// ── Color picker panel ────────────────────────────────────────
function showColorsPickerForKey(localKey) {
  const [cat, tag] = localKey.split('::');
  const currentColor = getColor(cat, tag);
  const remoteColor  = getRemoteColor(cat, tag);
  const isDeleted    = colorsLocal.deleted.includes(localKey);
  const isModified   = !!colorsLocal.modified[localKey];
  const isNew        = !!colorsLocal.added[localKey];

  document.getElementById('colors-no-selection').style.display = 'none';
  document.getElementById('colors-picker-active').style.display = '';

  // Tag preview chip
  const chipColor = currentColor;
  document.getElementById('colors-picker-tag-preview').innerHTML =
    `<span class="editor-tag-chip" style="background:${chipColor}22;color:${chipColor};border:1px solid ${chipColor}44;font-size:13px;padding:4px 12px;border-radius:999px">${escHtml(tag)}</span>`;

  // Original swatch
  const swatchEl = document.getElementById('colors-original-swatch');
  if (remoteColor && (isModified)) {
    swatchEl.style.background = remoteColor;
    swatchEl.style.display = 'inline-block';
    swatchEl.title = `Original: ${remoteColor}`;
  } else {
    swatchEl.style.display = 'none';
  }

  // Hex input
  document.getElementById('colors-hex-input').value = currentColor.toUpperCase();

  // Revert button — only shown for remote tags that have local modifications
  const revertBtn = document.getElementById('colors-revert-btn');
  revertBtn.style.display = (isModified && remoteColor) ? '' : 'none';
  revertBtn.disabled = false;

  // Delete button
  const deleteBtn = document.getElementById('colors-delete-btn');
  if (isNew) {
    // New tags get a hard delete (removes from added entirely)
    deleteBtn.style.display = '';
    deleteBtn.textContent = 'Delete tag';
    deleteBtn.onclick = deleteNewColorTag;
  } else {
    // Remote tags get soft delete (marks for deletion, reversible)
    deleteBtn.style.display = '';
    deleteBtn.textContent = isDeleted ? 'Unmark for deletion' : 'Mark for deletion';
    deleteBtn.onclick = toggleColorDeletion;
  }

  // Init or update vanilla-picker
  initOrUpdatePicker(currentColor);
}

function initOrUpdatePicker(hexColor) {
  const mount = document.getElementById('colors-picker-mount');
  if (_colorPicker) {
    _colorPicker.destroy();
    _colorPicker = null;
    mount.innerHTML = '';
  }
  _colorPicker = new Picker({
    parent:  mount,
    popup:   false,
    alpha:   false,
    editor:  false,
    color:   hexColor,
    onChange: (color) => {
      if (_pickerSuppressCallback) return;
      const hex = color.hex.slice(0, 7).toUpperCase();
      document.getElementById('colors-hex-input').value = hex;
      updatePickerPreview(hex);
    },
  });
  // Strip out the built-in UI elements we've replaced with our own: editor input, sample swatch, OK button, alpha slider
  ['.picker_editor', '.picker_sample', '.picker_done', '.picker_alpha'].forEach(sel => {
    mount.querySelector(sel)?.remove();
  });
}

function onColorsHexInput(val) {
  if (!val.startsWith('#')) val = '#' + val;
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return; // wait until complete
  // Update picker without triggering onChange loop
  _pickerSuppressCallback = true;
  if (_colorPicker) _colorPicker.setColor(val, false);
  _pickerSuppressCallback = false;
  updatePickerPreview(val);
}

function updatePickerPreview(hex) {
  // Update tag preview chip live
  const [, tag] = (selectedColorKey || '::').split('::');
  document.getElementById('colors-picker-tag-preview').innerHTML =
    `<span class="editor-tag-chip" style="background:${hex}22;color:${hex};border:1px solid ${hex}44;font-size:13px;padding:4px 12px;border-radius:999px">${escHtml(tag)}</span>`;
}

function applyColorChange() {
  if (!selectedColorKey) return;
  const hex = document.getElementById('colors-hex-input').value.trim().toUpperCase();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const [cat, tag] = selectedColorKey.split('::');
  const isNew = !!colorsLocal.added[selectedColorKey];

  if (isNew) {
    colorsLocal.added[selectedColorKey] = hex;
  } else {
    colorsLocal.modified[selectedColorKey] = hex;
  }
  saveColorsLocal();
  refreshAfterColorChange();
  renderColorsBrowser();
  showColorsPickerForKey(selectedColorKey); // refresh revert/delete button states
}

function revertColorChange() {
  if (!selectedColorKey) return;
  const isNew = !!colorsLocal.added[selectedColorKey];
  if (isNew) {
    // Revert a new tag = delete it entirely
    if (!confirm('Remove this new tag entirely?')) return;
    delete colorsLocal.added[selectedColorKey];
    saveColorsLocal();
    selectedColorKey = null;
    document.getElementById('colors-no-selection').style.display = '';
    document.getElementById('colors-picker-active').style.display = 'none';
  } else {
    delete colorsLocal.modified[selectedColorKey];
    saveColorsLocal();
    showColorsPickerForKey(selectedColorKey);
  }
  refreshAfterColorChange();
  renderColorsBrowser();
}

function deleteNewColorTag() {
  if (!selectedColorKey) return;
  if (!confirm('Permanently remove this new tag? This cannot be undone.')) return;
  delete colorsLocal.added[selectedColorKey];
  saveColorsLocal();
  selectedColorKey = null;
  document.getElementById('colors-no-selection').style.display = '';
  document.getElementById('colors-picker-active').style.display = 'none';
  refreshAfterColorChange();
  renderColorsBrowser();
}

function toggleColorDeletion() {
  if (!selectedColorKey) return;
  const idx = colorsLocal.deleted.indexOf(selectedColorKey);
  if (idx === -1) colorsLocal.deleted.push(selectedColorKey);
  else colorsLocal.deleted.splice(idx, 1);
  saveColorsLocal();
  refreshAfterColorChange();
  renderColorsBrowser();
  showColorsPickerForKey(selectedColorKey);
}

function refreshAfterColorChange() {
  // Re-render cards and sidebar so all chips pick up the new color via getColor()
  buildFilterSidebar();
  render();
}

// ── Mobile panel switching ────────────────────────────────────
function colorsShowBrowser() {
  document.getElementById('colors-tag-browser').style.display = '';
  const panel = document.getElementById('colors-picker-panel');
  panel.style.display = '';
  // Remove back button if present
  panel.querySelector('.colors-back-btn')?.remove();
  if (window.innerWidth <= 650) {
    panel.style.display = 'none';
  }
}

function colorsShowPicker() {
  document.getElementById('colors-tag-browser').style.display = 'none';
  const panel = document.getElementById('colors-picker-panel');
  panel.style.display = '';
  // Inject back button at the top of the picker panel if not already there
  if (!panel.querySelector('.colors-back-btn')) {
    const btn = document.createElement('button');
    btn.className = 'colors-back-btn';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back to tags`;
    btn.onclick = colorsShowBrowser;
    panel.insertBefore(btn, panel.firstChild);
  }
}

// ── Go ────────────────────────────────────────────────────────
init();