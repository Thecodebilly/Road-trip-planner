import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { GoogleMap, InfoWindowF, MarkerF, PolylineF, useLoadScript } from '@react-google-maps/api';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  FilePlus2,
  FolderOpen,
  LocateFixed,
  MapPin,
  Plus,
  Route,
  Save,
  Trash2,
  Wifi,
} from 'lucide-react';
import tripStops from './tripStops.json';

type ImportedTripStop = {
  order: number;
  date: string;
  label: string;
  lat: number;
  lng: number;
  notes: string;
  remoteWork?: boolean;
};

type TripStop = ImportedTripStop & {
  id: string;
};

type Trip = {
  id: string;
  name: string;
  notes: string;
  stops: TripStop[];
  createdAt: string;
  updatedAt: string;
};

type MapCanvasProps = {
  apiKey: string;
  stops: TripStop[];
  selectedStopId: string | null;
  fitSignal: number;
  onSelectStop: (stopId: string | null) => void;
};

const mapContainerStyle = { width: '100%', height: '100%' };
const usCenter = { lat: 39.8283, lng: -98.5795 };
const savedTripsKey = 'road-trip-planner.savedTrips.v1';
const activeTripKey = 'road-trip-planner.activeTrip.v1';
const defaultTripId = 'default-2026-usa-itinerary';

const seedStops = [...(tripStops as ImportedTripStop[])]
  .sort((a, b) => a.order - b.order)
  .map((stop, index) => ({
    ...stop,
    id: `seed-stop-${stop.order}`,
    order: index + 1,
  }));

const mapStyles: google.maps.MapTypeStyle[] = [
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#f1eee7' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#cfe4ea' }],
  },
];

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resequenceStops(stops: TripStop[]) {
  return [...stops]
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index + 1 }));
}

function normalizeTrip(candidate: Partial<Trip> | null | undefined): Trip | null {
  if (!candidate || !Array.isArray(candidate.stops)) return null;

  const now = new Date().toISOString();
  const stops = candidate.stops
    .filter((stop) => stop && typeof stop.label === 'string')
    .map((stop, index) => ({
      id: typeof stop.id === 'string' ? stop.id : makeId('stop'),
      order: Number.isFinite(stop.order) ? stop.order : index + 1,
      date: typeof stop.date === 'string' ? stop.date : '',
      label: stop.label || 'Untitled stop',
      lat: Number.isFinite(stop.lat) ? stop.lat : usCenter.lat,
      lng: Number.isFinite(stop.lng) ? stop.lng : usCenter.lng,
      notes: typeof stop.notes === 'string' ? stop.notes : '',
      remoteWork: Boolean(stop.remoteWork),
    }));

  return {
    id: typeof candidate.id === 'string' ? candidate.id : makeId('trip'),
    name: candidate.name?.trim() || 'Untitled trip',
    notes: typeof candidate.notes === 'string' ? candidate.notes : '',
    stops: resequenceStops(stops),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  };
}

function createDefaultTrip(): Trip {
  const now = new Date().toISOString();

  return {
    id: defaultTripId,
    name: '2026 USA itinerary',
    notes: 'Jacksonville to Winston-Salem through the Southwest, California, and the Blue Ridge.',
    stops: seedStops,
    createdAt: now,
    updatedAt: now,
  };
}

