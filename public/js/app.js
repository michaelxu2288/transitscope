const CATEGORY_COLORS = {
  Hospital: '#ef4444',
  Library: '#14b8a6',
  Retail: '#facc15',
};

const API_BASES = (() => {
  const bases = [];
  if (window.__TRANSITSCOPE_API_BASE__) {
    bases.push(window.__TRANSITSCOPE_API_BASE__);
  }
  if (window.location.protocol.startsWith('http')) {
    bases.push(window.location.origin);
  }
  bases.push('http://localhost:3000');
  return [...new Set(bases)];
})();

const state = {
  config: null,
  selectedMinutes: null,
  selectedCategories: new Set(),
  selectedProfile: null,
  map: null,
  isoLayer: null,
  poiLayer: null,
  compareLayer: null,
  comparePoiLayers: [],
  compareShapes: [],
  originMarker: null,
  currentOrigin: null,
  lastSnapshot: null,
  savedLocations: [],
  savedReport: null,
  editingLocationId: null,
  // Auth state
  user: null,
  sessionId: localStorage.getItem('sessionId') || null,
};

function setStatus(message) {
  document.getElementById('status-bar').textContent = message;
}

async function fetchJson(url, options = {}) {
  let lastError;
  for (const base of API_BASES) {
    const target = /^https?:/i.test(url) ? url : `${base}${url}`;
    try {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      // Include session ID if available
      if (state.sessionId) {
        headers['X-Session-ID'] = state.sessionId;
      }
      const response = await fetch(target, {
        headers,
        ...options,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      if (response.status === 204) {
        return null;
      }
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Request failed');
}

function createChip(value, label, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `chip-option${active ? ' active' : ''}`;
  button.textContent = label;
  button.addEventListener('click', () => onClick(value));
  return button;
}

function createTag(value, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tag${active ? ' active' : ''}`;
  button.textContent = value;
  button.addEventListener('click', () => onClick(value));
  return button;
}

function renderTravelOptions() {
  const container = document.getElementById('travel-options');
  container.innerHTML = '';
  state.config.travelOptions.forEach((minutes) => {
    const chip = createChip(
      minutes,
      `${minutes} min`,
      minutes === state.selectedMinutes,
      (value) => {
        state.selectedMinutes = value;
        renderTravelOptions();
      },
    );
    container.appendChild(chip);
  });
}

function renderCategoryOptions() {
  const container = document.getElementById('category-options');
  container.innerHTML = '';
  state.config.poiCategories.forEach((category) => {
    const tag = createTag(category, state.selectedCategories.has(category), (value) => {
      if (state.selectedCategories.has(value)) {
        state.selectedCategories.delete(value);
      } else {
        state.selectedCategories.add(value);
      }
      renderCategoryOptions();
    });
    container.appendChild(tag);
  });
}

function renderProfileSelect() {
  const select = document.getElementById('profile-select');
  select.innerHTML = '';
  state.config.scoringProfiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  });
  select.value = state.selectedProfile;
  updateProfileDescription();
}

function updateProfileDescription() {
  const description = document.getElementById('profile-description');
  description.textContent =
    state.config.scoringProfiles.find((profile) => profile.id === state.selectedProfile)?.description ||
    '';
}

function setupDatasetPill() {
  const pill = document.getElementById('dataset-pill');
  const stats = state.config.datasetStats;
  pill.textContent = `NYC GTFS snapshot · ${stats.routes} routes · ${stats.stops} stops · ${stats.pois} POIs`;
}

function initMap(defaultLocation) {
  state.map = L.map('map', {
    zoomControl: true,
  }).setView([defaultLocation.latitude, defaultLocation.longitude], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);

  state.isoLayer = L.layerGroup().addTo(state.map);
  state.poiLayer = L.layerGroup().addTo(state.map);
  state.compareLayer = L.layerGroup().addTo(state.map);

  state.map.on('click', (event) => {
    const label = `Dropped pin (${event.latlng.lat.toFixed(4)}, ${event.latlng.lng.toFixed(4)})`;
    setOrigin({ latitude: event.latlng.lat, longitude: event.latlng.lng, label });
  });
}

function updateOriginMarker(origin) {
  if (!state.map) return;
  if (!state.originMarker) {
    state.originMarker = L.marker([origin.latitude, origin.longitude], { draggable: true }).addTo(
      state.map,
    );
    state.originMarker.on('moveend', (event) => {
      const latlng = event.target.getLatLng();
      setOrigin(
        {
          latitude: latlng.lat,
          longitude: latlng.lng,
          label: `Dragged pin (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`,
        },
        { runAnalysis: true },
      );
    });
  } else {
    state.originMarker.setLatLng([origin.latitude, origin.longitude]);
  }
}

function setOrigin(origin, options = { runAnalysis: false }) {
  state.currentOrigin = origin;
  updateOriginMarker(origin);
  const formLat = document.getElementById('save-lat');
  const formLon = document.getElementById('save-lon');
  if (formLat && formLon) {
    formLat.value = Number(origin.latitude).toFixed(6);
    formLon.value = Number(origin.longitude).toFixed(6);
  }
  if (options.runAnalysis) {
    runIsochrone();
  } else {
    setStatus(`Pinned ${origin.label}. Click “Update accessibility” to refresh insights.`);
  }
}

function buildHull(stops) {
  if (!window.turf || stops.length < 3) {
    return null;
  }
  const points = turf.featureCollection(
    stops.map((stop) => turf.point([stop.longitude, stop.latitude])),
  );
  let polygon = turf.concave(points, { maxEdge: 5, units: 'kilometers' });
  if (!polygon) {
    polygon = turf.convex(points);
  }
  return polygon;
}

function drawIsochrone(
  snapshot,
  options = { color: '#2563eb', layer: 'iso', clearLayer: true, poiLimit: 150, poiLayer: null },
) {
  const { reachableStops, accessiblePois } = snapshot;
  const poiHullPoints = accessiblePois.slice(0, 200).map((poi) => ({
    stop_id: `poi-${poi.poi_id ?? poi.name}`,
    stop_name: poi.name,
    latitude: poi.latitude,
    longitude: poi.longitude,
    minutes: poi.minutes,
  }));
  const hull = buildHull([...reachableStops, ...poiHullPoints]);
  const targetLayer = options.layer === 'compare' ? state.compareLayer : state.isoLayer;
  if (options.clearLayer) {
    targetLayer.clearLayers();
  }
  let geometryLayer = null;
  if (hull) {
    geometryLayer = L.geoJSON(hull, {
      style: {
        color: options.color,
        fillColor: options.color,
        weight: 2,
        fillOpacity: options.layer === 'compare' ? 0.15 : 0.25,
      },
    }).addTo(targetLayer);
  } else if (reachableStops.length > 0) {
    const [first] = reachableStops;
    geometryLayer = L.circle([first.latitude, first.longitude], {
      radius: 400,
      color: options.color,
    }).addTo(targetLayer);
  }
  if (options.layer === 'compare' && geometryLayer) {
    state.compareShapes.push(geometryLayer);
  }

  if (options.poiLayer) {
    if (options.clearPoiLayer !== false && options.poiLayer.clearLayers) {
      options.poiLayer.clearLayers();
    }
    accessiblePois.slice(0, options.poiLimit ?? 150).forEach((poi) => {
      const marker = L.circleMarker([poi.latitude, poi.longitude], {
        radius: 6,
        color: CATEGORY_COLORS[poi.category_name] || '#f97316',
        fillOpacity: 0.85,
      });
      marker.bindPopup(
        `<strong>${poi.name}</strong><br>${poi.category_name}<br>${poi.minutes.toFixed(
          1,
        )} min from pin`,
      );
      marker.addTo(options.poiLayer);
    });
  }
}

function renderScorecard(snapshot) {
  const heading = document.getElementById('score-heading');
  heading.textContent = `Within ${snapshot.maxMinutes}-minute ride of ${state.currentOrigin.label}`;
  document.getElementById('score-value').textContent = snapshot.score.toFixed(2);
  document.getElementById('poi-count').textContent = snapshot.metadata.poiCount;
  document.getElementById('stop-count').textContent = `${snapshot.metadata.reachedStopCount} stops`;

  const breakdown = document.getElementById('score-breakdown');
  breakdown.innerHTML = '';
  state.config.poiCategories.forEach((category) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${category}</span><strong>${snapshot.countsByCategory[category] || 0}</strong>`;
    breakdown.appendChild(li);
  });

  const nearest = document.getElementById('nearest-stops');
  nearest.innerHTML = snapshot.nearestStops
    .slice(0, 3)
    .map((stop) => `${stop.stop_name} · ${stop.distanceKm.toFixed(2)} km walk`)
    .join('<br>');

  const poiSummary = document.getElementById('poi-summary');
  poiSummary.innerHTML = state.config.poiCategories
    .map(
      (category) =>
        `<li><strong>${snapshot.countsByCategory[category] || 0}</strong> ${category}s</li>`,
    )
    .join('');
}

async function runIsochrone() {
  clearComparePoiLayers();
  clearCompareShapes();
  resetCompareLayer();
  resetIsoLayer();
  if (!state.currentOrigin) {
    setStatus('Drop a pin or search for an address to begin.');
    return;
  }
  setStatus('Crunching the transit graph…');
  try {
    const payload = {
      latitude: state.currentOrigin.latitude,
      longitude: state.currentOrigin.longitude,
      maxMinutes: state.selectedMinutes,
      categories: Array.from(state.selectedCategories),
      profileId: state.selectedProfile,
    };
    const snapshot = await fetchJson('/api/isochrone', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.lastSnapshot = snapshot;
    drawIsochrone(snapshot, { poiLayer: state.poiLayer, poiLimit: 150, clearPoiLayer: true });
    renderScorecard(snapshot);
    setStatus(
      `We found ${snapshot.metadata.poiCount} essential destinations across ${snapshot.metadata.reachedStopCount} reachable stops.`,
    );
    updateComparisonOptions();
  } catch (error) {
    console.error(error);
    setStatus('Could not compute the isochrone. Please adjust the pin and try again.');
  }
}

async function loadSavedLocations() {
  try {
    clearComparePoiLayers();
    state.savedLocations = await fetchJson('/api/saved-locations');
    if (
      state.editingLocationId &&
      !state.savedLocations.some((loc) => loc.location_id === state.editingLocationId)
    ) {
      resetEditMode();
    }
    renderSavedLocations();
    updateComparisonOptions();
    await loadSavedLocationReport();
  } catch (error) {
    console.error(error);
    setStatus('Failed to load saved locations (check the API server).');
  }
}

async function loadSavedLocationReport() {
  try {
    const report = await fetchJson('/api/saved-locations/report');
    state.savedReport = report;
    updateSavedSummary(report);
  } catch (error) {
    console.error(error);
    document.getElementById('saved-summary').textContent = 'Failed to load saved location stats.';
  }
}

function updateSavedSummary(report) {
  const summaryEl = document.getElementById('saved-summary');
  const historyEl = document.getElementById('saved-history');
  if (!report || !report.summary) {
    summaryEl.textContent = 'No saved locations yet.';
    historyEl.textContent = '';
    return;
  }
  const summary = report.summary;
  const history = report.history || [];
  const lastSavedText = summary.last_saved_at
    ? new Date(summary.last_saved_at).toLocaleString()
    : 'N/A';
  summaryEl.textContent = `${summary.location_count} locations saved · last saved ${lastSavedText}`;

  if (history.length === 0) {
    historyEl.textContent = '';
  } else {
    const topDays = history.slice(0, 3).map((entry) => {
      const day = new Date(entry.saved_date).toLocaleDateString();
      return `${day}: ${entry.saves_on_day} saves`;
    });
    historyEl.textContent = `Recent activity — ${topDays.join(' · ')}`;
  }
}

function renderSavedLocations() {
  const list = document.getElementById('saved-panel-list');
  list.innerHTML = '';
  if (state.savedLocations.length === 0) {
    list.innerHTML = '<li class="saved-item">No saved locations yet.</li>';
    return;
  }
  state.savedLocations.forEach((loc) => {
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    const li = document.createElement('li');
    li.className = 'saved-item';
    const createdText = loc.created_at ? new Date(loc.created_at).toLocaleString() : '';
    li.innerHTML = `<strong>${loc.name}</strong><span class="helper-text">${loc.address || ''}</span><span class="helper-text">Saved ${createdText}</span>`;
    const actions = document.createElement('div');
    actions.className = 'saved-item-actions';
    const fly = document.createElement('button');
    fly.type = 'button';
    fly.className = 'ghost-btn';
    fly.textContent = 'Set as start';
    fly.addEventListener('click', () => {
      state.map.setView([lat, lon], 13);
      setOrigin({ latitude: lat, longitude: lon, label: loc.name }, { runAnalysis: true });
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost-btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      startEditMode(loc);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-btn';
    remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
      try {
        await fetchJson(`/api/saved-locations/${loc.location_id}`, { method: 'DELETE' });
        await loadSavedLocations();
      } catch (error) {
        console.error(error);
        setStatus('Failed to delete saved location.');
      }
    });

    actions.append(fly, edit, remove);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function openSavedPanel() {
  document.getElementById('saved-panel').classList.add('visible');
}

function closeSavedPanel() {
  document.getElementById('saved-panel').classList.remove('visible');
}

function updateComparisonOptions() {
  const baseOptions = [];
  if (state.currentOrigin) {
    baseOptions.push({
      key: 'current',
      label: `Current pin · ${state.currentOrigin.label}`,
      latitude: state.currentOrigin.latitude,
      longitude: state.currentOrigin.longitude,
    });
  }
  state.savedLocations.forEach((loc) => {
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    baseOptions.push({
      key: `saved-${loc.location_id}`,
      label: loc.name,
      latitude: lat,
      longitude: lon,
    });
  });

  ['compare-a', 'compare-b'].forEach((id, index) => {
    const select = document.getElementById(id);
    const previous = select.value;
    select.innerHTML = '';
    baseOptions.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.key;
      option.dataset.lat = entry.latitude;
      option.dataset.lon = entry.longitude;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    if (previous && baseOptions.some((entry) => entry.key === previous)) {
      select.value = previous;
    } else if (baseOptions[index]) {
      select.value = baseOptions[index].key;
    }
  });
}

function extractOptionData(option) {
  if (!option || !option.dataset.lat) return null;
  return {
    label: option.textContent,
    latitude: Number(option.dataset.lat),
    longitude: Number(option.dataset.lon),
  };
}

function renderComparisonResults(results) {
  const container = document.getElementById('compare-results');
  container.innerHTML = '';
  const colors = ['#2563eb', '#ec4899', '#10b981', '#f97316'];
  clearCompareShapes();
  resetCompareLayer();
  clearComparePoiLayers();
  resetIsoLayer();

  results.forEach((result, index) => {
    const color = colors[index % colors.length];
    const poiLayer = L.layerGroup().addTo(state.map);
    state.comparePoiLayers.push(poiLayer);
    drawIsochrone(result, {
      color,
      layer: 'compare',
      clearLayer: false,
      poiLayer,
      poiLimit: 50,
      clearPoiLayer: true,
    });

    const card = document.createElement('div');
    card.className = 'compare-card';
    card.innerHTML = `
      <h4>${result.label}</h4>
      <p class="stat">${result.metadata.poiCount} POIs</p>
      <ul>
        ${state.config.poiCategories
          .map(
            (category) =>
              `<li>${category}: <strong>${result.countsByCategory[category] || 0}</strong></li>`,
          )
          .join('')}
      </ul>
    `;
    container.appendChild(card);
  });
}

async function runComparison() {
  const optionA = document.getElementById('compare-a').selectedOptions[0];
  const optionB = document.getElementById('compare-b').selectedOptions[0];
  const origins = [extractOptionData(optionA), extractOptionData(optionB)].filter(Boolean);
  if (origins.length < 2) {
    setStatus('Need two valid locations to compare.');
    return;
  }
  try {
    setStatus('Comparing neighborhoods…');
    const response = await fetchJson('/api/compare', {
      method: 'POST',
      body: JSON.stringify({
        origins,
        maxMinutes: state.selectedMinutes,
        categories: Array.from(state.selectedCategories),
        profileId: state.selectedProfile,
      }),
    });
    renderComparisonResults(response.results);
    setStatus('Comparison updated on the map.');
  } catch (error) {
    console.error(error);
    setStatus('Could not complete the comparison.');
  }
}

async function submitSaveForm(event) {
  event.preventDefault();
  const name = document.getElementById('save-name').value.trim();
  const address = document.getElementById('save-address').value.trim();
  const latitude = Number(document.getElementById('save-lat').value);
  const longitude = Number(document.getElementById('save-lon').value);
  if (!name || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    document.getElementById('save-status').textContent = 'Fill out the name and coordinates.';
    return;
  }
  try {
    if (state.editingLocationId) {
      await fetchJson(`/api/saved-locations/${state.editingLocationId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, address, latitude, longitude }),
      });
      document.getElementById('save-status').textContent = 'Location updated!';
      resetEditMode();
      await loadSavedLocations();
    } else {
      const response = await fetchJson('/api/saved-locations', {
        method: 'POST',
        body: JSON.stringify({ name, address, latitude, longitude }),
      });
      document.getElementById('save-status').textContent = 'Saved!';
      document.getElementById('save-form').reset();
      await loadSavedLocations();
      if (response.report) {
        updateSavedSummary(response.report);
      }
    }
  } catch (error) {
    console.error(error);
    document.getElementById('save-status').textContent = 'Failed to save location.';
  }
}

async function fetchRouteLeaderboard() {
  try {
    const routes = await fetchJson('/api/analytics/top-routes');
    const list = document.getElementById('route-leaderboard');
    list.innerHTML = routes
      .map(
        (route) =>
          `<li><strong>${route.route_short_name}</strong> · ${route.route_long_name} (${route.stop_count} stops)</li>`,
      )
      .join('');
  } catch (error) {
    console.error(error);
  }
}

async function handleSearch(event) {
  event.preventDefault();
  const input = document.getElementById('search-query');
  const term = input.value.trim();
  if (!term) {
    return;
  }
  setStatus(`Finding ${term}…`);
  try {
    const results = await fetchJson(`/api/geocode?q=${encodeURIComponent(term)}`);
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    if (results.length === 0) {
      container.textContent = 'No matches.';
      return;
    }
    results.forEach((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      button.textContent = result.label;
      button.addEventListener('click', () => {
        state.map.setView([result.latitude, result.longitude], 13);
        setOrigin(result, { runAnalysis: true });
        container.innerHTML = '';
      });
      container.appendChild(button);
    });
  } catch (error) {
    console.error(error);
    setStatus('Geocoder unavailable. Try again in a moment.');
  }
}

function wireEvents() {
  document.getElementById('search-form').addEventListener('submit', handleSearch);
  document.getElementById('run-analysis').addEventListener('click', runIsochrone);
  document.getElementById('profile-select').addEventListener('change', (event) => {
    state.selectedProfile = event.target.value;
    updateProfileDescription();
    if (state.currentOrigin) {
      runIsochrone();
    }
  });
  document.getElementById('refresh-locations').addEventListener('click', loadSavedLocations);
  document.getElementById('save-form').addEventListener('submit', submitSaveForm);
  document
    .getElementById('use-current-coordinates')
    .addEventListener('click', () => {
      if (!state.currentOrigin) return;
      document.getElementById('save-lat').value = state.currentOrigin.latitude.toFixed(6);
      document.getElementById('save-lon').value = state.currentOrigin.longitude.toFixed(6);
    });
  document.getElementById('cancel-edit').addEventListener('click', resetEditMode);
  document.getElementById('compare-btn').addEventListener('click', runComparison);
  document.getElementById('open-saved-panel').addEventListener('click', openSavedPanel);
  document.getElementById('close-saved-panel').addEventListener('click', closeSavedPanel);
  document.getElementById('saved-panel-overlay').addEventListener('click', closeSavedPanel);
}

function clearComparePoiLayers() {
  state.comparePoiLayers.forEach((layer) => {
    if (state.map && state.map.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });
  state.comparePoiLayers = [];
}

function resetCompareLayer() {
  if (!state.map) return;
  if (state.compareLayer && state.map.hasLayer(state.compareLayer)) {
    state.map.removeLayer(state.compareLayer);
  }
  state.compareLayer = L.layerGroup().addTo(state.map);
}

function resetIsoLayer() {
  if (!state.map) return;
  if (state.isoLayer && state.map.hasLayer(state.isoLayer)) {
    state.map.removeLayer(state.isoLayer);
  }
  state.isoLayer = L.layerGroup().addTo(state.map);
}

function clearCompareShapes() {
  state.compareShapes.forEach((layer) => {
    if (state.map && state.map.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });
  state.compareShapes = [];
}

function startEditMode(loc) {
  state.editingLocationId = loc.location_id;
  document.getElementById('form-title').textContent = 'Edit favorite';
  document.getElementById('save-button').textContent = 'Update location';
  document.getElementById('cancel-edit').classList.remove('hidden');
  document.getElementById('save-name').value = loc.name;
  document.getElementById('save-address').value = loc.address || '';
  document.getElementById('save-lat').value = Number(loc.latitude).toFixed(6);
  document.getElementById('save-lon').value = Number(loc.longitude).toFixed(6);
  document.getElementById('save-status').textContent = 'Editing existing location…';
  closeSavedPanel();
  document.getElementById('save-name').focus();
  const form = document.getElementById('save-form');
  form.classList.add('shake');
  setTimeout(() => form.classList.remove('shake'), 500);
  document.getElementById('save-status').classList.add('highlight');
}

function resetEditMode() {
  state.editingLocationId = null;
  document.getElementById('form-title').textContent = 'Add a new favorite';
  document.getElementById('save-button').textContent = 'Save location';
  document.getElementById('cancel-edit').classList.add('hidden');
  document.getElementById('save-form').reset();
  document.getElementById('save-status').textContent = '';
  document.getElementById('save-status').classList.remove('highlight');
}

// ==================== AUTH FUNCTIONS ====================

function setSession(sessionId, user) {
  state.sessionId = sessionId;
  state.user = user;
  if (sessionId) {
    localStorage.setItem('sessionId', sessionId);
  } else {
    localStorage.removeItem('sessionId');
  }
  updateAuthUI();
}

function updateAuthUI() {
  const userStatus = document.getElementById('user-status');
  if (state.user) {
    userStatus.innerHTML = `
      <span class="user-greeting">Hi, <strong>${state.user.username}</strong></span>
      <button id="profile-btn" class="auth-btn" type="button">Profile</button>
    `;
    document.getElementById('profile-btn').addEventListener('click', openProfileModal);
  } else {
    userStatus.innerHTML = `
      <button id="auth-btn" class="auth-btn" type="button">Sign In</button>
    `;
    document.getElementById('auth-btn').addEventListener('click', openAuthModal);
  }
}

function openAuthModal() {
  document.getElementById('auth-modal').classList.add('visible');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('tab-login').classList.add('active');
  document.getElementById('tab-register').classList.remove('active');
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('visible');
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
}

function openProfileModal() {
  if (!state.user) return;
  document.getElementById('profile-modal').classList.add('visible');
  document.getElementById('profile-username').textContent = state.user.username;
  document.getElementById('profile-username-input').value = state.user.username;
  document.getElementById('profile-email-input').value = state.user.email;
  document.getElementById('profile-password-input').value = '';
  document.getElementById('profile-error').textContent = '';
  document.getElementById('profile-success').textContent = '';
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('visible');
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const response = await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSession(response.sessionId, response.user);
    closeAuthModal();
    await loadSavedLocations();
    setStatus(`Welcome back, ${response.user.username}!`);
  } catch (error) {
    console.error('Login error:', error);
    try {
      const errData = JSON.parse(error.message);
      errorEl.textContent = errData.error || 'Login failed';
    } catch {
      errorEl.textContent = 'Login failed. Please check your credentials.';
    }
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  try {
    const response = await fetchJson('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    setSession(response.sessionId, response.user);
    closeAuthModal();
    await loadSavedLocations();
    setStatus(`Welcome, ${response.user.username}! Your account has been created.`);
  } catch (error) {
    console.error('Registration error:', error);
    try {
      const errData = JSON.parse(error.message);
      errorEl.textContent = errData.error || 'Registration failed';
    } catch {
      errorEl.textContent = 'Registration failed. Please try again.';
    }
  }
}

async function handleLogout() {
  try {
    await fetchJson('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout error:', error);
  }
  setSession(null, null);
  closeProfileModal();
  await loadSavedLocations();
  setStatus('You have been signed out.');
}

async function handleProfileUpdate(event) {
  event.preventDefault();
  if (!state.user) return;
  const username = document.getElementById('profile-username-input').value;
  const email = document.getElementById('profile-email-input').value;
  const password = document.getElementById('profile-password-input').value;
  const errorEl = document.getElementById('profile-error');
  const successEl = document.getElementById('profile-success');
  errorEl.textContent = '';
  successEl.textContent = '';
  try {
    const body = { username, email };
    if (password) {
      body.password = password;
    }
    const updatedUser = await fetchJson(`/api/users/${state.user.user_id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    state.user = updatedUser;
    document.getElementById('profile-username').textContent = updatedUser.username;
    updateAuthUI();
    successEl.textContent = 'Profile updated successfully!';
    document.getElementById('profile-password-input').value = '';
  } catch (error) {
    console.error('Profile update error:', error);
    try {
      const errData = JSON.parse(error.message);
      errorEl.textContent = errData.error || 'Update failed';
    } catch {
      errorEl.textContent = 'Failed to update profile.';
    }
  }
}

async function handleDeleteAccount() {
  if (!state.user) return;
  const confirmed = confirm(
    'Are you sure you want to delete your account? This action cannot be undone and all your saved locations will be lost.'
  );
  if (!confirmed) return;
  try {
    await fetchJson(`/api/users/${state.user.user_id}`, { method: 'DELETE' });
    setSession(null, null);
    closeProfileModal();
    await loadSavedLocations();
    setStatus('Your account has been deleted.');
  } catch (error) {
    console.error('Delete account error:', error);
    document.getElementById('profile-error').textContent = 'Failed to delete account.';
  }
}

async function checkExistingSession() {
  if (!state.sessionId) return;
  try {
    const user = await fetchJson('/api/auth/me');
    state.user = user;
    updateAuthUI();
  } catch (error) {
    // Session invalid, clear it
    console.log('Session expired or invalid');
    localStorage.removeItem('sessionId');
    state.sessionId = null;
    state.user = null;
  }
}

function wireAuthEvents() {
  // Auth modal events
  document.getElementById('auth-btn')?.addEventListener('click', openAuthModal);
  document.getElementById('close-auth-modal').addEventListener('click', closeAuthModal);
  document.getElementById('auth-modal-overlay').addEventListener('click', closeAuthModal);

  // Tab switching
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
  });
  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('tab-register').classList.add('active');
  });

  // Form submissions
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);

  // Profile modal events
  document.getElementById('close-profile-modal').addEventListener('click', closeProfileModal);
  document.getElementById('profile-modal-overlay').addEventListener('click', closeProfileModal);
  document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('delete-account-btn').addEventListener('click', handleDeleteAccount);
}

// ==================== END AUTH FUNCTIONS ====================

async function init() {
  try {
    state.config = await fetchJson('/api/app-config');
    state.selectedMinutes = state.config.travelOptions.includes(30)
      ? 30
      : state.config.travelOptions[0];
    state.selectedCategories = new Set(state.config.poiCategories);
    state.selectedProfile = state.config.scoringProfiles[0].id;
    setupDatasetPill();
    renderTravelOptions();
    renderCategoryOptions();
    renderProfileSelect();
    initMap(state.config.defaultLocation);
    wireEvents();
    wireAuthEvents();
    // Check for existing session
    await checkExistingSession();
    setStatus('Pick a starting point to get transit insights.');
    await fetchRouteLeaderboard();
    await loadSavedLocations();
    setOrigin(
      {
        latitude: state.config.defaultLocation.latitude,
        longitude: state.config.defaultLocation.longitude,
        label: 'Downtown NYC',
      },
      { runAnalysis: true },
    );
  } catch (error) {
    console.error(error);
    setStatus('Failed to load configuration. Ensure the server is running.');
  }
}

document.addEventListener('DOMContentLoaded', init);
