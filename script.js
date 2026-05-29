/* ============================================================
   TUTEL SIGHTINGS — script.js
   Loads appearances.json + colors.json, renders cards,
   handles filtering, sorting, and all interactions.
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let allAppearances = [];
let colors = {};
let watchedIds  = new Set(JSON.parse(localStorage.getItem('tutel-watched')   || '[]'));
let userProgress =        JSON.parse(localStorage.getItem('tutel-progress')  || '{}');

function saveWatched()      { localStorage.setItem('tutel-watched',  JSON.stringify([...watchedIds])); }
function saveUserProgress() { localStorage.setItem('tutel-progress', JSON.stringify(userProgress));    }

const state = {
  search:  '',
  sort:    'date',
  sortDir: 'desc',
  watch:   'all',
  inProgress: false,
  filters: {
    activities:        new Set(),
    games:             new Set(),
    collab_partners:   new Set(),
    appearance_weight: new Set(),
  },
};

// ── Bootstrap ────────────────────────────────────────────────
async function init() {
  try {
    const [appData, colorData] = await Promise.all([
      fetch('data/appearances.json').then(r => r.json()),
      fetch('data/colors.json').then(r => r.json()),
    ]);
    allAppearances = appData;
    // Guard against colors.json being accidentally wrapped in an outer array
    colors = Array.isArray(colorData) ? colorData[0] : colorData;
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
}

// ── Color helpers ─────────────────────────────────────────────
function getColor(category, key) {
  return (colors[category] && colors[category][key]) || colors.fallback || '#4B5563';
}

// Returns an inline style string for a colored chip
function chipStyle(category, key) {
  const hex = getColor(category, key);
  return `background:${hex}22; color:${hex}; border-color:${hex}44;`;
}

// ── Duration helpers ──────────────────────────────────────────
// Returns the duration of Vedal's appearance in a single VOD, in seconds.
// Returns null if either timestamp is missing.
function vodDuration(vod) {
  if (vod.timestamp_seconds == null || vod.timestamp_end_seconds == null) return null;
  return vod.timestamp_end_seconds - vod.timestamp_seconds;
}

function formatDuration(secs) {
  if (secs == null || secs < 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// Returns { display, sortValue } for an entry's collab duration.
// "povs" entries show a min~max range; "parts" entries sum their durations.
function entryDurationInfo(entry) {
  const durations = entry.vods.map(vodDuration).filter(d => d !== null);
  if (!durations.length) return { display: null, sortValue: null };

  if (entry.vods.length === 1 || entry.vod_type === 'parts') {
    const total = durations.reduce((a, b) => a + b, 0);
    return { display: formatDuration(total), sortValue: total };
  }

  // Multiple POVs — show range, sort by midpoint
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  if (min === max) return { display: formatDuration(min), sortValue: min };
return { display: `${formatDuration(min)} ~ ${formatDuration(max)}`, sortValue: max };
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
      const da = entryDurationInfo(a).sortValue;
      const db = entryDurationInfo(b).sortValue;
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
    if (cat === 'activities')        { if (![...set].every(v => entry.activities.includes(v)))        return false; }
    else if (cat === 'games')        { if (![...set].every(v => entry.games.includes(v)))             return false; }
    else if (cat === 'collab_partners') { if (![...set].every(v => entry.collab_partners.includes(v))) return false; }
    else if (cat === 'appearance_weight') { if (!set.has(entry.appearance_weight))                    return false; }
  }
  return true;
}

function filteredAndSorted() {
  return sortedAppearances(allAppearances.filter(passesFilter));
}

function hasActiveFilters() {
  return Object.values(state.filters).some(s => s.size > 0);
}

// ── Sidebar filter builder ────────────────────────────────────
function buildFilterSidebar() {
  const container = document.getElementById('filter-groups');
  const sortIgnoreCase = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());

  const allActivities = [...new Set(allAppearances.flatMap(e => e.activities))].sort(sortIgnoreCase);
  const allGames      = [...new Set(allAppearances.flatMap(e => e.games))].filter(Boolean).sort(sortIgnoreCase);
  const allPartners   = [...new Set(allAppearances.flatMap(e => e.collab_partners))].sort(sortIgnoreCase);
  const allWeights    = ['Full', 'Partial', 'Cameo'];

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
          const count = allAppearances.filter(e => {
            if (cat === 'activities')        return e.activities.includes(item);
            if (cat === 'games')             return e.games.includes(item);
            if (cat === 'collab_partners')   return e.collab_partners.includes(item);
            if (cat === 'appearance_weight') return e.appearance_weight === item;
          }).length;
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
  document.getElementById('clear-filters').style.display = hasActiveFilters() ? '' : 'none';
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
  if (entry.vods.length === 1 && entry.vods[0].vod_title) return entry.vods[0].vod_title;
  return entry.id;
}

function getThumbUrl(entry) {
  const first = entry.vods[0];
  if (!first?.video_id) return null;
  return `https://img.youtube.com/vi/${first.video_id}/maxresdefault.jpg`;
}

// Builds a YouTube watch URL for a VOD.
function getWatchUrl(vod, entryId, withProgress = true) { 
  if (!vod.video_id) return '#';
  let t = vod.timestamp_seconds;

  if (withProgress && entryId) {
    const entry = allAppearances.find(e => e.id === entryId);
    const p = userProgress?.[entryId];
    if (entry && p != null) {
      const vodIndex = entry.vods.indexOf(vod);
      if (vodIndex !== -1 && p.vodIndex === vodIndex) {
        t = p.seconds;
      }
    }
  }

  return t ? `https://youtu.be/${vod.video_id}?t=${t}` : `https://youtu.be/${vod.video_id}`;
}

function getStreamerLabel(vod) {
  if (vod.vod_part != null) return `Part ${vod.vod_part}`;
  if (vod.streamer)         return `${vod.streamer}'s POV`;
  return 'Watch';
}

function renderChips(entry) {
  const chips = [];
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
  document.querySelectorAll('.card-chips').forEach(applyChipOverflowContainer);
}

function applyChipOverflowForCard(card) {
  const container = card.querySelector('.card-chips');
  if (container) applyChipOverflowContainer(container);
}

function applyChipOverflowContainer(container) {
  const chips = [...container.querySelectorAll('.chip')];
  if (!chips.length) return;

  // Reset any previous overflow pass so we measure from a clean state
  chips.forEach(c => c.style.display = '');
  container.querySelector('.chip-overflow')?.remove();

  // The allowed vertical space is exactly 2 chip heights, measured from the
  // top of the first chip (not the container, which has padding above it).
  const firstRect  = chips[0].getBoundingClientRect();
  const maxBottom  = firstRect.top + firstRect.height * 2 + 8;

  // Find the first chip that pushes past the 2-line boundary
  let overflowFrom = chips.findIndex(c => c.getBoundingClientRect().bottom > maxBottom);
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

  // If the badge itself overflows into a 3rd line, pull one more chip into it
  // and repeat until it fits. Safety counter prevents an infinite loop.
  let safety = chips.length;
  while (badge.getBoundingClientRect().bottom > maxBottom && overflowFrom > 0 && safety-- > 0) {
    overflowFrom--;
    chips[overflowFrom].style.display = 'none';
    overflowData.unshift({ cat: chips[overflowFrom].dataset.cat, value: chips[overflowFrom].dataset.value });
    badge.textContent = `+${overflowData.length} more`;
    badge.dataset.overflow = encodeURIComponent(JSON.stringify(overflowData));
  }
}

function renderCard(entry) {
  const watched  = isWatched(entry);
  const thumbUrl = getThumbUrl(entry);
  const title    = getCardTitle(entry);
  const { display: duration } = entryDurationInfo(entry);
  const isMulti  = entry.vods.length > 1;
  const singleUrl = !isMulti ? getWatchUrl(entry.vods[0], entry.id) : '#';

  const thumbClick = isMulti
    ? `onclick="openPovDropdown(event,'${entry.id}')" style="cursor:pointer"`
    : `onclick="window.open('${singleUrl}','_blank')" style="cursor:pointer"`;
  const titleClick = isMulti
    ? `onclick="openPovDropdown(event,'${entry.id}')"`
    : `onclick="window.open('${singleUrl}','_blank')"`;

  // Progress bar and badge — only shown when we have both user progress
  // AND the VOD has a known end timestamp to calculate a percentage against.
  let progressHtml = '';
  let progressBadgeHtml = '';
  if (userProgress[entry.id]) {
    const p   = userProgress[entry.id];
    const vod = entry.vods[p.vodIndex];
    if (vod?.timestamp_end_seconds) {
      const start   = vod.timestamp_seconds || 0;
      const percent = Math.max(0, Math.min(100,
        Math.floor(((p.seconds - start) / (vod.timestamp_end_seconds - start)) * 100)
      ));
      progressBadgeHtml = `<div class="progress-badge">${percent}% Watched</div>`;
      progressHtml      = `<div class="card-progress-bar"><div class="card-progress-fill" style="width:${percent}%"></div></div>`;
    }
  }

  return `
    <article class="card" data-id="${entry.id}">
      <div class="card-thumb-wrap" ${thumbClick}>
        ${thumbUrl
          ? `<img class="card-thumb" src="${thumbUrl}" alt="${escAttr(title)}" loading="lazy"
               onload="if(this.naturalHeight > 90 ) { this.style.removeProperty('opacity'); this.onload=null; return; } var n=this.src.replace('maxres','hq'); this.src=''; this.src=n; this.style.removeProperty('opacity'); this.onload=null;">
             <div class="card-thumb-placeholder" style="display:none">🐢</div>` // i might be able to delete this fallback but ill look into this later
          : `<div class="card-thumb-placeholder">🐢</div>`
        }
        <div class="card-thumb-overlay">
          <div class="play-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        ${isMulti ? `<div class="multi-vod-badge">${entry.vods.length} ${entry.vod_type === 'parts' ? 'Parts' : 'POVs'}</div>` : ''}
        ${progressBadgeHtml}
        ${progressHtml}
      </div>
      <div class="card-body">
        <div class="card-chips">${renderChips(entry)}</div>
        <div class="card-title" ${titleClick}>${escHtml(title)}</div>
        <div class="card-meta">
          ${entry.date ? `<span>${entry.date}</span>` : '<span style="opacity:0.4">Date unknown</span>'}
          ${duration ? `<span class="card-meta-sep">·</span><span class="card-duration">${duration}</span>` : ''}
          ${watched ? `<span title="Watched" style="display:flex"><svg class="watched-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}
          <span class="card-menu-wrap">
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

  if (results.length === 0) {
    grid.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display  = 'none';
    grid.innerHTML       = results.map(renderCard).join('');
    requestAnimationFrame(applyChipOverflow);
  }

  const total = allAppearances.length;
  const resultsText = results.length === total
    ? `<span class="results-count">${total}</span> sightings`
    : `<span class="results-count">${results.length}</span> of ${total} sightings`;

  const totalSecs = results.reduce((sum, e) => sum + (entryDurationInfo(e).sortValue ?? 0), 0);
  const durationText = totalSecs > 0
    ? `<span class="results-separator">·</span><span class="results-count">${formatDuration(totalSecs)}</span> total`
    : '';

  const diceSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><circle cx="15.5" cy="8.5" r="1.5"></circle><circle cx="15.5" cy="15.5" r="1.5"></circle><circle cx="8.5" cy="15.5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>`;

  resultsBar.innerHTML = `
    <div class="results-text">${resultsText}${durationText}</div>
    <div class="results-actions">
      <button class="random-btn" onclick="playRandomSighting()" ${results.length === 0 ? 'disabled' : ''} title="Play a random stream from this list">
        ${diceSvg} Random
      </button>
    </div>
  `;

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

    if (entry.vod_type === 'parts') {
      // Multi-parter: Only throw Part 1 into the pool
      possibleChoices.push({ entry, vod: entry.vods[0] });
    } else {
      // POVs: Throw every perspective into the pool
      entry.vods.forEach(vod => possibleChoices.push({ entry, vod }));
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
  const entry    = allAppearances.find(e => e.id === entryId);
  const dropdown = document.getElementById('pov-dropdown');
  if (!entry) return;

  // Toggle closed if already open for this entry
  if (dropdownEntry === entryId && dropdown.style.display !== 'none') {
    closePovDropdown();
    return;
  }
  dropdownEntry = entryId;

  document.getElementById('pov-dropdown-inner').innerHTML = entry.vods.map((vod, vodIndex) => {
    const baseLabel      = getStreamerLabel(vod);
    const hasProgress    = userProgress[entryId]?.vodIndex === vodIndex;
    const label          = hasProgress ? `${baseLabel} (Watching)` : baseLabel;
    const url            = getWatchUrl(vod, entryId);
    const color          = vod.streamer ? getColor('collab_partners', vod.streamer) : colors.fallback;
    // Active-progress VOD gets a solid border; others get a translucent one
    const borderHex      = hasProgress ? color : `${color}44`;
    return `
      <a class="pov-option" href="${url}" target="_blank" rel="noopener">
        <span class="pov-option-label">${escHtml(vod.vod_title || baseLabel)}</span>
        <span class="pov-chip" style="background:${color}22;color:${color};border:1px solid ${borderHex}">${escHtml(label)}</span>
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

  const entry = allAppearances.find(e => e.id === entryId);
  const card  = document.querySelector(`.card[data-id="${entryId}"]`);
  if (!entry || !card) return;

  if (passesFilter(entry)) {
    // Card still belongs in the current view — re-render it in place
    card.outerHTML = renderCard(entry);
    requestAnimationFrame(() => {
      applyChipOverflowForCard(document.querySelector(`.card[data-id="${entryId}"]`));
    });
  } else {
    // Card no longer passes the filter — animate it out and remove it
    card.style.transition = 'opacity 250ms ease, transform 250ms ease';
    card.style.opacity    = '0';
    card.style.transform  = 'scale(0.96)';
    setTimeout(() => {
      card.remove();
      const visible    = document.querySelectorAll('.card').length;
      const total      = allAppearances.length;
      const resultsBar = document.getElementById('results-bar');
      resultsBar.innerHTML = visible === total
        ? `<span class="results-count">${total}</span> sightings`
        : `<span class="results-count">${visible}</span> of ${total} sightings`;
      document.getElementById('empty-state').style.display = visible === 0 ? '' : 'none';
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

  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;
  activeCardMenu = entryId;

  // SVG icon strings
  const copyIcon     = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const eyeIcon      = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOffIcon   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const progressIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const summaryIcon  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`;
  const highlightIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

  const watched    = isWatched(entry);
  const divider    = `<div class="card-menu-divider"></div>`;
  const watchItem  = `<button class="card-menu-item" onclick="toggleWatched('${entry.id}')">${watched ? eyeOffIcon : eyeIcon} ${watched ? 'Mark as unwatched' : 'Mark as watched'}</button>`;
  const progItem   = `<button class="card-menu-item" onclick="openProgressPopup('${escAttr(entry.id)}')">${progressIcon} Set Progress</button>`;
  const hlItem     = (entry.highlights && entry.highlights.length > 0) ? `<button class="card-menu-item" onclick="openHighlights('${escAttr(entry.id)}')">${highlightIcon} Highlights</button>` : '';
  const summItem   = entry.summary ? `<button class="card-menu-item" onclick="openSummary('${escAttr(entry.id)}')">${summaryIcon} Summary</button>` : '';

  // Copy link — one button for single VOD, one per VOD for multi
  const copyItems = entry.vods.length === 1
    ? `<button class="card-menu-item" onclick="copyLink('${escAttr(getWatchUrl(entry.vods[0], entry.id, false))}')">${copyIcon} Copy link</button>`
    : entry.vods.map(vod => `
        <button class="card-menu-item" onclick="copyLink('${escAttr(getWatchUrl(vod, entry.id))}')">
          ${copyIcon}<span>Copy link<span class="card-menu-label-sub">${escHtml(getStreamerLabel(vod))}</span></span>
        </button>`).join('');

  // .filter(Boolean) will automatically remove any empty strings (like missing summaries/highlights) and .join('') mashes the surviving items together without dividers.
  const group1 = [watchItem, progItem].filter(Boolean).join('');
  const group2 = [summItem, hlItem].filter(Boolean).join('');
  const group3 = [copyItems].filter(Boolean).join('');

  // .filter(Boolean) will strip out group2 entirely if it's empty so that .join(divider) puts your divider ONLY between the groups that actually survived.
  const menu = document.createElement('div');
  menu.className = 'card-menu-dropdown';
  menu.id        = 'card-menu-dropdown';
  menu.innerHTML = [group1, group2, group3].filter(Boolean).join(divider);
  
  document.body.appendChild(menu);

  // Align the menu's right edge to the button's right edge, shifted up from screen edge if needed
  const rect = event.currentTarget.getBoundingClientRect();
  const mw   = 190;
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

function clearAllFilters() {
  Object.values(state.filters).forEach(s => s.clear());
  state.search = '';
  document.getElementById('search-input').value        = '';
  document.getElementById('mobile-search-input').value = '';
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
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry?.summary) return;
  document.getElementById('summary-title').textContent = getCardTitle(entry);
  document.getElementById('summary-text').textContent  = entry.summary;
  openOverlay('summary-popup');
}

function closeSummary() { closeOverlay('summary-popup'); }

// ── Highlights popup ──────────────────────────────────────────
function openHighlights(entryId) {
  closeCardMenu();
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry?.highlights?.length) return;
  
  document.getElementById('highlights-title').textContent = getCardTitle(entry);
  
  const listHtml = entry.highlights.map(hl => {
    const vod = entry.vods[hl.vod_index];
    if (!vod) return '';
    
    // Construct direct timestamped link for YouTube
    const url = `https://youtu.be/${vod.video_id}?t=${hl.timestamp_seconds}`;
    
    // --- 🌟 Calculate Relative Collab Time ---
    let relativeSecs = hl.timestamp_seconds - (vod.timestamp_seconds || 0);

    // If it's a sequential multi-parter, add the durations of all previous parts
    if (entry.vod_type === 'parts') {
      for (let i = 0; i < hl.vod_index; i++) {
        const prevVod = entry.vods[i];
        const prevDuration = (prevVod.timestamp_end_seconds || 0) - (prevVod.timestamp_seconds || 0);
        if (prevDuration > 0) {
          relativeSecs += prevDuration;
        }
      }
    }
    
    // Prevent negative timestamps just in case the data is weird
    const timeStr = formatDuration(Math.max(0, relativeSecs));

    // If it's a multi-POV/multi-part stream, tell them which VOD it belongs to
    const streamerLabel = entry.vods.length > 1 
      ? `<span class="highlight-streamer">${escHtml(getStreamerLabel(vod))}</span>` 
      : '';
    
    return `
      <a href="${url}" target="_blank" rel="noopener" class="highlight-item">
        <div class="highlight-info">
          <div class="highlight-title">${escHtml(hl.title)}</div>
          ${streamerLabel}
        </div>
        <div class="highlight-time">${timeStr}</div>
      </a>
    `;
  }).join('');
  
  document.getElementById('highlights-list').innerHTML = listHtml;
  openOverlay('highlights-popup');
}

function closeHighlights() { closeOverlay('highlights-popup'); }

// ── About modal ───────────────────────────────────────────────
function openModal()  { openOverlay('modal'); }
function closeModal() { closeOverlay('modal'); }

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t   => t.classList.toggle('active', t.dataset.tab   === tab));
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}

// ── Progress popup ─────────────────────────────────────────────
let currentProgressEntry   = null;
let pendingProgressSeconds = 0;
let pendingProgressVodIndex = null;

function openProgressPopup(entryId) {
  closeCardMenu();
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;
  currentProgressEntry = entry;

  document.getElementById('progress-title').textContent = getCardTitle(entry);
  document.getElementById('prog-hh').value              = '';
  document.getElementById('prog-mm').value              = '';
  document.getElementById('prog-ss').value              = '';
  document.getElementById('progress-watched-prompt').style.display = 'none';
  document.getElementById('progress-actions').style.display        = 'flex';

  // Show VOD selector only for multi-VOD entries
  const select = document.getElementById('progress-vod-select');
  select.style.display = entry.vods.length > 1 ? '' : 'none';
  select.innerHTML = entry.vods.map((v, i) =>
    `<option value="${i}">${escHtml(getStreamerLabel(v))}</option>`
  ).join('');

  // Pre-fill with existing progress if present
  const p = userProgress[entryId];
  if (p) {
    select.value = p.vodIndex ?? 0;
    const h = Math.floor(p.seconds / 3600);
    const m = Math.floor((p.seconds % 3600) / 60);
    const s = p.seconds % 60;
    if (h)      document.getElementById('prog-hh').value = String(h).padStart(2, '0');
    if (m || h) document.getElementById('prog-mm').value = String(m).padStart(2, '0');
    document.getElementById('prog-ss').value = String(s).padStart(2, '0');
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

  const hh = parseInt(document.getElementById('prog-hh').value || '0', 10);
  const mm = parseInt(document.getElementById('prog-mm').value || '0', 10);
  const ss = parseInt(document.getElementById('prog-ss').value || '0', 10);
  const totalSec = hh * 3600 + mm * 60 + ss;
  const vodIndex = parseInt(document.getElementById('progress-vod-select').value, 10);

  // Treat 00:00:00 as "clear progress"
  if (totalSec === 0) { clearProgressFromPopup(); return; }

  // If the timestamp is past the VOD's known end, ask if they want to mark it watched instead
  const vod = currentProgressEntry.vods[vodIndex];
  if (vod?.timestamp_end_seconds && totalSec >= vod.timestamp_end_seconds) {
    pendingProgressSeconds = totalSec;
    pendingProgressVodIndex = vodIndex;
    document.getElementById('progress-watched-prompt').style.display = 'block';
    document.getElementById('progress-actions').style.display        = 'none';
    return;
  }

  finalizeProgressSave(totalSec, vodIndex);
}

function confirmProgressWatched(markWatched) {
  if (markWatched) {
    // Use toggleWatched so card removal / filter logic is handled consistently
    if (!watchedIds.has(currentProgressEntry.id)) toggleWatched(currentProgressEntry.id);
    else closeProgress();
  } else {
    finalizeProgressSave(pendingProgressSeconds, pendingProgressVodIndex);
  }
}

function cancelProgressPrompt() {
  document.getElementById('progress-watched-prompt').style.display = 'none';
  document.getElementById('progress-actions').style.display        = 'flex';
  pendingProgressSeconds = 0;
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

// ── Event bindings ────────────────────────────────────────────
function bindEvents() {
  // Search — desktop and mobile inputs stay in sync
  document.getElementById('search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('mobile-search-input').value = state.search;
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });
  document.getElementById('mobile-search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('search-input').value = state.search;
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });

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

  document.getElementById('clear-filters').addEventListener('click', clearAllFilters);

  // Close POV dropdown and card menu on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('pov-dropdown').contains(e.target)) closePovDropdown();
    if (activeCardMenu && !e.target.closest('#card-menu-dropdown') && !e.target.closest('.card-menu-btn')) closeCardMenu();
    // Close progress/summary/modal popups when clicking the backdrop
    if (e.target.id === 'modal-backdrop') {
      closeProgress();
      closeSummary();
      closeModal();
      closeHighlights();
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

  // Escape closes any open overlay
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeModal();
    closeSummary();
    closeProgress();
    closeHighlights();
  });

  // Re-measure chip overflow when the window is resized
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyChipOverflow, 150);
  }, { passive: true });
}

// ── Escape helpers ────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
  if (state.watch === 'unwatched') {
    ipBtn.style.display = '';
    ipBtn.dataset.active = String(state.inProgress);
  } else {
    ipBtn.style.display = 'none';
  }
}

// URL PARAMS HANDING!!!!!
// 1. Take whatever is currently in 'state' and update the browser's URL bar
function updateURLFromState() {
  const params = new URLSearchParams();

  // Handle simple strings
  if (state.search) params.set('search', state.search);
  if (state.sort !== 'date') params.set('sort', state.sort); // only add if not default
  if (state.sortDir !== 'desc') params.set('sortDir', state.sortDir);
  if (state.watch !== 'all') params.set('watch', state.watch);
  if (state.inProgress) params.set('inProgress', '1');

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
}

// 2. Look at the URL bar and overwrite 'state' with what we find
function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('search')) state.search = params.get('search');
  if (params.has('sort'))   state.sort = params.get('sort');
  if (params.has('sortDir')) state.sortDir = params.get('sortDir');
  if (params.has('watch'))      state.watch      = params.get('watch');
  if (params.has('inProgress')) state.inProgress = params.get('inProgress') === '1';

  // Convert comma-separated strings back into Sets for your filters
  for (const key of Object.keys(state.filters)) {
    if (params.has(key)) {
      const values = params.get(key).split(',');
      state.filters[key] = new Set(values);
    }
  }
}

// ── Go ────────────────────────────────────────────────────────
init();