function createBlankTrip(): Trip {
  const now = new Date().toISOString();

  return {
    id: makeId('trip'),
    name: 'Untitled trip',
    notes: '',
    stops: [
      {
        id: makeId('stop'),
        order: 1,
        date: '',
        label: 'First stop',
        lat: usCenter.lat,
        lng: usCenter.lng,
        notes: '',
        remoteWork: false,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function readActiveTrip() {
  try {
    const saved = window.localStorage.getItem(activeTripKey);
    return saved ? normalizeTrip(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function readSavedTrips() {
  try {
    const saved = window.localStorage.getItem(savedTripsKey);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((trip) => normalizeTrip(trip))
      .filter((trip): trip is Trip => Boolean(trip))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be unavailable in private browsing or locked-down embeds.
  }
}

function formatDate(date: string) {
  if (!date) return 'Unscheduled';

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatDateTime(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Just now';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function calculateMiles(stops: TripStop[]) {
  const earthRadiusMiles = 3958.8;
  let miles = 0;

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    const dLat = ((next.lat - previous.lat) * Math.PI) / 180;
    const dLng = ((next.lng - previous.lng) * Math.PI) / 180;
    const lat1 = (previous.lat * Math.PI) / 180;
    const lat2 = (next.lat * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    miles += earthRadiusMiles * c;
  }

  return Math.round(miles);
}

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const [savedTrips, setSavedTrips] = useState<Trip[]>(readSavedTrips);
  const [activeTrip, setActiveTrip] = useState<Trip>(() => readActiveTrip() || createDefaultTrip());
  const [selectedStopId, setSelectedStopId] = useState<string | null>(
    () => activeTrip.stops[0]?.id || null,
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');

  const stops = useMemo(() => resequenceStops(activeTrip.stops), [activeTrip.stops]);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const routeMiles = useMemo(() => calculateMiles(stops), [stops]);
  const remoteStops = useMemo(() => stops.filter((stop) => stop.remoteWork).length, [stops]);
  const dateRange = useMemo(() => {
    if (!stops.length) return 'No stops';
    return `${formatDate(stops[0].date)} - ${formatDate(stops[stops.length - 1].date)}`;
  }, [stops]);

  useEffect(() => {
    writeStorage(savedTripsKey, savedTrips);
  }, [savedTrips]);

  useEffect(() => {
    writeStorage(activeTripKey, activeTrip);
  }, [activeTrip]);

  useEffect(() => {
    if (!stops.length) {
      setSelectedStopId(null);
      return;
    }

    if (selectedStopId && !stops.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(stops[0].id);
    }
  }, [selectedStopId, stops]);

  const touchTrip = (updater: (trip: Trip) => Trip) => {
    setActiveTrip((trip) => ({
      ...updater(trip),
      updatedAt: new Date().toISOString(),
    }));
    setSaveMessage('');
  };

  const updateTripField = (field: 'name' | 'notes', value: string) => {
    touchTrip((trip) => ({ ...trip, [field]: value }));
  };

  const updateStop = (stopId: string, updates: Partial<TripStop>) => {
    touchTrip((trip) => ({
      ...trip,
      stops: resequenceStops(
        trip.stops.map((stop) => (stop.id === stopId ? { ...stop, ...updates } : stop)),
      ),
    }));
  };

  const updateStopNumber = (stopId: string, field: 'lat' | 'lng', value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    updateStop(stopId, { [field]: nextValue });
  };

  const addStop = () => {
    const anchorIndex = selectedStop
      ? stops.findIndex((stop) => stop.id === selectedStop.id)
      : stops.length - 1;
    const order = Math.max(anchorIndex + 2, 1);
    const newStop: TripStop = {
      id: makeId('stop'),
      order,
      date: selectedStop?.date || '',
      label: 'New stop',
      lat: selectedStop?.lat || usCenter.lat,
      lng: selectedStop?.lng || usCenter.lng,
      notes: '',
      remoteWork: false,
    };

    touchTrip((trip) => {
      const before = trip.stops.filter((stop) => stop.order < order);
      const after = trip.stops.filter((stop) => stop.order >= order);
      return { ...trip, stops: resequenceStops([...before, newStop, ...after]) };
    });
    setSelectedStopId(newStop.id);
  };

  const duplicateStop = () => {
    if (!selectedStop) return;

    const copy: TripStop = {
      ...selectedStop,
      id: makeId('stop'),
      order: selectedStop.order + 1,
      label: `${selectedStop.label} copy`,
    };

    touchTrip((trip) => {
      const nextStops = trip.stops.map((stop) =>
        stop.order > selectedStop.order ? { ...stop, order: stop.order + 1 } : stop,
      );
      return { ...trip, stops: resequenceStops([...nextStops, copy]) };
    });
    setSelectedStopId(copy.id);
  };

  const deleteStop = () => {
    if (!selectedStop) return;

    const nextSelection =
      stops[selectedStop.order] || stops[selectedStop.order - 2] || stops.find((stop) => stop.id !== selectedStop.id);

    touchTrip((trip) => ({
      ...trip,
      stops: resequenceStops(trip.stops.filter((stop) => stop.id !== selectedStop.id)),
    }));
    setSelectedStopId(nextSelection?.id || null);
  };

  const moveStop = (direction: -1 | 1) => {
    if (!selectedStop) return;

    const index = stops.findIndex((stop) => stop.id === selectedStop.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= stops.length) return;

    const nextStops = [...stops];
    [nextStops[index], nextStops[swapIndex]] = [nextStops[swapIndex], nextStops[index]];
    touchTrip((trip) => ({ ...trip, stops: resequenceStops(nextStops) }));
  };

  const saveTrip = () => {
    const now = new Date().toISOString();
    const tripToSave = normalizeTrip({ ...activeTrip, stops, updatedAt: now }) || activeTrip;

    setActiveTrip(tripToSave);
    setSavedTrips((trips) => [
      tripToSave,
      ...trips.filter((trip) => trip.id !== tripToSave.id),
    ]);
    setSaveMessage(`Saved ${formatDateTime(now)}`);
  };

  const startNewTrip = () => {
    const newTrip = createBlankTrip();
    setActiveTrip(newTrip);
    setSelectedStopId(newTrip.stops[0].id);
    setSaveMessage('');
    setFitSignal((value) => value + 1);
  };

  const loadTrip = (trip: Trip) => {
    const nextTrip = normalizeTrip(trip);
    if (!nextTrip) return;

    setActiveTrip(nextTrip);
    setSelectedStopId(nextTrip.stops[0]?.id || null);
    setSaveMessage(`Loaded ${nextTrip.name}`);
    setFitSignal((value) => value + 1);
  };

  const removeSavedTrip = (tripId: string) => {
    setSavedTrips((trips) => trips.filter((trip) => trip.id !== tripId));
  };

  const handleRemoteChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedStop) return;
    updateStop(selectedStop.id, { remoteWork: event.currentTarget.checked });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Route size={22} />
          </span>
          <span>
            <h1>Road Trip Planner</h1>
            <p>{dateRange}</p>
          </span>
        </div>

        <div className="topbar-actions" aria-label="Trip actions">
          {saveMessage && <span className="save-status">{saveMessage}</span>}
          <button type="button" className="icon-button" onClick={startNewTrip} title="New trip">
            <FilePlus2 size={18} />
          </button>
          <button type="button" className="primary-button" onClick={saveTrip}>
            <Save size={18} />
            <span>Save trip</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel" aria-label="Trip itinerary">
          <section className="trip-editor">
            <label htmlFor="trip-name">Trip name</label>
            <input
              id="trip-name"
              value={activeTrip.name}
              onChange={(event) => updateTripField('name', event.currentTarget.value)}
            />

            <label htmlFor="trip-notes">Notes</label>
            <textarea
              id="trip-notes"
              value={activeTrip.notes}
              onChange={(event) => updateTripField('notes', event.currentTarget.value)}
              rows={3}
            />

            <div className="metric-grid">
              <div>
                <strong>{stops.length}</strong>
                <span>Stops</span>
              </div>
              <div>
                <strong>{routeMiles.toLocaleString()}</strong>
                <span>Miles</span>
              </div>
              <div>
                <strong>{remoteStops}</strong>
                <span>Remote</span>
              </div>
            </div>

            <div className="rail-actions">
              <button type="button" className="secondary-button" onClick={addStop}>
                <Plus size={17} />
                <span>Add stop</span>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFitSignal((value) => value + 1)}
                title="Fit route"
              >
                <LocateFixed size={18} />
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <h2>Itinerary</h2>
              <span>{stops.length}</span>
            </div>
            <ol className="stop-list">
              {stops.map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    className={`stop-card ${stop.id === selectedStopId ? 'selected' : ''}`}
                    onClick={() => setSelectedStopId(stop.id)}
                  >
                    <span className={stop.remoteWork ? 'stop-index remote' : 'stop-index'}>
                      {stop.order}
                    </span>
                    <span className="stop-copy">
                      <strong>{stop.label}</strong>
                      <small>
                        <CalendarDays size={14} />
                        {formatDate(stop.date)}
                      </small>
                    </span>
                    {stop.remoteWork && (
                      <span className="mini-badge" title="Remote-work stop">
                        <Wifi size={14} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel-section saved-section">
            <div className="section-heading">
              <h2>Saved Trips</h2>
              <span>{savedTrips.length}</span>
            </div>
            {savedTrips.length ? (
              <div className="saved-list">
                {savedTrips.map((trip) => (
                  <article key={trip.id} className="saved-card">
                    <button type="button" className="saved-main" onClick={() => loadTrip(trip)}>
                      <FolderOpen size={16} />
                      <span>
                        <strong>{trip.name}</strong>
                        <small>{formatDateTime(trip.updatedAt)}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button ghost"
                      onClick={() => removeSavedTrip(trip.id)}
                      title="Delete saved trip"
                    >
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No saved trips yet.</p>
            )}
          </section>
        </aside>

        <section className="map-panel" aria-label="Route map">
          {apiKey ? (
            <MapCanvas
              apiKey={apiKey}
              stops={stops}
              selectedStopId={selectedStopId}
              fitSignal={fitSignal}
              onSelectStop={setSelectedStopId}
            />
          ) : (
            <div className="map-state">
              <MapPin size={32} />
              <h2>Map key missing</h2>
              <p>
                Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable the route map.
              </p>
            </div>
          )}
        </section>

        <aside className="detail-panel" aria-label="Selected stop details">
          <div className="detail-heading">
            <span className="detail-icon" aria-hidden="true">
              <MapPin size={18} />
            </span>
            <span>
              <h2>Stop Details</h2>
              <p>{selectedStop ? `Stop ${selectedStop.order}` : 'No stop selected'}</p>
            </span>
          </div>

          {selectedStop ? (
            <form className="stop-form">
              <label htmlFor="stop-label">Place</label>
              <input
                id="stop-label"
                value={selectedStop.label}
                onChange={(event) => updateStop(selectedStop.id, { label: event.currentTarget.value })}
              />

              <label htmlFor="stop-date">Date</label>
              <input
                id="stop-date"
                type="date"
                value={selectedStop.date}
                onChange={(event) => updateStop(selectedStop.id, { date: event.currentTarget.value })}
              />

              <label htmlFor="stop-notes">Notes</label>
              <textarea
                id="stop-notes"
                value={selectedStop.notes}
                onChange={(event) => updateStop(selectedStop.id, { notes: event.currentTarget.value })}
                rows={5}
              />

              <div className="coordinate-grid">
                <span>
                  <label htmlFor="stop-lat">Latitude</label>
                  <input
                    id="stop-lat"
                    type="number"
                    step="0.0001"
                    value={selectedStop.lat}
                    onChange={(event) => updateStopNumber(selectedStop.id, 'lat', event.currentTarget.value)}
                  />
                </span>
                <span>
                  <label htmlFor="stop-lng">Longitude</label>
                  <input
                    id="stop-lng"
                    type="number"
                    step="0.0001"
                    value={selectedStop.lng}
                    onChange={(event) => updateStopNumber(selectedStop.id, 'lng', event.currentTarget.value)}
                  />
                </span>
              </div>

              <label className="toggle-row" htmlFor="remote-work">
                <input
                  id="remote-work"
                  type="checkbox"
                  checked={Boolean(selectedStop.remoteWork)}
                  onChange={handleRemoteChange}
                />
                <span>Remote-work stop</span>
              </label>

              <div className="button-grid">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => moveStop(-1)}
                  title="Move stop up"
                  disabled={selectedStop.order === 1}
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => moveStop(1)}
                  title="Move stop down"
                  disabled={selectedStop.order === stops.length}
                >
                  <ChevronDown size={18} />
                </button>
                <button type="button" className="icon-button" onClick={duplicateStop} title="Duplicate stop">
                  <Copy size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={deleteStop}
                  title="Delete stop"
                  disabled={stops.length <= 1}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </form>
          ) : (
            <p className="empty-copy">Select a stop to edit it.</p>
          )}
        </aside>
      </main>
    </div>
  );
}

function MapCanvas({ apiKey, stops, selectedStopId, fitSignal, onSelectStop }: MapCanvasProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const path = useMemo(() => stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })), [stops]);

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
  });

  const fitAllStops = (map: google.maps.Map) => {
    if (!stops.length) return;

    const bounds = new google.maps.LatLngBounds();
    stops.forEach((stop) => bounds.extend({ lat: stop.lat, lng: stop.lng }));
    map.fitBounds(bounds, 72);
  };

  useEffect(() => {
    if (!mapRef.current || !selectedStop) return;

    mapRef.current.panTo({ lat: selectedStop.lat, lng: selectedStop.lng });
  }, [selectedStop]);

  useEffect(() => {
    if (!mapRef.current) return;
    fitAllStops(mapRef.current);
  }, [fitSignal]);

  if (loadError) {
    return (
      <div className="map-state error">
        <MapPin size={32} />
        <h2>Map unavailable</h2>
        <p>Please verify the Google Maps API key, billing, and allowed referrers.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="map-state">
        <Route size={32} />
        <h2>Loading map</h2>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={usCenter}
      zoom={4}
      onLoad={(map) => {
        mapRef.current = map;
        fitAllStops(map);
      }}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        styles: mapStyles,
      }}
    >
      {path.length > 1 && (
        <PolylineF
          path={path}
          options={{
            strokeColor: '#0f766e',
            strokeOpacity: 0.95,
            strokeWeight: 4,
          }}
        />
      )}

      {stops.map((stop) => (
        <MarkerF
          key={stop.id}
          position={{ lat: stop.lat, lng: stop.lng }}
          onClick={() => onSelectStop(stop.id)}
          label={{
            text: String(stop.order),
            color: '#ffffff',
            fontWeight: '700',
          }}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: stop.remoteWork ? '#9f2d55' : '#0f766e',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale: stop.id === selectedStopId ? 13 : 10,
          }}
        />
      ))}

      {selectedStop && (
        <InfoWindowF
          position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
          onCloseClick={() => onSelectStop(null)}
        >
          <div className="info-window">
            <p>{formatDate(selectedStop.date)}</p>
            <h2>{selectedStop.label}</h2>
            <p>{selectedStop.notes || 'No notes yet.'}</p>
            {selectedStop.remoteWork && <span className="remote-badge">Remote-work stop</span>}
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
  );
}

export default App;
