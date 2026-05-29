const state = {
  windowSeconds: 60,
  sourceMode: 'players',
  metric: 'damage',
  selectedSource: null,
  lastData: null,
  petAssignments: loadPetAssignments(),
  petMenuSource: null
};

const els = {
  status: document.querySelector('#status'),
  rateLabel: document.querySelector('#rate-label'),
  totalRate: document.querySelector('#total-rate'),
  totalLabel: document.querySelector('#total-label'),
  totalAmount: document.querySelector('#total-amount'),
  duration: document.querySelector('#duration'),
  events: document.querySelector('#events'),
  tableTitle: document.querySelector('#table-title'),
  amountHeading: document.querySelector('#amount-heading'),
  rateHeading: document.querySelector('#rate-heading'),
  eventsHeading: document.querySelector('#events-heading'),
  takenHeading: document.querySelector('#taken-heading'),
  outMitHeading: document.querySelector('#out-mit-heading'),
  inMitHeading: document.querySelector('#in-mit-heading'),
  combatants: document.querySelector('#combatants'),
  combatantCount: document.querySelector('#combatant-count'),
  detailTitle: document.querySelector('#detail-title'),
  detailSubtitle: document.querySelector('#detail-subtitle'),
  breakdown: document.querySelector('#breakdown'),
  eventsList: document.querySelector('#events-list'),
  lastUpdated: document.querySelector('#last-updated'),
  resetButton: document.querySelector('#reset-button'),
  settingsButton: document.querySelector('#settings-button'),
  settingsClose: document.querySelector('#settings-close'),
  settingsBackdrop: document.querySelector('#settings-backdrop'),
  settingsDrawer: document.querySelector('#settings-drawer'),
  settingPaused: document.querySelector('#setting-paused'),
  settingOverlay: document.querySelector('#setting-overlay'),
  settingInterval: document.querySelector('#setting-interval'),
  settingRegion: document.querySelector('#setting-region'),
  settingWindow: document.querySelector('#setting-window'),
  settingDetection: document.querySelector('#setting-detection'),
  settingEvents: document.querySelector('#setting-events'),
  settingError: document.querySelector('#setting-error'),
  rescanButton: document.querySelector('#rescan-button'),
  petMenuBackdrop: document.querySelector('#pet-menu-backdrop'),
  petMenu: document.querySelector('#pet-menu'),
  petMenuTitle: document.querySelector('#pet-menu-title'),
  petOwnerSelect: document.querySelector('#pet-owner-select'),
  petAssignButton: document.querySelector('#pet-assign-button'),
  petUnassignButton: document.querySelector('#pet-unassign-button')
};

const CLASS_COLORS = {
  'Dire Lord': '#ff2d4d',
  Paladin: '#dc4d95',
  Warrior: '#c28a4a',
  Cleric: '#f1d991',
  Druid: '#d97b00',
  Shaman: '#1687f2',
  Enchanter: '#8175c7',
  Necromancer: '#37a383',
  Summoner: '#bc35dd',
  'Summoner Pet': '#bc35dd',
  Wizard: '#31c5c5',
  Ranger: '#93c95a',
  Monk: '#00d48a',
  Rogue: '#efcc49',
  Mob: '#6f7a86',
  Pet: '#8a98a8',
  Unknown: '#8a98a8'
};

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDps(value) {
  return Number(value || 0).toFixed(2);
}

