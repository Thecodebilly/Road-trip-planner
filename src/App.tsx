import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  GoogleMap,
  InfoWindowF,
  OVERLAY_MOUSE_TARGET,
  OverlayViewF,
  PolylineF,
  type Libraries,
  useLoadScript,
} from '@react-google-maps/api';
import {
  BedDouble,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Import,
  LocateFixed,
  MapPin,
  Maximize2,
  Paperclip,
  Plus,
  Route,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import tripStops from './tripStops.json';

type SleepingArrangement = 'camping' | 'hotel' | 'friend';
type HotelRegion = 'Northeast' | 'South' | 'Midwest' | 'West';
type TripDocumentKind = 'text' | 'file';

type ImportedTripStop = {
  order: number;
  date: string;
  label: string;
  lat: number;
  lng: number;
  notes: string;
  remoteWork?: boolean;
  sleepingArrangement?: SleepingArrangement;
  friendName?: string;
};

type TripStop = Omit<ImportedTripStop, 'sleepingArrangement' | 'friendName'> & {
  id: string;
  sleepingArrangement: SleepingArrangement;
  friendName: string;
};

type DriveEstimate = {
  fromStopId: string;
  toStopId: string;
  distanceMiles: number;
  durationMinutes: number;
  source: 'road' | 'estimated';
};

type MapStopGroup = {
  id: string;
  position: google.maps.LatLngLiteral;
  stops: TripStop[];
  stopRangeLabel: string;
  dateRangeLabel: string;
  sleepingArrangement: SleepingArrangement | 'mixed';
  hasWeekend: boolean;
  hasRemoteWork: boolean;
};

type HotelSearchPoint = {
  id: string;
  label: string;
  position: google.maps.LatLngLiteral;
};

type HotelCandidate = {
  id: string;
  name: string;
  position: google.maps.LatLngLiteral;
  rating: number | null;
  userRatingsTotal: number | null;
  priceLevel: google.maps.places.PriceLevel | null;
  vicinity: string;
  searchLabel: string;
  distanceFromSearchMiles: number;
  score: number;
};

type CachedRouteLeg = Pick<DriveEstimate, 'distanceMiles' | 'durationMinutes' | 'source'>;

type CachedRoute = {
  version: 1;
  routePaths: google.maps.LatLngLiteral[][];
  distanceMiles: number | null;
  routeLegs: CachedRouteLeg[];
  hotelSearchPoints: HotelSearchPoint[];
};

type CacheRecord<T> = {
  key: string;
  savedAt: number;
  value: T;
};

type TripDocument = {
  id: string;
  title: string;
  kind: TripDocumentKind;
  linkedStopId: string;
  text: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
  createdAt: string;
  updatedAt: string;
};

type Trip = {
  id: string;
  name: string;
  notes: string;
  stops: TripStop[];
  documents: TripDocument[];
  createdAt: string;
  updatedAt: string;
};

type ExportedTrip = {
  format: 'road-trip-planner.saved-trip.v1';
  exportedAt: string;
  trip: Trip;
};

type SaveBackend = 'checking' | 'database' | 'local';
type AppView = 'editor' | 'saved';

type RouteAssistantResult = {
  summary: string;
  trip: Trip;
};

type RoadRoute = {
  distanceMeters?: number;
  durationMillis?: number;
  legs?: Array<{
    distanceMeters?: number;
    durationMillis?: number;
  }>;
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
  isPlacingPin: boolean;
  showHotelFinder: boolean;
  onSelectStop: (stopId: string | null) => void;
  onPlacePin: (position: google.maps.LatLngLiteral) => void;
  onRouteDistanceChange: (miles: number | null) => void;
  onDriveEstimatesChange: (estimates: DriveEstimate[] | null) => void;
};

const mapContainerStyle = { width: '100%', height: '100%' };
const centerOverlay = (width: number, height: number) => ({ x: -(width / 2), y: -(height / 2) });
const googleMapsLibraries: Libraries = ['places'];
const usCenter = { lat: 39.8283, lng: -98.5795 };
const savedTripsKey = 'road-trip-planner.savedTrips.v1';
const activeTripKey = 'road-trip-planner.activeTrip.v1';
const gasPriceKey = 'road-trip-planner.gasPrice.v1';
const fuelMpgKey = 'road-trip-planner.fuelMpg.v1';
const routeCacheKey = 'road-trip-planner.routeCache.v1';
const hotelCacheKey = 'road-trip-planner.hotelCache.v1';
const defaultTripId = 'default-2026-usa-itinerary';
const tripExportFormat = 'road-trip-planner.saved-trip.v1';
const maxStopsPerDirectionsRequest = 25;
const maxHotelSearchPoints = 8;
const maxHotelCandidates = 12;
const hotelSearchRadiusMeters = 16093;
const routeCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const hotelCacheTtlMs = 24 * 60 * 60 * 1000;
const maxRouteCacheEntries = 12;
const maxHotelCacheEntries = 80;
const maxDocumentFileBytes = 1024 * 1024;
const defaultGasPrice = 3.5;
const defaultFuelMpg = 25;
const estimatedAverageMph = 55;
const sleepingArrangementOptions: SleepingArrangement[] = ['camping', 'hotel', 'friend'];
// Broad nightly assumptions for planning totals; live hotel search still shows actual nearby options.
const hotelRegionAverageNightlyRates: Record<HotelRegion, number> = {
  Northeast: 175,
  South: 135,
  Midwest: 125,
  West: 185,
};
const stateHotelRegions: Record<string, HotelRegion> = {
  AL: 'South',
  AK: 'West',
  AZ: 'West',
  AR: 'South',
  CA: 'West',
  CO: 'West',
  CT: 'Northeast',
  DE: 'South',
  DC: 'South',
  FL: 'South',
  GA: 'South',
  HI: 'West',
  ID: 'West',
  IL: 'Midwest',
  IN: 'Midwest',
  IA: 'Midwest',
  KS: 'Midwest',
  KY: 'South',
  LA: 'South',
  ME: 'Northeast',
  MD: 'South',
  MA: 'Northeast',
  MI: 'Midwest',
  MN: 'Midwest',
  MS: 'South',
  MO: 'Midwest',
  MT: 'West',
  NE: 'Midwest',
  NV: 'West',
  NH: 'Northeast',
  NJ: 'Northeast',
  NM: 'West',
  NY: 'Northeast',
  NC: 'South',
  ND: 'Midwest',
  OH: 'Midwest',
  OK: 'South',
  OR: 'West',
  PA: 'Northeast',
  RI: 'Northeast',
  SC: 'South',
  SD: 'Midwest',
  TN: 'South',
  TX: 'South',
  UT: 'West',
  VT: 'Northeast',
  VA: 'South',
  WA: 'West',
  WV: 'South',
  WI: 'Midwest',
  WY: 'West',
};
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
      documents: [
        {
          id: 'document-example-1',
          title: 'Museum notes',
          kind: 'text',
          linkedStopId: 'stop-example-1',
          text: 'Hours, ticket links, and backup plans.',
          fileName: '',
          mimeType: 'text/plain',
          fileSize: 0,
          dataUrl: '',
          createdAt: '2026-05-24T00:00:00.000Z',
          updatedAt: '2026-05-24T00:00:00.000Z',
        },
      ],
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
          sleepingArrangement: 'camping',
          friendName: '',
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
    sleepingArrangement: normalizeSleepingArrangement(stop.sleepingArrangement),
    friendName: typeof stop.friendName === 'string' ? stop.friendName : '',
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

function normalizeSleepingArrangement(value: unknown): SleepingArrangement {
  return sleepingArrangementOptions.includes(value as SleepingArrangement)
    ? (value as SleepingArrangement)
    : 'camping';
}

function normalizeDocumentKind(value: unknown): TripDocumentKind {
  return value === 'file' ? 'file' : 'text';
}

function normalizeTripDocument(
  candidate: Partial<TripDocument> | null | undefined,
  stopIds: Set<string>,
): TripDocument | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const now = new Date().toISOString();
  const kind = normalizeDocumentKind(candidate.kind);
  const linkedStopId =
    typeof candidate.linkedStopId === 'string' && stopIds.has(candidate.linkedStopId)
      ? candidate.linkedStopId
      : '';
  const fileName = typeof candidate.fileName === 'string' ? candidate.fileName : '';
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const dataUrl = typeof candidate.dataUrl === 'string' ? candidate.dataUrl : '';

  if (kind === 'file' && !dataUrl) return null;

  return {
    id: typeof candidate.id === 'string' ? candidate.id : makeId('document'),
    title:
      (typeof candidate.title === 'string' && candidate.title.trim()) ||
      fileName ||
      (kind === 'file' ? 'Untitled file' : 'Untitled note'),
    kind,
    linkedStopId,
    text: kind === 'text' ? text : '',
    fileName: kind === 'file' ? fileName : '',
    mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : 'text/plain',
    fileSize: Number.isFinite(candidate.fileSize) ? Number(candidate.fileSize) : 0,
    dataUrl: kind === 'file' ? dataUrl : '',
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  };
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
      sleepingArrangement: normalizeSleepingArrangement(stop.sleepingArrangement),
      friendName: typeof stop.friendName === 'string' ? stop.friendName : '',
    }));
  const stopIds = new Set(stops.map((stop) => stop.id));
  const documents = Array.isArray(candidate.documents)
    ? candidate.documents
        .map((document) => normalizeTripDocument(document, stopIds))
        .filter((document): document is TripDocument => Boolean(document))
    : [];

  return {
    id: typeof candidate.id === 'string' ? candidate.id : makeId('trip'),
    name: candidate.name?.trim() || 'Untitled trip',
    notes: typeof candidate.notes === 'string' ? candidate.notes : '',
    stops: resequenceStops(stops),
    documents,
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
    documents: [],
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
        sleepingArrangement: 'camping',
        friendName: '',
      },
    ],
    documents: [],
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

