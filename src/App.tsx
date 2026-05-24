import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  GoogleMap,
  InfoWindowF,
  MarkerF,
  PolylineF,
  useLoadScript,
} from '@react-google-maps/api';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  LocateFixed,
  MapPin,
  Plus,
  Route,
  Save,
  Trash2,
  Upload,
  Wifi,
  X,
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

type ExportedTrip = {
  format: 'road-trip-planner.saved-trip.v1';
  exportedAt: string;
  trip: Trip;
};

type SaveBackend = 'checking' | 'database' | 'local';

type RoadRoute = {
  distanceMeters?: number;
  warnings?: string[];
  createPolylines: (options?: {
    polylineOptions?: google.maps.PolylineOptions | ((options: google.maps.PolylineOptions) => google.maps.PolylineOptions);
  }) => google.maps.Polyline[];
};

type RoadRoutesLibrary = google.maps.RoutesLibrary & {
  Route: {
    computeRoutes: (request: {
      origin: google.maps.LatLngLiteral;
      destination: google.maps.LatLngLiteral;
      intermediates?: Array<{
        location: google.maps.LatLngLiteral;
        vehicleStopover?: boolean;
      }>;
      travelMode: 'DRIVING';
      routingPreference: 'TRAFFIC_UNAWARE';
      fields: string[];
    }) => Promise<{ routes?: RoadRoute[] }>;
  };
};

type MapCanvasProps = {
  apiKey: string;
  stops: TripStop[];
  selectedStopId: string | null;
  fitSignal: number;
  onSelectStop: (stopId: string | null) => void;
  onRouteDistanceChange: (miles: number | null) => void;
};

const mapContainerStyle = { width: '100%', height: '100%' };
const usCenter = { lat: 39.8283, lng: -98.5795 };
const savedTripsKey = 'road-trip-planner.savedTrips.v1';
const activeTripKey = 'road-trip-planner.activeTrip.v1';
const defaultTripId = 'default-2026-usa-itinerary';
const tripExportFormat = 'road-trip-planner.saved-trip.v1';
const maxStopsPerDirectionsRequest = 25;
const exportFormatExample = JSON.stringify(
  {
    format: tripExportFormat,
    exportedAt: '2026-05-24T00:00:00.000Z',
    trip: {
      id: 'trip-example',
      name: 'Southwest loop',
      notes: 'Museum stops, desert drives, remote-work days.',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      stops: [
        {
          id: 'stop-example-1',
          order: 1,
          date: '2026-07-21',
          label: 'Jacksonville, FL',
          lat: 30.3322,
          lng: -81.6557,
          notes: 'Start',
          remoteWork: false,
        },
      ],
    },
  },
  null,
  2,
);

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

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in private browsing or locked-down embeds.
  }
}

function sortTripsByUpdatedAt(trips: Trip[]) {
  return [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mergeTripsByFreshness(...tripGroups: Trip[][]) {
  const tripsById = new Map<string, Trip>();

  tripGroups.flat().forEach((trip) => {
    const normalizedTrip = normalizeTrip(trip);
    if (!normalizedTrip) return;

    const existingTrip = tripsById.get(normalizedTrip.id);
    if (!existingTrip || normalizedTrip.updatedAt.localeCompare(existingTrip.updatedAt) > 0) {
      tripsById.set(normalizedTrip.id, normalizedTrip);
    }
  });

  return sortTripsByUpdatedAt([...tripsById.values()]);
}

async function fetchSavedTripsFromDatabase() {
  const response = await fetch('/api/trips', {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`GET_TRIPS_${response.status}`);
  }

  const trips = await response.json();
  if (!Array.isArray(trips)) {
    throw new Error('INVALID_TRIPS_RESPONSE');
  }

  return sortTripsByUpdatedAt(
    trips
      .map((trip) => normalizeTrip(trip))
      .filter((trip): trip is Trip => Boolean(trip)),
  );
}

async function saveTripToDatabase(trip: Trip) {
  const response = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(trip),
  });

  if (!response.ok) {
    throw new Error(`SAVE_TRIP_${response.status}`);
  }

  const savedTrip = normalizeTrip(await response.json());
  if (!savedTrip) {
    throw new Error('INVALID_SAVED_TRIP_RESPONSE');
  }

  return savedTrip;
}

async function deleteTripFromDatabase(tripId: string) {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`DELETE_TRIP_${response.status}`);
  }
}

function createTripExport(trip: Trip): ExportedTrip {
  return {
    format: tripExportFormat,
    exportedAt: new Date().toISOString(),
    trip: normalizeTrip(trip) || trip,
  };
}

function parseTripImport(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null;

  const exportedTrip = candidate as Partial<ExportedTrip>;
  if (exportedTrip.format !== tripExportFormat) return null;
  if (typeof exportedTrip.exportedAt !== 'string') return null;

  return normalizeTrip(exportedTrip.trip);
}