function formatDuration(seconds) {
  const value = Math.round(Number(seconds || 0));
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${minutes}m ${remainder}s`;
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString();
}

function loadPetAssignments() {
  try {
    const parsed = JSON.parse(localStorage.getItem('pantheon.petAssignments') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([pet, owner]) => typeof pet === 'string' && typeof owner === 'string' && pet && owner && pet !== owner));
  } catch {
    return {};
  }
}

function savePetAssignments() {
  localStorage.setItem('pantheon.petAssignments', JSON.stringify(state.petAssignments));
}

function addNumericFields(target, source) {
  for (const key of ['total', 'damage', 'healing', 'damageTaken', 'mitigatedTaken', 'events', 'hits', 'incomingEvents', 'mitigated', 'crits']) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
}

function combineAssignedPets(rows) {
  const clones = rows.map((row) => ({
    ...row,
    abilities: [...(row.abilities || [])],
    assignedPets: []
  }));
  const bySource = new Map(clones.map((row) => [row.source, row]));
  const hidden = new Set();

  for (const [pet, owner] of Object.entries(state.petAssignments)) {
    const petRow = bySource.get(pet);
    const ownerRow = bySource.get(owner);
    if (!petRow || !ownerRow || pet === owner) continue;

    addNumericFields(ownerRow, petRow);
    ownerRow.abilities = [...new Set([...(ownerRow.abilities || []), ...(petRow.abilities || [])])];
    ownerRow.assignedPets.push(pet);
    hidden.add(pet);
  }

  return clones
    .filter((row) => !hidden.has(row.source))
    .map((row) => ({
      ...row,
      rate: state.lastData && state.lastData.durationSeconds
        ? Number((Number(row.total || 0) / state.lastData.durationSeconds).toFixed(2))
        : Number(row.rate || 0),
      dps: state.metric === 'damage' && state.lastData && state.lastData.durationSeconds
        ? Number((Number(row.total || 0) / state.lastData.durationSeconds).toFixed(2))
        : Number(row.dps || 0),
      hps: state.metric === 'healing' && state.lastData && state.lastData.durationSeconds
        ? Number((Number(row.total || 0) / state.lastData.durationSeconds).toFixed(2))
        : Number(row.hps || 0)
    }))
    .sort((a, b) => (b.total - a.total) || (b.events - a.events));
}

function getDisplayRows(data = state.lastData) {
  return combineAssignedPets((data && data.combatants) || []);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body = null) {
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function renderSettings(settings) {
  if (!settings || !settings.available) {
    els.settingError.textContent = 'Parser controls are unavailable in dashboard-only mode.';
    return;
  }

  els.settingError.textContent = settings.lastError ? `Parser error: ${settings.lastError}` : '';
  els.settingPaused.checked = settings.paused === true;
  els.settingOverlay.checked = settings.overlayEnabled === true;
  els.settingInterval.value = String(settings.intervalMs || 250);
  els.settingEvents.textContent = formatNumber(settings.totalInserted);

  const region = settings.lastCapture && settings.lastCapture.region;
  els.settingRegion.textContent = region
    ? `${region.width}x${region.height} at ${region.x}, ${region.y}`
    : '-';

  const windowInfo = settings.lastCapture && settings.lastCapture.window;
  els.settingWindow.textContent = windowInfo
    ? `PID ${windowInfo.id}, ${windowInfo.width}x${windowInfo.height}`
    : '-';

  const detection = settings.lastCapture && settings.lastCapture.detection;
  els.settingDetection.textContent = detection
    ? detection.strategy || (detection.refinement && detection.refinement.strategy) || '-'
    : '-';
}

async function loadSettings() {
  const settings = await fetchJson('/api/settings');
  renderSettings(settings);
  return settings;
}

async function saveSettings(patch) {
  const settings = await postJson('/api/settings', patch);
  renderSettings(settings);
  return settings;
}

async function openSettings() {
  els.settingsBackdrop.hidden = false;
  els.settingsDrawer.classList.add('open');
  els.settingsDrawer.setAttribute('aria-hidden', 'false');
  try {
    await loadSettings();
  } catch (error) {
    els.settingError.textContent = `Settings unavailable: ${error.message}`;
  }
}

function closeSettings() {
  els.settingsBackdrop.hidden = true;
  els.settingsDrawer.classList.remove('open');
  els.settingsDrawer.setAttribute('aria-hidden', 'true');
}

function renderMetrics(data) {
  const isHealing = state.metric === 'healing';
  els.rateLabel.textContent = isHealing ? 'Total HPS' : 'Total DPS';
  els.totalRate.textContent = formatDps(data.totals.rate);
  els.totalLabel.textContent = isHealing ? 'Healing' : 'Damage';
  els.totalAmount.textContent = formatNumber(data.totals.total);
  els.duration.textContent = formatDuration(data.durationSeconds);
  els.events.textContent = formatNumber(data.totals.events);
  els.lastUpdated.textContent = `Updated ${formatTime(data.generatedAt)}`;
}

function renderCombatants(data) {
  const rows = getDisplayRows(data);
  const isHealing = state.metric === 'healing';
  els.tableTitle.textContent = isHealing ? 'Healing Done' : 'Damage Done';
  els.amountHeading.textContent = isHealing ? 'Healing' : 'Damage';
  els.rateHeading.textContent = isHealing ? 'HPS' : 'DPS';
  els.eventsHeading.textContent = isHealing ? 'Casts' : 'Hits';
  els.takenHeading.textContent = isHealing ? '' : 'Taken';
  els.outMitHeading.textContent = isHealing ? '' : 'Out Mit';
  els.inMitHeading.textContent = isHealing ? '' : 'In Mit';
  els.combatantCount.textContent = `${rows.length} source${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    els.combatants.innerHTML = '<tr><td colspan="9" class="empty">Waiting for combat data...</td></tr>';
    state.selectedSource = null;
    renderBreakdown([]);
    return;
  }

  const maxTotal = Math.max(...rows.map((row) => row.total), 1);
  if (!state.selectedSource || !rows.some((row) => row.source === state.selectedSource)) {
    state.selectedSource = rows[0].source;
  }

  els.combatants.replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    tr.className = `combatant-row${row.source === state.selectedSource ? ' selected' : ''}`;
    tr.style.setProperty('--bar-width', `${Math.max(3, (row.total / maxTotal) * 100)}%`);
    tr.style.setProperty('--class-color', getClassColor(row.className));
    tr.tabIndex = 0;
    tr.dataset.source = row.source;
    const sourceTitle = row.sourceKind === 'ability'
      ? `${row.source} (healing spell; caster not exposed in this log line)`
      : row.source;
    const petText = row.assignedPets && row.assignedPets.length
      ? `<span class="source-kind" title="${escapeHtml(row.assignedPets.join(', '))}">+${row.assignedPets.length} pet${row.assignedPets.length === 1 ? '' : 's'}</span>`
      : '';
    const classTitle = row.classMatchedAbilities && row.classMatchedAbilities.length
      ? `${row.className}: ${row.classMatchedAbilities.join(', ')}`
      : 'Not enough class-specific abilities yet';
    tr.innerHTML = `
      <td class="name" title="${escapeHtml(sourceTitle)}">
        ${escapeHtml(row.source)}
        ${row.sourceKind === 'ability' ? '<span class="source-kind">ability</span>' : ''}
        ${petText}
      </td>
      <td class="class-cell" title="${escapeHtml(classTitle)}">
        <span class="class-badge confidence-${getConfidenceLevel(row.classConfidence)}">${escapeHtml(row.className || 'Unknown')}</span>
      </td>
      <td class="number">${formatNumber(row.total)}</td>
      <td class="number">${formatDps(row.rate)}</td>
      <td class="number">${formatNumber(row.events)}</td>
      <td class="number">${formatNumber(row.crits)}</td>
      <td class="number" title="${escapeHtml(isHealing ? '' : `${formatNumber(row.incomingEvents)} incoming hits, ${formatNumber(row.mitigatedTaken)} mitigated`)}">${isHealing ? '-' : formatNumber(row.damageTaken)}</td>
      <td class="number">${isHealing ? '-' : formatNumber(row.mitigated)}</td>
      <td class="number">${isHealing ? '-' : formatNumber(row.mitigatedTaken)}</td>
    `;
    tr.addEventListener('click', () => selectSource(row.source));
    tr.addEventListener('contextmenu', (event) => openPetMenu(event, row.source));
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') selectSource(row.source);
    });
    return tr;
  }));
}