function readNumberStorage(key: string, fallback: number, minimum = 0) {
  try {
    const saved = window.localStorage.getItem(key);
    const parsed = saved ? Number(JSON.parse(saved)) : fallback;

    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in private browsing or locked-down embeds.
  }
}

function readCacheRecords<T>(key: string): CacheRecord<T>[] {
  try {
    const saved = window.localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (record): record is CacheRecord<T> =>
        record &&
        typeof record === 'object' &&
        typeof record.key === 'string' &&
        typeof record.savedAt === 'number' &&
        'value' in record,
    );
  } catch {
    return [];
  }
}

function getCachedValue<T>(storageKey: string, key: string, ttlMs: number) {
  const now = Date.now();
  const records = readCacheRecords<T>(storageKey).filter((record) => now - record.savedAt <= ttlMs);
  const match = records.find((record) => record.key === key);

  return match?.value || null;
}

function setCachedValue<T>(storageKey: string, key: string, value: T, maxEntries: number) {
  const nextRecords = [
    { key, value, savedAt: Date.now() },
    ...readCacheRecords<T>(storageKey).filter((record) => record.key !== key),
  ].slice(0, maxEntries);

  writeStorage(storageKey, nextRecords);
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

async function requestRouteAssistant(trip: Trip, instruction: string): Promise<RouteAssistantResult> {
  const response = await fetch('/api/route-assistant', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ trip, instruction }),
  });

  if (!response.ok) {
    throw new Error(`ROUTE_ASSISTANT_${response.status}`);
  }

  const result = await response.json();
  const proposedTrip = normalizeTrip(result.trip);
  if (!proposedTrip || typeof result.summary !== 'string') {
    throw new Error('INVALID_ROUTE_ASSISTANT_RESPONSE');
  }

  return {
    summary: result.summary,
    trip: proposedTrip,
  };
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

  if (Array.isArray(candidate)) {
    const now = new Date().toISOString();
    return normalizeTrip({
      id: makeId('trip'),
      name: 'Imported itinerary',
      notes: 'Imported from a raw stop list.',
      stops: candidate,
      createdAt: now,
      updatedAt: now,
    });
  }

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

function createTextDocument(linkedStopId = ''): TripDocument {
  const now = new Date().toISOString();

  return {
    id: makeId('document'),
    title: 'Untitled note',
    kind: 'text',
    linkedStopId,
    text: '',
    fileName: '',
    mimeType: 'text/plain',
    fileSize: 0,
    dataUrl: '',
    createdAt: now,
    updatedAt: now,
  };
}

function createFileDocument(file: File, dataUrl: string, linkedStopId = ''): TripDocument {
  const now = new Date().toISOString();

  return {
    id: makeId('document'),
    title: file.name,
    kind: 'file',
    linkedStopId,
    text: '',
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    fileSize: file.size,
    dataUrl,
    createdAt: now,
    updatedAt: now,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('INVALID_FILE_RESULT'));
    };
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocumentLocation(document: TripDocument, stops: TripStop[]) {
  if (!document.linkedStopId) return 'Whole trip';

  const stop = stops.find((candidate) => candidate.id === document.linkedStopId);
  return stop ? `Stop ${stop.order}: ${stop.label}` : 'Whole trip';
}

