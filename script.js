/* ============================================================
   TUTEL SIGHTINGS — script.js
   Loads appearances.json + colors.json, renders cards,
   handles filtering, sorting, and all interactions.
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let allAppearances = [];
let colors = {};
let watchedIds = new Set(JSON.parse(localStorage.getItem('tutel-watched') || '[]'));
let userProgress = JSON.parse(localStorage.getItem('tutel-progress') || '{}');

function saveUserProgress() {
  localStorage.setItem('tutel-progress', JSON.stringify(userProgress));
}

const state = {
  search: '',
  sort: 'date',
  sortDir: 'desc',
  watch: 'all',
  filters: {
    activities: new Set(),
    games: new Set(),
    collab_partners: new Set(),
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
    // Handle colors.json being accidentally wrapped in an array
    colors = Array.isArray(colorData) ? colorData[0] : colorData;
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('card-grid').innerHTML =
      '<p style="color:var(--text-muted);padding:40px">Failed to load appearances data.</p>';
    return;
  }

  buildFilterSidebar();
  renderStats();
  render();
  bindEvents();
}

// ── Color helpers ─────────────────────────────────────────────
function getColor(category, key) {
  return (colors[category] && colors[category][key]) || colors.fallback || '#4B5563';
}

function chipStyle(category, key) {
  const hex = getColor(category, key);
  return `background:${hex}22; color:${hex}; border-color:${hex}44;`;
}

// ── Duration helpers ──────────────────────────────────────────
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

function entryDurationInfo(entry) {
  // Returns { display: string|null, sortValue: number|null }
  const durations = entry.vods.map(vodDuration).filter(d => d !== null);
  if (!durations.length) return { display: null, sortValue: null };

  if (entry.vods.length === 1 || entry.vod_type === 'parts') {
    const total = durations.reduce((a, b) => a + b, 0);
    return { display: formatDuration(total), sortValue: total };
  }

  // povs — range
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const mid = (min + max) / 2;
  if (min === max) return { display: formatDuration(min), sortValue: min };
  return { display: `${formatDuration(min)} ~ ${formatDuration(max)}`, sortValue: mid };
}

// ── Sort helpers ──────────────────────────────────────────────
function sortedAppearances(list) {
  const copy = [...list];
  const dir = state.sortDir === 'asc' ? 1 : -1;
  if (state.sort === 'date') {
    copy.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return dir * a.date.localeCompare(b.date);
    });
  } else if (state.sort === 'duration') {
    copy.sort((a, b) => {
      const da = entryDurationInfo(a).sortValue;
      const db = entryDurationInfo(b).sortValue;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return dir * (da - db);
    });
  } else if (state.sort === 'partners') {
    copy.sort((a, b) => dir * (a.collab_partners.length - b.collab_partners.length));
  }
  return copy;
}

// ── Filter logic ──────────────────────────────────────────────
function passesFilter(entry) {
  // Watch status
  const isWatched = watchedIds.has(entry.id) || entry.watched;
  if (state.watch === 'watched' && !isWatched) return false;
  if (state.watch === 'unwatched' && isWatched) return false;

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    const title = (entry.title || entry.vods[0]?.vod_title || '').toLowerCase();
    const partners = entry.collab_partners.map(p => p.toLowerCase()).join(' ');
    const games = entry.games.map(g => g.toLowerCase()).join(' ');
    if (!title.includes(q) && !partners.includes(q) && !games.includes(q)) return false;
  }

  // Active filters — AND within each category
  for (const [cat, set] of Object.entries(state.filters)) {
    if (!set.size) continue;
    if (cat === 'activities') {
      if (![...set].every(a => entry.activities.includes(a))) return false;
    } else if (cat === 'games') {
      if (![...set].every(g => entry.games.includes(g))) return false;
    } else if (cat === 'collab_partners') {
      if (![...set].every(p => entry.collab_partners.includes(p))) return false;
    } else if (cat === 'appearance_weight') {
      // Weight is a single value so OR makes sense here
      if (!set.has(entry.appearance_weight)) return false;
    }
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

  const allActivities = [...new Set(allAppearances.flatMap(e => e.activities))].sort();
  const allGames      = [...new Set(allAppearances.flatMap(e => e.games))].filter(Boolean).sort();
  const allPartners   = [...new Set(allAppearances.flatMap(e => e.collab_partners))].sort();
  const allWeights    = ['Full','Partial','Cameo'];

  const sections = [
    { label: 'Activity',          cat: 'activities',      items: allActivities },
    { label: 'Game',              cat: 'games',           items: allGames      },
    { label: 'Collab Partner',    cat: 'collab_partners', items: allPartners   },
    { label: 'Appearance Weight', cat: 'appearance_weight', items: allWeights  },
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
            if (cat === 'activities') return e.activities.includes(item);
            if (cat === 'games') return e.games.includes(item);
            if (cat === 'collab_partners') return e.collab_partners.includes(item);
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
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  btn.classList.toggle('open', !isOpen);
}

function updateFilterChipStates() {
  document.querySelectorAll('.filter-chip').forEach(btn => {
    const { cat, value } = btn.dataset;
    btn.classList.toggle('active', state.filters[cat]?.has(value) ?? false);
  });

  const clearBtn = document.getElementById('clear-filters');
  clearBtn.style.display = hasActiveFilters() ? '' : 'none';
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const total = allAppearances.length;
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
  return entry.id; // fallback
}

function getThumbUrl(entry) {
  const first = entry.vods[0];
  if (!first?.video_id) return null;
  return `https://img.youtube.com/vi/${first.video_id}/maxresdefault.jpg`;
}

function getWatchUrl(vod, entryId) {
  if (!vod.video_id) return '#';
  let url = `https://youtu.be/${vod.video_id}`;
  let t = vod.timestamp_seconds;

  // Override with user progress if it exists for this specific VOD
  if (entryId && userProgress[entryId] && userProgress[entryId].videoId === vod.video_id) {
    t = userProgress[entryId].seconds;
  }

  if (t) url += `?t=${t}`;
  return url;
}

function getStreamerLabel(vod) {
  if (vod.vod_part != null) return `Part ${vod.vod_part}`;
  if (vod.streamer) return `${vod.streamer}'s POV`;
  return 'Watch';
}

function renderChips(entry) {
  const chips = [];

  entry.activities.forEach(act => {
    chips.push(`<button class="chip" data-cat="activities" data-value="${escAttr(act)}" style="${chipStyle('activities', act)}" onclick="filterBy('activities','${escAttr(act)}')">${escHtml(act)}</button>`);
  });

  entry.games.forEach(game => {
    chips.push(`<button class="chip" data-cat="games" data-value="${escAttr(game)}" style="${chipStyle('games', game)}" onclick="filterBy('games','${escAttr(game)}')">${escHtml(game)}</button>`);
  });

  entry.collab_partners.forEach(p => {
    chips.push(`<button class="chip" data-cat="collab_partners" data-value="${escAttr(p)}" style="${chipStyle('collab_partners', p)}" onclick="filterBy('collab_partners','${escAttr(p)}')">${escHtml(p)}</button>`);
  });

  return chips.join('');
}

// Called after render — measures each chip row and collapses overflow into +N more
function applyChipOverflowForCard(card) {
  const container = card.querySelector('.card-chips');
  if (container) applyChipOverflowContainer(container);
}

function applyChipOverflow() {
  document.querySelectorAll('.card-chips').forEach(applyChipOverflowContainer);
}

function applyChipOverflowContainer(container) {
    const chips = [...container.querySelectorAll('.chip')];
    if (!chips.length) return;

    // Reset any previous overflow pass
    chips.forEach(c => c.style.display = '');
    const existing = container.querySelector('.chip-overflow');
    if (existing) existing.remove();

    // Measure line height from first chip
    const firstRect = chips[0].getBoundingClientRect();
    const lineHeight = firstRect.height;
    const maxBottom = firstRect.top + lineHeight * 2 + 8; // 2 lines from where chips actually start

    // Find the first chip that overflows 2 lines
    let overflowFrom = -1;
    for (let i = 0; i < chips.length; i++) {
      if (chips[i].getBoundingClientRect().bottom > maxBottom) {
        overflowFrom = i;
        break;
      }
    }
    if (overflowFrom === -1) return; // Everything fits

    // Build overflow data from hidden chips
    const hiddenChips = chips.slice(overflowFrom);
    hiddenChips.forEach(c => c.style.display = 'none');

    const overflowData = hiddenChips.map(c => ({
      cat: c.dataset.cat,
      value: c.dataset.value
    }));

    const badge = document.createElement('span');
    badge.className = 'chip-overflow';
    badge.textContent = `+${overflowData.length} more`;
    badge.dataset.overflow = encodeURIComponent(JSON.stringify(overflowData));
    badge.addEventListener('mouseenter', e => showOverflowTooltip(e, badge));
    badge.addEventListener('mouseleave', hidePartnerTooltip);
    container.appendChild(badge);

    // If the badge itself overflowed into a 3rd line, pull one more chip in
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
  const isWatchedEntry = isWatched(entry);
  const thumbUrl = getThumbUrl(entry);
  const title = getCardTitle(entry);
  const { display: duration } = entryDurationInfo(entry);
  const isMulti = entry.vods.length > 1;
  const singleUrl = !isMulti ? getWatchUrl(entry.vods[0], entry.id) : '#';
  const thumbClick = isMulti
    ? `onclick="openPovDropdown(event, '${entry.id}')" style="cursor:pointer"`
    : `onclick="window.open('${singleUrl}','_blank')" style="cursor:pointer"`;
  const titleClick = isMulti
    ? `onclick="openPovDropdown(event, '${entry.id}')"`
    : `onclick="window.open('${singleUrl}','_blank')"`;

  // ── Calculate User Progress Overlay ──
  let progressHtml = '';
  let progressBadgeHtml = '';

  if (userProgress[entry.id]) {
    const p = userProgress[entry.id];
    const vod = entry.vods.find(v => v.video_id === p.videoId);
    
    // Only render progress UI if we know the total duration of this specific VOD
    if (vod && vod.timestamp_end_seconds) {
      const start = vod.timestamp_seconds || 0;
      const totalCollabDuration = vod.timestamp_end_seconds - start;
      const userEffectiveProgress = p.seconds - start;
      
      // Calculate, floor, and clamp the percentage between 0 and 100
      let percent = Math.floor((userEffectiveProgress / totalCollabDuration) * 100);
      percent = Math.max(0, Math.min(100, percent));

      progressBadgeHtml = `<div class="progress-badge">${percent}% Watched</div>`;
      progressHtml = `
        <div class="card-progress-bar">
          <div class="card-progress-fill" style="width: ${percent}%"></div>
        </div>`;
    }
  }

  return `
    <article class="card" data-id="${entry.id}">
      <div class="card-thumb-wrap" ${thumbClick}>
        ${thumbUrl
          ? `<img class="card-thumb" src="${thumbUrl}" alt="${escAttr(title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="card-thumb-placeholder" style="display:none">🐢</div>`
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
          ${isWatchedEntry ? '<span class="watched-dot" title="Watched"></span>' : ''}
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
  const results = filteredAndSorted();
  const grid = document.getElementById('card-grid');
  const empty = document.getElementById('empty-state');
  const resultsBar = document.getElementById('results-bar');

  if (results.length === 0) {
    grid.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    grid.innerHTML = results.map(renderCard).join('');
    requestAnimationFrame(applyChipOverflow);
  }

  const total = allAppearances.length;
  resultsBar.innerHTML = results.length === total
    ? `<span class="results-count">${total}</span> sightings`
    : `<span class="results-count">${results.length}</span> of ${total} sightings`;

  updateFilterChipStates();
}

// ── POV dropdown ──────────────────────────────────────────────
let dropdownEntry = null;

function openPovDropdown(event, entryId) {
  event.stopPropagation();
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;

  // Close if already open for same entry
  const dropdown = document.getElementById('pov-dropdown');
  if (dropdownEntry === entryId && dropdown.style.display !== 'none') {
    closePovDropdown();
    return;
  }
  dropdownEntry = entryId;

  const inner = document.getElementById('pov-dropdown-inner');
  inner.innerHTML = entry.vods.map(vod => {
    let label = getStreamerLabel(vod);
    
    // Check if this specific VOD is the one the user has active progress on
    const isActiveProgress = userProgress[entryId] && userProgress[entryId].videoId === vod.video_id;
    if (isActiveProgress) {
      label += ' (Watching)';
    }

    const url = getWatchUrl(vod, entryId);
    const color = vod.streamer ? getColor('collab_partners', vod.streamer) : colors.fallback;
    
    // If it is the active progress, give it a solid border instead of a translucent one (color vs color+'44')
    const borderHex = isActiveProgress ? color : color + '44';

    return `
      <a class="pov-option" href="${url}" target="_blank" rel="noopener">
        <span class="pov-option-label">${escHtml(vod.vod_title || getStreamerLabel(vod))}</span>
        <span class="pov-chip" style="background:${color}22;color:${color};border:1px solid ${borderHex}">${escHtml(label)}</span>
      </a>`;
  }).join('');

  // Position near cursor
  const x = event.clientX;
  const y = event.clientY;
  dropdown.style.display = '';
  const rect = dropdown.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 12);
  const top  = Math.min(y + 8, window.innerHeight - rect.height - 12);
  dropdown.style.left = left + 'px';
  dropdown.style.top  = top  + 'px';
}

function closePovDropdown() {
  document.getElementById('pov-dropdown').style.display = 'none';
  dropdownEntry = null;
}

// ── Partner tooltip ───────────────────────────────────────────
let tooltipHideTimer = null;

function showOverflowTooltip(event, el) {
  clearTimeout(tooltipHideTimer);
  const items = JSON.parse(decodeURIComponent(el.dataset.overflow));
  const tooltip = document.getElementById('partner-tooltip');
  const inner   = document.getElementById('partner-tooltip-inner');

  inner.innerHTML = items.map(({ cat, value }) => {
    const hex = getColor(cat, value);
    return `<button class="chip" style="background:${hex}22;color:${hex};border-color:${hex}44;"
      onclick="filterBy('${escAttr(cat)}','${escAttr(value)}');hidePartnerTooltip()">
      <span class="chip-dot"></span>${escHtml(value)}
    </button>`;
  }).join('');

  tooltip.style.display = '';
  const rect  = el.getBoundingClientRect();
  const tRect = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.min(rect.left, window.innerWidth  - tRect.width  - 12) + 'px';
  tooltip.style.top  = Math.min(rect.bottom + 6, window.innerHeight - tRect.height - 12) + 'px';
}

function hidePartnerTooltip() {
  tooltipHideTimer = setTimeout(() => {
    document.getElementById('partner-tooltip').style.display = 'none';
  }, 120);
}

function keepPartnerTooltip() {
  clearTimeout(tooltipHideTimer);
}

// ── Watched management ────────────────────────────────────────
function isWatched(entry) {
  return watchedIds.has(entry.id);
}

function saveWatched() {
  localStorage.setItem('tutel-watched', JSON.stringify([...watchedIds]));
}

function toggleWatched(entryId) {
  if (watchedIds.has(entryId)) {
    watchedIds.delete(entryId);
  } else {
    watchedIds.add(entryId);
    // Delete progress when marked watched
    if (userProgress[entryId]) {
      delete userProgress[entryId];
      saveUserProgress();
    }
  }
  saveWatched();
  closeCardMenu();

  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;

  const card = document.querySelector(`.card[data-id="${entryId}"]`);
  if (!card) return;

  if (passesFilter(entry)) {
    // Still visible — re-render in place
    card.outerHTML = renderCard(entry);
    requestAnimationFrame(() => {
      const newCard = document.querySelector(`.card[data-id="${entryId}"]`);
      if (newCard) applyChipOverflowForCard(newCard);
    });
  } else {
    // Should no longer be visible — animate out then remove
    card.style.transition = 'opacity 250ms ease, transform 250ms ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.96)';
    setTimeout(() => {
      card.remove();
      // Update results bar count without full re-render
      const visible = document.querySelectorAll('.card').length;
      const total = allAppearances.length;
      const resultsBar = document.getElementById('results-bar');
      resultsBar.innerHTML = visible === total
        ? `<span class="results-count">${total}</span> sightings`
        : `<span class="results-count">${visible}</span> of ${total} sightings`;
      // Show empty state if nothing left
      const empty = document.getElementById('empty-state');
      empty.style.display = visible === 0 ? '' : 'none';
    }, 260);
  }
}

// ── Watched & Progress Data Management ────────────────────────

function exportWatchData() {
  // Bundle both states into a single object
  const exportObject = {
    watched: [...watchedIds],
    progress: userProgress
  };
  
  const data = JSON.stringify(exportObject, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Changed the filename slightly to reflect it holds all data
  a.download = 'tutel-sightings-data.json'; 
  a.click();
  URL.revokeObjectURL(url);
}

function importWatchData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      
      // Basic validation to ensure it's an object
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error();
      }

      // Extract the data, falling back to empty states if something is missing
      watchedIds = new Set(Array.isArray(parsed.watched) ? parsed.watched : []);
      userProgress = (parsed.progress && typeof parsed.progress === 'object') ? parsed.progress : {};

      // Save both to localStorage and re-render the UI
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
    // Wipe both states
    watchedIds = new Set();
    userProgress = {}; 
    
    // Save the empty states to localStorage
    saveWatched();
    saveUserProgress();
    render();
    
    btn.textContent = 'Clear data';
    btn.dataset.confirming = 'false';
    btn.classList.remove('confirming');
  } else {
    btn.textContent = 'Are you sure?';
    btn.dataset.confirming = 'true';
    btn.classList.add('confirming');
    setTimeout(() => {
      if (btn.dataset.confirming === 'true') {
        btn.textContent = 'Clear data';
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
  // Close if same menu already open
  if (activeCardMenu === entryId) { closeCardMenu(); return; }
  closeCardMenu();

  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;
  activeCardMenu = entryId;

  const copyIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const eyeIcon  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOffIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const progressIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const progressItem = `<button class="card-menu-item" onclick="openProgressPopup('${escAttr(entry.id)}')">${progressIcon} Set Progress</button>`;

  const watched = isWatched(entry);
  const watchItem = `<button class="card-menu-item" onclick="toggleWatched('${entry.id}')">
    ${watched ? eyeOffIcon : eyeIcon}
    ${watched ? 'Mark as unwatched' : 'Mark as watched'}
  </button>`;
  const divider = `<div class="card-menu-divider"></div>`;

  const summaryIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`;
  const summaryItem = entry.summary
    ? `<button class="card-menu-item" onclick="openSummary('${escAttr(entry.id)}')">${summaryIcon} Summary</button>${divider}`
    : '';

  let copyItems;
  if (entry.vods.length === 1) {
    const url = getWatchUrl(entry.vods[0]);
    copyItems = `<button class="card-menu-item" onclick="copyLink('${escAttr(url)}')">
      ${copyIcon} Copy link
    </button>`;
  } else {
    copyItems = entry.vods.map(vod => {
      const url = getWatchUrl(vod);
      const label = getStreamerLabel(vod);
      return `<button class="card-menu-item" onclick="copyLink('${escAttr(url)}')">
        ${copyIcon}
        <span><span>Copy link</span><span class="card-menu-label-sub">${escHtml(label)}</span></span>
      </button>`;
    }).join('');
  }

  const items = watchItem + divider + progressItem + divider + summaryItem + copyItems;

  const menu = document.createElement('div');
  menu.className = 'card-menu-dropdown';
  menu.id = 'card-menu-dropdown';
  menu.innerHTML = items;
  document.body.appendChild(menu);

  // Position near the button
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const mw = 190;
  const left = Math.min(rect.right - mw, window.innerWidth - mw - 8);
  const top  = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top  = top + 'px';
}

function closeCardMenu() {
  const existing = document.getElementById('card-menu-dropdown');
  if (existing) existing.remove();
  activeCardMenu = null;
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
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

function filterBy(cat, value) {
  const set = state.filters[cat];
  if (set.has(value)) set.delete(value);
  else set.add(value);
  render();
}

function clearAllFilters() {
  for (const set of Object.values(state.filters)) set.clear();
  state.search = '';
  document.getElementById('search-input').value = '';
  document.getElementById('mobile-search-input').value = '';
  render();
}

// ── Event bindings ────────────────────────────────────────────
function bindEvents() {
  // Desktop search
  document.getElementById('search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('mobile-search-input').value = state.search;
    render();
  });

  // Mobile search
  document.getElementById('mobile-search-input').addEventListener('input', e => {
    state.search = e.target.value.trim();
    document.getElementById('search-input').value = state.search;
    render();
  });

  // Hamburger open
  document.getElementById('hamburger-btn').addEventListener('click', openSidebar);

  // Sidebar close button
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);

  // Backdrop close
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  // Sort
  document.getElementById('sort-options').addEventListener('click', e => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const newSort = btn.dataset.sort;
    if (newSort === state.sort) {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sort = newSort;
      state.sortDir = 'desc';
    }
    document.querySelectorAll('.sort-btn').forEach(b => {
      const isActive = b.dataset.sort === state.sort;
      b.classList.toggle('active', isActive);
      const arrow = b.querySelector('.sort-arrow');
      if (arrow) {
        arrow.style.display = isActive ? '' : 'none';
        arrow.classList.toggle('asc', state.sortDir === 'asc');
      }
    });
    render();
  });

  // Watch status
  document.querySelector('.watch-toggle-wrap').addEventListener('click', e => {
    const btn = e.target.closest('.watch-toggle-btn');
    if (!btn) return;
    state.watch = btn.dataset.watch;
    document.querySelectorAll('.watch-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });

  // Filter chips (sidebar)
  document.getElementById('filter-groups').addEventListener('click', e => {
    const btn = e.target.closest('.filter-chip');
    if (!btn) return;
    filterBy(btn.dataset.cat, btn.dataset.value);
  });

  // Clear all filters button
  document.getElementById('clear-filters').addEventListener('click', clearAllFilters);

  // Close dropdown and card menu on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('pov-dropdown').contains(e.target)) {
      closePovDropdown();
    }
    if (activeCardMenu && !e.target.closest('#card-menu-dropdown') && !e.target.closest('.card-menu-btn')) {
      closeCardMenu();
    }
  });

  // Close dropdown on scroll
  window.addEventListener('scroll', closePovDropdown, { passive: true });

  // Modal tabs
  document.getElementById('modal')?.addEventListener('click', e => {
    const tab = e.target.closest('.modal-tab');
    if (tab) switchModalTab(tab.dataset.tab);
  });
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

// ── Summary popup ─────────────────────────────────────────────
function openSummary(entryId) {
  closeCardMenu();
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry?.summary) return;

  document.getElementById('summary-title').textContent = entry.title || entry.vods[0]?.vod_title || 'Collab Summary';
  document.getElementById('summary-text').textContent = entry.summary;
  document.getElementById('summary-popup').style.display = '';
  document.getElementById('modal-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeSummary() {
  document.getElementById('summary-popup').style.display = 'none';
  document.getElementById('modal-backdrop').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Modal ─────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal').style.display = '';
  document.getElementById('modal-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('modal-backdrop').style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeSummary();
    if (typeof closeProgress === 'function') closeProgress();
  }
});

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}

// ── Progress popup ─────────────────────────────────────────────
let currentProgressEntry = null;
let pendingProgressSeconds = 0;
let pendingProgressVideoId = null;

function openProgressPopup(entryId) {
  closeCardMenu();
  const entry = allAppearances.find(e => e.id === entryId);
  if (!entry) return;
  currentProgressEntry = entry;

  document.getElementById('progress-title').textContent = entry.title || entry.vods[0]?.vod_title || 'Set Progress';

  // Reset UI state
  document.getElementById('prog-hh').value = '';
  document.getElementById('prog-mm').value = '';
  document.getElementById('prog-ss').value = '';
  document.getElementById('progress-watched-prompt').style.display = 'none';
  document.getElementById('progress-actions').style.display = 'flex';

  // Populate Dropdown
  const select = document.getElementById('progress-vod-select');
  if (entry.vods.length > 1) {
    select.style.display = '';
    select.innerHTML = entry.vods.map(v => `<option value="${v.video_id}">${escHtml(getStreamerLabel(v))}</option>`).join('');
  } else {
    select.style.display = 'none';
    select.innerHTML = `<option value="${entry.vods[0].video_id}">Single</option>`;
  }

  // Pre-fill existing progress if present
  if (userProgress[entryId]) {
    const p = userProgress[entryId];
    select.value = p.videoId;
    const h = Math.floor(p.seconds / 3600);
    const m = Math.floor((p.seconds % 3600) / 60);
    const s = p.seconds % 60;
    
    if (h > 0) document.getElementById('prog-hh').value = String(h).padStart(2, '0');
    if (m > 0 || h > 0) document.getElementById('prog-mm').value = String(m).padStart(2, '0');
    document.getElementById('prog-ss').value = String(s).padStart(2, '0');
  }

  document.getElementById('progress-popup').style.display = '';
  document.getElementById('modal-backdrop').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeProgress() {
  document.getElementById('progress-popup').style.display = 'none';
  document.getElementById('modal-backdrop').style.display = 'none';
  document.body.style.overflow = '';
  currentProgressEntry = null;
}

// Auto-advance inputs
function handleProgressInput(el, nextId) {
  el.value = el.value.replace(/\D/g, ''); // Strip non-digits
  if (el.value.length === 2 && nextId) {
    document.getElementById(nextId).focus();
  }
}

// Backspace jump to previous input
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
  const totalSec = (hh * 3600) + (mm * 60) + ss;
  const videoId = document.getElementById('progress-vod-select').value;

  // Don't save 00:00:00
  if (totalSec === 0) {
    clearProgressFromPopup();
    return;
  }

  // Check if timestamp is past the end of the VOD
  const vod = currentProgressEntry.vods.find(v => v.video_id === videoId);
  if (vod && vod.timestamp_end_seconds && totalSec >= vod.timestamp_end_seconds) {
    pendingProgressSeconds = totalSec;
    pendingProgressVideoId = videoId;
    document.getElementById('progress-watched-prompt').style.display = 'block';
    document.getElementById('progress-actions').style.display = 'none';
    return;
  }

  _finalizeProgressSave(totalSec, videoId);
}

function confirmProgressWatched(isWatchedChoice) {
  if (isWatchedChoice) {
    if (!watchedIds.has(currentProgressEntry.id)) {
      watchedIds.add(currentProgressEntry.id);
      saveWatched();
    }
    if (userProgress[currentProgressEntry.id]) {
      delete userProgress[currentProgressEntry.id];
      saveUserProgress();
    }
    render();
    closeProgress();
  } else {
    _finalizeProgressSave(pendingProgressSeconds, pendingProgressVideoId);
  }
}

function cancelProgressPrompt() {
  document.getElementById('progress-watched-prompt').style.display = 'none';
  const actionsEl = document.getElementById('progress-actions');
  if (actionsEl) actionsEl.style.display = 'flex';
  
  // Also clear the temporary pending cache variables
  pendingProgressSeconds = null;
  pendingProgressVideoId = null;
}

function _finalizeProgressSave(seconds, videoId) {
  userProgress[currentProgressEntry.id] = { videoId, seconds };
  saveUserProgress();
  render(); // Re-render to update single-click URLs
  closeProgress();
}

function clearProgressFromPopup() {
  if (currentProgressEntry && userProgress[currentProgressEntry.id]) {
    delete userProgress[currentProgressEntry.id];
    saveUserProgress();
    render();
  }
  closeProgress();
}

// ── Go ────────────────────────────────────────────────────────
init();