function sanitizeFileName(value: string) {
  const fileName = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return fileName || 'road-trip';
}

function downloadTripExport(trip: Trip) {
  downloadExportedTrip(createTripExport(trip));
}

function downloadExportedTrip(exportedTrip: ExportedTrip) {
  const blob = new Blob([`${JSON.stringify(exportedTrip, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${sanitizeFileName(exportedTrip.trip.name)}.trip.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
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

function splitStopsForDirections(stops: TripStop[]) {
  const chunks: TripStop[][] = [];
  let startIndex = 0;

  while (startIndex < stops.length - 1) {
    const endIndex = Math.min(startIndex + maxStopsPerDirectionsRequest - 1, stops.length - 1);
    chunks.push(stops.slice(startIndex, endIndex + 1));
    startIndex = endIndex;
  }

  return chunks;
}

async function requestRoadRoute(routeLibrary: RoadRoutesLibrary, stops: TripStop[]) {
  const [origin, ...rest] = stops;
  const destination = rest[rest.length - 1];
  const intermediates = rest.slice(0, -1).map((stop) => ({
    location: { lat: stop.lat, lng: stop.lng },
    vehicleStopover: true,
  }));

  const response = await routeLibrary.Route.computeRoutes({
    origin: { lat: origin.lat, lng: origin.lng },
    destination: { lat: destination.lat, lng: destination.lng },
    intermediates,
    travelMode: 'DRIVING',
    routingPreference: 'TRAFFIC_UNAWARE',
    fields: ['path', 'distanceMeters', 'warnings'],
  });

  const route = response.routes?.[0];
  if (!route) {
    throw new Error('NO_ROUTE');
  }

  return route;
}

function calculateRoadRouteMiles(routes: RoadRoute[]) {
  const meters = routes.reduce((total, route) => total + (route.distanceMeters || 0), 0);

  return meters > 0 ? Math.round(meters / 1609.344) : null;
}

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [savedTrips, setSavedTrips] = useState<Trip[]>(readSavedTrips);
  const [activeTrip, setActiveTrip] = useState<Trip>(() => readActiveTrip() || createDefaultTrip());
  const [selectedStopId, setSelectedStopId] = useState<string | null>(
    () => activeTrip.stops[0]?.id || null,
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveBackend, setSaveBackend] = useState<SaveBackend>('checking');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [drivingMiles, setDrivingMiles] = useState<number | null>(null);
  const [previewExport, setPreviewExport] = useState<ExportedTrip | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);

  const stops = useMemo(() => resequenceStops(activeTrip.stops), [activeTrip.stops]);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const routeMiles = useMemo(() => calculateMiles(stops), [stops]);
  const displayMiles = drivingMiles ?? routeMiles;
  const remoteStops = useMemo(() => stops.filter((stop) => stop.remoteWork).length, [stops]);
  const dateRange = useMemo(() => {
    if (!stops.length) return 'No stops';
    return `${formatDate(stops[0].date)} - ${formatDate(stops[stops.length - 1].date)}`;
  }, [stops]);
  const saveBackendLabel =
    saveBackend === 'database' ? 'DB' : saveBackend === 'local' ? 'Local' : 'Sync';
  const previewJson = useMemo(
    () => (previewExport ? `${JSON.stringify(previewExport, null, 2)}\n` : ''),
    [previewExport],
  );

  useEffect(() => {
    let canceled = false;
    const localTrips = readSavedTrips();

    fetchSavedTripsFromDatabase()
      .then(async (databaseTrips) => {
        const mergedTrips = mergeTripsByFreshness(databaseTrips, localTrips);

        if (localTrips.length) {
          await Promise.all(mergedTrips.map((trip) => saveTripToDatabase(trip)));
        }

        if (canceled) return;

        setSavedTrips(mergedTrips);
        setSaveBackend('database');
        removeStorage(savedTripsKey);
        if (localTrips.length) {
          setSaveMessage('Synced saved trips to database');
        }
      })
      .catch(() => {
        if (canceled) return;

        setSaveBackend('local');
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (saveBackend === 'local') {
      writeStorage(savedTripsKey, savedTrips);
    }
  }, [saveBackend, savedTrips]);

  useEffect(() => {
    writeStorage(activeTripKey, activeTrip);
  }, [activeTrip]);

  useEffect(() => {
    if (!previewExport) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewExport(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewExport]);

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

  const getActiveTripForExport = () => normalizeTrip({ ...activeTrip, stops }) || activeTrip;

  const previewTripExport = (trip: Trip) => {
    const normalizedTrip = normalizeTrip(trip) || trip;
    setPreviewExport(createTripExport(normalizedTrip));
    setPreviewCopied(false);
  };

  const previewActiveTrip = () => {
    previewTripExport(getActiveTripForExport());
  };

  const copyPreviewJson = async () => {
    if (!previewJson) return;

    try {
      await copyText(previewJson);
      setPreviewCopied(true);
    } catch {
      setPreviewCopied(false);
    }
  };

  const importTrip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setIsImporting(true);

    try {
      const importedTrip = parseTripImport(JSON.parse(await file.text()));
      if (!importedTrip) {
        setSaveMessage('Import needs a saved-trip JSON export');
        return;
      }

      const nextSavedTrips = [
        importedTrip,
        ...savedTrips.filter((trip) => trip.id !== importedTrip.id),
      ];

      setActiveTrip(importedTrip);
      setSelectedStopId(importedTrip.stops[0]?.id || null);
      setSavedTrips(nextSavedTrips);
      setFitSignal((value) => value + 1);

      try {
        const savedTrip = await saveTripToDatabase(importedTrip);
        setSavedTrips((trips) => [
          savedTrip,
          ...trips.filter((trip) => trip.id !== savedTrip.id),
        ]);
        setSaveBackend('database');
        removeStorage(savedTripsKey);
        setSaveMessage(`Imported to database: ${savedTrip.name}`);
      } catch {
        setSaveBackend('local');
        writeStorage(savedTripsKey, nextSavedTrips);
        setSaveMessage(`Imported locally: ${importedTrip.name}`);
      }
    } catch {
      setSaveMessage('Import failed: invalid JSON');
    } finally {
      setIsImporting(false);
    }
  };

  const saveTrip = async () => {
    const now = new Date().toISOString();
    const tripToSave = normalizeTrip({ ...activeTrip, stops, updatedAt: now }) || activeTrip;
    const nextSavedTrips = [
      tripToSave,
      ...savedTrips.filter((trip) => trip.id !== tripToSave.id),
    ];

    setActiveTrip(tripToSave);
    setSavedTrips(nextSavedTrips);
    setIsSaving(true);

    try {
      const savedTrip = await saveTripToDatabase(tripToSave);
      setSavedTrips((trips) => mergeTripsByFreshness([savedTrip], trips));
      setSaveBackend('database');
      removeStorage(savedTripsKey);
      setSaveMessage(`Saved to database ${formatDateTime(now)}`);
    } catch {
      setSaveBackend('local');
      writeStorage(savedTripsKey, nextSavedTrips);
      setSaveMessage(`Saved locally ${formatDateTime(now)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const exportActiveTrip = () => {
    const tripToExport = getActiveTripForExport();
    downloadTripExport(tripToExport);
    setSaveMessage('Exported JSON');
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

  const removeSavedTrip = async (tripId: string) => {
    const nextSavedTrips = savedTrips.filter((trip) => trip.id !== tripId);
    setSavedTrips(nextSavedTrips);

    if (saveBackend !== 'database') {
      writeStorage(savedTripsKey, nextSavedTrips);
      return;
    }

    try {
      await deleteTripFromDatabase(tripId);
      removeStorage(savedTripsKey);
      setSaveMessage('Deleted from database');
    } catch {
      setSavedTrips(savedTrips);
      setSaveMessage('Delete failed');
    }
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
          <input
            ref={importInputRef}
            className="file-input"
            type="file"
            accept="application/json,.json"
            onChange={importTrip}
            aria-label="Import trip JSON"
          />
          <button type="button" className="icon-button" onClick={startNewTrip} title="New trip">
            <FilePlus2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => importInputRef.current?.click()}
            title="Import trip JSON"
            aria-label="Import trip JSON"
            disabled={isImporting}
          >
            <Upload size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={previewActiveTrip}
            title="Preview active trip JSON"
            aria-label="Preview active trip JSON"
          >
            <Eye size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={exportActiveTrip}
            title="Export active trip"
            aria-label="Export active trip"
          >
            <Download size={18} />
          </button>
          <button type="button" className="primary-button" onClick={saveTrip} disabled={isSaving}>
            <Save size={18} />
            <span>{isSaving ? 'Saving' : 'Save trip'}</span>
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
                <strong>{displayMiles.toLocaleString()}</strong>
                <span>{drivingMiles === null ? 'Est. miles' : 'Drive mi'}</span>
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
              <span>{`${saveBackendLabel} ${savedTrips.length}`}</span>
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
                    <span className="saved-actions">
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => previewTripExport(trip)}
                        title="Preview saved trip JSON"
                        aria-label={`Preview ${trip.name} JSON`}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => downloadTripExport(trip)}
                        title="Export saved trip"
                        aria-label={`Export ${trip.name}`}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => removeSavedTrip(trip.id)}
                        title="Delete saved trip"
                        aria-label={`Delete ${trip.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No saved trips yet.</p>
            )}
          </section>

          <section className="panel-section format-section">
            <div className="section-heading">
              <h2>Export Format</h2>
              <span>JSON</span>
            </div>
            <p className="format-copy">Saved trips export and import as versioned JSON files.</p>
            <pre className="format-example" aria-label="Saved trip export JSON example">
              <code>{exportFormatExample}</code>
            </pre>
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
              onRouteDistanceChange={setDrivingMiles}
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

      {previewExport && (
        <div className="json-modal-backdrop" role="presentation" onClick={() => setPreviewExport(null)}>
          <section
            className="json-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="json-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="json-modal-header">
              <span>
                <h2 id="json-preview-title">JSON Preview</h2>
                <p>{previewExport.trip.name}</p>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPreviewExport(null)}
                title="Close preview"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </header>
            <pre className="json-preview" aria-label={`${previewExport.trip.name} JSON export`}>
              <code>{previewJson}</code>
            </pre>
            <footer className="json-modal-actions">
              <button type="button" className="secondary-button" onClick={copyPreviewJson}>
                <Copy size={17} />
                <span>{previewCopied ? 'Copied' : 'Copy JSON'}</span>
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => downloadExportedTrip(previewExport)}
              >
                <Download size={17} />
                <span>Download</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function MapCanvas({
  apiKey,
  stops,
  selectedStopId,
  fitSignal,
  onSelectStop,
  onRouteDistanceChange,
}: MapCanvasProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const routePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [routeError, setRouteError] = useState('');
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const path = useMemo(() => stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })), [stops]);
  const directionsKey = useMemo(
    () => stops.map((stop) => `${stop.id}:${stop.order}:${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join('|'),
    [stops],
  );

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

  useEffect(() => {
    const clearRoutePolylines = () => {
      routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      routePolylinesRef.current = [];
    };

    if (!isLoaded || !mapInstance || stops.length < 2) {
      clearRoutePolylines();
      setRouteStatus('idle');
      setRouteError('');
      setRouteWarnings([]);
      onRouteDistanceChange(null);
      return undefined;
    }

    let canceled = false;
    clearRoutePolylines();
    setRouteStatus('loading');
    setRouteError('');
    setRouteWarnings([]);
    onRouteDistanceChange(null);

    const timeoutId = window.setTimeout(() => {
      const chunks = splitStopsForDirections(stops);

      google.maps
        .importLibrary('routes')
        .then((library) => {
          const routeLibrary = library as RoadRoutesLibrary;
          if (!('Route' in routeLibrary)) {
            throw new Error('ROUTES_LIBRARY_UNAVAILABLE');
          }

          return Promise.all(chunks.map((chunk) => requestRoadRoute(routeLibrary, chunk)));
        })
        .then((routes) => {
          if (canceled) return;

          const polylines = routes.flatMap((route) =>
            route.createPolylines({
              polylineOptions: {
                strokeColor: '#0f766e',
                strokeOpacity: 0.95,
                strokeWeight: 5,
              },
            }),
          );
          polylines.forEach((polyline) => polyline.setMap(mapInstance));
          routePolylinesRef.current = polylines;
          setRouteStatus('ready');
          setRouteError('');
          setRouteWarnings(routes.flatMap((route) => route.warnings || []));
          onRouteDistanceChange(calculateRoadRouteMiles(routes));
        })
        .catch((error: Error) => {
          if (canceled) return;

          clearRoutePolylines();
          setRouteStatus('fallback');
          setRouteError(error.message);
          setRouteWarnings([]);
          onRouteDistanceChange(null);
        });
    }, 300);

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
      clearRoutePolylines();
    };
  }, [directionsKey, isLoaded, mapInstance, onRouteDistanceChange, stops]);

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
    <>
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={usCenter}
      zoom={4}
      onLoad={(map) => {
        mapRef.current = map;
        setMapInstance(map);
        fitAllStops(map);
      }}
      onUnmount={() => {
        routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
        routePolylinesRef.current = [];
        mapRef.current = null;
        setMapInstance(null);
      }}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        styles: mapStyles,
      }}
    >
      {routeStatus === 'fallback' && path.length > 1 && (
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
    {routeStatus === 'loading' && <div className="route-status">Calculating driving route...</div>}
    {routeStatus === 'fallback' && (
      <div className="route-status warning">
        Driving route unavailable{routeError ? ` (${routeError})` : ''}; showing estimated path.
      </div>
    )}
    {routeStatus === 'ready' && routeWarnings.length > 0 && (
      <div className="route-status warning">{routeWarnings.join(' ')}</div>
    )}
    </>
  );
}

export default App;
