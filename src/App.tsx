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
import L from 'leaflet';
import {
  BedDouble,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderCog,
  FolderOpen,
  Fuel,
  History,
  Import,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Maximize2,
  Paperclip,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Save,
  Share2,
  Ship,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import tripStops from './tripStops.json';

type SleepingArrangement = 'camping' | 'hotel' | 'friend';
type TravelMode = 'car' | 'plane' | 'boat';
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
  travelMode?: TravelMode;
};

type TripStop = Omit<ImportedTripStop, 'sleepingArrangement' | 'friendName' | 'travelMode'> & {
  id: string;
  sleepingArrangement: SleepingArrangement;
  friendName: string;
  travelMode: TravelMode;
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
  dayRangeLabel: string;
  dateRangeLabel: string;
  sleepingArrangement: SleepingArrangement | 'mixed';
  hasWeekend: boolean;
  hasRemoteWork: boolean;
};

type MapMarkerLabelMode = 'day' | 'date';

type GasLegSegment = {
  fromStopId: string;
  toStopId: string;
  path: google.maps.LatLngLiteral[];
  gasPrice: number;
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
  website: string;
  searchLabel: string;
  distanceFromSearchMiles: number;
  score: number;
};

type CachedRouteLeg = DriveEstimate;

type CachedRoute = {
  version: 2;
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

type Workspace = {
  id: string;
  name: string;
  defaultTripId: string;
  createdAt: string;
  updatedAt: string;
};

type Trip = {
  id: string;
  workspaceId: string;
  name: string;
  notes: string;
  remoteWorkDates: string[];
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

type CompactSharedTripStop = [
  date: string,
  label: string,
  lat: number,
  lng: number,
  notes?: string,
  remoteWork?: 0 | 1,
  sleepingArrangement?: SleepingArrangement | '',
  friendName?: string,
  travelMode?: TravelMode | '',
];

type CompactSharedTrip = {
  f: 'rtp2';
  n: string;
  o?: string;
  r?: string[];
  s: CompactSharedTripStop[];
};

type TripShareSource =
  | { kind: 'server'; id: string }
  | { kind: 'payload'; payload: string };

type SharedTripResponse = {
  id: string;
  durable?: boolean;
};

type SaveBackend = 'checking' | 'database' | 'local';
type AppView = 'editor' | 'saved' | 'ai' | 'workspaces';
type NewTripMode = 'setup' | 'ai' | 'json';

type LastAiEdit = {
  kind: 'route-edit' | 'new-trip';
  instruction: string;
  summary: string;
  at: string;
};

type NewTripDraft = {
  startDate: string;
  endDate: string;
  startLocation: string;
  endLocation: string;
};

type RouteAssistantResult = {
  summary: string;
  trip: Trip;
};

type RouteAssistantContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type RouteAssistantSettings = {
  maxCarLegHours: number;
  model?: string;
};

type AiModelSettings = {
  routeAssistantModel: string;
  tripStarterModel: string;
};

type OpenAIModelOption = {
  id: string;
  ownedBy: string;
  created: number;
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
  gasPriceScaling: boolean;
  markerLabelMode: MapMarkerLabelMode;
  onSelectStop: (stopId: string | null) => void;
  onPlacePin: (position: google.maps.LatLngLiteral) => void;
  onRouteDistanceChange: (miles: number | null) => void;
  onDriveEstimatesChange: (estimates: DriveEstimate[] | null) => void;
};

const mapContainerStyle = { width: '100%', height: '100%' };
const defaultRouteColor = '#0f766e';
const centerOverlay = (width: number, height: number) => ({ x: -(width / 2), y: -(height / 2) });
const googleMapsLibraries: Libraries = ['places'];
const usCenter = { lat: 39.8283, lng: -98.5795 };
const savedTripsKey = 'road-trip-planner.savedTrips.v1';
const activeTripKey = 'road-trip-planner.activeTrip.v1';
const workspacesKey = 'road-trip-planner.workspaces.v1';
const activeWorkspaceKey = 'road-trip-planner.activeWorkspace.v1';
const gasPriceKey = 'road-trip-planner.gasPrice.v1';
const gasPriceScalingKey = 'road-trip-planner.gasPriceScaling.v1';
const mapMarkerLabelModeKey = 'road-trip-planner.mapMarkerLabelMode.v1';
const lastAiEditKey = 'road-trip-planner.lastAiEdit.v1';
const fuelMpgKey = 'road-trip-planner.fuelMpg.v1';
const maxCarLegHoursKey = 'road-trip-planner.maxCarLegHours.v1';
const aiModelSettingsKey = 'road-trip-planner.aiModelSettings.v1';
const routeCacheKey = 'road-trip-planner.routeCache.v1';
const hotelCacheKey = 'road-trip-planner.hotelCache.v1';
const defaultWorkspaceId = 'workspace-default';
const defaultTripId = 'default-2026-usa-itinerary';
const tripExportFormat = 'road-trip-planner.saved-trip.v1';
const compactTripShareFormat = 'rtp2';
const savedRouteParam = 'route';
const shortTripShareParam = 'share';
const compactTripShareParam = 't';
const legacyTripShareParam = 'trip';
const sharePathPrefix = '/share/';
const aiSettingsPath = '/AI';
const workspacesPath = '/workspaces';
const routeAssistantPromptMaxLength = 12000;
const maxRouteAssistantContextMessages = 5;
const maxStopsPerDirectionsRequest = 25;
const maxHotelSearchPoints = 8;
const maxHotelCandidates = 12;
const hotelSearchRadiusMeters = 16093;
const routeCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const hotelCacheTtlMs = 24 * 60 * 60 * 1000;
const routeQuotaCooldownMs = 24 * 60 * 60 * 1000;
const maxRouteCacheEntries = 12;
const maxHotelCacheEntries = 80;
const maxDocumentFileBytes = 1024 * 1024;
const routeQuotaExhaustedUntilKey = 'road-trip-planner.routeQuotaExhaustedUntil.v1';
const defaultGasPrice = 3.5;
const defaultFuelMpg = 25;
const defaultMaxCarLegHours = 14;
const estimatedAverageMph = 55;
const sleepingArrangementOptions: SleepingArrangement[] = ['camping', 'hotel', 'friend'];
const travelModeOptions: TravelMode[] = ['car', 'plane', 'boat'];
const remoteCalendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nonCarTravelCostAssumptions: Record<Exclude<TravelMode, 'car'>, { base: number; perMile: number; minimum: number }> = {
  plane: { base: 95, perMile: 0.22, minimum: 140 },
  boat: { base: 45, perMile: 0.75, minimum: 65 },
};
// Broad nightly assumptions for planning totals; live hotel search still shows actual nearby options.
const hotelRegionAverageNightlyRates: Record<HotelRegion, number> = {
  Northeast: 175,
  South: 135,
  Midwest: 125,
  West: 185,
};
// Broad statewide $/gal planning averages for gas price scaling; the flat gas price still applies when scaling is off.
const stateAverageGasPrices: Record<string, number> = {
  AL: 2.95,
  AK: 4.35,
  AZ: 3.45,
  AR: 2.9,
  CA: 4.75,
  CO: 3.15,
  CT: 3.45,
  DE: 3.1,
  DC: 3.35,
  FL: 3.15,
  GA: 3.0,
  HI: 4.65,
  ID: 3.45,
  IL: 3.45,
  IN: 3.2,
  IA: 3.0,
  KS: 2.95,
  KY: 3.0,
  LA: 2.9,
  ME: 3.25,
  MD: 3.2,
  MA: 3.35,
  MI: 3.25,
  MN: 3.1,
  MS: 2.85,
  MO: 2.95,
  MT: 3.35,
  NE: 3.0,
  NV: 4.05,
  NH: 3.2,
  NJ: 3.25,
  NM: 3.05,
  NY: 3.45,
  NC: 3.05,
  ND: 3.1,
  OH: 3.1,
  OK: 2.85,
  OR: 3.95,
  PA: 3.45,
  RI: 3.3,
  SC: 2.95,
  SD: 3.1,
  TN: 2.95,
  TX: 2.9,
  UT: 3.35,
  VT: 3.3,
  VA: 3.1,
  WA: 4.25,
  WV: 3.15,
  WI: 3.05,
  WY: 3.2,
};
const regionAverageGasPrices: Record<HotelRegion, number> = {
  Northeast: 3.35,
  South: 3.0,
  Midwest: 3.1,
  West: 3.95,
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
      remoteWorkDates: ['2026-07-21'],
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
          remoteWork: true,
          sleepingArrangement: 'camping',
          friendName: '',
          travelMode: 'car',
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
    travelMode: normalizeTravelMode(stop.travelMode),
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

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDateOnlyTime(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);

  return parsed.toISOString().slice(0, 10);
}

function normalizeRemoteWorkDates(value: unknown, stops: Pick<TripStop, 'date' | 'remoteWork'>[] = []) {
  const remoteWorkDates = new Set<string>();

  if (Array.isArray(value)) {
    value.forEach((date) => {
      if (isDateOnly(date)) {
        remoteWorkDates.add(date);
      }
    });
  }

  stops.forEach((stop) => {
    if (stop.remoteWork && isDateOnly(stop.date)) {
      remoteWorkDates.add(stop.date);
    }
  });

  return Array.from(remoteWorkDates).sort();
}

function applyRemoteWorkDatesToStops(stops: TripStop[], remoteWorkDates: string[]) {
  const remoteWorkDateSet = new Set(remoteWorkDates);

  return stops.map((stop) => ({
    ...stop,
    remoteWork: isDateOnly(stop.date) && remoteWorkDateSet.has(stop.date),
  }));
}

function buildTripCalendarDates(stops: TripStop[], remoteWorkDates: string[]) {
  const dates = [...stops.map((stop) => stop.date), ...remoteWorkDates].filter(isDateOnly).sort();
  if (!dates.length) return [];

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const dayCount = Math.round((getDateOnlyTime(lastDate) - getDateOnlyTime(firstDate)) / (24 * 60 * 60 * 1000)) + 1;

  if (!Number.isFinite(dayCount) || dayCount <= 0 || dayCount > 370) {
    return Array.from(new Set(dates));
  }

  return Array.from({ length: dayCount }, (_, index) => addDays(firstDate, index));
}

function normalizeSleepingArrangement(value: unknown): SleepingArrangement {
  return sleepingArrangementOptions.includes(value as SleepingArrangement)
    ? (value as SleepingArrangement)
    : 'camping';
}

function normalizeTravelMode(value: unknown): TravelMode {
  return travelModeOptions.includes(value as TravelMode) ? (value as TravelMode) : 'car';
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

function normalizeWorkspace(candidate: Partial<Workspace> | null | undefined): Workspace | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const now = new Date().toISOString();
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  if (!name) return null;

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : makeId('workspace'),
    name,
    defaultTripId: typeof candidate.defaultTripId === 'string' ? candidate.defaultTripId : '',
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  };
}

function createDefaultWorkspace(): Workspace {
  const now = new Date().toISOString();

  return {
    id: defaultWorkspaceId,
    name: 'Main workspace',
    defaultTripId: '',
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeTrip(
  candidate: Partial<Trip> | null | undefined,
  fallbackWorkspaceId = defaultWorkspaceId,
): Trip | null {
  if (!candidate || !Array.isArray(candidate.stops)) return null;

  const now = new Date().toISOString();
  const workspaceId =
    typeof candidate.workspaceId === 'string' && candidate.workspaceId
      ? candidate.workspaceId
      : fallbackWorkspaceId;
  const rawStops = candidate.stops
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
      travelMode: index === 0 ? 'car' : normalizeTravelMode(stop.travelMode),
    }));
  const remoteWorkDates = normalizeRemoteWorkDates(candidate.remoteWorkDates, rawStops);
  const remoteWorkDateSet = new Set(remoteWorkDates);
  const stops = rawStops.map((stop) => ({
    ...stop,
    remoteWork: isDateOnly(stop.date) && remoteWorkDateSet.has(stop.date),
  }));
  const stopIds = new Set(stops.map((stop) => stop.id));
  const documents = Array.isArray(candidate.documents)
    ? candidate.documents
        .map((document) => normalizeTripDocument(document, stopIds))
        .filter((document): document is TripDocument => Boolean(document))
    : [];

  return {
    id: typeof candidate.id === 'string' ? candidate.id : makeId('trip'),
    workspaceId,
    name: candidate.name?.trim() || 'Untitled trip',
    notes: typeof candidate.notes === 'string' ? candidate.notes : '',
    remoteWorkDates,
    stops: resequenceStops(stops),
    documents,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  };
}