function openPetMenu(event, source) {
  if (!state.lastData) return;
  event.preventDefault();
  state.petMenuSource = source;
  const rawRows = state.lastData.combatants || [];
  const ownerCandidates = rawRows
    .map((row) => row.source)
    .filter((owner) => owner && owner !== source && state.petAssignments[owner] !== source)
    .sort((a, b) => a.localeCompare(b));

  els.petMenuTitle.textContent = source;
  els.petOwnerSelect.replaceChildren(...ownerCandidates.map((owner) => {
    const option = document.createElement('option');
    option.value = owner;
    option.textContent = owner;
    return option;
  }));
  els.petOwnerSelect.value = state.petAssignments[source] || ownerCandidates[0] || '';
  els.petAssignButton.disabled = ownerCandidates.length === 0;
  els.petUnassignButton.disabled = !state.petAssignments[source];

  const width = 220;
  const height = 132;
  const left = Math.min(event.clientX, window.innerWidth - width - 8);
  const top = Math.min(event.clientY, window.innerHeight - height - 8);
  els.petMenu.style.left = `${Math.max(8, left)}px`;
  els.petMenu.style.top = `${Math.max(8, top)}px`;
  els.petMenuBackdrop.hidden = false;
  els.petMenu.hidden = false;
}

function closePetMenu() {
  state.petMenuSource = null;
  els.petMenuBackdrop.hidden = true;
  els.petMenu.hidden = true;
}

