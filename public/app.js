const state = {
  map: null,
  markers: [],
  plans: [],
  routePolyline: null,
};
const DEFAULT_MAP_CENTER = { lat: 39.5, lng: -98.35 };
const DEFAULT_MAP_ZOOM = 4;
const GENERAL_SEARCH_RADIUS_METERS = 50000;

const elements = {
  status: document.getElementById('status'),
  planForm: document.getElementById('planForm'),
  planTitle: document.getElementById('planTitle'),
  planDescription: document.getElementById('planDescription'),
  routeStart: document.getElementById('routeStart'),
  routeEnd: document.getElementById('routeEnd'),
  planSelect: document.getElementById('planSelect'),
  emailPlanSelect: document.getElementById('emailPlanSelect'),
  stopForm: document.getElementById('stopForm'),
  stopName: document.getElementById('stopName'),
  stopNotes: document.getElementById('stopNotes'),
  stopAddress: document.getElementById('stopAddress'),
  stopLat: document.getElementById('stopLat'),
  stopLng: document.getElementById('stopLng'),
  stopImage: document.getElementById('stopImage'),
  stopsList: document.getElementById('stopsList'),
  generalSearchForm: document.getElementById('generalSearchForm'),
  routeSearchForm: document.getElementById('routeSearchForm'),
  generalSearchInput: document.getElementById('generalSearchInput'),
  routeSearchInput: document.getElementById('routeSearchInput'),
  emailForm: document.getElementById('emailForm'),
  emailTo: document.getElementById('emailTo'),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? '#b91c1c' : '#111827';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Request failed');
  }
  return response.json();
}

function clearMarkers() {
  state.markers.forEach((m) => m.setMap(null));
  state.markers = [];
}

function addMarker({ lat, lng, title, contentHtml }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const marker = new google.maps.Marker({
    map: state.map,
    position: { lat, lng },
    title,
  });

  if (contentHtml) {
    const info = new google.maps.InfoWindow({ content: contentHtml });
    marker.addListener('click', () => info.open({ anchor: marker, map: state.map }));
  }

  state.markers.push(marker);
}

async function refreshPlans() {
  state.plans = await api('/api/plans');

  const options = state.plans
    .map((plan) => `<option value="${plan.id}">${escapeHtml(plan.title)}</option>`)
    .join('');

  elements.planSelect.innerHTML = options;
  elements.emailPlanSelect.innerHTML = options;

  if (state.plans.length > 0) {
    await loadPlanDetails(state.plans[0].id);
  } else {
    elements.stopsList.innerHTML = '<li>No saved stops yet.</li>';
    clearMarkers();
  }
}

async function loadPlanDetails(planId) {
  const plan = await api(`/api/plans/${planId}`);

  elements.stopsList.innerHTML = plan.stops.length
    ? plan.stops
        .map(
          (stop) => `<li>
              <strong>${escapeHtml(stop.name)}</strong>${stop.address ? ` — ${escapeHtml(stop.address)}` : ''}
              ${stop.notes ? `<div>${escapeHtml(stop.notes)}</div>` : ''}
              ${stop.image_path ? `<img src="${escapeHtml(stop.image_path)}" alt="${escapeHtml(stop.name)}" />` : ''}
            </li>`,
        )
        .join('')
    : '<li>No saved stops yet.</li>';

  clearMarkers();
  plan.stops.forEach((stop) => {
    addMarker({
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      title: stop.name,
      contentHtml: `<strong>${escapeHtml(stop.name)}</strong><br/>${escapeHtml(stop.address || '')}`,
    });
  });
}