function createDefaultTrip(workspaceId = defaultWorkspaceId): Trip {
  const now = new Date().toISOString();

  return {
    id: defaultTripId,
    workspaceId,
    name: '2026 USA itinerary',
    notes: 'Jacksonville to Winston-Salem through the Southwest, California, and the Blue Ridge.',
    remoteWorkDates: normalizeRemoteWorkDates([], seedStops),
    stops: seedStops,
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createBlankTrip(workspaceId = defaultWorkspaceId, name = 'Untitled trip'): Trip {
  const now = new Date().toISOString();

  return {
    id: makeId('trip'),
    workspaceId,
    name,
    notes: '',
    remoteWorkDates: [],
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
        travelMode: 'car',
      },
    ],
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyNewTripDraft(): NewTripDraft {
  return {
    startDate: '',
    endDate: '',
    startLocation: '',
    endLocation: '',
  };
}

function createEmptyAiModelSettings(): AiModelSettings {
  return {
    routeAssistantModel: '',
    tripStarterModel: '',
  };
}

function normalizeAiModelSettings(value: unknown): AiModelSettings {
  if (!value || typeof value !== 'object') return createEmptyAiModelSettings();

  const settings = value as Partial<AiModelSettings>;
  return {
    routeAssistantModel: typeof settings.routeAssistantModel === 'string' ? settings.routeAssistantModel : '',
    tripStarterModel: typeof settings.tripStarterModel === 'string' ? settings.tripStarterModel : '',
  };
}

function workspaceStorageKey(baseKey: string, workspaceId: string) {
  return `${baseKey}.${workspaceId}`;
}

function readWorkspaces() {
  const defaultWorkspace = createDefaultWorkspace();

  try {
    const saved = window.localStorage.getItem(workspacesKey);
    const parsed = saved ? JSON.parse(saved) : [];
    const workspaces = Array.isArray(parsed)
      ? parsed
          .map((workspace) => normalizeWorkspace(workspace))
          .filter((workspace): workspace is Workspace => Boolean(workspace))
      : [];
    const workspaceById = new Map<string, Workspace>();

    workspaces.forEach((workspace) => {
      if (!workspaceById.has(workspace.id)) {
        workspaceById.set(workspace.id, workspace);
      }
    });

    const savedDefaultWorkspace = workspaceById.get(defaultWorkspaceId);
    workspaceById.delete(defaultWorkspaceId);

    return [savedDefaultWorkspace || defaultWorkspace, ...workspaceById.values()];
  } catch {
    return [defaultWorkspace];
  }
}

function readActiveWorkspaceId(workspaces: Workspace[]) {
  try {
    const saved = window.localStorage.getItem(activeWorkspaceKey);
    const parsed = saved ? JSON.parse(saved) : '';
    if (typeof parsed === 'string' && workspaces.some((workspace) => workspace.id === parsed)) {
      return parsed;
    }
  } catch {
    // localStorage can be unavailable in private browsing or locked-down embeds.
  }

  return workspaces[0]?.id || defaultWorkspaceId;
}

function readActiveTrip(workspaceId = defaultWorkspaceId) {
  try {
    const workspaceSaved = window.localStorage.getItem(workspaceStorageKey(activeTripKey, workspaceId));
    const legacySaved = workspaceId === defaultWorkspaceId ? window.localStorage.getItem(activeTripKey) : null;
    const saved = workspaceSaved || legacySaved;

    return saved ? normalizeTrip(JSON.parse(saved), workspaceId) : null;
  } catch {
    return null;
  }
}

function readSavedTrips(workspaceId = defaultWorkspaceId) {
  try {
    const workspaceSaved = window.localStorage.getItem(workspaceStorageKey(savedTripsKey, workspaceId));
    const legacySaved = workspaceId === defaultWorkspaceId ? window.localStorage.getItem(savedTripsKey) : null;
    const saved = workspaceSaved || legacySaved;
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((trip) => normalizeTrip(trip, workspaceId))
      .filter((trip): trip is Trip => Boolean(trip))
      .filter((trip) => trip.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function findWorkspaceDefaultTrip(workspace: Workspace | undefined, trips: Trip[]) {
  if (!workspace?.defaultTripId) return null;

  return trips.find((trip) => trip.id === workspace.defaultTripId) || null;
}

function createInitialTripForWorkspace(workspaceId: string, defaultTrip: Trip | null = null) {
  return (
    readActiveTrip(workspaceId) ||
    defaultTrip ||
    (workspaceId === defaultWorkspaceId ? createDefaultTrip(workspaceId) : createBlankTrip(workspaceId))
  );
}

function getInitialWorkspaceSnapshot() {
  const workspaces = readWorkspaces();
  const activeWorkspaceId = readActiveWorkspaceId(workspaces);
  const savedTrips = readSavedTrips(activeWorkspaceId);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  return {
    workspaces,
    activeWorkspaceId,
    savedTrips,
    activeTrip: createInitialTripForWorkspace(
      activeWorkspaceId,
      findWorkspaceDefaultTrip(activeWorkspace, savedTrips),
    ),
  };
}

function readAiModelSettings() {
  try {
    const saved = window.localStorage.getItem(aiModelSettingsKey);
    return normalizeAiModelSettings(saved ? JSON.parse(saved) : null);
  } catch {
    return createEmptyAiModelSettings();
  }
}

function writeAiModelSettings(settings: AiModelSettings) {
  writeStorage(aiModelSettingsKey, normalizeAiModelSettings(settings));
}

function writeWorkspaceActiveTrip(workspaceId: string, trip: Trip) {
  writeStorage(workspaceStorageKey(activeTripKey, workspaceId), trip);
  if (workspaceId === defaultWorkspaceId) {
    removeStorage(activeTripKey);
  }
}

function writeWorkspaceSavedTrips(workspaceId: string, trips: Trip[]) {
  writeStorage(workspaceStorageKey(savedTripsKey, workspaceId), trips);
  if (workspaceId === defaultWorkspaceId) {
    removeStorage(savedTripsKey);
  }
}

function removeWorkspaceSavedTrips(workspaceId: string) {
  removeStorage(workspaceStorageKey(savedTripsKey, workspaceId));
  if (workspaceId === defaultWorkspaceId) {
    removeStorage(savedTripsKey);
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

function readBooleanStorage(key: string, fallback = false) {
  try {
    const saved = window.localStorage.getItem(key);

    return saved ? Boolean(JSON.parse(saved)) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLastAiEdit(value: unknown): LastAiEdit | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<LastAiEdit>;
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) return null;

  return {
    kind: candidate.kind === 'new-trip' ? 'new-trip' : 'route-edit',
    instruction: typeof candidate.instruction === 'string' ? candidate.instruction : '',
    summary: candidate.summary,
    at: typeof candidate.at === 'string' ? candidate.at : new Date().toISOString(),
  };
}

function readLastAiEdit() {
  try {
    const saved = window.localStorage.getItem(lastAiEditKey);

    return normalizeLastAiEdit(saved ? JSON.parse(saved) : null);
  } catch {
    return null;
  }
}

function clampMaxCarLegHours(value: number) {
  if (!Number.isFinite(value)) return defaultMaxCarLegHours;
  return Math.min(24, Math.max(1, value));
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

function sortWorkspaces(workspaces: Workspace[]) {
  return [...workspaces].sort((a, b) => {
    if (a.id === defaultWorkspaceId) return -1;
    if (b.id === defaultWorkspaceId) return 1;

    return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
  });
}

function isRecoveredWorkspace(workspace: Workspace) {
  return workspace.name.startsWith('Recovered workspace');
}

function mergeWorkspacesByFreshness(...workspaceGroups: Workspace[][]) {
  const workspacesById = new Map<string, Workspace>();
  const candidateWorkspaces = workspaceGroups.flat();
  const workspacesWithDefault = candidateWorkspaces.some((workspace) => workspace.id === defaultWorkspaceId)
    ? candidateWorkspaces
    : [createDefaultWorkspace(), ...candidateWorkspaces];

  workspacesWithDefault.forEach((workspace) => {
    const normalizedWorkspace = normalizeWorkspace(workspace);
    if (!normalizedWorkspace) return;

    const existingWorkspace = workspacesById.get(normalizedWorkspace.id);
    if (existingWorkspace && isRecoveredWorkspace(normalizedWorkspace) && !isRecoveredWorkspace(existingWorkspace)) {
      return;
    }

    if (
      !existingWorkspace ||
      (isRecoveredWorkspace(existingWorkspace) && !isRecoveredWorkspace(normalizedWorkspace)) ||
      normalizedWorkspace.updatedAt.localeCompare(existingWorkspace.updatedAt) > 0
    ) {
      workspacesById.set(normalizedWorkspace.id, normalizedWorkspace);
    }
  });

  return sortWorkspaces([...workspacesById.values()]);
}

function createRecoveredWorkspaceFromTrip(trip: Trip): Workspace {
  const now = new Date().toISOString();
  const suffix = trip.workspaceId.replace(/^workspace-/, '').slice(0, 8);

  return {
    id: trip.workspaceId,
    name: trip.workspaceId === defaultWorkspaceId
      ? 'Main workspace'
      : `Recovered workspace${suffix ? ` ${suffix}` : ''}`,
    defaultTripId: '',
    createdAt: trip.createdAt || now,
    updatedAt: trip.updatedAt || now,
  };
}

function addMissingWorkspacesFromTrips(workspaces: Workspace[], trips: Trip[]) {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  trips.forEach((trip) => {
    if (workspacesById.has(trip.workspaceId)) return;
    workspacesById.set(trip.workspaceId, createRecoveredWorkspaceFromTrip(trip));
  });

  return sortWorkspaces([...workspacesById.values()]);
}

function workspacesMatch(first: Workspace[], second: Workspace[]) {
  if (first.length !== second.length) return false;

  return first.every((workspace, index) => {
    const otherWorkspace = second[index];

    return (
      otherWorkspace &&
      workspace.id === otherWorkspace.id &&
      workspace.name === otherWorkspace.name &&
      workspace.defaultTripId === otherWorkspace.defaultTripId &&
      workspace.createdAt === otherWorkspace.createdAt &&
      workspace.updatedAt === otherWorkspace.updatedAt
    );
  });
}

function sortTripsByUpdatedAt(trips: Trip[]) {
  return [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mergeTripsByFreshness(...tripGroups: Trip[][]) {
  const tripsById = new Map<string, Trip>();

  tripGroups.flat().forEach((trip) => {
    const normalizedTrip = normalizeTrip(trip, trip.workspaceId || defaultWorkspaceId);
    if (!normalizedTrip) return;

    const existingTrip = tripsById.get(normalizedTrip.id);
    if (!existingTrip || normalizedTrip.updatedAt.localeCompare(existingTrip.updatedAt) > 0) {
      tripsById.set(normalizedTrip.id, normalizedTrip);
    }
  });

  return sortTripsByUpdatedAt([...tripsById.values()]);
}

function filterTripsForWorkspace(trips: Trip[], workspaceId: string) {
  return sortTripsByUpdatedAt(trips.filter((trip) => trip.workspaceId === workspaceId));
}

async function fetchWorkspacesFromDatabase() {
  const response = await fetch('/api/workspaces', {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`GET_WORKSPACES_${response.status}`);
  }

  const workspaces = await response.json();
  if (!Array.isArray(workspaces)) {
    throw new Error('INVALID_WORKSPACES_RESPONSE');
  }

  return sortWorkspaces(
    workspaces
      .map((workspace) => normalizeWorkspace(workspace))
      .filter((workspace): workspace is Workspace => Boolean(workspace)),
  );
}

async function saveWorkspaceToDatabase(workspace: Workspace) {
  const normalizedWorkspace = normalizeWorkspace(workspace);
  if (!normalizedWorkspace) {
    throw new Error('INVALID_WORKSPACE');
  }

  const response = await fetch(`/api/workspaces/${encodeURIComponent(normalizedWorkspace.id)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(normalizedWorkspace),
  });

  if (!response.ok) {
    throw new Error(`SAVE_WORKSPACE_${response.status}`);
  }

  const savedWorkspace = normalizeWorkspace(await response.json());
  if (!savedWorkspace) {
    throw new Error('INVALID_SAVED_WORKSPACE_RESPONSE');
  }

  return savedWorkspace;
}

async function deleteWorkspaceFromDatabase(workspaceId: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`DELETE_WORKSPACE_${response.status}`);
  }
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

  const savedTrip = normalizeTrip(await response.json(), trip.workspaceId);
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

async function requestOpenAIModels(): Promise<OpenAIModelOption[]> {
  const response = await fetch('/api/openai-models', {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`OPENAI_MODELS_${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.models)) {
    throw new Error('INVALID_OPENAI_MODELS_RESPONSE');
  }

  return payload.models
    .map((model: Partial<OpenAIModelOption>) => ({
      id: typeof model.id === 'string' ? model.id : '',
      ownedBy: typeof model.ownedBy === 'string' ? model.ownedBy : '',
      created: Number.isFinite(Number(model.created)) ? Number(model.created) : 0,
    }))
    .filter((model: OpenAIModelOption) => model.id);
}

function trimRouteAssistantContext(messages: RouteAssistantContextMessage[]) {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content)
    .slice(-maxRouteAssistantContextMessages);
}

async function requestRouteAssistant(
  trip: Trip,
  instruction: string,
  settings: RouteAssistantSettings,
  contextMessages: RouteAssistantContextMessage[] = [],
): Promise<RouteAssistantResult> {
  const response = await fetch('/api/route-assistant', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      trip,
      instruction,
      settings,
      contextMessages: trimRouteAssistantContext(contextMessages),
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      let retryAfterSeconds = Number(response.headers.get('retry-after'));
      try {
        const payload = await response.json();
        retryAfterSeconds = Number(payload.retryAfterSeconds) || retryAfterSeconds;
      } catch {
        // Keep the Retry-After header fallback.
      }

      throw new Error(`ROUTE_ASSISTANT_RATE_LIMITED_${Math.max(1, Math.ceil(retryAfterSeconds || 30))}`);
    }

    throw new Error(`ROUTE_ASSISTANT_${response.status}`);
  }

  const result = await response.json();
  const proposedTrip = normalizeTrip(result.trip, trip.workspaceId);
  if (!proposedTrip || typeof result.summary !== 'string') {
    throw new Error('INVALID_ROUTE_ASSISTANT_RESPONSE');
  }

  return {
    summary: result.summary,
    trip: proposedTrip,
  };
}

async function requestTripStarter(
  instruction: string,
  settings: RouteAssistantSettings,
  workspaceId = defaultWorkspaceId,
): Promise<RouteAssistantResult> {
  const response = await fetch('/api/trip-starter', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ instruction, settings }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      let retryAfterSeconds = Number(response.headers.get('retry-after'));
      try {
        const payload = await response.json();
        retryAfterSeconds = Number(payload.retryAfterSeconds) || retryAfterSeconds;
      } catch {
        // Keep the Retry-After header fallback.
      }

      throw new Error(`TRIP_STARTER_RATE_LIMITED_${Math.max(1, Math.ceil(retryAfterSeconds || 30))}`);
    }

    throw new Error(`TRIP_STARTER_${response.status}`);
  }

  const result = await response.json();
  const proposedTrip = normalizeTrip(result.trip, workspaceId);
  if (!proposedTrip || typeof result.summary !== 'string') {
    throw new Error('INVALID_TRIP_STARTER_RESPONSE');
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
    trip: normalizeTrip(trip, trip.workspaceId) || trip,
  };
}

function createSharedTripExport(trip: Trip): ExportedTrip {
  const normalizedTrip = normalizeTrip(
    {
      ...trip,
      documents: [],
    },
    trip.workspaceId,
  ) || {
    ...trip,
    documents: [],
  };

  return {
    format: tripExportFormat,
    exportedAt: new Date().toISOString(),
    trip: normalizedTrip,
  };
}

function createCompactSharedTrip(trip: Trip): CompactSharedTrip {
  const normalizedTrip = normalizeTrip(
    {
      ...trip,
      documents: [],
    },
    trip.workspaceId,
  ) || {
    ...trip,
    documents: [],
  };

  return {
    f: compactTripShareFormat,
    n: normalizedTrip.name,
    o: normalizedTrip.notes || undefined,
    r: normalizedTrip.remoteWorkDates.length ? normalizedTrip.remoteWorkDates : undefined,
    s: normalizedTrip.stops.map((stop) => {
      const fields: CompactSharedTripStop = [
        stop.date,
        stop.label,
        roundPosition({ lat: stop.lat, lng: stop.lng }, 5).lat,
        roundPosition({ lat: stop.lat, lng: stop.lng }, 5).lng,
      ];
      const optionals: CompactSharedTripStop[number][] = [
        stop.notes || '',
        stop.remoteWork ? 1 : 0,
        stop.sleepingArrangement === 'camping' ? '' : stop.sleepingArrangement,
        stop.friendName || '',
        stop.travelMode === 'car' ? '' : stop.travelMode,
      ];

      while (optionals.length) {
        const lastValue = optionals[optionals.length - 1];
        if (lastValue !== '' && lastValue !== 0) break;
        optionals.pop();
      }

      return [...fields, ...optionals] as CompactSharedTripStop;
    }),
  };
}

function parseCompactSharedTrip(candidate: unknown, workspaceId = defaultWorkspaceId) {
  if (!candidate || typeof candidate !== 'object') return null;

  const compactTrip = candidate as Partial<CompactSharedTrip>;
  if (compactTrip.f !== compactTripShareFormat || !Array.isArray(compactTrip.s)) return null;

  const now = new Date().toISOString();
  const compactStops = compactTrip.s.filter((stop): stop is CompactSharedTripStop => Array.isArray(stop));
  if (!compactStops.length) return null;

  return normalizeTrip(
    {
      id: makeId('trip'),
      workspaceId,
      name: typeof compactTrip.n === 'string' && compactTrip.n ? compactTrip.n : 'Shared route',
      notes: typeof compactTrip.o === 'string' ? compactTrip.o : '',
      remoteWorkDates: normalizeRemoteWorkDates(compactTrip.r),
      documents: [],
      stops: compactStops.map((stop, index) => ({
        id: makeId('stop'),
        order: index + 1,
        date: typeof stop[0] === 'string' ? stop[0] : '',
        label: typeof stop[1] === 'string' ? stop[1] : 'Shared stop',
        lat: Number(stop[2]),
        lng: Number(stop[3]),
        notes: typeof stop[4] === 'string' ? stop[4] : '',
        remoteWork: stop[5] === 1,
        sleepingArrangement: normalizeSleepingArrangement(stop[6]),
        friendName: typeof stop[7] === 'string' ? stop[7] : '',
        travelMode: normalizeTravelMode(stop[8]),
      })),
      createdAt: now,
      updatedAt: now,
    },
    workspaceId,
  );
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(paddedBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function parseTripImport(candidate: unknown, workspaceId = defaultWorkspaceId) {
  if (!candidate || typeof candidate !== 'object') return null;

  if (Array.isArray(candidate)) {
    const now = new Date().toISOString();
    return normalizeTrip({
      id: makeId('trip'),
      workspaceId,
      name: 'Imported itinerary',
      notes: 'Imported from a raw stop list.',
      stops: candidate,
      createdAt: now,
      updatedAt: now,
    });
  }

  const compactTrip = parseCompactSharedTrip(candidate, workspaceId);
  if (compactTrip) return compactTrip;

  const exportedTrip = candidate as Partial<ExportedTrip>;
  if (exportedTrip.format !== tripExportFormat) return null;
  if (typeof exportedTrip.exportedAt !== 'string') return null;

  return normalizeTrip(
    {
      ...(exportedTrip.trip || {}),
      workspaceId,
    },
    workspaceId,
  );
}

function createEncodedTripShareUrl(trip: Trip) {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams();

  url.searchParams.delete(savedRouteParam);
  url.searchParams.delete(shortTripShareParam);
  url.searchParams.delete(compactTripShareParam);
  url.searchParams.delete(legacyTripShareParam);
  hashParams.set(compactTripShareParam, encodeBase64Url(JSON.stringify(createCompactSharedTrip(trip))));
  url.hash = hashParams.toString();

  return url.toString();
}

function createSavedRouteToken(name: string) {
  return sanitizeFileName(name).slice(0, 96) || 'road-trip';
}

function savedRouteTokenMatchesTrip(token: string, trip: Pick<Trip, 'id' | 'name'>) {
  const routeToken = createSavedRouteToken(trip.name);

  return token === routeToken || token === trip.id || token === `${routeToken}-${trip.id}` || token.endsWith(`-${trip.id}`);
}

function hasSavedRouteTokenConflict(trip: Pick<Trip, 'id' | 'name'>, trips: Array<Pick<Trip, 'id' | 'name'>>) {
  const routeToken = createSavedRouteToken(trip.name);

  return trips.some((savedTrip) => savedTrip.id !== trip.id && createSavedRouteToken(savedTrip.name) === routeToken);
}

function createSavedRouteTokenForTrip(trip: Pick<Trip, 'id' | 'name'>, trips: Array<Pick<Trip, 'id' | 'name'>> = []) {
  const routeToken = createSavedRouteToken(trip.name);

  return hasSavedRouteTokenConflict(trip, trips) ? `${routeToken}-${trip.id}` : routeToken;
}

function createUniqueSavedTripName(name: string, trips: Array<Pick<Trip, 'name'>>) {
  const baseName = name.trim() || 'Untitled trip';
  const copyBaseName = `${baseName} copy`;
  const usedRouteTokens = new Set(trips.map((trip) => createSavedRouteToken(trip.name)));
  let candidate = copyBaseName;
  let copyNumber = 2;

  while (usedRouteTokens.has(createSavedRouteToken(candidate))) {
    candidate = `${copyBaseName} ${copyNumber}`;
    copyNumber += 1;
  }

  return candidate;
}

function extractShareIdFromToken(token: string) {
  return token.trim();
}

function safeDecodeUrlPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function createShortTripShareUrl(shareId: string) {
  return new URL(`${sharePathPrefix}${encodeURIComponent(shareId)}`, window.location.origin).toString();
}

async function createServerTripShare(trip: Trip) {
  const response = await fetch('/api/shared-trips', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(createSharedTripExport(trip)),
  });

  if (!response.ok) {
    if (response.status === 409) {
      let slug = '';
      try {
        const payload = await response.json();
        slug = typeof payload.slug === 'string' ? payload.slug : '';
      } catch {
        slug = '';
      }

      throw new Error(`CREATE_SHARED_TRIP_DUPLICATE_${slug || sanitizeFileName(trip.name)}`);
    }

    throw new Error(`CREATE_SHARED_TRIP_${response.status}`);
  }

  const result = (await response.json()) as Partial<SharedTripResponse>;
  if (typeof result.id !== 'string' || !result.id) {
    throw new Error('INVALID_SHARED_TRIP_RESPONSE');
  }

  return result.id;
}

async function fetchServerTripShare(shareId: string, workspaceId = defaultWorkspaceId) {
  const response = await fetch(`/api/shared-trips/${encodeURIComponent(shareId)}`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`GET_SHARED_TRIP_${response.status}`);
  }

  return parseTripImport(await response.json(), workspaceId);
}

function getSavedRouteIdFromUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashRoute = hashParams.get(savedRouteParam);
  if (hashRoute) return hashRoute;

  return new URLSearchParams(window.location.search).get(savedRouteParam) || '';
}

function isAiSettingsPath() {
  return window.location.pathname.toLowerCase() === aiSettingsPath.toLowerCase();
}

function isWorkspacesPath() {
  return window.location.pathname.toLowerCase() === workspacesPath.toLowerCase();
}

function getInitialAppView(): AppView {
  if (isAiSettingsPath()) return 'ai';
  if (isWorkspacesPath()) return 'workspaces';
  return 'editor';
}

function clearAppViewPath(replace = false) {
  if (!isAiSettingsPath() && !isWorkspacesPath()) return;

  if (replace) {
    window.history.replaceState(null, '', '/');
  } else {
    window.history.pushState(null, '', '/');
  }
}

function setSavedRouteUrl(trip: Pick<Trip, 'id' | 'name'>, trips: Array<Pick<Trip, 'id' | 'name'>> = [], replace = false) {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));

  [shortTripShareParam, compactTripShareParam, legacyTripShareParam].forEach((param) => {
    hashParams.delete(param);
    url.searchParams.delete(param);
  });
  hashParams.set(savedRouteParam, createSavedRouteTokenForTrip(trip, trips));
  url.searchParams.delete(savedRouteParam);

  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ''}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextUrl === currentUrl) return;

  if (replace) {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
}

function clearSavedRouteUrl(replace = false) {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  let changed = false;

  if (hashParams.has(savedRouteParam)) {
    hashParams.delete(savedRouteParam);
    changed = true;
  }

  if (url.searchParams.has(savedRouteParam)) {
    url.searchParams.delete(savedRouteParam);
    changed = true;
  }

  if (!changed) return;

  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ''}`;

  if (replace) {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
}

function getTripShareSourceFromUrl(): TripShareSource | null {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashShare = hashParams.get(shortTripShareParam);
  if (hashShare) return { kind: 'server', id: extractShareIdFromToken(hashShare) };

  const pathShare = window.location.pathname.startsWith(sharePathPrefix)
    ? safeDecodeUrlPart(window.location.pathname.slice(sharePathPrefix.length).split('/')[0] || '')
    : '';
  if (pathShare) return { kind: 'server', id: extractShareIdFromToken(pathShare) };

  const searchParams = new URLSearchParams(window.location.search);
  const queryShare = searchParams.get(shortTripShareParam);
  if (queryShare) return { kind: 'server', id: extractShareIdFromToken(queryShare) };

  const compactPayload = hashParams.get(compactTripShareParam) || searchParams.get(compactTripShareParam);
  if (compactPayload) return { kind: 'payload', payload: compactPayload };

  const legacyPayload = hashParams.get(legacyTripShareParam) || searchParams.get(legacyTripShareParam);
  return legacyPayload ? { kind: 'payload', payload: legacyPayload } : null;
}

function clearTripSharePayloadFromUrl() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  let changed = false;

  [savedRouteParam, shortTripShareParam, compactTripShareParam, legacyTripShareParam].forEach((param) => {
    if (hashParams.has(param)) {
      hashParams.delete(param);
      changed = true;
    }

    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  });

  if (url.pathname.startsWith(sharePathPrefix)) {
    url.pathname = '/';
    changed = true;
  }

  if (!changed) return;

  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
}

function parseEncodedTripSharePayload(payload: string, workspaceId = defaultWorkspaceId) {
  const decoded = JSON.parse(decodeBase64Url(payload));
  const importedTrip = parseCompactSharedTrip(decoded, workspaceId) || parseTripImport(decoded, workspaceId);
  if (!importedTrip) return null;

  const now = new Date().toISOString();
  return normalizeTrip(
    {
      ...importedTrip,
      id: makeId('trip'),
      workspaceId,
      documents: [],
      createdAt: now,
      updatedAt: now,
    },
    workspaceId,
  );
}

async function loadTripShareFromUrl(workspaceId = defaultWorkspaceId) {
  const source = getTripShareSourceFromUrl();
  if (!source) return null;

  try {
    const importedTrip =
      source.kind === 'server'
        ? await fetchServerTripShare(source.id, workspaceId)
        : parseEncodedTripSharePayload(source.payload, workspaceId);
    if (!importedTrip) return null;

    const now = new Date().toISOString();
    return normalizeTrip(
      {
        ...importedTrip,
        id: makeId('trip'),
        workspaceId,
        documents: [],
        createdAt: now,
        updatedAt: now,
      },
      workspaceId,
    );
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string) {
  const fileName = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return fileName || 'road-trip';
}

function parseLocationCoordinates(value: string): google.maps.LatLngLiteral | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

async function resolveNewTripLocation(
  label: string,
  fallbackPosition: google.maps.LatLngLiteral,
) {
  const trimmedLabel = label.trim();
  const coordinatePosition = parseLocationCoordinates(trimmedLabel);
  if (coordinatePosition) {
    return {
      label: trimmedLabel,
      position: coordinatePosition,
      resolved: true,
    };
  }

  if (typeof google === 'undefined' || !google.maps?.Geocoder) {
    return {
      label: trimmedLabel,
      position: fallbackPosition,
      resolved: false,
    };
  }

  try {
    const geocoder = new google.maps.Geocoder();
    const result = await geocoder.geocode({ address: trimmedLabel });
    const location = result.results[0]?.geometry?.location;

    if (!location) throw new Error('NO_GEOCODE_RESULT');

    return {
      label: trimmedLabel,
      position: roundPosition({ lat: location.lat(), lng: location.lng() }, 6),
      resolved: true,
    };
  } catch {
    return {
      label: trimmedLabel,
      position: fallbackPosition,
      resolved: false,
    };
  }
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
  if (!stop) return 'Whole trip';

  const dayNumber = getStopDayNumber(stop, stops);
  return dayNumber === null ? stop.label : `Day ${dayNumber}: ${stop.label}`;
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

function getTripStartDate(stops: TripStop[]) {
  const dates = stops.map((stop) => stop.date).filter(isDateOnly).sort();

  return dates[0] || '';
}

function getStopDayNumber(stop: Pick<TripStop, 'date'>, stops: TripStop[]) {
  const startDate = getTripStartDate(stops);
  if (!startDate || !isDateOnly(stop.date)) return null;

  return Math.round((getDateOnlyTime(stop.date) - getDateOnlyTime(startDate)) / 86400000) + 1;
}

function formatStopDayLabel(stop: TripStop, stops: TripStop[]) {
  const dayNumber = getStopDayNumber(stop, stops);

  return dayNumber === null ? 'Unscheduled' : `Day ${dayNumber}`;
}

function formatStopDayBadge(stop: TripStop, stops: TripStop[]) {
  const dayNumber = getStopDayNumber(stop, stops);

  return dayNumber === null ? '–' : String(dayNumber);
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

function formatCalendarDayNumber(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';

  return String(parsed.getDate());
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

function formatMapDayRange(groupStops: TripStop[], allStops: TripStop[]) {
  const dayNumbers = Array.from(
    new Set(
      groupStops
        .map((stop) => getStopDayNumber(stop, allStops))
        .filter((dayNumber): dayNumber is number => dayNumber !== null),
    ),
  ).sort((first, second) => first - second);
  if (!dayNumbers.length) return '';

  const first = dayNumbers[0];
  const last = dayNumbers[dayNumbers.length - 1];
  const isConsecutive = dayNumbers.every((dayNumber, index) => index === 0 || dayNumber === dayNumbers[index - 1] + 1);

  if (first === last) return String(first);
  return isConsecutive ? `${first}-${last}` : dayNumbers.join(', ');
}

function formatMapGroupHeading(stops: TripStop[]) {
  const labels = Array.from(new Set(stops.map((stop) => stop.label)));
  if (labels.length === 1) return labels[0];

  return `${labels[0]} + ${labels.length - 1} more`;
}

function normalizeMapMarkerLabelMode(value: unknown): MapMarkerLabelMode {
  return value === 'date' ? 'date' : 'day';
}

function readMapMarkerLabelMode(): MapMarkerLabelMode {
  try {
    const saved = window.localStorage.getItem(mapMarkerLabelModeKey);

    return normalizeMapMarkerLabelMode(saved ? JSON.parse(saved) : null);
  } catch {
    return 'day';
  }
}

function getMapMarkerLabel(group: MapStopGroup, markerLabelMode: MapMarkerLabelMode) {
  if (markerLabelMode === 'date') {
    const hasDates = group.stops.some((stop) => isDateOnly(stop.date));

    return hasDates ? group.dateRangeLabel : '–';
  }

  return group.dayRangeLabel || '–';
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

function estimateRoadMiles(previous: google.maps.LatLngLiteral, next: google.maps.LatLngLiteral) {
  return calculatePointMiles(previous, next) * 1.2;
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
    if (next.travelMode !== 'car') continue;

    const distanceMiles = estimateRoadMiles(previous, next);

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

function getTravelModeLabel(value: TravelMode) {
  switch (value) {
    case 'plane':
      return 'Plane';
    case 'boat':
      return 'Boat';
    default:
      return 'Car';
  }
}

function getTravelLegMiles(stops: TripStop[], stopIndex: number) {
  const previous = stops[stopIndex - 1];
  const stop = stops[stopIndex];
  if (!previous || !stop) return 0;

  return Math.round(calculatePointMiles(previous, stop));
}

function calculateNonCarTravelLegCost(stops: TripStop[], stopIndex: number) {
  const stop = stops[stopIndex];
  if (!stop || stop.travelMode === 'car') return 0;

  const assumptions = nonCarTravelCostAssumptions[stop.travelMode];
  const miles = getTravelLegMiles(stops, stopIndex);

  return Math.max(assumptions.minimum, assumptions.base + miles * assumptions.perMile);
}

function calculateNonCarTravelCost(stops: TripStop[]) {
  return stops.reduce((total, _stop, index) => total + calculateNonCarTravelLegCost(stops, index), 0);
}

function countNonCarTravelLegs(stops: TripStop[]) {
  return stops.filter((stop, index) => index > 0 && stop.travelMode !== 'car').length;
}

function getCarLegDayEstimate(
  stop: TripStop,
  stopIndex: number,
  stops: TripStop[],
  driveEstimate: DriveEstimate | undefined,
  maxCarLegHours: number,
) {
  if (stopIndex <= 0 || stop.travelMode !== 'car') return null;

  const previous = stops[stopIndex - 1];
  if (!previous) return null;

  const distanceMiles = driveEstimate?.distanceMiles ?? estimateRoadMiles(previous, stop);
  const durationMinutes = driveEstimate?.durationMinutes ?? estimateDriveMinutes(distanceMiles);
  const maxCarLegMinutes = Math.round(clampMaxCarLegHours(maxCarLegHours) * 60);

  return {
    distanceMiles,
    durationMinutes,
    isTraversableInDay: durationMinutes <= maxCarLegMinutes,
  };
}

function getCarLegDayWarning(
  stop: TripStop,
  stopIndex: number,
  stops: TripStop[],
  driveEstimate: DriveEstimate | undefined,
  maxCarLegHours: number,
) {
  const estimate = getCarLegDayEstimate(stop, stopIndex, stops, driveEstimate, maxCarLegHours);
  if (!estimate || estimate.isTraversableInDay) return '';

  return `Long car day: ${Math.round(estimate.distanceMiles).toLocaleString()} mi / ${formatDriveDuration(
    estimate.durationMinutes,
  )}. Max is ${clampMaxCarLegHours(maxCarLegHours)}h; add an overnight stop or switch this leg to plane/boat.`;
}

function countOverlongCarLegs(
  stops: TripStop[],
  driveEstimateByStopId: Map<string, DriveEstimate>,
  maxCarLegHours: number,
) {
  return stops.filter((stop, index) => {
    const estimate = getCarLegDayEstimate(
      stop,
      index,
      stops,
      driveEstimateByStopId.get(stop.id),
      maxCarLegHours,
    );
    return Boolean(estimate && !estimate.isTraversableInDay);
  }).length;
}

function formatTravelLegSummary(
  stop: TripStop,
  stopIndex: number,
  stops: TripStop[],
  driveEstimate: DriveEstimate | undefined,
  gasPrice: number,
  fuelMpg: number,
  scaleGasPriceByStop = false,
) {
  if (stopIndex === 0) return 'Starting point';

  if (stop.travelMode === 'car') {
    const previous = stops[stopIndex - 1];
    const legGasPrice = scaleGasPriceByStop && previous ? getLegGasPrice(previous, stop) : gasPrice;
    if (driveEstimate) return formatDriveSummary(driveEstimate, legGasPrice, fuelMpg);

    const distanceMiles = previous ? estimateRoadMiles(previous, stop) : 0;
    return formatDriveSummary(
      {
        fromStopId: previous?.id || '',
        toStopId: stop.id,
        distanceMiles,
        durationMinutes: estimateDriveMinutes(distanceMiles),
        source: 'estimated',
      },
      legGasPrice,
      fuelMpg,
    );
  }

  const miles = getTravelLegMiles(stops, stopIndex);
  const cost = calculateNonCarTravelLegCost(stops, stopIndex);

  return `${getTravelModeLabel(stop.travelMode)} from previous: Est. ${miles.toLocaleString()} mi | ${formatCurrency(
    cost,
  )} travel`;
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
  return estimates.map(({ fromStopId, toStopId, distanceMiles, durationMinutes, source }) => ({
    fromStopId,
    toStopId,
    distanceMiles,
    durationMinutes,
    source,
  }));
}

function buildCachedDriveEstimates(routeLegs: CachedRouteLeg[], stops: TripStop[]) {
  const stopIds = new Set(stops.map((stop) => stop.id));

  return routeLegs.filter(
    (leg): leg is DriveEstimate =>
      stopIds.has(leg.fromStopId) &&
      stopIds.has(leg.toStopId) &&
      Number.isFinite(leg.distanceMiles) &&
      Number.isFinite(leg.durationMinutes) &&
      (leg.source === 'road' || leg.source === 'estimated'),
  );
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
  if (!cachedRoute || cachedRoute.version !== 2) return null;
  if (!Array.isArray(cachedRoute.routePaths) || !Array.isArray(cachedRoute.routeLegs)) return null;
  if (cachedRoute.routeLegs.length !== getCarLegCount(stops)) return null;

  const routePaths = cachedRoute.routePaths
    .map((routePath) => (Array.isArray(routePath) ? routePath.filter(isPosition).map((position) => roundPosition(position)) : []))
    .filter((routePath) => routePath.length > 1);

  if (!routePaths.length) return null;
  const driveEstimates = buildCachedDriveEstimates(cachedRoute.routeLegs, stops);
  if (driveEstimates.length !== getCarLegCount(stops)) return null;

  return {
    routePaths,
    distanceMiles: Number.isFinite(cachedRoute.distanceMiles) ? cachedRoute.distanceMiles : null,
    driveEstimates,
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
      version: 2,
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

function getStopGasPrice(stop: Pick<TripStop, 'label' | 'lat' | 'lng'>) {
  const state = extractStateAbbreviation(stop.label);
  if (state && state in stateAverageGasPrices) return stateAverageGasPrices[state];

  return regionAverageGasPrices[getHotelRegion(stop)];
}

function getLegGasPrice(fromStop: TripStop, toStop: TripStop) {
  return (getStopGasPrice(fromStop) + getStopGasPrice(toStop)) / 2;
}

function getCarLegGasPrices(stops: TripStop[]) {
  const prices: number[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index].travelMode !== 'car') continue;
    prices.push(getLegGasPrice(stops[index - 1], stops[index]));
  }

  return prices;
}

function createGasPriceColor(minPrice: number, maxPrice: number) {
  return (price: number) => {
    if (!Number.isFinite(price)) return defaultRouteColor;

    const spread = maxPrice - minPrice;
    const ratio = spread < 0.005 ? 0.5 : (maxPrice - price) / spread;

    return `hsl(${Math.round(ratio * 120)}, 82%, 40%)`;
  };
}

function buildStraightGasLegSegments(stops: TripStop[]): GasLegSegment[] {
  const segments: GasLegSegment[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1];
    const to = stops[index];

    segments.push({
      fromStopId: from.id,
      toStopId: to.id,
      path: [
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      ],
      gasPrice: to.travelMode === 'car' ? getLegGasPrice(from, to) : Number.NaN,
    });
  }

  return segments;
}

function findNearestRoutePathIndex(routePath: google.maps.LatLngLiteral[], position: google.maps.LatLngLiteral) {
  let index = 0;
  let miles = Number.POSITIVE_INFINITY;

  routePath.forEach((point, pointIndex) => {
    const pointMiles = calculatePointMiles(point, position);
    if (pointMiles < miles) {
      miles = pointMiles;
      index = pointIndex;
    }
  });

  return { index, miles };
}

// Road paths come back per directions chunk, not per leg, so slice each car leg out of
// the nearest chunk path; fall back to a straight segment when no slice matches.
function buildRoadGasLegSegments(
  routePaths: google.maps.LatLngLiteral[][],
  stops: TripStop[],
): GasLegSegment[] {
  const segments: GasLegSegment[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1];
    const to = stops[index];
    if (to.travelMode !== 'car') continue;

    let best: { path: google.maps.LatLngLiteral[]; score: number } | null = null;
    for (const routePath of routePaths) {
      if (routePath.length < 2) continue;

      const fromNearest = findNearestRoutePathIndex(routePath, from);
      const toNearest = findNearestRoutePathIndex(routePath, to);
      if (fromNearest.index >= toNearest.index) continue;

      const score = fromNearest.miles + toNearest.miles;
      if (!best || score < best.score) {
        best = { path: routePath.slice(fromNearest.index, toNearest.index + 1), score };
      }
    }

    segments.push({
      fromStopId: from.id,
      toStopId: to.id,
      path:
        best && best.score <= 25
          ? best.path
          : [
              { lat: from.lat, lng: from.lng },
              { lat: to.lat, lng: to.lng },
            ],
      gasPrice: getLegGasPrice(from, to),
    });
  }

  return segments;
}

function formatGasPricePerGallon(value: number) {
  return `$${value.toFixed(2)}/gal`;
}

function calculateTripGasCost(
  stops: TripStop[],
  driveEstimates: DriveEstimate[],
  totalMiles: number,
  gasPrice: number,
  fuelMpg: number,
  scaleGasPriceByStop: boolean,
) {
  if (!scaleGasPriceByStop) return calculateGasCost(totalMiles, gasPrice, fuelMpg);

  const stopById = new Map(stops.map((stop) => [stop.id, stop]));

  return driveEstimates.reduce((total, estimate) => {
    const fromStop = stopById.get(estimate.fromStopId);
    const toStop = stopById.get(estimate.toStopId);
    const legGasPrice = fromStop && toStop ? getLegGasPrice(fromStop, toStop) : gasPrice;

    return total + calculateGasCost(estimate.distanceMiles, legGasPrice, fuelMpg);
  }, 0);
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
      dayRangeLabel: formatMapDayRange(sortedStops, stops),
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
  return stops
    .map((stop, index) => `${index === 0 ? 'car' : stop.travelMode}:${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`)
    .join('|');
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
    website: typeof place.websiteURI === 'string' ? place.websiteURI : '',
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
    website: typeof candidate.website === 'string' ? candidate.website : '',
    searchLabel: searchPoint.label,
    distanceFromSearchMiles,
    score: scoreHotelCandidate(priceLevel, rating, userRatingsTotal, distanceFromSearchMiles),
  };
}

// Spread hotel picks along the trip: at most two per search point instead of one global ranking.
function pickDistributedHotelCandidates(candidates: HotelCandidate[], maxCount: number) {
  const rankedBySearchPoint = new Map<string, HotelCandidate[]>();

  [...candidates]
    .sort((first, second) => second.score - first.score)
    .forEach((candidate) => {
      const list = rankedBySearchPoint.get(candidate.searchLabel) || [];
      list.push(candidate);
      rankedBySearchPoint.set(candidate.searchLabel, list);
    });

  const picked: HotelCandidate[] = [];
  for (let round = 0; round < 2 && picked.length < maxCount; round += 1) {
    for (const rankedCandidates of rankedBySearchPoint.values()) {
      if (picked.length >= maxCount) break;

      const candidate = rankedCandidates[round];
      if (candidate) picked.push(candidate);
    }
  }

  return picked.sort((first, second) => second.score - first.score);
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
      'websiteURI',
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
  let chunk: TripStop[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const stop = stops[index];

    if (stop.travelMode !== 'car') {
      if (chunk.length > 1) chunks.push(chunk);
      chunk = [];
      continue;
    }

    if (!chunk.length || chunk[chunk.length - 1].id !== previous.id) {
      if (chunk.length > 1) chunks.push(chunk);
      chunk = [previous];
    }

    chunk.push(stop);

    if (chunk.length === maxStopsPerDirectionsRequest) {
      chunks.push(chunk);
      chunk = [stop];
    }
  }

  if (chunk.length > 1) chunks.push(chunk);

  return chunks;
}

function getCarLegCount(stops: TripStop[]) {
  return stops.filter((stop, index) => index > 0 && stop.travelMode === 'car').length;
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

async function requestRoadRoutes(routeLibrary: RoadRoutesLibrary, routeChunks: TripStop[][]) {
  const routes: RoadRoute[] = [];

  for (const chunk of routeChunks) {
    routes.push(await requestRoadRoute(routeLibrary, chunk));
  }

  return routes;
}

function isRouteQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|ComputeRoutesRequestsPerDay|quota/i.test(message);
}

function hasRememberedRouteQuotaExhaustion() {
  const quotaExhaustedUntil = readNumberStorage(routeQuotaExhaustedUntilKey, 0);

  if (quotaExhaustedUntil > Date.now()) return true;
  if (quotaExhaustedUntil) removeStorage(routeQuotaExhaustedUntilKey);
  return false;
}

function rememberRouteQuotaExhaustion() {
  writeStorage(routeQuotaExhaustedUntilKey, Date.now() + routeQuotaCooldownMs);
}

function getRouteQuotaFallbackMessage() {
  return 'Routes API daily quota reached; using estimated path without more API calls.';
}

function formatRouteFallbackMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (isRouteQuotaError(error)) return getRouteQuotaFallbackMessage();
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
  const shareImportHandledRef = useRef(false);
  const savedRouteUrlIdRef = useRef(getSavedRouteIdFromUrl());
  const pendingDefaultTripRef = useRef<{ workspaceId: string; tripId: string } | null>(null);
  const initialWorkspaceSnapshotRef = useRef<ReturnType<typeof getInitialWorkspaceSnapshot> | null>(null);
  if (!initialWorkspaceSnapshotRef.current) {
    initialWorkspaceSnapshotRef.current = getInitialWorkspaceSnapshot();
  }

  const initialWorkspaceSnapshot = initialWorkspaceSnapshotRef.current;
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaceSnapshot.workspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(initialWorkspaceSnapshot.activeWorkspaceId);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [savedTrips, setSavedTrips] = useState<Trip[]>(initialWorkspaceSnapshot.savedTrips);
  const [activeTrip, setActiveTrip] = useState<Trip>(initialWorkspaceSnapshot.activeTrip);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(
    () => activeTrip.stops[0]?.id || null,
  );
  const [fitSignal, setFitSignal] = useState(0);
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [showHotelFinder, setShowHotelFinder] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>(() => getInitialAppView());
  const [saveMessage, setSaveMessage] = useState('');
  const [routeAssistantPrompt, setRouteAssistantPrompt] = useState('');
  const [routeAssistantMessage, setRouteAssistantMessage] = useState('');
  const [routeAssistantContextMessages, setRouteAssistantContextMessages] = useState<RouteAssistantContextMessage[]>([]);
  const [isRouteAssistantWorking, setIsRouteAssistantWorking] = useState(false);
  const [aiModelSettings, setAiModelSettings] = useState<AiModelSettings>(() => readAiModelSettings());
  const [aiModelDraft, setAiModelDraft] = useState<AiModelSettings>(() => readAiModelSettings());
  const [aiSettingsMessage, setAiSettingsMessage] = useState('');
  const [openAIModels, setOpenAIModels] = useState<OpenAIModelOption[]>([]);
  const [isLoadingOpenAIModels, setIsLoadingOpenAIModels] = useState(false);
  const [hasLoadedOpenAIModels, setHasLoadedOpenAIModels] = useState(false);
  const [newTripPrompt, setNewTripPrompt] = useState('');
  const [newTripAssistantMessage, setNewTripAssistantMessage] = useState('');
  const [isNewTripAssistantWorking, setIsNewTripAssistantWorking] = useState(false);
  const [newTripFormatCopied, setNewTripFormatCopied] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showNewTripModal, setShowNewTripModal] = useState(false);
  const [newTripMode, setNewTripMode] = useState<NewTripMode>('setup');
  const [newTripDraft, setNewTripDraft] = useState<NewTripDraft>(() => createEmptyNewTripDraft());
  const [isCreatingNewTrip, setIsCreatingNewTrip] = useState(false);
  const [saveBackend, setSaveBackend] = useState<SaveBackend>('checking');
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportFormatHelp, setShowExportFormatHelp] = useState(false);
  const [drivingMiles, setDrivingMiles] = useState<number | null>(null);
  const [roadDriveEstimates, setRoadDriveEstimates] = useState<DriveEstimate[] | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [gasPrice, setGasPrice] = useState(() => readNumberStorage(gasPriceKey, defaultGasPrice));
  const [gasPriceScaling, setGasPriceScaling] = useState(() => readBooleanStorage(gasPriceScalingKey));
  const [markerLabelMode, setMarkerLabelMode] = useState<MapMarkerLabelMode>(() => readMapMarkerLabelMode());
  const [lastAiEdit, setLastAiEdit] = useState<LastAiEdit | null>(() => readLastAiEdit());
  const [showLastAiEdit, setShowLastAiEdit] = useState(false);
  const [fuelMpg, setFuelMpg] = useState(() => readNumberStorage(fuelMpgKey, defaultFuelMpg, 0.01));
  const [maxCarLegHours, setMaxCarLegHours] = useState(() =>
    clampMaxCarLegHours(readNumberStorage(maxCarLegHoursKey, defaultMaxCarLegHours, 1)),
  );
  const [previewExport, setPreviewExport] = useState<ExportedTrip | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ||
      workspaces[0] ||
      createDefaultWorkspace(),
    [activeWorkspaceId, workspaces],
  );
  const stops = useMemo(() => resequenceStops(activeTrip.stops), [activeTrip.stops]);
  const remoteWorkDates = useMemo(
    () => normalizeRemoteWorkDates(activeTrip.remoteWorkDates, stops),
    [activeTrip.remoteWorkDates, stops],
  );
  const remoteWorkDateSet = useMemo(() => new Set(remoteWorkDates), [remoteWorkDates]);
  const tripCalendarDates = useMemo(() => buildTripCalendarDates(stops, remoteWorkDates), [remoteWorkDates, stops]);
  const remoteCalendarFirstDay = tripCalendarDates[0]
    ? new Date(`${tripCalendarDates[0]}T00:00:00`).getDay()
    : 0;
  const remoteCalendarLeadingBlankCount = Number.isFinite(remoteCalendarFirstDay) ? remoteCalendarFirstDay : 0;
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
  const gasCost = useMemo(
    () => calculateTripGasCost(stops, driveEstimates, displayMiles, gasPrice, fuelMpg, gasPriceScaling),
    [displayMiles, driveEstimates, fuelMpg, gasPrice, gasPriceScaling, stops],
  );
  const lodgingCost = useMemo(() => calculateLodgingCost(stops), [stops]);
  const nonCarTravelCost = useMemo(() => calculateNonCarTravelCost(stops), [stops]);
  const displayGasCost = formatCurrency(gasCost);
  const displayLodgingCost = formatCurrency(lodgingCost);
  const displayNonCarTravelCost = formatCurrency(nonCarTravelCost);
  const displayTripTotal = formatCurrency(gasCost + lodgingCost + nonCarTravelCost);
  const remoteWorkDayCount = remoteWorkDates.length;
  const nonCarTravelLegs = useMemo(() => countNonCarTravelLegs(stops), [stops]);
  const overlongCarLegs = useMemo(
    () => countOverlongCarLegs(stops, driveEstimateByStopId, maxCarLegHours),
    [driveEstimateByStopId, maxCarLegHours, stops],
  );
  const documents = activeTrip.documents;
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  );
  const selectedStopDocuments = useMemo(
    () => (selectedStop ? documents.filter((document) => document.linkedStopId === selectedStop.id) : []),
    [documents, selectedStop],
  );
  const selectedStopTravelSummary = useMemo(() => {
    if (!selectedStop || selectedStopIndex < 0) return '';

    return formatTravelLegSummary(
      selectedStop,
      selectedStopIndex,
      stops,
      driveEstimateByStopId.get(selectedStop.id),
      gasPrice,
      fuelMpg,
      gasPriceScaling,
    );
  }, [driveEstimateByStopId, fuelMpg, gasPrice, gasPriceScaling, selectedStop, selectedStopIndex, stops]);
  const selectedStopCarDayWarning = useMemo(() => {
    if (!selectedStop || selectedStopIndex < 0) return '';

    return getCarLegDayWarning(
      selectedStop,
      selectedStopIndex,
      stops,
      driveEstimateByStopId.get(selectedStop.id),
      maxCarLegHours,
    );
  }, [driveEstimateByStopId, maxCarLegHours, selectedStop, selectedStopIndex, stops]);
  const dateRange = useMemo(() => formatStopDateRange(stops), [stops]);
  const tripStartDate = stops[0]?.date || '';
  const tripEndDate = stops.length > 1 ? stops[stops.length - 1]?.date || '' : '';
  const carLegGasPriceRange = useMemo(() => {
    if (!gasPriceScaling) return null;

    const prices = getCarLegGasPrices(stops);
    if (!prices.length) return null;

    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [gasPriceScaling, stops]);
  const saveBackendLabel =
    saveBackend === 'database' ? 'DB' : saveBackend === 'local' ? 'Local' : 'Sync';
  const previewJson = useMemo(
    () => (previewExport ? `${JSON.stringify(previewExport, null, 2)}\n` : ''),
    [previewExport],
  );

  useEffect(() => {
    writeStorage(workspacesKey, workspaces);
  }, [workspaces]);

  useEffect(() => {
    let canceled = false;

    fetchWorkspacesFromDatabase()
      .then((databaseWorkspaces) => {
        if (canceled) return;

        setWorkspaces((currentWorkspaces) => {
          const nextWorkspaces = mergeWorkspacesByFreshness(databaseWorkspaces, currentWorkspaces);
          return workspacesMatch(currentWorkspaces, nextWorkspaces) ? currentWorkspaces : nextWorkspaces;
        });
      })
      .catch(() => {
        // Browser storage remains the source of truth when the database is unavailable.
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    writeStorage(activeWorkspaceKey, activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (saveBackend !== 'database') return;

    void Promise.all(workspaces.map((workspace) => saveWorkspaceToDatabase(workspace))).catch(() => {
      // Trip saving can still continue locally if workspace metadata cannot be persisted.
    });
  }, [saveBackend, workspaces]);

  useEffect(() => {
    let canceled = false;
    const localTrips = readSavedTrips(activeWorkspaceId);

    setSavedTrips(localTrips);

    fetchSavedTripsFromDatabase()
      .then(async (databaseTrips) => {
        const workspaceDatabaseTrips = filterTripsForWorkspace(databaseTrips, activeWorkspaceId);
        const mergedTrips = filterTripsForWorkspace(
          mergeTripsByFreshness(workspaceDatabaseTrips, localTrips),
          activeWorkspaceId,
        );

        if (localTrips.length) {
          await Promise.all(mergedTrips.map((trip) => saveTripToDatabase(trip)));
        }

        if (canceled) return;

        setWorkspaces((currentWorkspaces) => {
          const nextWorkspaces = addMissingWorkspacesFromTrips(currentWorkspaces, databaseTrips);
          return workspacesMatch(currentWorkspaces, nextWorkspaces) ? currentWorkspaces : nextWorkspaces;
        });
        setSavedTrips(mergedTrips);
        setSaveBackend('database');
        removeWorkspaceSavedTrips(activeWorkspaceId);
        if (localTrips.length) {
          setSaveMessage('Synced saved trips to database');
        }

        const pendingDefaultTrip = pendingDefaultTripRef.current;
        if (pendingDefaultTrip && pendingDefaultTrip.workspaceId === activeWorkspaceId) {
          pendingDefaultTripRef.current = null;

          const defaultTrip = mergedTrips.find((trip) => trip.id === pendingDefaultTrip.tripId);
          if (defaultTrip) {
            setDrivingMiles(null);
            setRoadDriveEstimates(null);
            setRouteAssistantContextMessages([]);
            setActiveTrip(defaultTrip);
            setSelectedStopId(defaultTrip.stops[0]?.id || null);
            setSelectedDocumentId(defaultTrip.documents[0]?.id || null);
            setFitSignal((value) => value + 1);
          }
        }
      })
      .catch(() => {
        if (canceled) return;

        setSaveBackend('local');
      });

    return () => {
      canceled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (saveBackend === 'local') {
      writeWorkspaceSavedTrips(activeWorkspaceId, savedTrips);
    }
  }, [activeWorkspaceId, saveBackend, savedTrips]);

  useEffect(() => {
    writeStorage(gasPriceKey, gasPrice);
  }, [gasPrice]);

  useEffect(() => {
    writeStorage(gasPriceScalingKey, gasPriceScaling);
  }, [gasPriceScaling]);

  useEffect(() => {
    writeStorage(mapMarkerLabelModeKey, markerLabelMode);
  }, [markerLabelMode]);

  useEffect(() => {
    writeStorage(fuelMpgKey, fuelMpg);
  }, [fuelMpg]);

  useEffect(() => {
    writeStorage(maxCarLegHoursKey, maxCarLegHours);
  }, [maxCarLegHours]);

  useEffect(() => {
    writeWorkspaceActiveTrip(activeWorkspaceId, activeTrip);
  }, [activeTrip, activeWorkspaceId]);

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
    if (!showLastAiEdit) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowLastAiEdit(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showLastAiEdit]);

  useEffect(() => {
    if (!showNewTripModal) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowNewTripModal(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showNewTripModal]);

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

  useEffect(() => {
    if (shareImportHandledRef.current) return;

    const hasShareSource = Boolean(getTripShareSourceFromUrl());
    if (!hasShareSource) {
      shareImportHandledRef.current = true;
      return;
    }

    shareImportHandledRef.current = true;
    let cancelled = false;

    loadTripShareFromUrl(activeWorkspaceId).then((sharedTrip) => {
      if (cancelled) return;

      clearTripSharePayloadFromUrl();

      if (!sharedTrip) {
        setSaveMessage('Share link could not be loaded');
        return;
      }

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setRouteAssistantContextMessages([]);
      setActiveTrip(sharedTrip);
      setSelectedStopId(sharedTrip.stops[0]?.id || null);
      setSelectedDocumentId(null);
      clearAppViewPath(true);
      setCurrentView('editor');
      setSaveMessage(`Shared route loaded: ${sharedTrip.name}. Save it when ready.`);
      setFitSignal((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const recordLastAiEdit = (kind: LastAiEdit['kind'], instruction: string, summary: string) => {
    const nextLastAiEdit: LastAiEdit = {
      kind,
      instruction,
      summary,
      at: new Date().toISOString(),
    };

    setLastAiEdit(nextLastAiEdit);
    writeStorage(lastAiEditKey, nextLastAiEdit);
  };

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
    touchTrip((trip) => {
      const updatedStops = resequenceStops(
        trip.stops.map((stop) => (stop.id === stopId ? { ...stop, ...updates } : stop)),
      );
      const remoteWorkDateSet = new Set(normalizeRemoteWorkDates(trip.remoteWorkDates));
      const updatedStop = updatedStops.find((stop) => stop.id === stopId);

      if (updatedStop && 'remoteWork' in updates && isDateOnly(updatedStop.date)) {
        if (updates.remoteWork) {
          remoteWorkDateSet.add(updatedStop.date);
        } else {
          remoteWorkDateSet.delete(updatedStop.date);
        }
      }

      const remoteWorkDates = Array.from(remoteWorkDateSet).sort();

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(updatedStops, remoteWorkDates),
      };
    });
  };

  const setRemoteWorkDate = (date: string, enabled: boolean) => {
    if (!isDateOnly(date)) return;

    touchTrip((trip) => {
      const remoteWorkDateSet = new Set(normalizeRemoteWorkDates(trip.remoteWorkDates));

      if (enabled) {
        remoteWorkDateSet.add(date);
      } else {
        remoteWorkDateSet.delete(date);
      }

      const remoteWorkDates = Array.from(remoteWorkDateSet).sort();

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(trip.stops, remoteWorkDates),
      };
    });
  };

  const updateStopNumber = (stopId: string, field: 'lat' | 'lng', value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    updateStop(stopId, { [field]: nextValue });
  };

  const updateTripAnchorDate = (anchor: 'start' | 'end', value: string) => {
    const anchorStop = anchor === 'start' ? stops[0] : stops[stops.length - 1];
    if (!anchorStop) return;
    updateStop(anchorStop.id, { date: value });
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

  const updateMaxCarLegHours = (value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;

    setMaxCarLegHours(clampMaxCarLegHours(nextValue));
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
      travelMode: 'car',
    };

    touchTrip((trip) => {
      const before = trip.stops.filter((stop) => stop.order < order);
      const after = trip.stops.filter((stop) => stop.order >= order);
      const remoteWorkDates = normalizeRemoteWorkDates(trip.remoteWorkDates);
      const nextStops = resequenceStops([...before, newStop, ...after]);

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(nextStops, remoteWorkDates),
      };
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
      travelMode: 'car',
    };

    touchTrip((trip) => {
      const before = trip.stops.filter((stop) => stop.order < order);
      const after = trip.stops.filter((stop) => stop.order >= order);
      const remoteWorkDates = normalizeRemoteWorkDates(trip.remoteWorkDates);
      const nextStops = resequenceStops([...before, newStop, ...after]);

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(nextStops, remoteWorkDates),
      };
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
      const remoteWorkDates = normalizeRemoteWorkDates(trip.remoteWorkDates);
      const resequencedStops = resequenceStops([...nextStops, copy]);

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(resequencedStops, remoteWorkDates),
      };
    });
    setSelectedStopId(copy.id);
  };

  const deleteStop = () => {
    if (!selectedStop) return;

    const nextSelection =
      stops[selectedStop.order] || stops[selectedStop.order - 2] || stops.find((stop) => stop.id !== selectedStop.id);

    touchTrip((trip) => {
      const remoteWorkDates = normalizeRemoteWorkDates(trip.remoteWorkDates);
      const nextStops = resequenceStops(trip.stops.filter((stop) => stop.id !== selectedStop.id));

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(nextStops, remoteWorkDates),
        documents: trip.documents.map((document) =>
          document.linkedStopId === selectedStop.id ? { ...document, linkedStopId: '' } : document,
        ),
      };
    });
    setSelectedStopId(nextSelection?.id || null);
  };

  const moveStop = (direction: -1 | 1) => {
    if (!selectedStop) return;

    const index = stops.findIndex((stop) => stop.id === selectedStop.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= stops.length) return;

    const nextStops = [...stops];
    [nextStops[index], nextStops[swapIndex]] = [nextStops[swapIndex], nextStops[index]];
    touchTrip((trip) => {
      const remoteWorkDates = normalizeRemoteWorkDates(trip.remoteWorkDates);
      const resequencedStops = resequenceStops(nextStops);

      return {
        ...trip,
        remoteWorkDates,
        stops: applyRemoteWorkDatesToStops(resequencedStops, remoteWorkDates),
      };
    });
  };

  const getActiveTripForExport = () =>
    normalizeTrip({ ...activeTrip, workspaceId: activeWorkspaceId, stops }, activeWorkspaceId) || activeTrip;

  const previewTripExport = (trip: Trip) => {
    const normalizedTrip = normalizeTrip(trip, trip.workspaceId || activeWorkspaceId) || trip;
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

  const copyTripShareLink = async (trip: Trip) => {
    const normalizedTrip = normalizeTrip(trip, trip.workspaceId || activeWorkspaceId) || trip;

    setIsSharing(true);
    try {
      const shareId = await createServerTripShare(normalizedTrip);
      await copyText(createShortTripShareUrl(shareId));
      setSaveMessage(`Short share link copied: ${normalizedTrip.name}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CREATE_SHARED_TRIP_DUPLICATE_')) {
        const slug = error.message.replace('CREATE_SHARED_TRIP_DUPLICATE_', '');
        setSaveMessage(`Share URL /share/${slug} already exists. Try sharing again.`);
      } else {
        setSaveMessage('Share link copy failed');
      }
    } finally {
      setIsSharing(false);
    }
  };

  const importTripJson = async (jsonText: string, closeModal = false) => {
    setIsImporting(true);

    try {
      const importedTrip = parseTripImport(JSON.parse(jsonText), activeWorkspaceId);
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
      setRouteAssistantContextMessages([]);
      setActiveTrip(importedTrip);
      setSelectedStopId(importedTrip.stops[0]?.id || null);
      setSelectedDocumentId(importedTrip.documents[0]?.id || null);
      setSavedTrips(nextSavedTrips);
      clearAppViewPath(true);
      setCurrentView('editor');
      clearSavedRouteUrl(true);
      setFitSignal((value) => value + 1);
      if (closeModal) {
        setShowImportModal(false);
        setShowNewTripModal(false);
        setNewTripMode('setup');
        setImportJsonText('');
        setNewTripPrompt('');
        setNewTripAssistantMessage('');
        setNewTripFormatCopied(false);
      }

      try {
        const savedTrip = await saveTripToDatabase(importedTrip);
        setSavedTrips((trips) => [
          savedTrip,
          ...trips.filter((trip) => trip.id !== savedTrip.id),
        ]);
        setSaveBackend('database');
        removeWorkspaceSavedTrips(activeWorkspaceId);
        setSaveMessage(`Imported to database: ${savedTrip.name}`);
      } catch {
        setSaveBackend('local');
        writeWorkspaceSavedTrips(activeWorkspaceId, nextSavedTrips);
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
    setRouteAssistantMessage('Thinking through route changes and driving order...');

    try {
      const result = await requestRouteAssistant(
        getActiveTripForExport(),
        instruction,
        { maxCarLegHours, model: aiModelSettings.routeAssistantModel },
        routeAssistantContextMessages,
      );
      const now = new Date().toISOString();
      const proposedTrip = normalizeTrip(
        {
          ...result.trip,
          id: makeId('trip'),
          workspaceId: activeWorkspaceId,
          createdAt: now,
          updatedAt: now,
          name: activeTrip.name,
          documents: activeTrip.documents,
        },
        activeWorkspaceId,
      );

      if (!proposedTrip) {
        throw new Error('INVALID_ROUTE_ASSISTANT_RESPONSE');
      }

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setActiveTrip(proposedTrip);
      setSelectedStopId(proposedTrip.stops[0]?.id || null);
      setSelectedDocumentId(proposedTrip.documents[0]?.id || null);
      clearAppViewPath(true);
      setCurrentView('editor');
      clearSavedRouteUrl(true);
      setFitSignal((value) => value + 1);
      setRouteAssistantPrompt('');
      setRouteAssistantMessage(`${result.summary} Save the draft when ready.`);
      recordLastAiEdit('route-edit', instruction, result.summary);
      setRouteAssistantContextMessages((messages) =>
        trimRouteAssistantContext([
          ...messages,
          { role: 'user', content: instruction },
          { role: 'assistant', content: result.summary },
        ]),
      );
      setSaveMessage('AI route draft loaded');
    } catch (error) {
      const message = error instanceof Error && error.message.includes('503')
        ? 'AI route editor needs OPENAI_TOKEN on the server.'
        : error instanceof Error && error.message.startsWith('ROUTE_ASSISTANT_RATE_LIMITED_')
          ? `AI route editor is cooling down. Try again in ${error.message.split('_').pop()} seconds.`
          : 'AI route edit failed. Try a smaller change.';
      setRouteAssistantMessage(message);
    } finally {
      setIsRouteAssistantWorking(false);
    }
  };

  const persistSavedTrip = async (
    tripToSave: Trip,
    nextSavedTrips: Trip[],
    savedAt: string,
    messagePrefix: string,
  ) => {
    setActiveTrip(tripToSave);
    setSavedTrips(nextSavedTrips);
    setSavedRouteUrl(tripToSave, nextSavedTrips, true);
    setIsSaving(true);

    try {
      const savedTrip = await saveTripToDatabase(tripToSave);
      setSavedTrips((trips) => mergeTripsByFreshness([savedTrip], trips));
      setSaveBackend('database');
      removeWorkspaceSavedTrips(activeWorkspaceId);
      setSaveMessage(`${messagePrefix} to database ${formatDateTime(savedAt)}`);
    } catch {
      setSaveBackend('local');
      writeWorkspaceSavedTrips(activeWorkspaceId, nextSavedTrips);
      setSaveMessage(`${messagePrefix} locally ${formatDateTime(savedAt)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveTrip = async () => {
    const now = new Date().toISOString();
    const tripToSave =
      normalizeTrip({ ...activeTrip, workspaceId: activeWorkspaceId, stops, updatedAt: now }, activeWorkspaceId) ||
      activeTrip;

    const nextSavedTrips = [
      tripToSave,
      ...savedTrips.filter((trip) => trip.id !== tripToSave.id),
    ];

    await persistSavedTrip(tripToSave, nextSavedTrips, now, 'Saved');
  };

  const saveAsNewTrip = async () => {
    const now = new Date().toISOString();
    const tripName = createUniqueSavedTripName(activeTrip.name, savedTrips);
    const tripToSave =
      normalizeTrip(
        {
          ...activeTrip,
          id: makeId('trip'),
          workspaceId: activeWorkspaceId,
          name: tripName,
          stops,
          createdAt: now,
          updatedAt: now,
        },
        activeWorkspaceId,
      ) || activeTrip;

    const nextSavedTrips = [
      tripToSave,
      ...savedTrips,
    ];

    await persistSavedTrip(tripToSave, nextSavedTrips, now, 'Saved as new trip');
  };

  const exportActiveTrip = () => {
    const tripToExport = getActiveTripForExport();
    downloadTripExport(tripToExport);
    setSaveMessage('Exported JSON');
  };

  const startNewTrip = () => {
    setNewTripDraft(createEmptyNewTripDraft());
    setImportJsonText('');
    setNewTripPrompt('');
    setNewTripAssistantMessage('');
    setNewTripFormatCopied(false);
    setNewTripMode('setup');
    setShowNewTripModal(true);
  };

  const updateNewTripDraft = (field: keyof NewTripDraft, value: string) => {
    setNewTripDraft((draft) => ({ ...draft, [field]: value }));
  };

  const copyNewTripJsonFormat = async () => {
    try {
      await copyText(exportFormatExample);
      setNewTripFormatCopied(true);
    } catch {
      setNewTripFormatCopied(false);
    }
  };

  const createNewTripFromDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const startDate = newTripDraft.startDate;
    const endDate = newTripDraft.endDate;
    const startLocation = newTripDraft.startLocation.trim();
    const endLocation = newTripDraft.endLocation.trim();
    if (!startDate || !endDate || !startLocation || !endLocation) return;
    if (endDate < startDate) {
      setSaveMessage('End date must be on or after start date');
      return;
    }

    setIsCreatingNewTrip(true);
    try {
      const startFallback = usCenter;
      const endFallback = { lat: usCenter.lat, lng: usCenter.lng + 1 };
      const [start, end] = await Promise.all([
        resolveNewTripLocation(startLocation, startFallback),
        resolveNewTripLocation(endLocation, endFallback),
      ]);
      const now = new Date().toISOString();
      const newTrip: Trip = {
        id: makeId('trip'),
        workspaceId: activeWorkspaceId,
        name: `${start.label} to ${end.label}`,
        notes: '',
        remoteWorkDates: [],
        stops: [
          {
            id: makeId('stop'),
            order: 1,
            date: startDate,
            label: start.label,
            lat: start.position.lat,
            lng: start.position.lng,
            notes: '',
            remoteWork: false,
            sleepingArrangement: 'camping',
            friendName: '',
            travelMode: 'car',
          },
          {
            id: makeId('stop'),
            order: 2,
            date: endDate,
            label: end.label,
            lat: end.position.lat,
            lng: end.position.lng,
            notes: '',
            remoteWork: false,
            sleepingArrangement: 'camping',
            friendName: '',
            travelMode: 'car',
          },
        ],
        documents: [],
        createdAt: now,
        updatedAt: now,
      };

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setRouteAssistantContextMessages([]);
      setActiveTrip(newTrip);
      setSelectedStopId(newTrip.stops[0].id);
      setSelectedDocumentId(null);
      clearAppViewPath(true);
      setCurrentView('editor');
      setSaveMessage(
        start.resolved && end.resolved
          ? 'New trip started'
          : 'New trip started; review map coordinates for unresolved locations',
      );
      setShowNewTripModal(false);
      setNewTripDraft(createEmptyNewTripDraft());
      clearSavedRouteUrl();
      setFitSignal((value) => value + 1);
    } finally {
      setIsCreatingNewTrip(false);
    }
  };

  const generateNewTripWithAi = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const instruction = newTripPrompt.trim();
    if (!instruction) return;

    setIsNewTripAssistantWorking(true);
    setNewTripAssistantMessage('Planning an initial trip...');

    try {
      const result = await requestTripStarter(
        instruction,
        { maxCarLegHours, model: aiModelSettings.tripStarterModel },
        activeWorkspaceId,
      );
      const now = new Date().toISOString();
      const generatedTrip = normalizeTrip(
        {
          ...result.trip,
          id: makeId('trip'),
          workspaceId: activeWorkspaceId,
          documents: [],
          createdAt: now,
          updatedAt: now,
        },
        activeWorkspaceId,
      );

      if (!generatedTrip) {
        throw new Error('INVALID_TRIP_STARTER_RESPONSE');
      }

      setDrivingMiles(null);
      setRoadDriveEstimates(null);
      setRouteAssistantContextMessages([]);
      setActiveTrip(generatedTrip);
      setSelectedStopId(generatedTrip.stops[0]?.id || null);
      setSelectedDocumentId(null);
      clearAppViewPath(true);
      setCurrentView('editor');
      setShowNewTripModal(false);
      setNewTripPrompt('');
      setNewTripAssistantMessage('');
      clearSavedRouteUrl();
      setFitSignal((value) => value + 1);
      setSaveMessage(`${result.summary} Save the draft when ready.`);
      recordLastAiEdit('new-trip', instruction, result.summary);
    } catch (error) {
      const message = error instanceof Error && error.message.includes('503')
        ? 'AI trip starter needs OPENAI_TOKEN on the server.'
        : error instanceof Error && error.message.startsWith('TRIP_STARTER_RATE_LIMITED_')
          ? `AI trip starter is cooling down. Try again in ${error.message.split('_').pop()} seconds.`
          : 'AI trip draft failed. Try a smaller prompt.';
      setNewTripAssistantMessage(message);
    } finally {
      setIsNewTripAssistantWorking(false);
    }
  };

  const loadTrip = (trip: Trip, options: { syncUrl?: boolean } = {}) => {
    const nextTrip = normalizeTrip(trip, activeWorkspaceId);
    if (!nextTrip) return;
    const syncUrl = options.syncUrl !== false;

    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setRouteAssistantContextMessages([]);
    setActiveTrip(nextTrip);
    setSelectedStopId(nextTrip.stops[0]?.id || null);
    setSelectedDocumentId(nextTrip.documents[0]?.id || null);
    clearAppViewPath(true);
    setCurrentView('editor');
    setSaveMessage(`Loaded ${nextTrip.name}`);
    if (syncUrl) {
      setSavedRouteUrl(nextTrip, savedTrips);
    }
    setFitSignal((value) => value + 1);
  };

  useEffect(() => {
    const loadSavedRouteFromUrl = (event?: Event) => {
      if (getTripShareSourceFromUrl()) return;

      const routeToken = getSavedRouteIdFromUrl();
      const previousRouteToken = savedRouteUrlIdRef.current;
      savedRouteUrlIdRef.current = routeToken;

      if (!routeToken) {
        if (previousRouteToken && event) {
          setCurrentView('saved');
        }
        return;
      }

      const savedRoute = savedTrips.find((trip) => savedRouteTokenMatchesTrip(routeToken, trip));
      if (savedRoute) {
        if (activeTrip.id !== savedRoute.id || currentView !== 'editor') {
          loadTrip(savedRoute, { syncUrl: false });
        }
        return;
      }

      if (saveBackend !== 'checking') {
        setSaveMessage('Saved route URL was not found in this workspace');
      }
    };

    loadSavedRouteFromUrl();
    window.addEventListener('hashchange', loadSavedRouteFromUrl);
    window.addEventListener('popstate', loadSavedRouteFromUrl);

    return () => {
      window.removeEventListener('hashchange', loadSavedRouteFromUrl);
      window.removeEventListener('popstate', loadSavedRouteFromUrl);
    };
  }, [activeTrip.id, currentView, saveBackend, savedTrips]);

  useEffect(() => {
    const syncViewFromPath = () => {
      if (isAiSettingsPath()) {
        setCurrentView('ai');
        return;
      }

      if (isWorkspacesPath()) {
        setCurrentView('workspaces');
        return;
      }

      setCurrentView((view) => (view === 'ai' || view === 'workspaces' ? 'editor' : view));
    };

    window.addEventListener('popstate', syncViewFromPath);
    return () => window.removeEventListener('popstate', syncViewFromPath);
  }, []);

  useEffect(() => {
    if (currentView === 'ai' && !hasLoadedOpenAIModels && !isLoadingOpenAIModels) {
      loadOpenAIModels();
    }
  }, [currentView, hasLoadedOpenAIModels, isLoadingOpenAIModels]);

  const openEditor = () => {
    clearAppViewPath();
    setCurrentView('editor');
  };

  const openSavedTrips = () => {
    clearAppViewPath();
    clearSavedRouteUrl();
    setCurrentView('saved');
  };

  const openWorkspacesPage = () => {
    if (!isWorkspacesPath()) {
      window.history.pushState(null, '', workspacesPath);
    }
    setCurrentView('workspaces');
  };

  const updateAiModelDraft = (field: keyof AiModelSettings, value: string) => {
    setAiModelDraft((settings) => normalizeAiModelSettings({ ...settings, [field]: value }));
    setAiSettingsMessage('Ready to submit');
  };

  const submitAiModelSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextSettings = normalizeAiModelSettings(aiModelDraft);
    setAiModelSettings(nextSettings);
    setAiModelDraft(nextSettings);
    writeAiModelSettings(nextSettings);
    setAiSettingsMessage('AI model settings submitted');
  };

  const resetAiModelSettings = () => {
    const nextSettings = createEmptyAiModelSettings();
    setAiModelSettings(nextSettings);
    setAiModelDraft(nextSettings);
    writeAiModelSettings(nextSettings);
    setAiSettingsMessage('AI model settings reset');
  };

  const pickAiModelDraft = (field: keyof AiModelSettings, model: string) => {
    setAiModelDraft((settings) => normalizeAiModelSettings({ ...settings, [field]: model }));
    setAiSettingsMessage('Ready to submit');
  };

  const loadOpenAIModels = async () => {
    setIsLoadingOpenAIModels(true);
    setHasLoadedOpenAIModels(true);
    setAiSettingsMessage('Loading models...');

    try {
      const models = await requestOpenAIModels();
      setOpenAIModels(models);
      setAiSettingsMessage(models.length ? `${models.length} models available` : 'No models returned');
    } catch (error) {
      const message = error instanceof Error && error.message.includes('503')
        ? 'OPENAI_TOKEN needed to list models'
        : 'Model list failed';
      setAiSettingsMessage(message);
      setOpenAIModels([]);
    } finally {
      setIsLoadingOpenAIModels(false);
    }
  };

  const removeSavedTrip = async (tripId: string) => {
    const nextSavedTrips = savedTrips.filter((trip) => trip.id !== tripId);
    const removedTrip = savedTrips.find((trip) => trip.id === tripId);
    setSavedTrips(nextSavedTrips);
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.some((workspace) => workspace.defaultTripId === tripId)
        ? currentWorkspaces.map((workspace) =>
            workspace.defaultTripId === tripId
              ? { ...workspace, defaultTripId: '', updatedAt: new Date().toISOString() }
              : workspace,
          )
        : currentWorkspaces,
    );
    if (
      removedTrip
        ? savedRouteTokenMatchesTrip(getSavedRouteIdFromUrl(), removedTrip)
        : getSavedRouteIdFromUrl() === tripId
    ) {
      clearSavedRouteUrl(true);
    }

    if (saveBackend !== 'database') {
      writeWorkspaceSavedTrips(activeWorkspaceId, nextSavedTrips);
      return;
    }

    try {
      await deleteTripFromDatabase(tripId);
      removeWorkspaceSavedTrips(activeWorkspaceId);
      setSaveMessage('Deleted from database');
    } catch {
      setSavedTrips(savedTrips);
      setSaveMessage('Delete failed');
    }
  };

  const loadWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return;

    // A workspace default route pops up first; fall back to the last active trip while
    // database-backed saved trips are still syncing, then swap once they arrive.
    const defaultTrip = findWorkspaceDefaultTrip(workspace, readSavedTrips(workspaceId));
    const nextTrip = defaultTrip || createInitialTripForWorkspace(workspaceId);
    pendingDefaultTripRef.current =
      workspace.defaultTripId && !defaultTrip
        ? { workspaceId, tripId: workspace.defaultTripId }
        : null;

    setActiveWorkspaceId(workspaceId);
    setSavedTrips(readSavedTrips(workspaceId));
    setActiveTrip(nextTrip);
    setSelectedStopId(nextTrip.stops[0]?.id || null);
    setSelectedDocumentId(nextTrip.documents[0]?.id || null);
    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setRouteAssistantContextMessages([]);
    clearAppViewPath(true);
    setRouteAssistantPrompt('');
    setRouteAssistantMessage('');
    setNewTripPrompt('');
    setNewTripAssistantMessage('');
    setSaveMessage('');
    setSaveBackend('checking');
    clearSavedRouteUrl(true);
    setFitSignal((value) => value + 1);
  };

  const setWorkspaceDefaultTrip = (tripId: string) => {
    const now = new Date().toISOString();
    const isCurrentDefault = activeWorkspace.defaultTripId === tripId;
    const tripName = savedTrips.find((trip) => trip.id === tripId)?.name || 'route';

    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, defaultTripId: isCurrentDefault ? '' : tripId, updatedAt: now }
          : workspace,
      ),
    );
    setSaveMessage(
      isCurrentDefault
        ? `Removed default route for ${activeWorkspace.name}`
        : `${tripName} is now the default route for ${activeWorkspace.name}`,
    );
  };

  const deleteWorkspace = async (workspaceId: string) => {
    if (workspaceId === defaultWorkspaceId) return;

    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return;
    if (!window.confirm(`Delete workspace "${workspace.name}" and its saved trips? This cannot be undone.`)) {
      return;
    }

    setWorkspaces((currentWorkspaces) => currentWorkspaces.filter((candidate) => candidate.id !== workspaceId));
    removeStorage(workspaceStorageKey(activeTripKey, workspaceId));
    removeStorage(workspaceStorageKey(savedTripsKey, workspaceId));

    if (workspaceId === activeWorkspaceId) {
      loadWorkspace(defaultWorkspaceId);
    }

    try {
      await deleteWorkspaceFromDatabase(workspaceId);
      setSaveMessage(`Workspace deleted: ${workspace.name}`);
    } catch {
      setSaveMessage(`Workspace removed locally: ${workspace.name}`);
    }
  };

  const createWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = workspaceNameDraft.trim();
    if (!name) return;

    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: makeId('workspace'),
      name,
      defaultTripId: '',
      createdAt: now,
      updatedAt: now,
    };
    const newTrip = createBlankTrip(workspace.id, `${name} trip`);

    setWorkspaces((currentWorkspaces) => [workspace, ...currentWorkspaces]);
    void saveWorkspaceToDatabase(workspace).catch(() => {
      // The normal local-storage fallback and later database sync still cover this workspace.
    });
    setWorkspaceNameDraft('');
    setActiveWorkspaceId(workspace.id);
    setSavedTrips([]);
    setActiveTrip(newTrip);
    setSelectedStopId(newTrip.stops[0]?.id || null);
    setSelectedDocumentId(null);
    setDrivingMiles(null);
    setRoadDriveEstimates(null);
    setRouteAssistantContextMessages([]);
    clearAppViewPath(true);
    setCurrentView('editor');
    setRouteAssistantPrompt('');
    setRouteAssistantMessage('');
    setNewTripPrompt('');
    setNewTripAssistantMessage('');
    setSaveMessage(`Workspace created: ${workspace.name}`);
    setSaveBackend('checking');
    clearSavedRouteUrl(true);
    setFitSignal((value) => value + 1);
  };

  const handleRemoteChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedStop) return;
    setRemoteWorkDate(selectedStop.date, event.currentTarget.checked);
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

  const handleTravelModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!selectedStop || selectedStopIndex <= 0) return;
    updateStop(selectedStop.id, { travelMode: normalizeTravelMode(event.currentTarget.value) });
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

        <form className="workspace-switcher" onSubmit={createWorkspace} aria-label="Workspace selector">
          <label htmlFor="workspace-select">Workspace</label>
          <select
            id="workspace-select"
            value={activeWorkspace.id}
            onChange={(event) => loadWorkspace(event.currentTarget.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={workspaceNameDraft}
            onChange={(event) => setWorkspaceNameDraft(event.currentTarget.value)}
            placeholder="New idea or person"
            aria-label="New workspace name"
          />
          <button
            type="submit"
            className="icon-button"
            title="Create workspace"
            aria-label="Create workspace"
            disabled={!workspaceNameDraft.trim()}
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            className={currentView === 'workspaces' ? 'icon-button active' : 'icon-button'}
            onClick={openWorkspacesPage}
            title="Manage workspaces"
            aria-label="Manage workspaces"
          >
            <FolderCog size={18} />
          </button>
        </form>

        <nav className="view-tabs" aria-label="Primary views">
          <button
            type="button"
            className={currentView === 'editor' ? 'view-tab active' : 'view-tab'}
            onClick={openEditor}
          >
            Editor
          </button>
          <button
            type="button"
            className={currentView === 'saved' ? 'view-tab active' : 'view-tab'}
            onClick={openSavedTrips}
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
                onClick={() => copyTripShareLink(getActiveTripForExport())}
                title={isSharing ? 'Creating share link' : 'Copy route share link'}
                aria-label="Copy route share link"
                disabled={isSharing}
              >
                <Share2 size={18} />
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
              <button
                type="button"
                className="secondary-button topbar-save-as"
                onClick={saveAsNewTrip}
                title="Save as new trip"
                disabled={isSaving}
              >
                <Copy size={18} />
                <span>Save as new</span>
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
            <textarea
              id="route-assistant-prompt"
              value={routeAssistantPrompt}
              onChange={(event) => setRouteAssistantPrompt(event.currentTarget.value)}
              placeholder="Add Denver by car, change start to Atlanta, or change the end date to 2026-08-12"
              rows={3}
              maxLength={routeAssistantPromptMaxLength}
            />
            <button
              type="submit"
              className="primary-button"
              disabled={isRouteAssistantWorking || !routeAssistantPrompt.trim()}
            >
              {isRouteAssistantWorking ? <LoaderCircle className="loading-icon" size={17} /> : <Sparkles size={17} />}
              <span>{isRouteAssistantWorking ? 'Working' : 'Update route'}</span>
            </button>
          </form>
          {routeAssistantMessage && <p className="route-assistant-message">{routeAssistantMessage}</p>}
          {lastAiEdit && (
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowLastAiEdit(true)}
              title="Show full text of the last AI edit"
              aria-label="Show full text of the last AI edit"
            >
              <History size={18} />
            </button>
          )}
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

            <div className="trip-date-grid" aria-label="Trip date range">
              <span>
                <label htmlFor="trip-start-date">Trip start date</label>
                <input
                  id="trip-start-date"
                  type="date"
                  value={tripStartDate}
                  max={tripEndDate || undefined}
                  onChange={(event) => updateTripAnchorDate('start', event.currentTarget.value)}
                />
              </span>
              <span>
                <label htmlFor="trip-end-date">Trip end date</label>
                <input
                  id="trip-end-date"
                  type="date"
                  value={tripEndDate}
                  min={tripStartDate || undefined}
                  onChange={(event) => updateTripAnchorDate('end', event.currentTarget.value)}
                  disabled={stops.length < 2}
                />
              </span>
            </div>
            <p className="trip-date-hint">
              AI route edits stay inside these dates unless you explicitly ask to change the start or end date.
            </p>

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
                <strong>{displayNonCarTravelCost}</strong>
                <span>Plane/boat</span>
              </div>
              <div>
                <strong>{displayTripTotal}</strong>
                <span>Trip total</span>
              </div>
              <div>
                <strong>{remoteWorkDayCount}</strong>
                <span>Remote days</span>
              </div>
              <div>
                <strong>{nonCarTravelLegs}</strong>
                <span>Non-car</span>
              </div>
              <div>
                <strong>{overlongCarLegs}</strong>
                <span>Long car days</span>
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
                  disabled={gasPriceScaling}
                  title={gasPriceScaling ? 'Gas price scaling uses average prices near each stop' : undefined}
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
              <span>
                <label htmlFor="max-car-leg-hours">Max drive hrs/day</label>
                <input
                  id="max-car-leg-hours"
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={maxCarLegHours}
                  onChange={(event) => updateMaxCarLegHours(event.currentTarget.value)}
                />
              </span>
            </div>

            <div className="remote-work-calendar" aria-label="Remote work dates">
              <div className="remote-calendar-title">
                <span>
                  <CalendarDays size={16} />
                  <strong>Remote work dates</strong>
                </span>
                <small>{remoteWorkDayCount} selected</small>
              </div>
              {tripCalendarDates.length ? (
                <div className="remote-calendar-grid">
                  {remoteCalendarWeekdays.map((weekday) => (
                    <span key={weekday} className="remote-calendar-weekday">
                      {weekday}
                    </span>
                  ))}
                  {Array.from({ length: remoteCalendarLeadingBlankCount }, (_, index) => (
                    <span key={`blank-${index}`} className="remote-calendar-blank" aria-hidden="true" />
                  ))}
                  {tripCalendarDates.map((date) => {
                    const isSelected = remoteWorkDateSet.has(date);
                    const dateStopCount = stops.filter((stop) => stop.date === date).length;
                    const dayClassName = [
                      'remote-calendar-day',
                      isSelected ? 'selected' : '',
                      isWeekendDate(date) ? 'weekend' : '',
                      dateStopCount ? 'has-stop' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const stopLabel = dateStopCount === 1 ? '1 stop' : `${dateStopCount} stops`;

                    return (
                      <button
                        key={date}
                        type="button"
                        className={dayClassName}
                        onClick={() => setRemoteWorkDate(date, !isSelected)}
                        aria-pressed={isSelected}
                        aria-label={`${formatScheduleDate(date)}${dateStopCount ? `, ${stopLabel}` : ''}${
                          isSelected ? ', remote work' : ''
                        }`}
                        title={`${formatScheduleDate(date)}${dateStopCount ? ` | ${stopLabel}` : ''}${
                          isSelected ? ' | Remote work' : ''
                        }`}
                      >
                        <span>{formatCalendarDayNumber(date)}</span>
                        {dateStopCount > 0 && <small>{dateStopCount}</small>}
                        {isSelected && <Wifi size={13} />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="remote-calendar-empty">No dated stops.</p>
              )}
            </div>

            <label className="toggle-row gas-scaling-toggle" htmlFor="gas-price-scaling">
              <input
                id="gas-price-scaling"
                type="checkbox"
                checked={gasPriceScaling}
                onChange={(event) => setGasPriceScaling(event.currentTarget.checked)}
              />
              <span>
                <strong>Gas price scaling</strong>
                <small>Price each leg by local gas prices; route lines shade green (cheap) to red (pricey)</small>
              </span>
              <Fuel size={18} />
            </label>

            <label className="toggle-row marker-label-toggle" htmlFor="marker-date-labels">
              <input
                id="marker-date-labels"
                type="checkbox"
                checked={markerLabelMode === 'date'}
                onChange={(event) => setMarkerLabelMode(event.currentTarget.checked ? 'date' : 'day')}
              />
              <span>
                <strong>Dates on map pins</strong>
                <small>Show stop dates on markers instead of trip day numbers</small>
              </span>
              <CalendarDays size={18} />
            </label>

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
                const travelMode = stopIndex === 0 ? 'car' : stop.travelMode;
                const travelSummary = formatTravelLegSummary(
                  stop,
                  stopIndex,
                  stops,
                  driveEstimate,
                  gasPrice,
                  fuelMpg,
                  gasPriceScaling,
                );
                const carDayWarning = getCarLegDayWarning(stop, stopIndex, stops, driveEstimate, maxCarLegHours);
                const stopIsWeekend = isWeekendDate(stop.date);
                const stopIsRemoteWork = isDateOnly(stop.date) && remoteWorkDateSet.has(stop.date);
                const stopCardClassName = [
                  'stop-card',
                  getSleepClass(stop.sleepingArrangement),
                  carDayWarning ? 'long-car-day' : '',
                  stopIsRemoteWork ? 'remote' : '',
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
                      <span
                        className={`stop-index ${getSleepClass(stop.sleepingArrangement)}`}
                        title={formatStopDayLabel(stop, stops)}
                      >
                        {formatStopDayBadge(stop, stops)}
                      </span>
                      <span className="stop-copy">
                        <strong>{stop.label}</strong>
                        <small>
                          <CalendarDays size={14} />
                          {formatScheduleDate(stop.date)}
                        </small>
                        {stopIndex > 0 && (
                          <small className="drive-summary">
                            {travelMode === 'plane' ? (
                              <Plane size={14} />
                            ) : travelMode === 'boat' ? (
                              <Ship size={14} />
                            ) : (
                              <Car size={14} />
                            )}
                            {travelSummary}
                          </small>
                        )}
                        {carDayWarning && (
                          <small className="drive-warning">
                            <Route size={14} />
                            {carDayWarning}
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
                          {travelMode !== 'car' && <span className="stop-tag travel">{getTravelModeLabel(travelMode)}</span>}
                          {carDayWarning && <span className="stop-tag long-drive">Long car day</span>}
                          {stopIsRemoteWork && <span className="stop-tag remote">Remote work</span>}
                          {stopIsWeekend && <span className="stop-tag weekend">Weekend</span>}
                        </span>
                      </span>
                      {stopIsRemoteWork && (
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
              gasPriceScaling={gasPriceScaling}
              markerLabelMode={markerLabelMode}
              onSelectStop={setSelectedStopId}
              onPlacePin={placePin}
              onRouteDistanceChange={setDrivingMiles}
              onDriveEstimatesChange={setRoadDriveEstimates}
            />
          ) : (
            <OpenStreetMapCanvas
              apiKey=""
              stops={stops}
              selectedStopId={selectedStopId}
              fitSignal={fitSignal}
              isPlacingPin={isPlacingPin}
              showHotelFinder={showHotelFinder}
              gasPriceScaling={gasPriceScaling}
              markerLabelMode={markerLabelMode}
              onSelectStop={setSelectedStopId}
              onPlacePin={placePin}
              onRouteDistanceChange={setDrivingMiles}
              onDriveEstimatesChange={setRoadDriveEstimates}
              reason="Google Maps key missing; OpenStreetMap fallback active"
            />
          )}
          {carLegGasPriceRange && (
            <div className="gas-legend" aria-label="Route line gas price scale">
              <Fuel size={14} />
              <span>{formatGasPricePerGallon(carLegGasPriceRange.min)}</span>
              <span className="gas-legend-bar" aria-hidden="true" />
              <span>{formatGasPricePerGallon(carLegGasPriceRange.max)}</span>
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
              <p>{selectedStop ? formatStopDayLabel(selectedStop, stops) : 'No stop selected'}</p>
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

              <div className="travel-section">
                <label htmlFor="travel-mode">Travel from previous stop</label>
                <select
                  id="travel-mode"
                  value={selectedStopIndex <= 0 ? 'car' : selectedStop.travelMode}
                  onChange={handleTravelModeChange}
                  disabled={selectedStopIndex <= 0}
                >
                  <option value="car">Car</option>
                  <option value="plane">Plane</option>
                  <option value="boat">Boat</option>
                </select>
                <p className="travel-hint">
                  {selectedStopIndex <= 0
                    ? 'This is the starting point.'
                    : selectedStopTravelSummary}
                  {selectedStopIndex > 0 && selectedStop.travelMode !== 'car'
                    ? ' Planning estimate added to the trip total.'
                    : ''}
                </p>
                {gasPriceScaling && (
                  <p className="travel-hint">
                    Avg gas near this stop: {formatGasPricePerGallon(getStopGasPrice(selectedStop))}
                  </p>
                )}
                {selectedStopCarDayWarning && <p className="travel-warning">{selectedStopCarDayWarning}</p>}
              </div>

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
                  checked={isDateOnly(selectedStop.date) && remoteWorkDateSet.has(selectedStop.date)}
                  onChange={handleRemoteChange}
                  disabled={!isDateOnly(selectedStop.date)}
                />
                <span>Remote-work day</span>
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
                    {`${formatStopDayLabel(stop, stops)}: ${stop.label}`}
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
      ) : currentView === 'saved' ? (
        <main className="saved-page" aria-label="Saved trips page">
          <section className="saved-page-header">
            <span>
              <h2>Saved Trips</h2>
              <p>
                {saveBackend === 'database' ? 'Database-backed trip library' : 'Local trip library'} for{' '}
                {activeWorkspace.name}
              </p>
            </span>
            <div className="saved-page-actions">
              <button
                type="button"
                className={showExportFormatHelp ? 'icon-button active' : 'icon-button'}
                onClick={() => setShowExportFormatHelp((value) => !value)}
                title="Export format"
                aria-label="Export format"
                aria-expanded={showExportFormatHelp}
              >
                <CircleHelp size={18} />
              </button>
              <button type="button" className="secondary-button" onClick={startNewTrip}>
                <FilePlus2 size={17} />
                <span>New trip</span>
              </button>
              <button type="button" className="primary-button" onClick={openEditor}>
                <Route size={17} />
                <span>Open editor</span>
              </button>
            </div>
          </section>

          <section className={showExportFormatHelp ? 'saved-page-grid format-open' : 'saved-page-grid'}>
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
                          {activeWorkspace.defaultTripId === trip.id && (
                            <small className="default-route-tag">
                              <Star size={13} />
                              Default route for {activeWorkspace.name}
                            </small>
                          )}
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
                          className={
                            activeWorkspace.defaultTripId === trip.id
                              ? 'icon-button ghost default-route-star active'
                              : 'icon-button ghost default-route-star'
                          }
                          onClick={() => setWorkspaceDefaultTrip(trip.id)}
                          title={
                            activeWorkspace.defaultTripId === trip.id
                              ? 'Remove as default route for this workspace'
                              : 'Make default route for this workspace'
                          }
                          aria-label={
                            activeWorkspace.defaultTripId === trip.id
                              ? `Remove ${trip.name} as default route`
                              : `Make ${trip.name} the default route`
                          }
                          aria-pressed={activeWorkspace.defaultTripId === trip.id}
                        >
                          <Star size={16} />
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
                          onClick={() => copyTripShareLink(trip)}
                          title={isSharing ? 'Creating share link' : 'Copy route share link'}
                          aria-label={`Copy ${trip.name} share link`}
                          disabled={isSharing}
                        >
                          <Share2 size={16} />
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

            {showExportFormatHelp && (
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
            )}
          </section>
        </main>
      ) : currentView === 'workspaces' ? (
        <main className="saved-page workspaces-page" aria-label="Workspaces page">
          <section className="saved-page-header">
            <span>
              <h2>Workspaces</h2>
              <p>
                {saveBackend === 'database' ? 'Database-backed workspaces' : 'Locally stored workspaces'} |{' '}
                {workspaces.length} total
              </p>
            </span>
            <div className="saved-page-actions">
              <button type="button" className="primary-button" onClick={openEditor}>
                <Route size={17} />
                <span>Open editor</span>
              </button>
            </div>
          </section>

          <section className="saved-page-grid">
            <div className="saved-library">
              <div className="section-heading">
                <h2>All Workspaces</h2>
                <span>{workspaces.length}</span>
              </div>
              <div className="saved-list saved-list-page">
                {workspaces.map((workspace) => (
                  <article key={workspace.id} className="saved-card saved-card-page">
                    <button
                      type="button"
                      className="saved-main"
                      onClick={() => {
                        loadWorkspace(workspace.id);
                        openEditor();
                      }}
                      title={`Open ${workspace.name}`}
                    >
                      <FolderOpen size={18} />
                      <span>
                        <strong>{workspace.name}</strong>
                        <small>{`Updated ${formatDateTime(workspace.updatedAt)}`}</small>
                        <span className="stop-tags">
                          {workspace.id === defaultWorkspaceId && (
                            <span className="stop-tag sleep-camping">Main workspace</span>
                          )}
                          {workspace.id === activeWorkspaceId && <span className="stop-tag travel">Active</span>}
                          {workspace.defaultTripId && <span className="stop-tag sleep-hotel">Default route set</span>}
                        </span>
                      </span>
                    </button>
                    <span className="saved-actions">
                      {workspace.id === defaultWorkspaceId ? (
                        <span className="workspace-protected-note">Cannot be deleted</span>
                      ) : (
                        <button
                          type="button"
                          className="icon-button ghost danger"
                          onClick={() => deleteWorkspace(workspace.id)}
                          title={`Delete ${workspace.name}`}
                          aria-label={`Delete workspace ${workspace.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </span>
                  </article>
                ))}
              </div>
              <p className="empty-copy">
                Deleting a workspace removes its saved trips. The main workspace can never be deleted.
              </p>
            </div>
          </section>
        </main>
      ) : (
        <main className="ai-page" aria-label="AI settings">
          <section className="ai-page-header">
            <span>
              <h2>AI</h2>
              <p>{aiSettingsMessage || 'Model settings'}</p>
            </span>
            <div className="ai-page-actions">
              <button type="button" className="secondary-button" onClick={loadOpenAIModels} disabled={isLoadingOpenAIModels}>
                {isLoadingOpenAIModels ? <LoaderCircle className="loading-icon" size={17} /> : <RefreshCw size={17} />}
                <span>{isLoadingOpenAIModels ? 'Loading' : 'Refresh'}</span>
              </button>
              <button type="button" className="secondary-button" onClick={resetAiModelSettings}>
                <X size={17} />
                <span>Reset models</span>
              </button>
            </div>
          </section>

          <form className="ai-settings-panel" onSubmit={submitAiModelSettings}>
            <div className="section-heading">
              <h2>Models</h2>
              <span>{aiModelSettings.routeAssistantModel || aiModelSettings.tripStarterModel ? 'Custom' : 'Default'}</span>
            </div>
            <div className="ai-settings-grid">
              <label className="ai-setting-field" htmlFor="ai-route-model">
                <span>Route editor model</span>
                <input
                  id="ai-route-model"
                  list="ai-model-options"
                  type="text"
                  value={aiModelDraft.routeAssistantModel}
                  onChange={(event) => updateAiModelDraft('routeAssistantModel', event.currentTarget.value)}
                  placeholder="server default"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={128}
                />
              </label>
              <label className="ai-setting-field" htmlFor="ai-trip-model">
                <span>New-trip model</span>
                <input
                  id="ai-trip-model"
                  list="ai-model-options"
                  type="text"
                  value={aiModelDraft.tripStarterModel}
                  onChange={(event) => updateAiModelDraft('tripStarterModel', event.currentTarget.value)}
                  placeholder="server default"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={128}
                />
              </label>
            </div>
            <datalist id="ai-model-options">
              {openAIModels.map((model) => (
                <option key={model.id} value={model.id} />
              ))}
            </datalist>
            <footer className="ai-settings-actions">
              <button type="submit" className="primary-button">
                <Save size={17} />
                <span>Submit</span>
              </button>
            </footer>
          </form>

          <section className="ai-settings-panel">
            <div className="section-heading">
              <h2>Available Models</h2>
              <span>{openAIModels.length}</span>
            </div>
            {openAIModels.length ? (
              <div className="ai-model-list">
                {openAIModels.map((model) => (
                  <article key={model.id} className="ai-model-row">
                    <span>
                      <strong>{model.id}</strong>
                      <small>{model.ownedBy || 'owner unavailable'}</small>
                    </span>
                    <span className="ai-model-actions">
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => pickAiModelDraft('routeAssistantModel', model.id)}
                        title={`Select ${model.id} for route editor`}
                        aria-label={`Select ${model.id} for route editor`}
                      >
                        <Route size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button ghost"
                        onClick={() => pickAiModelDraft('tripStarterModel', model.id)}
                        title={`Select ${model.id} for new-trip generator`}
                        aria-label={`Select ${model.id} for new-trip generator`}
                      >
                        <FilePlus2 size={16} />
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">{isLoadingOpenAIModels ? 'Loading models...' : 'No models loaded.'}</p>
            )}
          </section>
        </main>
      )}

      {showNewTripModal && (
        <div className="json-modal-backdrop" role="presentation" onClick={() => setShowNewTripModal(false)}>
          <section
            className="json-modal new-trip-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-trip-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="json-modal-header">
              <span>
                <h2 id="new-trip-title">New Trip</h2>
                <p>{activeWorkspace.name}</p>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowNewTripModal(false)}
                title="Close new trip"
                aria-label="Close new trip"
              >
                <X size={18} />
              </button>
            </header>

            <div className="new-trip-mode-tabs" role="tablist" aria-label="New trip source">
              <button
                type="button"
                role="tab"
                aria-selected={newTripMode === 'setup'}
                className={newTripMode === 'setup' ? 'secondary-button active' : 'secondary-button'}
                onClick={() => setNewTripMode('setup')}
              >
                <Route size={17} />
                <span>Route</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={newTripMode === 'ai'}
                className={newTripMode === 'ai' ? 'secondary-button active' : 'secondary-button'}
                onClick={() => setNewTripMode('ai')}
              >
                <Sparkles size={17} />
                <span>AI</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={newTripMode === 'json'}
                className={newTripMode === 'json' ? 'secondary-button active' : 'secondary-button'}
                onClick={() => setNewTripMode('json')}
              >
                <Import size={17} />
                <span>JSON</span>
              </button>
            </div>

            {newTripMode === 'setup' ? (
              <form className="new-trip-setup-form" onSubmit={createNewTripFromDraft}>
                <div className="new-trip-field-grid">
                  <span>
                    <label htmlFor="new-trip-start-date">Start date</label>
                    <input
                      id="new-trip-start-date"
                      type="date"
                      value={newTripDraft.startDate}
                      onChange={(event) => updateNewTripDraft('startDate', event.currentTarget.value)}
                      required
                    />
                  </span>
                  <span>
                    <label htmlFor="new-trip-end-date">End date</label>
                    <input
                      id="new-trip-end-date"
                      type="date"
                      min={newTripDraft.startDate || undefined}
                      value={newTripDraft.endDate}
                      onChange={(event) => updateNewTripDraft('endDate', event.currentTarget.value)}
                      required
                    />
                  </span>
                  <span>
                    <label htmlFor="new-trip-start-location">Start location</label>
                    <input
                      id="new-trip-start-location"
                      type="text"
                      value={newTripDraft.startLocation}
                      onChange={(event) => updateNewTripDraft('startLocation', event.currentTarget.value)}
                      placeholder="Jacksonville, FL"
                      required
                    />
                  </span>
                  <span>
                    <label htmlFor="new-trip-end-location">End location</label>
                    <input
                      id="new-trip-end-location"
                      type="text"
                      value={newTripDraft.endLocation}
                      onChange={(event) => updateNewTripDraft('endLocation', event.currentTarget.value)}
                      placeholder="Winston-Salem, NC"
                      required
                    />
                  </span>
                </div>
                <footer className="json-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowNewTripModal(false)}
                    disabled={isCreatingNewTrip}
                  >
                    <X size={17} />
                    <span>Cancel</span>
                  </button>
                  <button type="submit" className="primary-button" disabled={isCreatingNewTrip}>
                    <FilePlus2 size={17} />
                    <span>{isCreatingNewTrip ? 'Creating' : 'Create trip'}</span>
                  </button>
                </footer>
              </form>
            ) : newTripMode === 'ai' ? (
              <form className="new-trip-ai-form" onSubmit={generateNewTripWithAi}>
                <label htmlFor="new-trip-ai-prompt">Trip prompt</label>
                <textarea
                  id="new-trip-ai-prompt"
                  value={newTripPrompt}
                  onChange={(event) => setNewTripPrompt(event.currentTarget.value)}
                  placeholder="Plan a two-week camping-focused road trip from Jacksonville to Denver in June, with remote work on weekdays, national parks, and no car leg over 10 hours."
                  rows={6}
                  maxLength={routeAssistantPromptMaxLength}
                />
                {newTripAssistantMessage && (
                  <p className="new-trip-ai-message">{newTripAssistantMessage}</p>
                )}
                <footer className="json-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowNewTripModal(false)}
                    disabled={isNewTripAssistantWorking}
                  >
                    <X size={17} />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={isNewTripAssistantWorking || !newTripPrompt.trim()}
                  >
                    {isNewTripAssistantWorking ? <LoaderCircle className="loading-icon" size={17} /> : <Sparkles size={17} />}
                    <span>{isNewTripAssistantWorking ? 'Planning' : 'Generate trip'}</span>
                  </button>
                </footer>
              </form>
            ) : (
              <form className="import-form new-trip-import-form" onSubmit={importPastedTrip}>
                <div className="new-trip-json-heading">
                  <label htmlFor="new-trip-import-json">Saved trip JSON</label>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={copyNewTripJsonFormat}
                  >
                    <Copy size={16} />
                    <span>{newTripFormatCopied ? 'Copied' : 'Copy format'}</span>
                  </button>
                </div>
                <textarea
                  id="new-trip-import-json"
                  value={importJsonText}
                  onChange={(event) => setImportJsonText(event.currentTarget.value)}
                  placeholder={exportFormatExample}
                  rows={12}
                />
                <footer className="json-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowNewTripModal(false)}
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
            )}
          </section>
        </div>
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

      {showLastAiEdit && lastAiEdit && (
        <div className="json-modal-backdrop" role="presentation" onClick={() => setShowLastAiEdit(false)}>
          <section
            className="json-modal ai-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="json-modal-header">
              <span>
                <h2 id="ai-edit-title">Last AI Edit</h2>
                <p>
                  {lastAiEdit.kind === 'new-trip' ? 'New trip' : 'Route edit'} | {formatDateTime(lastAiEdit.at)}
                </p>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowLastAiEdit(false)}
                title="Close last AI edit"
                aria-label="Close last AI edit"
              >
                <X size={18} />
              </button>
            </header>
            <div className="ai-edit-body">
              {lastAiEdit.instruction && (
                <>
                  <h3>Your request</h3>
                  <p className="ai-edit-text">{lastAiEdit.instruction}</p>
                </>
              )}
              <h3>What the AI did</h3>
              <p className="ai-edit-text">{lastAiEdit.summary}</p>
            </div>
            <footer className="json-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copyText(lastAiEdit.summary).catch(() => undefined)}
              >
                <Copy size={17} />
                <span>Copy text</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createOpenMapStopIcon(group: MapStopGroup, selected: boolean, markerLabelMode: MapMarkerLabelMode) {
  const markerLabel = getMapMarkerLabel(group, markerLabelMode);
  const className = [
    'map-stop-marker',
    getSleepClass(group.sleepingArrangement),
    markerLabelMode === 'date' ? 'dated' : '',
    group.stops.length > 1 ? 'grouped' : '',
    group.hasRemoteWork ? 'remote' : '',
    group.hasWeekend ? 'weekend' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const iconWidth = markerLabelMode === 'date' ? Math.max(36, Math.round(markerLabel.length * 6.6) + 18) : 36;

  return L.divIcon({
    className: 'open-map-stop-icon',
    html: `<span class="${className}">${escapeHtml(markerLabel)}</span>`,
    iconAnchor: [iconWidth / 2, 18],
    iconSize: [iconWidth, 36],
    popupAnchor: [0, -18],
  });
}

function createOpenMapPopupHtml(group: MapStopGroup) {
  const labels = escapeHtml(group.stops.map((stop) => stop.label).join(', '));
  const dateRange = escapeHtml(group.dateRangeLabel || 'No dates');
  const notes = escapeHtml(group.stops[0]?.notes || 'No notes yet.');

  return `
    <div class="map-info open-map-popup">
      <strong>${labels}</strong>
      <small>${dateRange}</small>
      <p>${notes}</p>
    </div>
  `;
}

function OpenStreetMapCanvas({
  fitSignal,
  isPlacingPin,
  gasPriceScaling,
  markerLabelMode,
  onDriveEstimatesChange,
  onPlacePin,
  onRouteDistanceChange,
  onSelectStop,
  selectedStopId,
  showHotelFinder,
  stops,
  reason,
}: MapCanvasProps & { reason: string }) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const isPlacingPinRef = useRef(isPlacingPin);
  const onPlacePinRef = useRef(onPlacePin);
  const onSelectStopRef = useRef(onSelectStop);
  const selectedStop = useMemo(
    () => stops.find((stop) => stop.id === selectedStopId) || null,
    [selectedStopId, stops],
  );
  const mapStopGroups = useMemo(() => groupMapStops(stops), [stops]);
  const path = useMemo(() => stops.map((stop) => [stop.lat, stop.lng] as [number, number]), [stops]);
  const routeKey = useMemo(() => buildRouteCacheKey(stops), [stops]);
  const mapCenter = useMemo(
    () =>
      [
        selectedStop?.lat || stops[0]?.lat || usCenter.lat,
        selectedStop?.lng || stops[0]?.lng || usCenter.lng,
      ] as [number, number],
    [selectedStop, stops],
  );

  useEffect(() => {
    isPlacingPinRef.current = isPlacingPin;
  }, [isPlacingPin]);

  useEffect(() => {
    onPlacePinRef.current = onPlacePin;
  }, [onPlacePin]);

  useEffect(() => {
    onSelectStopRef.current = onSelectStop;
  }, [onSelectStop]);

  useEffect(() => {
    onRouteDistanceChange(null);
    onDriveEstimatesChange(null);
  }, [onDriveEstimatesChange, onRouteDistanceChange, routeKey]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return undefined;

    const map = L.map(mapElementRef.current, {
      zoomControl: true,
    }).setView(mapCenter, 4);
    const handleMapClick = (event: L.LeafletMouseEvent) => {
      if (!isPlacingPinRef.current) return;

      onPlacePinRef.current({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    };

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', handleMapClick);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.off('click', handleMapClick);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;

    markerLayer.clearLayers();
    routeLayerRef.current?.remove();
    const routeGroup = L.layerGroup();
    const carLegGasPrices = gasPriceScaling ? getCarLegGasPrices(stops) : [];

    if (carLegGasPrices.length) {
      const gasPriceColor = createGasPriceColor(Math.min(...carLegGasPrices), Math.max(...carLegGasPrices));

      buildStraightGasLegSegments(stops).forEach((segment) => {
        L.polyline(
          segment.path.map((point) => [point.lat, point.lng] as [number, number]),
          {
            color: gasPriceColor(segment.gasPrice),
            opacity: 0.95,
            weight: 4,
          },
        ).addTo(routeGroup);
      });
    } else if (path.length > 1) {
      L.polyline(path, {
        color: defaultRouteColor,
        opacity: 0.95,
        weight: 4,
      }).addTo(routeGroup);
    }

    routeGroup.addTo(map);
    routeLayerRef.current = routeGroup;

    const selectedMarkers: L.Marker[] = [];
    mapStopGroups.forEach((group) => {
      const selectedInGroup = group.stops.some((stop) => stop.id === selectedStopId);
      const marker = L.marker([group.position.lat, group.position.lng], {
        icon: createOpenMapStopIcon(group, selectedInGroup, markerLabelMode),
        title: group.stops.map((stop) => stop.label).join(', '),
      })
        .bindPopup(createOpenMapPopupHtml(group))
        .on('click', () => onSelectStopRef.current(group.stops[0]?.id || null));

      markerLayer.addLayer(marker);
      if (selectedInGroup) {
        selectedMarkers.push(marker);
      }
    });

    selectedMarkers[0]?.openPopup();
  }, [gasPriceScaling, mapStopGroups, markerLabelMode, path, selectedStopId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stops.length) return;

    const positions = stops.map((stop) => [stop.lat, stop.lng] as [number, number]);
    if (positions.length === 1) {
      map.setView(positions[0], 6);
      return;
    }

    map.fitBounds(L.latLngBounds(positions), { padding: [72, 72] });
  }, [fitSignal, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStop) return;

    map.panTo([selectedStop.lat, selectedStop.lng]);
  }, [selectedStop]);

  return (
    <>
      <div ref={mapElementRef} className="open-map" />
      {showHotelFinder && (
        <div className="hotel-status error">Hotel finder needs Google Places; unavailable in OpenStreetMap fallback.</div>
      )}
      <div className="route-status warning">
        <span>{reason}; using estimated path.</span>
      </div>
    </>
  );
}

function MapCanvas({
  apiKey,
  stops,
  selectedStopId,
  fitSignal,
  isPlacingPin,
  showHotelFinder,
  gasPriceScaling,
  markerLabelMode,
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
  const [routeQuotaExhausted, setRouteQuotaExhausted] = useState(() => hasRememberedRouteQuotaExhaustion());
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
  const carLegGasPrices = useMemo(() => (gasPriceScaling ? getCarLegGasPrices(stops) : []), [gasPriceScaling, stops]);
  const showGasColors = gasPriceScaling && carLegGasPrices.length > 0;
  const gasPriceColor = useMemo(
    () => createGasPriceColor(Math.min(...carLegGasPrices), Math.max(...carLegGasPrices)),
    [carLegGasPrices],
  );
  const roadGasLegSegments = useMemo(
    () => (showGasColors && routeStatus === 'ready' ? buildRoadGasLegSegments(routePaths, stops) : []),
    [routePaths, routeStatus, showGasColors, stops],
  );
  const straightGasLegSegments = useMemo(
    () => (showGasColors && routeStatus === 'fallback' ? buildStraightGasLegSegments(stops) : []),
    [routeStatus, showGasColors, stops],
  );

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

    const routeChunks = splitStopsForDirections(stops);
    if (!routeChunks.length) {
      setRoutePaths([]);
      setRouteHotelSearchPoints([]);
      setRouteStatus('idle');
      setRouteError('');
      setRouteNoticeDismissed(false);
      onRouteDistanceChange(0);
      onDriveEstimatesChange([]);
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

    const rememberedRouteQuotaExhaustion = hasRememberedRouteQuotaExhaustion();
    if (routeQuotaExhausted && !rememberedRouteQuotaExhaustion) {
      setRouteQuotaExhausted(false);
    }

    if (rememberedRouteQuotaExhaustion) {
      if (!routeQuotaExhausted) {
        setRouteQuotaExhausted(true);
      }
      setRoutePaths([]);
      setRouteHotelSearchPoints([]);
      setRouteStatus('fallback');
      setRouteError(getRouteQuotaFallbackMessage());
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
      google.maps
        .importLibrary('routes')
        .then((library) => {
          const routeLibrary = library as RoadRoutesLibrary;
          if (!('Route' in routeLibrary)) {
            throw new Error('ROUTES_LIBRARY_UNAVAILABLE');
          }

          return requestRoadRoutes(routeLibrary, routeChunks);
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
            rememberRouteQuotaExhaustion();
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
        const rankedHotels = pickDistributedHotelCandidates(
          Array.from(candidatesById.values()),
          maxHotelCandidates,
        );
        const everySearchFailed = failedSearches === hotelSearchPoints.length;

        setHotelCandidates(rankedHotels);
        setHotelStatus(everySearchFailed ? 'error' : 'ready');
        setHotelMessage(
          everySearchFailed
            ? 'Hotel search is unavailable for this route.'
            : rankedHotels.length
            ? `${rankedHotels.length} hotel options spread along the route${messageSuffix}.`
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
      <OpenStreetMapCanvas
        apiKey={apiKey}
        stops={stops}
        selectedStopId={selectedStopId}
        fitSignal={fitSignal}
        isPlacingPin={isPlacingPin}
        showHotelFinder={showHotelFinder}
        gasPriceScaling={gasPriceScaling}
        markerLabelMode={markerLabelMode}
        onSelectStop={onSelectStop}
        onPlacePin={onPlacePin}
        onRouteDistanceChange={onRouteDistanceChange}
        onDriveEstimatesChange={onDriveEstimatesChange}
        reason="Google Maps unavailable; OpenStreetMap fallback active"
      />
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
        !showGasColors &&
        routePaths.map((routePath, index) => (
          <PolylineF
            key={`route-${index}`}
            path={routePath}
            options={{
              strokeColor: defaultRouteColor,
              strokeOpacity: 0.95,
              strokeWeight: 5,
            }}
          />
        ))}

      {routeStatus === 'ready' &&
        showGasColors &&
        roadGasLegSegments.map((segment) => (
          <PolylineF
            key={`gas-route-${segment.fromStopId}-${segment.toStopId}`}
            path={segment.path}
            options={{
              strokeColor: gasPriceColor(segment.gasPrice),
              strokeOpacity: 0.95,
              strokeWeight: 5,
            }}
          />
        ))}

      {routeStatus === 'fallback' && path.length > 1 && !showGasColors && (
        <PolylineF
          path={path}
          options={{
            strokeColor: defaultRouteColor,
            strokeOpacity: 0.95,
            strokeWeight: 4,
          }}
        />
      )}

      {routeStatus === 'fallback' &&
        showGasColors &&
        straightGasLegSegments.map((segment) => (
          <PolylineF
            key={`gas-fallback-${segment.fromStopId}-${segment.toStopId}`}
            path={segment.path}
            options={{
              strokeColor: gasPriceColor(segment.gasPrice),
              strokeOpacity: 0.95,
              strokeWeight: 4,
            }}
          />
        ))}

      {mapStopGroups.map((group) => {
        const selectedInGroup = group.stops.some((stop) => stop.id === selectedStopId);
        const markerLabel = getMapMarkerLabel(group, markerLabelMode);
        const className = [
          'map-stop-marker',
          getSleepClass(group.sleepingArrangement),
          markerLabelMode === 'date' ? 'dated' : '',
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
                  ? `Days ${group.dayRangeLabel}: ${heading} (${group.dateRangeLabel})`
                  : `${heading}: ${group.dateRangeLabel}`
              }
              aria-label={
                group.stops.length > 1
                  ? `Days ${group.dayRangeLabel}, ${group.dateRangeLabel}, ${group.stops.length} stops at ${heading}`
                  : `${formatStopDayLabel(group.stops[0], stops)}, ${heading}`
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
            <div className="hotel-info-links">
              {selectedHotel.website && (
                <a href={selectedHotel.website} target="_blank" rel="noreferrer">
                  Hotel website
                </a>
              )}
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
                ? `Days ${selectedMapGroup.dayRangeLabel} | ${selectedMapGroup.dateRangeLabel}`
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
                  {selectedStop.order > 1 && selectedStop.travelMode !== 'car' && (
                    <span className="stop-tag travel">{getTravelModeLabel(selectedStop.travelMode)}</span>
                  )}
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