function getClassColor(className) {
  return CLASS_COLORS[className] || CLASS_COLORS.Unknown;
}

function getConfidenceLevel(value) {
  const confidence = Number(value || 0);
  if (confidence >= 0.67) return 'high';
  if (confidence > 0) return 'low';
  return 'none';
}

function renderEvents(data) {
  const rows = data.recentEvents || [];
  if (!rows.length) {
    els.eventsList.innerHTML = '<div class="empty">No recent events.</div>';
    return;
  }

  els.eventsList.replaceChildren(...rows.slice(0, 40).map((row) => {
    const div = document.createElement('div');
    div.className = 'event-line';
    div.innerHTML = `
      <span class="event-time">${formatTime(row.observedAt)}</span>
      <span class="event-type">${escapeHtml(row.eventType)}</span>
      <span class="event-message" title="${escapeHtml(row.rawMessage)}">${escapeHtml(row.rawMessage)}</span>
      <span class="event-amount">${row.amount ? formatNumber(row.amount) : ''}</span>
    `;
    return div;
  }));
}

async function renderBreakdown(rows) {
  if (!state.selectedSource) {
    els.detailTitle.textContent = 'Breakdown';
    els.detailSubtitle.textContent = 'Select a source';
    els.breakdown.className = 'breakdown empty';
    els.breakdown.textContent = 'No source selected.';
    return;
  }

  els.detailTitle.textContent = state.selectedSource;
  const selectedRow = getDisplayRows().find((row) => row.source === state.selectedSource);
  const petCount = selectedRow && selectedRow.assignedPets ? selectedRow.assignedPets.length : 0;
  els.detailSubtitle.textContent = `${rows.length} abilit${rows.length === 1 ? 'y' : 'ies'}${petCount ? `, ${petCount} pet${petCount === 1 ? '' : 's'}` : ''}`;

  if (!rows.length) {
    els.breakdown.className = 'breakdown empty';
    els.breakdown.textContent = state.metric === 'healing' ? 'No healing breakdown yet.' : 'No damage breakdown yet.';
    return;
  }

  const isHealing = state.metric === 'healing';
  els.breakdown.className = 'breakdown';
  els.breakdown.replaceChildren(...rows.map((row) => {
    const div = document.createElement('div');
    div.className = 'ability-row';
    div.innerHTML = `
      <div class="ability-name" title="${escapeHtml(row.ability)}">
        ${escapeHtml(row.ability)}
        <span class="ability-meta">${escapeHtml(isHealing ? 'healing' : (row.damageType || 'damage'))} - ${formatNumber(row.events)} ${isHealing ? 'casts' : 'hits'} - ${formatNumber(row.crits)} crits</span>
      </div>
      <div class="number">${formatNumber(row.total)}</div>
      <div class="number">${isHealing ? '' : formatNumber(row.mitigated)}</div>
    `;
    return div;
  }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function selectSource(source) {
  state.selectedSource = source;
  document.querySelectorAll('.combatant-row').forEach((row) => {
    row.classList.toggle('selected', row.dataset.source === source);
  });
  await loadBreakdown();
}

async function loadBreakdown() {
  if (!state.selectedSource) {
    await renderBreakdown([]);
    return;
  }

  const selectedRow = getDisplayRows().find((row) => row.source === state.selectedSource);
  const sources = [state.selectedSource, ...((selectedRow && selectedRow.assignedPets) || [])];
  const results = await Promise.all(sources.map((source) => {
    const params = new URLSearchParams({
      window: String(state.windowSeconds),
      metric: state.metric,
      source
    });
    return fetchJson(`/api/breakdown?${params}`);
  }));

  const grouped = new Map();
  for (const result of results) {
    for (const row of result.rows || []) {
      const key = `${row.ability}\u0000${row.damageType || ''}`;
      const current = grouped.get(key) || {
        ...row,
        total: 0,
        damage: 0,
        healing: 0,
        events: 0,
        hits: 0,
        mitigated: 0,
        crits: 0
      };
      addNumericFields(current, row);
      grouped.set(key, current);
    }
  }

  await renderBreakdown([...grouped.values()].sort((a, b) => (b.total - a.total) || (b.events - a.events)));
}

async function refresh() {
  try {
    const params = new URLSearchParams({
      window: String(state.windowSeconds),
      metric: state.metric,
      sourceMode: state.sourceMode
    });
    const data = await fetchJson(`/api/summary?${params}`);
    state.lastData = data;
    renderMetrics(data);
    renderCombatants(data);
    renderEvents(data);
    await loadBreakdown();
    if (els.settingsDrawer.classList.contains('open')) {
      await loadSettings();
    }
    setStatus(data.lastSeen ? `Reading ${formatTime(data.firstSeen)} to ${formatTime(data.lastSeen)}` : 'Waiting for parser data');
  } catch (error) {
    setStatus(`Dashboard error: ${error.message}`, true);
  }
}

document.querySelectorAll('.range-button').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.range-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.windowSeconds = Number(button.dataset.window || 300);
    await refresh();
  });
});