async function savePlan(event) {
  event.preventDefault();
  const payload = {
    title: elements.planTitle.value,
    description: elements.planDescription.value,
    routeStart: elements.routeStart.value,
    routeEnd: elements.routeEnd.value,
  };

  const plan = await api('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  setStatus(`Saved plan: ${plan.title}`);
  elements.planForm.reset();
  await refreshPlans();
}

async function saveStop(event) {
  event.preventDefault();

  const planId = elements.planSelect.value;
  const formData = new FormData();
  formData.set('name', elements.stopName.value);
  formData.set('notes', elements.stopNotes.value);
  formData.set('address', elements.stopAddress.value);
  formData.set('lat', elements.stopLat.value);
  formData.set('lng', elements.stopLng.value);

  if (elements.stopImage.files[0]) {
    formData.set('image', elements.stopImage.files[0]);
  }

  await api(`/api/plans/${planId}/stops`, {
    method: 'POST',
    body: formData,
  });

  setStatus('Saved stop.');
  elements.stopForm.reset();
  await loadPlanDetails(planId);
}

function extractRoutePath(response) {
  const path = [];
  const route = response.routes?.[0];
  if (!route) return path;
  route.legs.forEach((leg) => {
    leg.steps.forEach((step) => {
      step.path.forEach((point) => path.push(point));
    });
  });
  return path;
}

async function drawRoute() {
  const selectedPlanId = elements.planSelect.value;
  if (!selectedPlanId) return;

  const plan = state.plans.find((p) => String(p.id) === String(selectedPlanId));
  if (!plan || !plan.route_start || !plan.route_end) {
    setStatus('Set route start/end on a plan before searching along route.', true);
    return null;
  }

  const directionsService = new google.maps.DirectionsService();
  const result = await directionsService.route({
    origin: plan.route_start,
    destination: plan.route_end,
    travelMode: google.maps.TravelMode.DRIVING,
  });

  if (state.routePolyline) {
    state.routePolyline.setMap(null);
  }

  const points = extractRoutePath(result).map((p) => ({ lat: p.lat(), lng: p.lng() }));
  state.routePolyline = new google.maps.Polyline({
    path: points,
    strokeColor: '#1d4ed8',
    strokeOpacity: 0.9,
    strokeWeight: 4,
    map: state.map,
  });

  const bounds = new google.maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  state.map.fitBounds(bounds);

  return { points, bounds };
}

function runTextSearch(request) {
  const places = new google.maps.places.PlacesService(state.map);
  return new Promise((resolve, reject) => {
    places.textSearch(request, (results, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK) {
        reject(new Error('No places found.'));
        return;
      }
      resolve(results || []);
    });
  });
}

async function runGeneralSearch(event) {
  event.preventDefault();
  const query = elements.generalSearchInput.value.trim();
  if (!query) return;

  const center = state.map.getCenter();
  const results = await runTextSearch({
    query,
    location: center,
    radius: GENERAL_SEARCH_RADIUS_METERS,
  });

  results.slice(0, 10).forEach((result) => {
    addMarker({
      lat: result.geometry.location.lat(),
      lng: result.geometry.location.lng(),
      title: result.name,
      contentHtml: `<strong>${escapeHtml(result.name)}</strong><br/>${escapeHtml(result.formatted_address || '')}`,
    });
  });

  setStatus(`Found ${results.length} general results for "${query}".`);
}

async function runRouteSearch(event) {
  event.preventDefault();
  const query = elements.routeSearchInput.value.trim();
  if (!query) return;

  const route = await drawRoute();
  if (!route) return;

  const results = await runTextSearch({
    query,
    bounds: route.bounds,
  });

  results.slice(0, 15).forEach((result) => {
    addMarker({
      lat: result.geometry.location.lat(),
      lng: result.geometry.location.lng(),
      title: result.name,
      contentHtml: `<strong>${escapeHtml(result.name)}</strong><br/>${escapeHtml(result.formatted_address || '')}`,
    });
  });

  setStatus(`Found ${results.length} results along route for "${query}".`);
}

async function exportPlan(event) {
  event.preventDefault();

  const planId = elements.emailPlanSelect.value;
  await api(`/api/plans/${planId}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: elements.emailTo.value }),
  });

  setStatus('Plan export email sent.');
}

async function initMap() {
  const config = await api('/api/config');

  if (!config.mapsApiKey) {
    setStatus('Set GOOGLE_MAPS_API_KEY in environment to load map features.', true);
    return;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.mapsApiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Maps script.'));
    document.head.appendChild(script);
  });

  state.map = new google.maps.Map(document.getElementById('map'), {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
  });

  state.map.addListener('click', (event) => {
    elements.stopLat.value = event.latLng.lat().toFixed(6);
    elements.stopLng.value = event.latLng.lng().toFixed(6);
    addMarker({
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
      title: 'New Marker',
      contentHtml: 'Marker selected for next stop save.',
    });
  });

  await refreshPlans();
}

async function boot() {
  elements.planForm.addEventListener('submit', (event) => savePlan(event).catch((e) => setStatus(e.message, true)));
  elements.stopForm.addEventListener('submit', (event) => saveStop(event).catch((e) => setStatus(e.message, true)));
  elements.generalSearchForm.addEventListener('submit', (event) => runGeneralSearch(event).catch((e) => setStatus(e.message, true)));
  elements.routeSearchForm.addEventListener('submit', (event) => runRouteSearch(event).catch((e) => setStatus(e.message, true)));
  elements.emailForm.addEventListener('submit', (event) => exportPlan(event).catch((e) => setStatus(e.message, true)));
  elements.planSelect.addEventListener('change', (event) => loadPlanDetails(event.target.value).catch((e) => setStatus(e.message, true)));

  try {
    await initMap();
  } catch (error) {
    setStatus(error.message, true);
  }
}

boot();