function downloadTripDocument(document: TripDocument) {
  const url =
    document.kind === 'file'
      ? document.dataUrl
      : URL.createObjectURL(new Blob([document.text], { type: 'text/plain;charset=utf-8' }));
  const link = window.document.createElement('a');

  link.href = url;
  link.download =
    document.kind === 'file' ? document.fileName || document.title : `${sanitizeFileName(document.title)}.txt`;
  window.document.body.appendChild(link);
  link.click();
  link.remove();

  if (document.kind !== 'file') URL.revokeObjectURL(url);
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

function formatScheduleDate(date: string) {
  if (!date) return 'Unscheduled';

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatMapDateRange(stops: TripStop[]) {
  const uniqueDates = Array.from(
    new Set(
      stops
        .map((stop) => stop.date)
        .filter((date) => {
          const parsed = new Date(`${date}T00:00:00`);
          return date && !Number.isNaN(parsed.getTime());
        }),
    ),
  ).sort();

  if (!uniqueDates.length) return stops.length > 1 ? `${stops.length} stops` : 'Unscheduled';

  const first = new Date(`${uniqueDates[0]}T00:00:00`);
  const last = new Date(`${uniqueDates[uniqueDates.length - 1]}T00:00:00`);

  if (uniqueDates.length === 1) return formatDate(uniqueDates[0]);

  const firstMonth = new Intl.DateTimeFormat('en', { month: 'short' }).format(first);
  const lastMonth = new Intl.DateTimeFormat('en', { month: 'short' }).format(last);
  const firstDay = first.getDate();
  const lastDay = last.getDate();

  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `${firstMonth} ${firstDay}-${lastDay}`;
  }

  return `${firstMonth} ${firstDay}-${lastMonth} ${lastDay}`;
}

function formatMapStopRange(stops: TripStop[]) {
  const orders = stops.map((stop) => stop.order).sort((first, second) => first - second);
  if (!orders.length) return '';

  const first = orders[0];
  const last = orders[orders.length - 1];

  return first === last ? String(first) : `${first}-${last}`;
}

function formatMapGroupHeading(stops: TripStop[]) {
  const labels = Array.from(new Set(stops.map((stop) => stop.label)));
  if (labels.length === 1) return labels[0];

  return `${labels[0]} + ${labels.length - 1} more`;
}

function formatStopDateRange(stops: TripStop[]) {
  if (!stops.length) return 'No stops';

  return `${formatDate(stops[0].date)} - ${formatDate(stops[stops.length - 1].date)}`;
}

function isWeekendDate(date: string) {
  if (!date) return false;

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;

  const day = parsed.getDay();
  return day === 0 || day === 6;
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

function calculatePointMiles(previous: google.maps.LatLngLiteral, next: google.maps.LatLngLiteral) {
  const earthRadiusMiles = 3958.8;
  const dLat = ((next.lat - previous.lat) * Math.PI) / 180;
  const dLng = ((next.lng - previous.lng) * Math.PI) / 180;
  const lat1 = (previous.lat * Math.PI) / 180;
  const lat2 = (next.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMiles * c;
}

function calculateSegmentMiles(previous: TripStop, next: TripStop) {
  return calculatePointMiles(previous, next);
}

function findClosestStopIndex(position: google.maps.LatLngLiteral, stops: TripStop[]) {
  if (!stops.length) return -1;

  return stops.reduce((closestIndex, stop, index) => {
    const closestStop = stops[closestIndex];
    const closestMiles = calculatePointMiles(position, closestStop);
    const stopMiles = calculatePointMiles(position, stop);

    return stopMiles < closestMiles ? index : closestIndex;
  }, 0);
}

function calculateInsertionAddedMiles(
  stops: TripStop[],
  position: google.maps.LatLngLiteral,
  insertionIndex: number,
) {
  const previousStop = stops[insertionIndex - 1];
  const nextStop = stops[insertionIndex];

  if (previousStop && nextStop) {
    return (
      calculatePointMiles(previousStop, position) +
      calculatePointMiles(position, nextStop) -
      calculatePointMiles(previousStop, nextStop)
    );
  }

  if (previousStop) return calculatePointMiles(previousStop, position);
  if (nextStop) return calculatePointMiles(position, nextStop);
  return 0;
}

function findDroppedPinInsertion(position: google.maps.LatLngLiteral, stops: TripStop[]) {
  if (!stops.length) {
    return {
      closestStop: null,
      closestIndex: -1,
      insertionIndex: 0,
    };
  }

  if (stops.length === 1) {
    return {
      closestStop: stops[0],
      closestIndex: 0,
      insertionIndex: 1,
    };
  }

  const closestIndex = findClosestStopIndex(position, stops);
  const candidateIndexes = [
    closestIndex > 0 ? closestIndex : null,
    closestIndex < stops.length - 1 ? closestIndex + 1 : null,
  ].filter((index): index is number => index !== null);

  const insertionIndex = candidateIndexes.reduce((bestIndex, candidateIndex) => {
    const bestAddedMiles = calculateInsertionAddedMiles(stops, position, bestIndex);
    const candidateAddedMiles = calculateInsertionAddedMiles(stops, position, candidateIndex);

    return candidateAddedMiles < bestAddedMiles ? candidateIndex : bestIndex;
  }, candidateIndexes[0]);

  return {
    closestStop: stops[closestIndex],
    closestIndex,
    insertionIndex,
  };
}

function metersToMiles(meters: number) {
  return meters / 1609.344;
}

function estimateDriveMinutes(miles: number) {
  return Math.max(1, Math.round((miles / estimatedAverageMph) * 60));
}

function millisToMinutes(milliseconds: number | undefined, fallbackMiles: number) {
  if (!milliseconds || !Number.isFinite(milliseconds)) return estimateDriveMinutes(fallbackMiles);

  return Math.max(1, Math.round(milliseconds / 60000));
}

function buildEstimatedDriveEstimates(stops: TripStop[]): DriveEstimate[] {
  const estimates: DriveEstimate[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    const distanceMiles = calculateSegmentMiles(previous, next);

    estimates.push({
      fromStopId: previous.id,
      toStopId: next.id,
      distanceMiles,
      durationMinutes: estimateDriveMinutes(distanceMiles),
      source: 'estimated',
    });
  }

  return estimates;
}

function buildRoadDriveEstimates(routes: RoadRoute[], stops: TripStop[]) {
  const chunks = splitStopsForDirections(stops);
  const estimates: DriveEstimate[] = [];

  chunks.forEach((chunk, chunkIndex) => {
    const route = routes[chunkIndex];

    for (let legIndex = 1; legIndex < chunk.length; legIndex += 1) {
      const previous = chunk[legIndex - 1];
      const next = chunk[legIndex];
      const fallbackMiles = calculateSegmentMiles(previous, next);
      const leg = route?.legs?.[legIndex - 1];
      const distanceMiles = leg?.distanceMeters ? metersToMiles(leg.distanceMeters) : fallbackMiles;

      estimates.push({
        fromStopId: previous.id,
        toStopId: next.id,
        distanceMiles,
        durationMinutes: millisToMinutes(leg?.durationMillis, distanceMiles),
        source: leg?.distanceMeters ? 'road' : 'estimated',
      });
    }
  });

  return estimates;
}

function cacheRouteLegs(estimates: DriveEstimate[]): CachedRouteLeg[] {
  return estimates.map(({ distanceMiles, durationMinutes, source }) => ({
    distanceMiles,
    durationMinutes,
    source,
  }));
}

function buildCachedDriveEstimates(routeLegs: CachedRouteLeg[], stops: TripStop[]) {
  return routeLegs.slice(0, Math.max(0, stops.length - 1)).map((leg, index) => ({
    fromStopId: stops[index].id,
    toStopId: stops[index + 1].id,
    distanceMiles: leg.distanceMiles,
    durationMinutes: leg.durationMinutes,
    source: leg.source,
  }));
}

function isPosition(value: unknown): value is google.maps.LatLngLiteral {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Number.isFinite((value as google.maps.LatLngLiteral).lat) &&
    Number.isFinite((value as google.maps.LatLngLiteral).lng)
  );
}

function readCachedRoute(key: string, stops: TripStop[]) {
  const cachedRoute = getCachedValue<CachedRoute>(routeCacheKey, key, routeCacheTtlMs);
  if (!cachedRoute || cachedRoute.version !== 1) return null;
  if (!Array.isArray(cachedRoute.routePaths) || !Array.isArray(cachedRoute.routeLegs)) return null;
  if (cachedRoute.routeLegs.length !== Math.max(0, stops.length - 1)) return null;

  const routePaths = cachedRoute.routePaths
    .map((routePath) => (Array.isArray(routePath) ? routePath.filter(isPosition).map((position) => roundPosition(position)) : []))
    .filter((routePath) => routePath.length > 1);

  if (!routePaths.length) return null;

  return {
    routePaths,
    distanceMiles: Number.isFinite(cachedRoute.distanceMiles) ? cachedRoute.distanceMiles : null,
    driveEstimates: buildCachedDriveEstimates(cachedRoute.routeLegs, stops),
    hotelSearchPoints: Array.isArray(cachedRoute.hotelSearchPoints)
      ? cachedRoute.hotelSearchPoints.filter((point) => point && typeof point.id === 'string' && isPosition(point.position))
      : buildRouteHotelSearchPoints(routePaths, stops),
  };
}

function writeCachedRoute(
  key: string,
  routePaths: google.maps.LatLngLiteral[][],
  distanceMiles: number | null,
  driveEstimates: DriveEstimate[],
  hotelSearchPoints: HotelSearchPoint[],
) {
  setCachedValue<CachedRoute>(
    routeCacheKey,
    key,
    {
      version: 1,
      routePaths,
      distanceMiles,
      routeLegs: cacheRouteLegs(driveEstimates),
      hotelSearchPoints,
    },
    maxRouteCacheEntries,
  );
}

function sumDriveMiles(estimates: DriveEstimate[]) {
  return Math.round(estimates.reduce((total, estimate) => total + estimate.distanceMiles, 0));
}

function sumDriveMinutes(estimates: DriveEstimate[]) {
  return estimates.reduce((total, estimate) => total + estimate.durationMinutes, 0);
}

function calculateGasCost(miles: number, gasPrice: number, fuelMpg: number) {
  if (fuelMpg <= 0) return 0;

  return (miles / fuelMpg) * gasPrice;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatGasCost(miles: number, gasPrice: number, fuelMpg: number) {
  return formatCurrency(calculateGasCost(miles, gasPrice, fuelMpg));
}

function extractStateAbbreviation(label: string) {
  const matches = [...label.toUpperCase().matchAll(/\b([A-Z]{2})\b/g)]
    .map((match) => match[1])
    .filter((state) => state in stateHotelRegions);

  return matches.length ? matches[matches.length - 1] : null;
}

function getHotelRegion(stop: Pick<TripStop, 'label' | 'lat' | 'lng'>): HotelRegion {
  const state = extractStateAbbreviation(stop.label);
  if (state) return stateHotelRegions[state];

  if (stop.lng <= -104) return 'West';
  if (stop.lng >= -80 && stop.lat >= 37) return 'Northeast';
  if (stop.lat >= 36 && stop.lng > -104 && stop.lng < -80) return 'Midwest';
  return 'South';
}

function getHotelAverageNightlyRate(stop: TripStop) {
  return hotelRegionAverageNightlyRates[getHotelRegion(stop)];
}

function parseStopDate(date: string) {
  if (!date) return null;

  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStopNightCount(stops: TripStop[], stopIndex: number) {
  const stopDate = parseStopDate(stops[stopIndex]?.date || '');
  const nextDate = parseStopDate(stops[stopIndex + 1]?.date || '');

  if (!stopDate || !nextDate) return 1;

  const days = Math.round((nextDate.getTime() - stopDate.getTime()) / 86400000);
  return Math.max(1, days);
}

function calculateStopLodgingCost(stops: TripStop[], stopIndex: number) {
  const stop = stops[stopIndex];
  if (!stop || stop.sleepingArrangement !== 'hotel') return 0;

  return getHotelAverageNightlyRate(stop) * getStopNightCount(stops, stopIndex);
}

function calculateLodgingCost(stops: TripStop[]) {
  return stops.reduce((total, _stop, index) => total + calculateStopLodgingCost(stops, index), 0);
}

function formatSleepingArrangementSummary(stop: TripStop, stopIndex: number, stops: TripStop[]) {
  if (stop.sleepingArrangement === 'hotel') {
    const region = getHotelRegion(stop);
    const nights = getStopNightCount(stops, stopIndex);
    const nightlyRate = getHotelAverageNightlyRate(stop);
    return `Hotel ${formatCurrency(nightlyRate)} avg/night in ${region} (${nights} ${
      nights === 1 ? 'night' : 'nights'
    })`;
  }

  if (stop.sleepingArrangement === 'friend') {
    return stop.friendName.trim() ? `Staying with ${stop.friendName.trim()}` : 'Staying with friend';
  }

  return 'Camping';
}

function formatDriveDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDriveSummary(estimate: DriveEstimate, gasPrice: number, fuelMpg: number) {
  const prefix = estimate.source === 'road' ? '' : 'Est. ';
  return `${prefix}${Math.round(estimate.distanceMiles).toLocaleString()} mi | ${formatDriveDuration(
    estimate.durationMinutes,
  )} | ${formatGasCost(estimate.distanceMiles, gasPrice, fuelMpg)} gas`;
}

function formatSleepingArrangementLabel(value: SleepingArrangement | 'mixed') {
  switch (value) {
    case 'hotel':
      return 'Hotel';
    case 'friend':
      return 'Friend';
    case 'mixed':
      return 'Mixed';
    default:
      return 'Camping';
  }
}

function getSleepClass(value: SleepingArrangement | 'mixed') {
  return `sleep-${value}`;
}

function groupMapStops(stops: TripStop[]): MapStopGroup[] {
  const groups = new Map<string, TripStop[]>();

  stops.forEach((stop) => {
    const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
    groups.set(key, [...(groups.get(key) || []), stop]);
  });

  return Array.from(groups.entries()).map(([key, groupedStops]) => {
    const sortedStops = [...groupedStops].sort((first, second) => first.order - second.order);
    const firstStop = sortedStops[0];
    const sleepingArrangements = Array.from(new Set(sortedStops.map((stop) => stop.sleepingArrangement)));

    return {
      id: `${key}:${sortedStops.map((stop) => stop.id).join('-')}`,
      position: { lat: firstStop.lat, lng: firstStop.lng },
      stops: sortedStops,
      stopRangeLabel: formatMapStopRange(sortedStops),
      dateRangeLabel: formatMapDateRange(sortedStops),
      sleepingArrangement: sleepingArrangements.length === 1 ? sleepingArrangements[0] : 'mixed',
      hasWeekend: sortedStops.some((stop) => isWeekendDate(stop.date)),
      hasRemoteWork: sortedStops.some((stop) => stop.remoteWork),
    };
  });
}

function hotelPriceRank(priceLevel: google.maps.places.PriceLevel | null) {
  switch (priceLevel) {
    case google.maps.places.PriceLevel.FREE:
      return 0;
    case google.maps.places.PriceLevel.INEXPENSIVE:
      return 1;
    case google.maps.places.PriceLevel.MODERATE:
      return 2;
    case google.maps.places.PriceLevel.EXPENSIVE:
      return 3;
    case google.maps.places.PriceLevel.VERY_EXPENSIVE:
      return 4;
    default:
      return 2;
  }
}

function formatHotelPrice(priceLevel: google.maps.places.PriceLevel | null) {
  switch (priceLevel) {
    case google.maps.places.PriceLevel.FREE:
      return 'Free';
    case google.maps.places.PriceLevel.INEXPENSIVE:
      return '$';
    case google.maps.places.PriceLevel.MODERATE:
      return '$$';
    case google.maps.places.PriceLevel.EXPENSIVE:
      return '$$$';
    case google.maps.places.PriceLevel.VERY_EXPENSIVE:
      return '$$$$';
    default:
      return 'Price n/a';
  }
}

function scoreHotelCandidate(
  priceLevel: google.maps.places.PriceLevel | null,
  rating: number | null,
  userRatingsTotal: number | null,
  distanceFromSearchMiles: number,
) {
  const priceScore = (4 - hotelPriceRank(priceLevel)) * 18;
  const ratingScore = (rating ?? 3.4) * 12;
  const reviewScore = Math.min(Math.log10((userRatingsTotal ?? 0) + 1), 4) * 5;
  const proximityPenalty = Math.min(distanceFromSearchMiles, 12) * 1.4;

  return priceScore + ratingScore + reviewScore - proximityPenalty;
}

function samplePositions(
  positions: google.maps.LatLngLiteral[],
  maxPoints: number,
  idPrefix: string,
  labelPrefix: string,
): HotelSearchPoint[] {
  if (!positions.length) return [];

  const pointCount = Math.min(maxPoints, positions.length);
  const sampledPositions = Array.from({ length: pointCount }, (_, index) => {
    const pathIndex = pointCount === 1 ? 0 : Math.round((index / (pointCount - 1)) * (positions.length - 1));
    return positions[pathIndex];
  });

  const seen = new Set<string>();
  return sampledPositions
    .filter((position) => {
      const key = `${position.lat.toFixed(4)},${position.lng.toFixed(4)}`;
      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    })
    .map((position, index) => ({
      id: `${idPrefix}-${index}`,
      label: `${labelPrefix} ${index + 1}`,
      position,
    }));
}

function buildStopHotelSearchPoints(stops: TripStop[]) {
  return samplePositions(
    stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    maxHotelSearchPoints,
    'stop',
    'Stop area',
  );
}

function roundPosition(position: google.maps.LatLngLiteral, precision = 5) {
  return {
    lat: Number(position.lat.toFixed(precision)),
    lng: Number(position.lng.toFixed(precision)),
  };
}

function buildRouteCacheKey(stops: TripStop[]) {
  return stops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join('|');
}

function buildHotelPointCacheKey(searchPoint: HotelSearchPoint) {
  return `${searchPoint.position.lat.toFixed(3)},${searchPoint.position.lng.toFixed(3)}`;
}

function buildRouteHotelSearchPoints(routePaths: google.maps.LatLngLiteral[][], stops: TripStop[]) {
  const routePositions = routePaths.flat();
  const sampledRoutePoints = samplePositions(routePositions, maxHotelSearchPoints, 'route', 'Route area');

  return sampledRoutePoints.length ? sampledRoutePoints : buildStopHotelSearchPoints(stops);
}

function extractRoutePaths(routes: RoadRoute[]) {
  return routes.flatMap((route) =>
    route
      .createPolylines()
      .map((polyline) =>
        polyline
          .getPath()
          .getArray()
          .map((position) => roundPosition({ lat: position.lat(), lng: position.lng() })),
      )
      .filter((routePath) => routePath.length > 1),
  );
}

function normalizeHotelPlace(
  place: google.maps.places.Place,
  searchPoint: HotelSearchPoint,
): HotelCandidate | null {
  const location = place.location;
  if (!place.id || !place.displayName || !location) return null;
  if (place.businessStatus && place.businessStatus !== google.maps.places.BusinessStatus.OPERATIONAL) return null;

  const position = { lat: location.lat(), lng: location.lng() };
  const rating = typeof place.rating === 'number' ? place.rating : null;
  const userRatingsTotal = typeof place.userRatingCount === 'number' ? place.userRatingCount : null;
  const priceLevel = place.priceLevel || null;
  const distanceFromSearchMiles = calculatePointMiles(position, searchPoint.position);

  return {
    id: place.id,
    name: place.displayName,
    position,
    rating,
    userRatingsTotal,
    priceLevel,
    vicinity: place.formattedAddress || '',
    searchLabel: searchPoint.label,
    distanceFromSearchMiles,
    score: scoreHotelCandidate(priceLevel, rating, userRatingsTotal, distanceFromSearchMiles),
  };
}

function normalizeCachedHotelCandidate(candidate: HotelCandidate, searchPoint: HotelSearchPoint) {
  if (!candidate || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
  if (!isPosition(candidate.position)) return null;

  const priceLevel = typeof candidate.priceLevel === 'number'
    ? candidate.priceLevel as google.maps.places.PriceLevel
    : null;
  const rating = typeof candidate.rating === 'number' ? candidate.rating : null;
  const userRatingsTotal = typeof candidate.userRatingsTotal === 'number' ? candidate.userRatingsTotal : null;
  const distanceFromSearchMiles = calculatePointMiles(candidate.position, searchPoint.position);

  return {
    ...candidate,
    position: roundPosition(candidate.position, 6),
    rating,
    userRatingsTotal,
    priceLevel,
    vicinity: typeof candidate.vicinity === 'string' ? candidate.vicinity : '',
    searchLabel: searchPoint.label,
    distanceFromSearchMiles,
    score: scoreHotelCandidate(priceLevel, rating, userRatingsTotal, distanceFromSearchMiles),
  };
}

function readCachedHotelCandidates(searchPoint: HotelSearchPoint) {
  const cachedCandidates = getCachedValue<HotelCandidate[]>(
    hotelCacheKey,
    buildHotelPointCacheKey(searchPoint),
    hotelCacheTtlMs,
  );
  if (!Array.isArray(cachedCandidates)) return null;

  return cachedCandidates
    .map((candidate) => normalizeCachedHotelCandidate(candidate, searchPoint))
    .filter((candidate): candidate is HotelCandidate => Boolean(candidate));
}

function writeCachedHotelCandidates(searchPoint: HotelSearchPoint, candidates: HotelCandidate[]) {
  setCachedValue<HotelCandidate[]>(
    hotelCacheKey,
    buildHotelPointCacheKey(searchPoint),
    candidates,
    maxHotelCacheEntries,
  );
}

async function searchHotelsNearPoint(
  placesLibrary: google.maps.PlacesLibrary,
  searchPoint: HotelSearchPoint,
) {
  const { places } = await placesLibrary.Place.searchNearby({
    fields: [
      'id',
      'displayName',
      'location',
      'rating',
      'userRatingCount',
      'priceLevel',
      'formattedAddress',
      'businessStatus',
    ],
    includedPrimaryTypes: ['hotel'],
    locationRestriction: {
      center: searchPoint.position,
      radius: hotelSearchRadiusMeters,
    },
    maxResultCount: 12,
    rankPreference: placesLibrary.SearchNearbyRankPreference.POPULARITY,
  });

  return places;
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
    fields: ['path', 'distanceMeters', 'durationMillis', 'legs'],
  });

  const route = response.routes?.[0];
  if (!route) {
    throw new Error('NO_ROUTE');
  }

  return route;
}

function isRouteQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /RESOURCE_EXHAUSTED|quota/i.test(message);
}

function formatRouteFallbackMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (isRouteQuotaError(error)) return 'Routes API daily quota reached';
  if (message.includes('ROUTES_LIBRARY_UNAVAILABLE')) return 'Routes library unavailable';
  return 'Driving route unavailable';
}

function calculateRoadRouteMiles(routes: RoadRoute[]) {
  const meters = routes.reduce((total, route) => total + (route.distanceMeters || 0), 0);

  return meters > 0 ? Math.round(metersToMiles(meters)) : null;
}

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const documentUploadStopIdRef = useRef('');
  const [savedTrips, setSavedTrips] = useState<Trip[]>(readSavedTrips);
  const [activeTrip, setActiveTrip] = useState<Trip>(() => readActiveTrip() || createDefaultTrip());
  const [selectedStopId, setSelectedStopId] = useState<string | null>(
    () => activeTrip.stops[0]?.id || null,
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [showHotelFinder, setShowHotelFinder] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('editor');
  const [saveMessage, setSaveMessage] = useState('');
  const [routeAssistantPrompt, setRouteAssistantPrompt] = useState('');
  const [routeAssistantMessage, setRouteAssistantMessage] = useState('');
  const [isRouteAssistantWorking, setIsRouteAssistantWorking] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [saveBackend, setSaveBackend] = useState<SaveBackend>('checking');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [drivingMiles, setDrivingMiles] = useState<number | null>(null);
  const [roadDriveEstimates, setRoadDriveEstimates] = useState<DriveEstimate[] | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [gasPrice, setGasPrice] = useState(() => readNumberStorage(gasPriceKey, defaultGasPrice));
  const [fuelMpg, setFuelMpg] = useState(() => readNumberStorage(fuelMpgKey, defaultFuelMpg, 0.01));
  const [previewExport, setPreviewExport] = useState<ExportedTrip | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);

  const stops = useMemo(() => resequenceStops(activeTrip.stops), [activeTrip.stops]);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const selectedStopIndex = useMemo(
    () => (selectedStop ? stops.findIndex((stop) => stop.id === selectedStop.id) : -1),
    [selectedStop, stops],
  );
  const estimatedDriveEstimates = useMemo(() => buildEstimatedDriveEstimates(stops), [stops]);
  const driveEstimates = roadDriveEstimates || estimatedDriveEstimates;
  const driveEstimateByStopId = useMemo(
    () => new Map(driveEstimates.map((estimate) => [estimate.toStopId, estimate])),
    [driveEstimates],
  );
  const hasRoadDriveEstimates = Boolean(roadDriveEstimates?.some((estimate) => estimate.source === 'road'));
  const displayMiles = drivingMiles ?? sumDriveMiles(estimatedDriveEstimates);
  const displayDriveMinutes = sumDriveMinutes(driveEstimates);
  const gasCost = calculateGasCost(displayMiles, gasPrice, fuelMpg);
  const lodgingCost = useMemo(() => calculateLodgingCost(stops), [stops]);
  const displayGasCost = formatGasCost(displayMiles, gasPrice, fuelMpg);
  const displayLodgingCost = formatCurrency(lodgingCost);
  const displayTripTotal = formatCurrency(gasCost + lodgingCost);
  const remoteStops = useMemo(() => stops.filter((stop) => stop.remoteWork).length, [stops]);
  const documents = activeTrip.documents;
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  );
  const selectedStopDocuments = useMemo(
    () => (selectedStop ? documents.filter((document) => document.linkedStopId === selectedStop.id) : []),
    [documents, selectedStop],
  );
  const dateRange = useMemo(() => formatStopDateRange(stops), [stops]);
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
    writeStorage(gasPriceKey, gasPrice);
  }, [gasPrice]);

  useEffect(() => {
    writeStorage(fuelMpgKey, fuelMpg);
  }, [fuelMpg]);

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
    if (!showImportModal) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowImportModal(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showImportModal]);

  useEffect(() => {
    if (!stops.length) {
      setSelectedStopId(null);
      return;
    }

    if (selectedStopId && !stops.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(stops[0].id);
    }
  }, [selectedStopId, stops]);

  useEffect(() => {
    if (selectedDocumentId && !documents.some((document) => document.id === selectedDocumentId)) {
      setSelectedDocumentId(null);
    }
  }, [documents, selectedDocumentId]);

  const touchTrip = (updater: (trip: Trip) => Trip) => {
    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setActiveTrip((trip) => ({
      ...updater(trip),
      updatedAt: new Date().toISOString(),
    }));
    setSaveMessage('');
  };

  const touchTripMetadata = (updater: (trip: Trip) => Trip) => {
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

  const updateDocument = (documentId: string, updates: Partial<TripDocument>) => {
    const now = new Date().toISOString();

    touchTripMetadata((trip) => ({
      ...trip,
      documents: trip.documents.map((document) =>
        document.id === documentId ? { ...document, ...updates, updatedAt: now } : document,
      ),
    }));
  };

  const addTextDocument = (linkedStopId = '') => {
    const newDocument = createTextDocument(linkedStopId);

    touchTripMetadata((trip) => ({
      ...trip,
      documents: [newDocument, ...trip.documents],
    }));
    setSelectedDocumentId(newDocument.id);
  };

  const startDocumentUpload = (linkedStopId = '') => {
    documentUploadStopIdRef.current = linkedStopId;
    documentInputRef.current?.click();
  };

  const importDocumentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    if (file.size > maxDocumentFileBytes) {
      setSaveMessage(`Document file must be ${formatFileSize(maxDocumentFileBytes)} or smaller`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const newDocument = createFileDocument(file, dataUrl, documentUploadStopIdRef.current);

      touchTripMetadata((trip) => ({
        ...trip,
        documents: [newDocument, ...trip.documents],
      }));
      setSelectedDocumentId(newDocument.id);
      setSaveMessage(`Attached ${file.name}`);
    } catch {
      setSaveMessage('Document upload failed');
    } finally {
      documentUploadStopIdRef.current = '';
    }
  };

  const deleteDocument = (documentId: string) => {
    const nextSelection = documents.find((document) => document.id !== documentId)?.id || null;

    touchTripMetadata((trip) => ({
      ...trip,
      documents: trip.documents.filter((document) => document.id !== documentId),
    }));
    setSelectedDocumentId(nextSelection);
  };

  const updateGasPrice = (value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue < 0) return;

    setGasPrice(nextValue);
  };

  const updateFuelMpg = (value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;

    setFuelMpg(nextValue);
  };

  const insertStopAtCoordinates = (
    position: google.maps.LatLngLiteral,
    label = 'Dropped pin',
    notes = 'Added from map pin.',
  ) => {
    const pinPosition = {
      lat: Number(position.lat.toFixed(6)),
      lng: Number(position.lng.toFixed(6)),
    };
    const { closestStop, closestIndex, insertionIndex } = findDroppedPinInsertion(pinPosition, stops);
    const order = insertionIndex + 1;
    const placement = closestStop && insertionIndex <= closestIndex ? 'before' : 'after';
    const newStop: TripStop = {
      id: makeId('stop'),
      order,
      date: closestStop?.date || '',
      label,
      lat: pinPosition.lat,
      lng: pinPosition.lng,
      notes,
      remoteWork: false,
      sleepingArrangement: 'camping',
      friendName: '',
    };

    touchTrip((trip) => {
      const before = trip.stops.filter((stop) => stop.order < order);
      const after = trip.stops.filter((stop) => stop.order >= order);
      return { ...trip, stops: resequenceStops([...before, newStop, ...after]) };
    });
    setSelectedStopId(newStop.id);
    setIsPlacingPin(false);
    setLocationMessage(
      closestStop
        ? `Added ${label} near ${closestStop.label}; optimized ${placement} that stop.`
        : `Added ${label}`,
    );
    setFitSignal((value) => value + 1);
  };

  const placePin = (position: google.maps.LatLngLiteral) => {
    insertStopAtCoordinates(position);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not available in this browser.');
      return;
    }

    setIsLocating(true);
    setLocationMessage('Getting current location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        insertStopAtCoordinates(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          'Current location',
          'Added from browser location.',
        );
        setIsLocating(false);
      },
      () => {
        setLocationMessage('Location permission was blocked or unavailable.');
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
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
      sleepingArrangement: 'camping',
      friendName: '',
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
      documents: trip.documents.map((document) =>
        document.linkedStopId === selectedStop.id ? { ...document, linkedStopId: '' } : document,
      ),
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

  const importTripJson = async (jsonText: string, closeModal = false) => {
    setIsImporting(true);

    try {
      const importedTrip = parseTripImport(JSON.parse(jsonText));
      if (!importedTrip) {
        setSaveMessage('Import needs a saved-trip export or stop list');
        return;
      }

      const nextSavedTrips = [
        importedTrip,
        ...savedTrips.filter((trip) => trip.id !== importedTrip.id),
      ];

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setActiveTrip(importedTrip);
      setSelectedStopId(importedTrip.stops[0]?.id || null);
      setSelectedDocumentId(importedTrip.documents[0]?.id || null);
      setSavedTrips(nextSavedTrips);
      setCurrentView('editor');
      setFitSignal((value) => value + 1);
      if (closeModal) {
        setShowImportModal(false);
        setImportJsonText('');
      }

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

  const importTrip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    await importTripJson(await file.text());
  };

  const importPastedTrip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const jsonText = importJsonText.trim();
    if (!jsonText) return;

    await importTripJson(jsonText, true);
  };

  const applyRouteAssistant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const instruction = routeAssistantPrompt.trim();
    if (!instruction) return;

    setIsRouteAssistantWorking(true);
    setRouteAssistantMessage('Thinking through route changes...');

    try {
      const result = await requestRouteAssistant(getActiveTripForExport(), instruction);
      const now = new Date().toISOString();
      const proposedTrip = normalizeTrip({
        ...result.trip,
        id: makeId('trip'),
        createdAt: now,
        updatedAt: now,
        name: result.trip.name || `${activeTrip.name} AI draft`,
        documents: activeTrip.documents,
      });

      if (!proposedTrip) {
        throw new Error('INVALID_ROUTE_ASSISTANT_RESPONSE');
      }

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setActiveTrip(proposedTrip);
      setSelectedStopId(proposedTrip.stops[0]?.id || null);
      setSelectedDocumentId(proposedTrip.documents[0]?.id || null);
      setCurrentView('editor');
      setFitSignal((value) => value + 1);
      setRouteAssistantPrompt('');
      setRouteAssistantMessage(`${result.summary} Save the draft when ready.`);
      setSaveMessage('AI route draft loaded');
    } catch (error) {
      const message = error instanceof Error && error.message.includes('503')
        ? 'AI route editor needs OPENAI_TOKEN on the server.'
        : 'AI route edit failed. Try a smaller change.';
      setRouteAssistantMessage(message);
    } finally {
      setIsRouteAssistantWorking(false);
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
    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setActiveTrip(newTrip);
    setSelectedStopId(newTrip.stops[0].id);
    setSelectedDocumentId(null);
    setCurrentView('editor');
    setSaveMessage('');
    setFitSignal((value) => value + 1);
  };

  const loadTrip = (trip: Trip) => {
    const nextTrip = normalizeTrip(trip);
    if (!nextTrip) return;

    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setActiveTrip(nextTrip);
    setSelectedStopId(nextTrip.stops[0]?.id || null);
    setSelectedDocumentId(nextTrip.documents[0]?.id || null);
    setCurrentView('editor');
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

  const handleSleepingArrangementChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!selectedStop) return;
    updateStop(selectedStop.id, {
      sleepingArrangement: normalizeSleepingArrangement(event.currentTarget.value),
    });
  };

  const handleFriendNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedStop) return;
    updateStop(selectedStop.id, { friendName: event.currentTarget.value });
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

        <nav className="view-tabs" aria-label="Primary views">
          <button
            type="button"
            className={currentView === 'editor' ? 'view-tab active' : 'view-tab'}
            onClick={() => setCurrentView('editor')}
          >
            Editor
          </button>
          <button
            type="button"
            className={currentView === 'saved' ? 'view-tab active' : 'view-tab'}
            onClick={() => setCurrentView('saved')}
          >
            Saved trips
            <span>{savedTrips.length}</span>
          </button>
        </nav>

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
          <input
            ref={documentInputRef}
            className="file-input"
            type="file"
            onChange={importDocumentFile}
            aria-label="Attach trip document"
          />
          <button type="button" className="icon-button" onClick={startNewTrip} title="New trip">
            <FilePlus2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => importInputRef.current?.click()}
            title="Import trip JSON file"
            aria-label="Import trip JSON file"
            disabled={isImporting}
          >
            <Upload size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowImportModal(true)}
            title="Paste trip JSON"
            aria-label="Paste trip JSON"
            disabled={isImporting}
          >
            <Import size={18} />
          </button>
          {currentView === 'editor' && (
            <>
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
            </>
          )}
        </div>
      </header>

      {currentView === 'editor' ? (
      <main className="editor-page">
        <section className="route-assistant-bar" aria-label="AI route editor">
          <span className="route-assistant-icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <form className="route-assistant-form" onSubmit={applyRouteAssistant}>
            <label htmlFor="route-assistant-prompt">AI route edit</label>
            <input
              id="route-assistant-prompt"
              value={routeAssistantPrompt}
              onChange={(event) => setRouteAssistantPrompt(event.currentTarget.value)}
              placeholder="Add a night in Denver or make the middle route more coastal; start/end stay locked"
            />
            <button
              type="submit"
              className="primary-button"
              disabled={isRouteAssistantWorking || !routeAssistantPrompt.trim()}
            >
              <Sparkles size={17} />
              <span>{isRouteAssistantWorking ? 'Working' : 'Update route'}</span>
            </button>
          </form>
          {routeAssistantMessage && <p className="route-assistant-message">{routeAssistantMessage}</p>}
        </section>

      <div className="workspace">
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
                <strong>{formatDriveDuration(displayDriveMinutes)}</strong>
                <span>{hasRoadDriveEstimates ? 'Drive time' : 'Est. time'}</span>
              </div>
              <div>
                <strong>{displayGasCost}</strong>
                <span>Est. gas</span>
              </div>
              <div>
                <strong>{displayLodgingCost}</strong>
                <span>Lodging</span>
              </div>
              <div>
                <strong>{displayTripTotal}</strong>
                <span>Trip total</span>
              </div>
              <div>
                <strong>{remoteStops}</strong>
                <span>Remote</span>
              </div>
              <div>
                <strong>{documents.length}</strong>
                <span>Docs</span>
              </div>
            </div>

            <div className="fuel-settings" aria-label="Fuel assumptions">
              <span>
                <label htmlFor="gas-price">Gas $/gal</label>
                <input
                  id="gas-price"
                  type="number"
                  min="0"
                  step="0.05"
                  value={gasPrice}
                  onChange={(event) => updateGasPrice(event.currentTarget.value)}
                />
              </span>
              <span>
                <label htmlFor="fuel-mpg">MPG</label>
                <input
                  id="fuel-mpg"
                  type="number"
                  min="1"
                  step="1"
                  value={fuelMpg}
                  onChange={(event) => updateFuelMpg(event.currentTarget.value)}
                />
              </span>
            </div>

            <label className="toggle-row hotel-finder-toggle" htmlFor="hotel-finder">
              <input
                id="hotel-finder"
                type="checkbox"
                checked={showHotelFinder}
                onChange={(event) => setShowHotelFinder(event.currentTarget.checked)}
              />
              <span>
                <strong>Hotel finder</strong>
                <small>Cheap, well-rated stays near the route</small>
              </span>
              <BedDouble size={18} />
            </label>

            <div className="rail-actions">
              <button type="button" className="secondary-button" onClick={addStop}>
                <Plus size={17} />
                <span>Add stop</span>
              </button>
              <button
                type="button"
                className={isPlacingPin ? 'icon-button active' : 'icon-button'}
                onClick={() => {
                  setIsPlacingPin((value) => !value);
                  setLocationMessage(isPlacingPin ? '' : 'Click the map to place a pin.');
                }}
                title="Place pin on map"
                aria-label="Place pin on map"
                aria-pressed={isPlacingPin}
              >
                <MapPin size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={useCurrentLocation}
                title="Use current location"
                aria-label="Use current location"
                disabled={isLocating}
              >
                <LocateFixed size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFitSignal((value) => value + 1)}
                title="Fit route"
                aria-label="Fit route"
              >
                <Maximize2 size={18} />
              </button>
            </div>
            {locationMessage && <p className="location-message">{locationMessage}</p>}
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <h2>Itinerary</h2>
              <span>{stops.length}</span>
            </div>
            <ol className="stop-list">
              {stops.map((stop, stopIndex) => {
                const driveEstimate = driveEstimateByStopId.get(stop.id);
                const stopIsWeekend = isWeekendDate(stop.date);
                const stopCardClassName = [
                  'stop-card',
                  getSleepClass(stop.sleepingArrangement),
                  stop.remoteWork ? 'remote' : '',
                  stopIsWeekend ? 'weekend' : '',
                  stop.id === selectedStopId ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <li key={stop.id}>
                    <button
                      type="button"
                      className={stopCardClassName}
                      onClick={() => setSelectedStopId(stop.id)}
                    >
                      <span className={`stop-index ${getSleepClass(stop.sleepingArrangement)}`}>
                        {stop.order}
                      </span>
                      <span className="stop-copy">
                        <strong>{stop.label}</strong>
                        <small>
                          <CalendarDays size={14} />
                          {formatScheduleDate(stop.date)}
                        </small>
                        {driveEstimate && (
                          <small className="drive-summary">
                            <Route size={14} />
                            {formatDriveSummary(driveEstimate, gasPrice, fuelMpg)}
                          </small>
                        )}
                        {stop.sleepingArrangement !== 'camping' && (
                          <small className="lodging-summary">
                            <BedDouble size={14} />
                            {formatSleepingArrangementSummary(stop, stopIndex, stops)}
                          </small>
                        )}
                        <span className="stop-tags">
                          <span className={`stop-tag ${getSleepClass(stop.sleepingArrangement)}`}>
                            {formatSleepingArrangementLabel(stop.sleepingArrangement)}
                          </span>
                          {stop.remoteWork && <span className="stop-tag remote">Remote work</span>}
                          {stopIsWeekend && <span className="stop-tag weekend">Weekend</span>}
                        </span>
                      </span>
                      {stop.remoteWork && (
                        <span className="mini-badge" title="Remote-work stop">
                          <Wifi size={14} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel-section documents-panel">
            <div className="section-heading">
              <h2>Documents</h2>
              <span>{documents.length}</span>
            </div>
            <div className="document-actions">
              <button type="button" className="secondary-button" onClick={() => addTextDocument()}>
                <FileText size={17} />
                <span>New note</span>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => startDocumentUpload()}
                title="Attach file"
                aria-label="Attach file"
              >
                <Paperclip size={18} />
              </button>
            </div>
            {documents.length ? (
              <div className="document-list">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    className={document.id === selectedDocumentId ? 'document-card selected' : 'document-card'}
                    onClick={() => setSelectedDocumentId(document.id)}
                  >
                    <span className="document-icon">
                      {document.kind === 'file' ? <Paperclip size={15} /> : <FileText size={15} />}
                    </span>
                    <span>
                      <strong>{document.title}</strong>
                      <small>{formatDocumentLocation(document, stops)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No documents yet.</p>
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
              isPlacingPin={isPlacingPin}
              showHotelFinder={showHotelFinder}
              onSelectStop={setSelectedStopId}
              onPlacePin={placePin}
              onRouteDistanceChange={setDrivingMiles}
              onDriveEstimatesChange={setRoadDriveEstimates}
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

              <div className="sleeping-section">
                <label htmlFor="sleeping-arrangement">Sleeping arrangement</label>
                <select
                  id="sleeping-arrangement"
                  value={selectedStop.sleepingArrangement}
                  onChange={handleSleepingArrangementChange}
                >
                  <option value="camping">Camping</option>
                  <option value="hotel">Hotel</option>
                  <option value="friend">Staying with friend</option>
                </select>

                {selectedStop.sleepingArrangement === 'hotel' && selectedStopIndex >= 0 && (
                  <p className="sleeping-hint">
                    {formatSleepingArrangementSummary(selectedStop, selectedStopIndex, stops)} adds{' '}
                    {formatCurrency(calculateStopLodgingCost(stops, selectedStopIndex))} to the trip total.
                  </p>
                )}

                {selectedStop.sleepingArrangement === 'friend' && (
                  <span className="friend-field">
                    <label htmlFor="friend-name">Friend</label>
                    <input
                      id="friend-name"
                      value={selectedStop.friendName}
                      onChange={handleFriendNameChange}
                      placeholder="Friend's name"
                    />
                  </span>
                )}
              </div>

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

              <div className="stop-document-actions">
                <button type="button" className="secondary-button" onClick={() => addTextDocument(selectedStop.id)}>
                  <FileText size={17} />
                  <span>Stop note</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => startDocumentUpload(selectedStop.id)}
                  title="Attach file to stop"
                  aria-label="Attach file to stop"
                >
                  <Paperclip size={18} />
                </button>
                {selectedStopDocuments.length > 0 && (
                  <span className="attached-count">{selectedStopDocuments.length} attached</span>
                )}
              </div>

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

          {selectedDocument && (
            <section className="document-editor" aria-label="Selected document">
              <div className="section-heading">
                <h2>Document</h2>
                <span>{selectedDocument.kind === 'file' ? 'File' : 'Text'}</span>
              </div>

              <label htmlFor="document-title">Title</label>
              <input
                id="document-title"
                value={selectedDocument.title}
                onChange={(event) => updateDocument(selectedDocument.id, { title: event.currentTarget.value })}
              />

              <label htmlFor="document-location">Location</label>
              <select
                id="document-location"
                value={selectedDocument.linkedStopId}
                onChange={(event) => updateDocument(selectedDocument.id, { linkedStopId: event.currentTarget.value })}
              >
                <option value="">Whole trip</option>
                {stops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {`Stop ${stop.order}: ${stop.label}`}
                  </option>
                ))}
              </select>

              {selectedDocument.kind === 'text' ? (
                <>
                  <label htmlFor="document-text">Text</label>
                  <textarea
                    id="document-text"
                    value={selectedDocument.text}
                    onChange={(event) => updateDocument(selectedDocument.id, { text: event.currentTarget.value })}
                    rows={7}
                  />
                </>
              ) : (
                <div className="document-file-panel">
                  <Paperclip size={18} />
                  <span>
                    <strong>{selectedDocument.fileName || selectedDocument.title}</strong>
                    <small>{formatFileSize(selectedDocument.fileSize)}</small>
                  </span>
                </div>
              )}

              <div className="document-editor-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => downloadTripDocument(selectedDocument)}
                >
                  <Download size={17} />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => deleteDocument(selectedDocument.id)}
                  title="Delete document"
                  aria-label="Delete document"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
      </main>
      ) : (
        <main className="saved-page" aria-label="Saved trips page">
          <section className="saved-page-header">
            <span>
              <h2>Saved Trips</h2>
              <p>{saveBackend === 'database' ? 'Database-backed trip library' : 'Local trip library'}</p>
            </span>
            <div className="saved-page-actions">
              <button type="button" className="secondary-button" onClick={startNewTrip}>
                <FilePlus2 size={17} />
                <span>New trip</span>
              </button>
              <button type="button" className="primary-button" onClick={() => setCurrentView('editor')}>
                <Route size={17} />
                <span>Open editor</span>
              </button>
            </div>
          </section>

          <section className="saved-page-grid">
            <div className="saved-library">
              <div className="section-heading">
                <h2>Library</h2>
                <span>{`${saveBackendLabel} ${savedTrips.length}`}</span>
              </div>
              {savedTrips.length ? (
                <div className="saved-list saved-list-page">
                  {savedTrips.map((trip) => (
                    <article key={trip.id} className="saved-card saved-card-page">
                      <button type="button" className="saved-main" onClick={() => loadTrip(trip)}>
                        <FolderOpen size={18} />
                        <span>
                          <strong>{trip.name}</strong>
                          <small>{formatStopDateRange(trip.stops)}</small>
                          <small>{`${trip.stops.length} stops | Updated ${formatDateTime(trip.updatedAt)}`}</small>
                        </span>
                      </button>
                      <span className="saved-actions">
                        <button
                          type="button"
                          className="secondary-button saved-edit-button"
                          onClick={() => loadTrip(trip)}
                        >
                          <FolderOpen size={16} />
                          <span>Edit</span>
                        </button>
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
                <div className="saved-empty">
                  <FolderOpen size={28} />
                  <p>No saved trips yet.</p>
                  <button type="button" className="primary-button" onClick={startNewTrip}>
                    <FilePlus2 size={17} />
                    <span>Create one</span>
                  </button>
                </div>
              )}
            </div>

            <aside className="saved-format-panel" aria-label="Trip JSON format">
              <div className="section-heading">
                <h2>Export Format</h2>
                <span>JSON</span>
              </div>
              <p className="format-copy">Saved trips export and import as versioned JSON files.</p>
              <pre className="format-example" aria-label="Saved trip export JSON example">
                <code>{exportFormatExample}</code>
              </pre>
            </aside>
          </section>
        </main>
      )}

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

      {showImportModal && (
        <div className="json-modal-backdrop" role="presentation" onClick={() => setShowImportModal(false)}>
          <section
            className="json-modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="json-import-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="json-modal-header">
              <span>
                <h2 id="json-import-title">Import JSON</h2>
                <p>Paste a saved trip export.</p>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowImportModal(false)}
                title="Close import"
                aria-label="Close import"
              >
                <X size={18} />
              </button>
            </header>
            <form className="import-form" onSubmit={importPastedTrip}>
              <label htmlFor="import-json">Saved trip JSON</label>
              <textarea
                id="import-json"
                value={importJsonText}
                onChange={(event) => setImportJsonText(event.currentTarget.value)}
                placeholder={exportFormatExample}
                rows={14}
              />
              <footer className="json-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowImportModal(false)}
                >
                  <X size={17} />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isImporting || !importJsonText.trim()}
                >
                  <Import size={17} />
                  <span>{isImporting ? 'Importing' : 'Import JSON'}</span>
                </button>
              </footer>
            </form>
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
  isPlacingPin,
  showHotelFinder,
  onSelectStop,
  onPlacePin,
  onRouteDistanceChange,
  onDriveEstimatesChange,
}: MapCanvasProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  const [routeError, setRouteError] = useState('');
  const [routeNoticeDismissed, setRouteNoticeDismissed] = useState(false);
  const [routeQuotaExhausted, setRouteQuotaExhausted] = useState(false);
  const [routePaths, setRoutePaths] = useState<google.maps.LatLngLiteral[][]>([]);
  const [routeHotelSearchPoints, setRouteHotelSearchPoints] = useState<HotelSearchPoint[]>([]);
  const [hotelCandidates, setHotelCandidates] = useState<HotelCandidate[]>([]);
  const [hotelStatus, setHotelStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');
  const [hotelMessage, setHotelMessage] = useState('');
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const mapStopGroups = useMemo(() => groupMapStops(stops), [stops]);
  const selectedMapGroup = useMemo(
    () => mapStopGroups.find((group) => group.stops.some((stop) => stop.id === selectedStopId)) || null,
    [mapStopGroups, selectedStopId],
  );
  const path = useMemo(() => stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })), [stops]);
  const stopHotelSearchPoints = useMemo(() => buildStopHotelSearchPoints(stops), [stops]);
  const hotelSearchPoints = routeHotelSearchPoints.length ? routeHotelSearchPoints : stopHotelSearchPoints;
  const hotelSearchKey = useMemo(
    () =>
      hotelSearchPoints
        .map((point) => `${point.id}:${point.position.lat.toFixed(4)},${point.position.lng.toFixed(4)}`)
        .join('|'),
    [hotelSearchPoints],
  );
  const selectedHotel = useMemo(
    () => hotelCandidates.find((hotel) => hotel.id === selectedHotelId) || null,
    [hotelCandidates, selectedHotelId],
  );
  const directionsKey = useMemo(() => buildRouteCacheKey(stops), [stops]);

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    libraries: googleMapsLibraries,
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
    if (!isLoaded || !mapInstance || stops.length < 2) {
      setRoutePaths([]);
      setRouteHotelSearchPoints([]);
      setRouteStatus('idle');
      setRouteError('');
      setRouteNoticeDismissed(false);
      onRouteDistanceChange(null);
      onDriveEstimatesChange(null);
      return undefined;
    }

    const cachedRoute = readCachedRoute(directionsKey, stops);
    if (cachedRoute) {
      setRoutePaths(cachedRoute.routePaths);
      setRouteHotelSearchPoints(cachedRoute.hotelSearchPoints);
      setRouteStatus('ready');
      setRouteError('');
      onRouteDistanceChange(cachedRoute.distanceMiles);
      onDriveEstimatesChange(cachedRoute.driveEstimates);
      return undefined;
    }

    if (routeQuotaExhausted) {
      setRoutePaths([]);
      setRouteHotelSearchPoints([]);
      setRouteStatus('fallback');
      setRouteError('Routes API daily quota reached');
      onRouteDistanceChange(null);
      onDriveEstimatesChange(null);
      return undefined;
    }

    let canceled = false;
    setRoutePaths([]);
    setRouteHotelSearchPoints([]);
    setRouteStatus('loading');
    setRouteError('');
    setRouteNoticeDismissed(false);
    onRouteDistanceChange(null);
    onDriveEstimatesChange(null);

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

          const nextRoutePaths = extractRoutePaths(routes);
          if (!nextRoutePaths.length) {
            throw new Error('NO_ROUTE_PATH');
          }

          const nextHotelSearchPoints = buildRouteHotelSearchPoints(nextRoutePaths, stops);
          const distanceMiles = calculateRoadRouteMiles(routes);
          const driveEstimates = buildRoadDriveEstimates(routes, stops);

          setRoutePaths(nextRoutePaths);
          setRouteHotelSearchPoints(nextHotelSearchPoints);
          setRouteStatus('ready');
          setRouteError('');
          setRouteNoticeDismissed(false);
          onRouteDistanceChange(distanceMiles);
          onDriveEstimatesChange(driveEstimates);
          writeCachedRoute(directionsKey, nextRoutePaths, distanceMiles, driveEstimates, nextHotelSearchPoints);
        })
        .catch((error: Error) => {
          if (canceled) return;

          setRoutePaths([]);
          setRouteHotelSearchPoints([]);
          setRouteStatus('fallback');
          setRouteError(formatRouteFallbackMessage(error));
          if (isRouteQuotaError(error)) {
            setRouteQuotaExhausted(true);
          }
          setRouteNoticeDismissed(false);
          onRouteDistanceChange(null);
          onDriveEstimatesChange(null);
        });
    }, 300);

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
    };
  }, [directionsKey, isLoaded, mapInstance, onDriveEstimatesChange, onRouteDistanceChange, routeQuotaExhausted, stops]);

  useEffect(() => {
    if (!showHotelFinder) {
      setHotelCandidates([]);
      setHotelStatus('idle');
      setHotelMessage('');
      setSelectedHotelId(null);
      return undefined;
    }

    if (!isLoaded || !mapInstance || !stops.length) {
      setHotelCandidates([]);
      setHotelStatus('searching');
      setHotelMessage('Waiting for map...');
      return undefined;
    }

    if (routeStatus === 'loading') {
      setHotelCandidates([]);
      setHotelStatus('searching');
      setHotelMessage('Waiting for driving route...');
      return undefined;
    }

    let canceled = false;

    setHotelCandidates([]);
    setSelectedHotelId(null);
    setHotelStatus('searching');
    setHotelMessage('Finding hotels near the route...');

    const runSearch = async () => {
      const candidatesById = new Map<string, HotelCandidate>();
      let failedSearches = 0;
      const addCandidates = (candidates: HotelCandidate[]) => {
        candidates.forEach((candidate) => {
          const existing = candidatesById.get(candidate.id);
          if (!existing || candidate.score > existing.score) {
            candidatesById.set(candidate.id, candidate);
          }
        });
      };
      const finishSearch = (messageSuffix = '') => {
        const rankedHotels = Array.from(candidatesById.values())
          .sort((first, second) => second.score - first.score)
          .slice(0, maxHotelCandidates);
        const everySearchFailed = failedSearches === hotelSearchPoints.length;

        setHotelCandidates(rankedHotels);
        setHotelStatus(everySearchFailed ? 'error' : 'ready');
        setHotelMessage(
          everySearchFailed
            ? 'Hotel search is unavailable for this route.'
            : rankedHotels.length
            ? `${rankedHotels.length} hotel options found near the route${messageSuffix}.`
            : 'No hotel options found near this route.',
        );
      };
      const uncachedSearchPoints = hotelSearchPoints.filter((searchPoint) => {
        const cachedCandidates = readCachedHotelCandidates(searchPoint);
        if (!cachedCandidates) return true;

        addCandidates(cachedCandidates);
        return false;
      });

      if (!uncachedSearchPoints.length) {
        if (!canceled) finishSearch(' from cache');
        return;
      }

      let placesLibrary: google.maps.PlacesLibrary;

      try {
        placesLibrary = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
      } catch {
        if (!canceled) {
          setHotelCandidates([]);
          setHotelStatus('error');
          setHotelMessage('Hotel search needs Places API (New) enabled for this Google Maps key.');
        }
        return;
      }

      for (const searchPoint of uncachedSearchPoints) {
        if (canceled) return;

        try {
          const results = await searchHotelsNearPoint(placesLibrary, searchPoint);
          const candidates = results
            .map((place) => normalizeHotelPlace(place, searchPoint))
            .filter((candidate): candidate is HotelCandidate => Boolean(candidate));

          addCandidates(candidates);
          writeCachedHotelCandidates(searchPoint, candidates);
        } catch {
          failedSearches += 1;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }

      if (canceled) return;

      finishSearch(uncachedSearchPoints.length === hotelSearchPoints.length ? '' : ' with cached matches');
    };

    runSearch();

    return () => {
      canceled = true;
    };
  }, [hotelSearchKey, hotelSearchPoints, isLoaded, mapInstance, routeStatus, showHotelFinder, stops.length]);

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
      onClick={(event) => {
        if (!isPlacingPin || !event.latLng) return;

        onPlacePin({
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        });
      }}
      onLoad={(map) => {
        mapRef.current = map;
        setMapInstance(map);
        fitAllStops(map);
      }}
      onUnmount={() => {
        mapRef.current = null;
        setMapInstance(null);
      }}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
        styles: mapStyles,
        draggableCursor: isPlacingPin ? 'crosshair' : undefined,
      }}
    >
      {routeStatus === 'ready' &&
        routePaths.map((routePath, index) => (
          <PolylineF
            key={`route-${index}`}
            path={routePath}
            options={{
              strokeColor: '#0f766e',
              strokeOpacity: 0.95,
              strokeWeight: 5,
            }}
          />
        ))}

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

      {mapStopGroups.map((group) => {
        const selectedInGroup = group.stops.some((stop) => stop.id === selectedStopId);
        const markerLabel = group.stopRangeLabel || String(group.stops[0].order);
        const className = [
          'map-stop-marker',
          getSleepClass(group.sleepingArrangement),
          group.stops.length > 1 ? 'grouped' : '',
          group.hasRemoteWork ? 'remote' : '',
          group.hasWeekend ? 'weekend' : '',
          selectedInGroup ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const heading = formatMapGroupHeading(group.stops);
        const selectedGroupStop = group.stops.find((stop) => stop.id === selectedStopId);

        return (
          <OverlayViewF
            key={group.id}
            position={group.position}
            mapPaneName={OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={centerOverlay}
            zIndex={selectedInGroup ? 30 : group.hasWeekend ? 20 : 10}
          >
            <button
              type="button"
              className={className}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectStop(selectedGroupStop?.id || group.stops[0].id);
              }}
              title={
                group.stops.length > 1
                  ? `Stops ${group.stopRangeLabel}: ${heading} (${group.dateRangeLabel})`
                  : `${heading}: ${group.dateRangeLabel}`
              }
              aria-label={
                group.stops.length > 1
                  ? `Stops ${group.stopRangeLabel}, ${group.dateRangeLabel}, ${group.stops.length} stops at ${heading}`
                  : `Stop ${group.stops[0].order}, ${heading}`
              }
            >
              <span>{markerLabel}</span>
            </button>
          </OverlayViewF>
        );
      })}

      {showHotelFinder &&
        hotelCandidates.map((hotel, index) => (
          <OverlayViewF
            key={hotel.id}
            position={hotel.position}
            mapPaneName={OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={centerOverlay}
            zIndex={selectedHotelId === hotel.id ? 26 : 8}
          >
            <button
              type="button"
              className={selectedHotelId === hotel.id ? 'hotel-marker selected' : 'hotel-marker'}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectStop(null);
                setSelectedHotelId(hotel.id);
              }}
              title={`${hotel.name} | ${formatHotelPrice(hotel.priceLevel)}${
                hotel.rating ? ` | ${hotel.rating.toFixed(1)} stars` : ''
              }`}
              aria-label={`Hotel ${index + 1}, ${hotel.name}`}
            >
              <BedDouble size={13} />
              <span>{index + 1}</span>
            </button>
          </OverlayViewF>
        ))}

      {showHotelFinder && selectedHotel && (
        <InfoWindowF
          position={selectedHotel.position}
          onCloseClick={() => setSelectedHotelId(null)}
        >
          <div className="info-window hotel-info-window">
            <p>
              {formatHotelPrice(selectedHotel.priceLevel)} | {selectedHotel.searchLabel}
            </p>
            <h2>{selectedHotel.name}</h2>
            <p>{selectedHotel.vicinity || 'Address unavailable'}</p>
            <div className="hotel-meta">
              <span>{selectedHotel.rating ? `${selectedHotel.rating.toFixed(1)} stars` : 'Rating n/a'}</span>
              <span>{selectedHotel.userRatingsTotal ? `${selectedHotel.userRatingsTotal} reviews` : 'Reviews n/a'}</span>
              <span>{selectedHotel.distanceFromSearchMiles.toFixed(1)} mi off route sample</span>
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${selectedHotel.position.lat},${selectedHotel.position.lng}&query_place_id=${encodeURIComponent(
                selectedHotel.id,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
          </div>
        </InfoWindowF>
      )}

      {selectedStop && selectedMapGroup && (
        <InfoWindowF
          position={selectedMapGroup.position}
          onCloseClick={() => onSelectStop(null)}
        >
          <div className="info-window">
            <p>
              {selectedMapGroup.stops.length > 1
                ? `Stops ${selectedMapGroup.stopRangeLabel} | ${selectedMapGroup.dateRangeLabel}`
                : selectedMapGroup.dateRangeLabel}
            </p>
            <h2>{formatMapGroupHeading(selectedMapGroup.stops)}</h2>
            {selectedMapGroup.stops.length > 1 ? (
              <div className="info-window-list" aria-label="Stops at this point">
                {selectedMapGroup.stops.map((stop) => (
                  <button
                    type="button"
                    key={stop.id}
                    className={stop.id === selectedStop.id ? 'info-window-stop active' : 'info-window-stop'}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectStop(stop.id);
                    }}
                  >
                    <span>{formatScheduleDate(stop.date)}</span>
                    <strong>{stop.label}</strong>
                    <small>{stop.notes || 'No notes yet.'}</small>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p>{selectedStop.notes || 'No notes yet.'}</p>
                <span className="stop-tags map-info-tags">
                  <span className={`stop-tag ${getSleepClass(selectedStop.sleepingArrangement)}`}>
                    {formatSleepingArrangementLabel(selectedStop.sleepingArrangement)}
                  </span>
                  {selectedStop.remoteWork && <span className="stop-tag remote">Remote work</span>}
                  {isWeekendDate(selectedStop.date) && <span className="stop-tag weekend">Weekend</span>}
                </span>
              </>
            )}
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
    {routeStatus === 'loading' && <div className="route-status">Calculating driving route...</div>}
    {showHotelFinder && hotelMessage && (
      <div className={hotelStatus === 'error' ? 'hotel-status error' : 'hotel-status'}>{hotelMessage}</div>
    )}
    {routeStatus === 'fallback' && !routeNoticeDismissed && (
      <div className="route-status warning">
        <span>{routeError || 'Driving route unavailable'}; showing estimated path.</span>
        <button
          type="button"
          className="route-status-close"
          onClick={() => setRouteNoticeDismissed(true)}
          title="Dismiss route notice"
          aria-label="Dismiss route notice"
        >
          <X size={14} />
        </button>
      </div>
    )}
    </>
  );
}

export default App;