document.querySelectorAll('.metric-button').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.metric-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.metric = button.dataset.metric || 'damage';
    state.selectedSource = null;
    await refresh();
  });
});

document.querySelectorAll('.source-button').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.source-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.sourceMode = button.dataset.sourceMode || 'players';
    state.selectedSource = null;
    await refresh();
  });
});

els.resetButton.addEventListener('click', async () => {
  if (!window.confirm('Clear all captured combat data?')) return;

  els.resetButton.disabled = true;
  const previousText = els.resetButton.textContent;
  els.resetButton.textContent = 'Resetting';
  try {
    const result = await postJson('/api/reset');
    state.selectedSource = null;
    await refresh();
    setStatus(`Reset complete. Cleared ${formatNumber(result.deleted)} events.`);
  } catch (error) {
    setStatus(`Reset failed: ${error.message}`, true);
  } finally {
    els.resetButton.disabled = false;
    els.resetButton.textContent = previousText;
  }
});

els.settingsButton.addEventListener('click', openSettings);
els.settingsClose.addEventListener('click', closeSettings);
els.settingsBackdrop.addEventListener('click', closeSettings);
els.petMenuBackdrop.addEventListener('click', closePetMenu);

els.petAssignButton.addEventListener('click', async () => {
  const source = state.petMenuSource;
  const owner = els.petOwnerSelect.value;
  if (!source || !owner || source === owner) return;
  state.petAssignments[source] = owner;
  savePetAssignments();
  closePetMenu();
  await refresh();
});

els.petUnassignButton.addEventListener('click', async () => {
  const source = state.petMenuSource;
  if (!source) return;
  delete state.petAssignments[source];
  savePetAssignments();
  closePetMenu();
  await refresh();
});

els.settingPaused.addEventListener('change', async () => {
  try {
    await saveSettings({ paused: els.settingPaused.checked });
  } catch (error) {
    els.settingError.textContent = `Pause update failed: ${error.message}`;
  }
});

els.settingOverlay.addEventListener('change', async () => {
  try {
    await saveSettings({ overlayEnabled: els.settingOverlay.checked });
  } catch (error) {
    els.settingError.textContent = `Overlay update failed: ${error.message}`;
  }
});

els.settingInterval.addEventListener('change', async () => {
  try {
    await saveSettings({ intervalMs: Number(els.settingInterval.value) });
  } catch (error) {
    els.settingError.textContent = `Interval update failed: ${error.message}`;
  }
});

els.rescanButton.addEventListener('click', async () => {
  els.rescanButton.disabled = true;
  try {
    await postJson('/api/parser/rescan');
    await loadSettings();
    setStatus('Capture region will rescan on the next parser pass.');
  } catch (error) {
    els.settingError.textContent = `Rescan failed: ${error.message}`;
  } finally {
    els.rescanButton.disabled = false;
  }
});

refresh();
setInterval(refresh, 2000);
