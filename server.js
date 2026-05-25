import 'dotenv/config';

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, '.data');
const sharedTripsFile = path.join(dataDir, 'shared-trips.json');
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;
const openaiToken = process.env.OPENAI_TOKEN || process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || 'gpt-5-mini';
const maxBodyBytes = 8 * 1024 * 1024;
const maxRouteAssistantInstructionChars = 12000;
const routeAssistantCooldownMs = 30 * 1000;
const defaultWorkspaceId = 'workspace-default';
const tripExportFormat = 'road-trip-planner.saved-trip.v1';
const maxFileSharedTrips = 500;
const targetCarLegMiles = 450;
const estimatedCarAverageMph = 55;
const defaultMaxOneDayCarDriveHours = 14;
const travelModeOptions = ['car', 'plane', 'boat'];

const routeProposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'trip'],
  properties: {
    summary: {
      type: 'string',
    },
    trip: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'notes', 'createdAt', 'updatedAt', 'stops'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        notes: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        stops: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'id',
              'order',
              'date',
              'label',
              'lat',
              'lng',
              'notes',
              'remoteWork',
              'sleepingArrangement',
              'friendName',
              'travelMode',
            ],
            properties: {
              id: { type: 'string' },
              order: { type: 'number' },
              date: { type: 'string' },
              label: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
              notes: { type: 'string' },
              remoteWork: { type: 'boolean' },
              sleepingArrangement: { type: 'string', enum: ['camping', 'hotel', 'friend'] },
              friendName: { type: 'string' },
              travelMode: { type: 'string', enum: travelModeOptions },
            },
          },
        },
      },
    },
  },
};

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    })
  : null;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

let databaseSetupError = null;
let fileSharedTripsReady = false;
let fileSharedTripsWriteQueue = Promise.resolve();
let nextRouteAssistantAllowedAt = 0;
const fileSharedTrips = new Map();

function normalizeSleepingArrangement(value) {
  return ['camping', 'hotel', 'friend'].includes(value) ? value : 'camping';
}

function normalizeTravelMode(value) {
  return travelModeOptions.includes(value) ? value : 'car';
}

function normalizeMaxCarLegHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return defaultMaxOneDayCarDriveHours;

  return Math.min(24, Math.max(1, hours));
}

function normalizeDocumentKind(value) {
  return value === 'file' ? 'file' : 'text';
}

function normalizeTripDocument(value, stopIds) {
  if (!value || typeof value !== 'object') return null;

  const now = new Date().toISOString();
  const kind = normalizeDocumentKind(value.kind);
  const linkedStopId = typeof value.linkedStopId === 'string' && stopIds.has(value.linkedStopId)
    ? value.linkedStopId
    : '';
  const fileName = typeof value.fileName === 'string' ? value.fileName : '';
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';

  if (kind === 'file' && !dataUrl) return null;

  return {
    id: typeof value.id === 'string' && value.id ? value.id : `document-${Date.now()}`,
    title:
      (typeof value.title === 'string' && value.title.trim()) ||
      fileName ||
      (kind === 'file' ? 'Untitled file' : 'Untitled note'),
    kind,
    linkedStopId,
    text: kind === 'text' && typeof value.text === 'string' ? value.text : '',
    fileName: kind === 'file' ? fileName : '',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'text/plain',
    fileSize: Number.isFinite(Number(value.fileSize)) ? Number(value.fileSize) : 0,
    dataUrl: kind === 'file' ? dataUrl : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

const databaseReady = pool
  ? pool.query(`
      CREATE TABLE IF NOT EXISTS saved_trips (
        id text PRIMARY KEY,
        trip jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT saved_trips_trip_object CHECK (jsonb_typeof(trip) = 'object')
      );

      CREATE INDEX IF NOT EXISTS saved_trips_updated_at_idx
        ON saved_trips (updated_at DESC);

      CREATE TABLE IF NOT EXISTS shared_trips (
        id text PRIMARY KEY,
        export jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT shared_trips_export_object CHECK (jsonb_typeof(export) = 'object')
      );

      CREATE INDEX IF NOT EXISTS shared_trips_created_at_idx
        ON shared_trips (created_at DESC);
    `).catch((error) => {
      databaseSetupError = error;
      console.error('Database setup failed:', error);
    })
  : Promise.resolve();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendEmpty(response, statusCode) {
  response.writeHead(statusCode, { 'cache-control': 'no-store' });
  response.end();
}

async function requireDatabase(response) {
  if (!pool) {
    sendJson(response, 503, { error: 'DATABASE_NOT_CONFIGURED' });
    return false;
  }

  await databaseReady;
  if (databaseSetupError) {
    sendJson(response, 503, { error: 'DATABASE_UNAVAILABLE' });
    return false;
  }

  return true;
}

function isTrip(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.stops)
  );
}

function normalizeTrip(value) {
  if (!isTrip(value)) return null;

  const now = new Date().toISOString();
  const stops = value.stops
    .filter((stop) => stop && typeof stop === 'object' && typeof stop.label === 'string')
    .map((stop, index) => ({
      id: typeof stop.id === 'string' && stop.id ? stop.id : `stop-${index + 1}`,
      order: Number.isFinite(Number(stop.order)) ? Number(stop.order) : index + 1,
      date: typeof stop.date === 'string' ? stop.date : '',
      label: stop.label || 'Untitled stop',
      lat: Number.isFinite(Number(stop.lat)) ? Number(stop.lat) : 39.8283,
      lng: Number.isFinite(Number(stop.lng)) ? Number(stop.lng) : -98.5795,
      notes: typeof stop.notes === 'string' ? stop.notes : '',
      remoteWork: Boolean(stop.remoteWork),
      sleepingArrangement: normalizeSleepingArrangement(stop.sleepingArrangement),
      friendName: typeof stop.friendName === 'string' ? stop.friendName : '',
      travelMode: index === 0 ? 'car' : normalizeTravelMode(stop.travelMode),
    }))
    .filter((stop) => stop.lat >= -90 && stop.lat <= 90 && stop.lng >= -180 && stop.lng <= 180)
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index + 1 }));

  if (!stops.length) return null;
  const stopIds = new Set(stops.map((stop) => stop.id));
  const documents = Array.isArray(value.documents)
    ? value.documents
        .map((document) => normalizeTripDocument(document, stopIds))
        .filter(Boolean)
    : [];

  return {
    id: value.id,
    workspaceId:
      typeof value.workspaceId === 'string' && value.workspaceId
        ? value.workspaceId
        : defaultWorkspaceId,
    name: value.name.trim() || 'Untitled trip',
    notes: typeof value.notes === 'string' ? value.notes : '',
    stops,
    documents,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function normalizeSharedTripExport(value) {
  if (!value || typeof value !== 'object') return null;

  const exportedAt = typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString();
  const trip = normalizeTrip(value.trip || value);
  if (!trip) return null;

  const sharedTrip = normalizeTrip({
    ...trip,
    documents: [],
  });

  if (!sharedTrip) return null;

  return {
    format: tripExportFormat,
    exportedAt,
    trip: sharedTrip,
  };
}

function createShareSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');

  return slug || 'road-trip';
}

function isShareSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isLegacyShareId(value) {
  return typeof value === 'string' && /^[a-f0-9]{10,20}$/i.test(value);
}

function getShareSlugCandidates(value) {
  if (typeof value !== 'string') return [];

  const slug = createShareSlug(value);
  const candidates = isShareSlug(slug) ? [slug] : [];
  const legacyId = value.trim().match(/(?:^|[-_])([a-f0-9]{10,20})$/i)?.[1]?.toLowerCase() || '';

  if (legacyId && !candidates.includes(legacyId)) {
    candidates.push(legacyId);
  }

  return candidates;
}

function createDuplicateShareSlugError(id) {
  const error = new Error('SHARED_TRIP_NAME_EXISTS');
  error.code = 'SHARED_TRIP_NAME_EXISTS';
  error.id = id;
  return error;
}

async function canUseDatabase() {
  if (!pool) return false;

  await databaseReady;
  return !databaseSetupError;
}

async function loadFileSharedTrips() {
  if (fileSharedTripsReady) return;

  fileSharedTripsReady = true;

  try {
    const raw = await readFile(sharedTripsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    parsed.forEach((record) => {
      const id = Array.isArray(record) ? record[0] : record?.id;
      const exportedTrip = Array.isArray(record) ? record[1] : record?.export;
      const normalizedExport = normalizeSharedTripExport(exportedTrip);
      if ((isShareSlug(id) || isLegacyShareId(id)) && normalizedExport) {
        fileSharedTrips.set(id.toLowerCase(), normalizedExport);
      }
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Shared trip file load failed:', error);
    }
  }
}

async function persistFileSharedTrips() {
  const records = Array.from(fileSharedTrips.entries()).slice(-maxFileSharedTrips);

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    sharedTripsFile,
    `${JSON.stringify(records.map(([id, exportedTrip]) => ({ id, export: exportedTrip })), null, 2)}\n`,
    'utf8',
  );
}

function queueFileSharedTripsSave() {
  fileSharedTripsWriteQueue = fileSharedTripsWriteQueue
    .catch(() => undefined)
    .then(() => persistFileSharedTrips());

  return fileSharedTripsWriteQueue;
}

async function fileShareSlugExists(id) {
  await loadFileSharedTrips();
  return fileSharedTrips.has(id);
}

async function databaseShareSlugExists(id) {
  const result = await pool.query('SELECT 1 FROM shared_trips WHERE id = $1', [id]);
  return Boolean(result.rowCount);
}

async function saveSharedTripExport(exportedTrip) {
  const useDatabase = await canUseDatabase();
  const id = createShareSlug(exportedTrip.trip?.name);
  const exists = useDatabase ? await databaseShareSlugExists(id) : await fileShareSlugExists(id);

  if (exists) {
    throw createDuplicateShareSlugError(id);
  }

  if (useDatabase) {
    try {
      await pool.query(
        `
          INSERT INTO shared_trips (id, export)
          VALUES ($1, $2::jsonb)
        `,
        [id, JSON.stringify(exportedTrip)],
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw createDuplicateShareSlugError(id);
      }

      throw error;
    }

    return { id, durable: true };
  }

  await loadFileSharedTrips();
  fileSharedTrips.set(id, exportedTrip);
  while (fileSharedTrips.size > maxFileSharedTrips) {
    const oldestId = fileSharedTrips.keys().next().value;
    if (!oldestId) break;
    fileSharedTrips.delete(oldestId);
  }
  await queueFileSharedTripsSave();

  return { id, durable: true };
}

async function readSharedTripExport(id) {
  const shareIds = getShareSlugCandidates(id);
  if (!shareIds.length) return null;

  if (await canUseDatabase()) {
    const result = await pool.query(
      'SELECT export FROM shared_trips WHERE id = ANY($1::text[]) ORDER BY array_position($1::text[], id) LIMIT 1',
      [shareIds],
    );
    return normalizeSharedTripExport(result.rows[0]?.export);
  }

  await loadFileSharedTrips();
  const matchedId = shareIds.find((shareId) => fileSharedTrips.has(shareId));
  return normalizeSharedTripExport(matchedId ? fileSharedTrips.get(matchedId) : null);
}

function isDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampDateToRange(date, startDate, endDate) {
  if (!isDateOnly(date) || !isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate) {
    return date;
  }

  if (date < startDate) return startDate;
  if (date > endDate) return endDate;
  return date;
}

function isSameLockedStop(stop, lockedStop) {
  return (
    stop.id === lockedStop.id ||
    (
      stop.date === lockedStop.date &&
      stop.label.trim().toLowerCase() === lockedStop.label.trim().toLowerCase() &&
      Math.abs(stop.lat - lockedStop.lat) < 0.00001 &&
      Math.abs(stop.lng - lockedStop.lng) < 0.00001
    )
  );
}

function makeLockedStop(stop, order) {
  return {
    ...stop,
    order,
  };
}

function getRemoteWorkDates(trip) {
  return new Set(
    trip.stops
      .filter((stop) => stop.remoteWork && isDateOnly(stop.date))
      .map((stop) => stop.date),
  );
}

function compareDateOnly(first, second) {
  if (isDateOnly(first) && isDateOnly(second)) return first.localeCompare(second);
  if (isDateOnly(first)) return -1;
  if (isDateOnly(second)) return 1;
  return 0;
}

function insertStopByDate(stops, stopToInsert) {
  const nextStops = [...stops];
  const insertIndex = nextStops.findIndex((stop) => compareDateOnly(stop.date, stopToInsert.date) > 0);

  if (insertIndex === -1) {
    nextStops.push(stopToInsert);
  } else {
    nextStops.splice(insertIndex, 0, stopToInsert);
  }

  return nextStops;
}

function enforceRemoteWorkDates(originalTrip, proposedStops) {
  const remoteWorkDates = getRemoteWorkDates(originalTrip);
  if (!remoteWorkDates.size) {
    return proposedStops.map((stop) => ({ ...stop, remoteWork: false }));
  }

  let stops = proposedStops.map((stop) => ({
    ...stop,
    remoteWork: isDateOnly(stop.date) && remoteWorkDates.has(stop.date),
  }));
  const proposedDates = new Set(stops.filter((stop) => isDateOnly(stop.date)).map((stop) => stop.date));

  originalTrip.stops
    .filter((stop) => stop.remoteWork && isDateOnly(stop.date) && !proposedDates.has(stop.date))
    .forEach((missingRemoteStop) => {
      stops = insertStopByDate(stops, {
        ...missingRemoteStop,
        id: `${missingRemoteStop.id}-remote-lock`,
        remoteWork: true,
      });
      proposedDates.add(missingRemoteStop.date);
    });

  return stops;
}

function normalizeCityToken(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCityTokens(label) {
  if (typeof label !== 'string') return [];

  const [cityPart, statePart = ''] = label.split(',');
  const state = normalizeCityToken(statePart);
  const cityTokens = cityPart
    .split(/\/|&|\band\b|\+/i)
    .map(normalizeCityToken)
    .filter(Boolean);
  const tokens = cityTokens.map((city) => (state ? `${city} ${state}` : city));

  if (cityTokens.length > 1) {
    const combinedCity = normalizeCityToken(cityPart);
    if (combinedCity) {
      tokens.push(state ? `${combinedCity} ${state}` : combinedCity);
    }
  }

  return Array.from(new Set(tokens));
}

function calculatePointMiles(previous, next) {
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

function estimateRoadMiles(previous, next) {
  return Math.round(calculatePointMiles(previous, next) * 1.2);
}

function looksLikePurposefulSplitDriveStop(stop) {
  const text = `${stop?.label || ''} ${stop?.notes || ''}`;

  return /\b(event|show|concert|festival|game|tour|museum|park|hike|trail|view|scenic|overlook|meal|lunch|dinner|breakfast|restaurant|reservation|appointment|wedding|conference|meet|meetup|visit|attraction|stopover|rest|break|detour|activity)\b/i.test(text);
}

function buildSameDateCarDriveDays(currentLegs, maxOneDayCarDriveHours) {
  const sessionsByDate = new Map();

  currentLegs.forEach((leg) => {
    if (leg.travelMode !== 'car' || !isDateOnly(leg.date)) return;

    const sessions = sessionsByDate.get(leg.date) || [];
    sessions.push(leg);
    sessionsByDate.set(leg.date, sessions);
  });

  return Array.from(sessionsByDate.entries())
    .filter(([, sessions]) => sessions.length > 1)
    .map(([date, sessions]) => {
      const totalDriveHours = Math.round(
        sessions.reduce((total, session) => total + session.estimatedDriveHours, 0) * 10,
      ) / 10;
      const middleStops = sessions.slice(0, -1);

      return {
        date,
        carDriveSessions: sessions.length,
        totalDriveHours,
        withinDailyLimit: totalDriveHours <= maxOneDayCarDriveHours,
        hasPurposefulMiddleStop: middleStops.some((session) => session.toLooksLikePurposefulStop),
        middleStops: middleStops.map((session) => ({
          order: session.toOrder,
          label: session.to,
          estimatedDriveHours: session.estimatedDriveHours,
          looksPurposeful: session.toLooksLikePurposefulStop,
        })),
        overnightStop: sessions[sessions.length - 1]?.to || '',
        sessions: sessions.map((session) => ({
          fromOrder: session.fromOrder,
          toOrder: session.toOrder,
          from: session.from,
          to: session.to,
          estimatedDriveMiles: session.estimatedDriveMiles,
          estimatedDriveHours: session.estimatedDriveHours,
        })),
      };
    });
}

function instructionAllowsNonCarTravel(instruction, trip) {
  if (trip.stops.some((stop, index) => index > 0 && stop.travelMode !== 'car')) return true;

  return /\b(non[-\s]?car|plane|flight|fly|flying|airport|boat|ferry|ship|sail|train|rail)\b/i.test(instruction);
}

function enforceTravelModeRules(originalTrip, proposedStops, instruction) {
  const allowNonCarTravel = instructionAllowsNonCarTravel(instruction, originalTrip);

  return proposedStops.map((stop, index) => {
    const travelMode = index === 0 ? 'car' : normalizeTravelMode(stop.travelMode);

    return {
      ...stop,
      travelMode: allowNonCarTravel ? travelMode : 'car',
    };
  });
}

function buildDrivingPlanningContext(trip, maxOneDayCarDriveHours) {
  const maxOneDayCarLegMiles = Math.round(maxOneDayCarDriveHours * estimatedCarAverageMph);
  const currentLegs = trip.stops.slice(1).map((stop, index) => {
    const previous = trip.stops[index];
    const estimatedDriveMiles = estimateRoadMiles(previous, stop);
    const estimatedDriveHours = Math.round((estimatedDriveMiles / estimatedCarAverageMph) * 10) / 10;

    return {
      fromOrder: previous.order,
      toOrder: stop.order,
      from: previous.label,
      to: stop.label,
      date: stop.date,
      travelMode: stop.travelMode,
      sameDateAsPreviousStop:
        isDateOnly(stop.date) && isDateOnly(previous.date) && stop.date === previous.date,
      toLooksLikePurposefulStop: looksLikePurposefulSplitDriveStop(stop),
      toRemoteWork: stop.remoteWork,
      estimatedDriveMiles,
      estimatedDriveHours,
      traversableInOneDay:
        stop.travelMode !== 'car' || estimatedDriveHours <= maxOneDayCarDriveHours,
    };
  });

  return {
    travelMode: 'passenger-car',
    routeBasis: 'public roads and car-accessible stops',
    targetCarLegMiles,
    maxOneDayCarLegMiles,
    estimatedCarAverageMph,
    maxOneDayCarDriveHours,
    currentLegs,
    sameDateCarDriveDays: buildSameDateCarDriveDays(currentLegs, maxOneDayCarDriveHours),
  };
}

function getAllowedFriendStays(originalTrip) {
  return originalTrip.stops
    .filter((stop) => stop.sleepingArrangement === 'friend' && typeof stop.friendName === 'string' && stop.friendName.trim())
    .map((stop) => ({
      friendName: stop.friendName.trim(),
      cityTokens: getCityTokens(stop.label),
      position: { lat: stop.lat, lng: stop.lng },
    }));
}

function findAllowedFriendStay(stop, allowedFriendStays) {
  const stopCityTokens = new Set(getCityTokens(stop.label));

  return allowedFriendStays.find((friendStay) => {
    if (friendStay.cityTokens.some((cityToken) => stopCityTokens.has(cityToken))) return true;

    return calculatePointMiles(friendStay.position, { lat: stop.lat, lng: stop.lng }) <= 25;
  });
}

function enforceFriendStayRules(stops, allowedFriendStays) {
  return stops.map((stop) => {
    if (stop.sleepingArrangement !== 'friend') {
      return {
        ...stop,
        friendName: '',
      };
    }

    const allowedFriendStay = findAllowedFriendStay(stop, allowedFriendStays);
    if (allowedFriendStay) {
      return {
        ...stop,
        friendName: allowedFriendStay.friendName,
      };
    }

    return {
      ...stop,
      sleepingArrangement: 'camping',
      friendName: '',
    };
  });
}

function buildRouteAssistantLocks(trip) {
  const start = trip.stops[0];
  const end = trip.stops[trip.stops.length - 1];

  return {
    start: {
      order: 1,
      date: start.date,
      label: start.label,
      lat: start.lat,
      lng: start.lng,
    },
    end: {
      order: trip.stops.length,
      date: end.date,
      label: end.label,
      lat: end.lat,
      lng: end.lng,
    },
    dateRange: {
      startDate: start.date,
      endDate: end.date,
    },
    remoteWorkDates: Array.from(getRemoteWorkDates(trip)).sort(),
    friendStayCities: getAllowedFriendStays(trip).map((friendStay) => ({
      friendName: friendStay.friendName,
      cityTokens: friendStay.cityTokens,
    })),
  };
}

function enforceRouteAssistantLocks(originalTrip, proposedTrip, instruction) {
  const lockedStart = originalTrip.stops[0];
  const lockedEnd = originalTrip.stops[originalTrip.stops.length - 1];
  const hasDistinctEnd = originalTrip.stops.length > 1;
  const allowedFriendStays = getAllowedFriendStays(originalTrip);
  const proposedMiddle = proposedTrip.stops
    .filter((stop) => {
      if (isSameLockedStop(stop, lockedStart)) return false;
      if (hasDistinctEnd && isSameLockedStop(stop, lockedEnd)) return false;
      return true;
    })
    .map((stop) => ({
      ...stop,
      date: clampDateToRange(stop.date, lockedStart.date, lockedEnd.date),
    }));

  const lockedStops = hasDistinctEnd
    ? [makeLockedStop(lockedStart, 1), ...proposedMiddle, makeLockedStop(lockedEnd, proposedMiddle.length + 2)]
    : [makeLockedStop(lockedStart, 1), ...proposedMiddle];
  const stops = enforceTravelModeRules(
    originalTrip,
    enforceFriendStayRules(enforceRemoteWorkDates(originalTrip, lockedStops), allowedFriendStays),
    instruction,
  )
    .map((stop, index) => ({ ...stop, order: index + 1 }));

  return normalizeTrip({
    ...proposedTrip,
    workspaceId: originalTrip.workspaceId,
    stops,
  }) || proposedTrip;
}

function getRouteAssistantTripInput(trip) {
  return {
    id: trip.id,
    workspaceId: trip.workspaceId,
    name: trip.name,
    notes: trip.notes,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    stops: trip.stops,
  };
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;

  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .map((content) => {
      if (typeof content?.text === 'string') return content.text;
      if (typeof content?.json === 'object') return JSON.stringify(content.json);
      if (typeof content?.parsed === 'object') return JSON.stringify(content.parsed);
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseRouteProposalText(outputText) {
  if (!outputText) return null;

  const trimmed = outputText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;

    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function normalizeRouteProposal(proposal, originalTrip) {
  if (!proposal || typeof proposal !== 'object') return null;

  const rawTrip = Array.isArray(proposal.trip)
    ? { stops: proposal.trip }
    : proposal.trip && typeof proposal.trip === 'object'
      ? proposal.trip
      : Array.isArray(proposal.stops)
        ? { stops: proposal.stops }
        : null;

  if (!rawTrip) return null;

  const proposedTrip = normalizeTrip({
    ...originalTrip,
    ...rawTrip,
    id: typeof rawTrip.id === 'string' && rawTrip.id ? rawTrip.id : originalTrip.id,
    workspaceId: originalTrip.workspaceId,
    name:
      typeof rawTrip.name === 'string' && rawTrip.name.trim()
        ? rawTrip.name
        : originalTrip.name,
    notes: typeof rawTrip.notes === 'string' ? rawTrip.notes : originalTrip.notes,
    documents: originalTrip.documents,
    createdAt:
      typeof rawTrip.createdAt === 'string' && rawTrip.createdAt
        ? rawTrip.createdAt
        : originalTrip.createdAt,
    updatedAt:
      typeof rawTrip.updatedAt === 'string' && rawTrip.updatedAt
        ? rawTrip.updatedAt
        : new Date().toISOString(),
  });

  if (!proposedTrip) return null;

  return {
    summary:
      typeof proposal.summary === 'string' && proposal.summary.trim()
        ? proposal.summary.trim()
        : 'Draft route updated.',
    trip: proposedTrip,
  };
}

function logInvalidRouteAssistantResponse(payload, outputText) {
  console.error(
    'OpenAI route assistant returned invalid structured output:',
    JSON.stringify({
      status: payload?.status,
      incomplete_details: payload?.incomplete_details,
      outputTextPreview: typeof outputText === 'string' ? outputText.slice(0, 1000) : '',
    }),
  );
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    request.on('error', reject);
  });
}

function checkRouteAssistantRateLimit(response) {
  const now = Date.now();
  if (now < nextRouteAssistantAllowedAt) {
    const retryAfterSeconds = Math.ceil((nextRouteAssistantAllowedAt - now) / 1000);

    response.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(retryAfterSeconds),
    });
    response.end(`${JSON.stringify({
      error: 'ROUTE_ASSISTANT_RATE_LIMITED',
      retryAfterSeconds,
    })}\n`);
    return false;
  }

  nextRouteAssistantAllowedAt = now + routeAssistantCooldownMs;
  return true;
}

async function handleApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/route-assistant') {
    if (!openaiToken) {
      sendJson(response, 503, { error: 'OPENAI_NOT_CONFIGURED' });
      return;
    }

    if (!checkRouteAssistantRateLimit(response)) return;

    const body = await readJsonBody(request);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const trip = normalizeTrip(body.trip);

    if (!instruction || instruction.length > maxRouteAssistantInstructionChars || !trip) {
      sendJson(response, 400, { error: 'INVALID_ROUTE_ASSISTANT_REQUEST' });
      return;
    }

    const lockedAnchors = buildRouteAssistantLocks(trip);
    const maxOneDayCarDriveHours = normalizeMaxCarLegHours(body.settings?.maxCarLegHours);
    const drivingPlanningContext = buildDrivingPlanningContext(trip, maxOneDayCarDriveHours);

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${openaiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        instructions: [
          'You are a route-planning assistant for a road-trip planner.',
          'Return only the requested structured JSON.',
          'Revise the supplied trip according to the user request. You may add, remove, reorder, rename, or adjust stops.',
          'Plan the itinerary for a passenger car using public roads by default. Do not add non-car travel unless the user explicitly asks for it or the supplied trip already has a non-car leg.',
          'travelMode means how the traveler gets from the previous stop to this stop. The first stop must use travelMode=car. Use travelMode=car, plane, or boat only.',
          'For car legs, every added or reordered stop must be realistically reachable by car from the surrounding stops. Prefer stops near plausible driving corridors.',
          'For plane or boat legs, use plausible airport, ferry, or dock-adjacent destinations and mention the non-car leg in notes. The app will estimate plane/boat cost separately.',
          `Every car leg must be traversable in one day: target roughly ${targetCarLegMiles} miles or less when practical, and do not create car legs over ${maxOneDayCarDriveHours} driving hours.`,
          `If a requested car route would exceed ${maxOneDayCarDriveHours} driving hours, add intermediate overnight stops with travelMode=car rather than leaving one oversized leg. Only use plane or boat for that leg if the user explicitly asks for non-car travel.`,
          "Plan each road-trip date around one primary car-driving session that ends at that date's overnight stop.",
          'Do not create multiple ordinary car-driving shifts on the same date just to chain route segments or work around the daily drive limit.',
          `Two car-driving sessions on one date are allowed only when the middle stop is a real event, reservation, meetup, scenic stop, attraction, meal, or rest break, the middle stop notes explain that purpose, and total same-date car driving stays within ${maxOneDayCarDriveHours} hours.`,
          'Do not invent fake events solely to justify split driving. If a day would need multiple normal driving shifts, move one stop to another date or add an overnight stop instead.',
          'Do not create three or more car-driving sessions on one date. Avoid adding split-drive sessions on remote-work dates unless the supplied route already had that exact pattern.',
          'The first and last stops are locked anchors. Keep them as the first and last stops with the same date, label, latitude, and longitude.',
          'The locked start/end date range cannot change. Keep all dated stops inside that inclusive range when both dates are known.',
          'If the user asks to change a locked start/end date or location, ignore that part and explain in the summary that those anchors stayed locked.',
          'Remote-work dates are locked. Keep the exact same calendar dates marked remoteWork=true as the input trip, do not add new remoteWork dates, and do not remove existing remoteWork dates.',
          'Preserve useful existing dates, notes, sleeping arrangements, friend names, and stops unless the user asks to change them.',
          'Use approximate latitude and longitude for well-known places when adding stops.',
          'Every stop must have order starting at 1, a human-readable label, numeric lat/lng, notes, date, remoteWork, sleepingArrangement, friendName, and travelMode.',
          'sleepingArrangement must be camping, hotel, or friend. Never invent a friend stay or friendName.',
          'Only use sleepingArrangement=friend in a city that already has an existing named friend stay in the supplied trip. Reuse that existing city friendName. Do not create friend stays in new cities, even if the user asks for one.',
          'For any stop that is not an allowed same-city friend stay, friendName must be an empty string. For newly added stops, default sleepingArrangement to camping unless the user explicitly asks for hotel.',
          'Keep dates as YYYY-MM-DD strings when dates are known; otherwise use an empty string.',
          'Do not save anything. This is only a proposed draft trip for the user to review.',
        ].join(' '),
        input: JSON.stringify({
          instruction,
          lockedAnchors,
          drivingPlanningContext,
          trip: getRouteAssistantTripInput(trip),
        }),
        max_output_tokens: 16000,
        text: {
          format: {
            type: 'json_schema',
            name: 'route_trip_proposal',
            strict: true,
            schema: routeProposalSchema,
          },
        },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI route assistant failed:', errorText);
      sendJson(response, 502, { error: 'OPENAI_REQUEST_FAILED' });
      return;
    }

    const payload = await openaiResponse.json();
    const outputText = extractOpenAIText(payload);
    const proposal = normalizeRouteProposal(parseRouteProposalText(outputText), trip);

    if (!proposal) {
      logInvalidRouteAssistantResponse(payload, outputText);
      sendJson(response, 502, { error: 'INVALID_OPENAI_RESPONSE' });
      return;
    }

    const anchoredTrip = enforceRouteAssistantLocks(trip, proposal.trip, instruction);
    const travelSummary = instructionAllowsNonCarTravel(instruction, trip)
      ? 'Car-first planning stayed on, with requested non-car legs allowed.'
      : 'Planned for passenger-car driving.';

    sendJson(response, 200, {
      summary: `${proposal.summary} ${travelSummary} Start/end date and locations stayed locked. Remote-work dates, friend stays, and split-driving days were kept constrained.`,
      trip: anchoredTrip,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/shared-trips') {
    const exportedTrip = normalizeSharedTripExport(await readJsonBody(request));
    if (!exportedTrip) {
      sendJson(response, 400, { error: 'INVALID_SHARED_TRIP' });
      return;
    }

    try {
      const result = await saveSharedTripExport(exportedTrip);
      sendJson(response, 201, result);
    } catch (error) {
      if (error?.code === 'SHARED_TRIP_NAME_EXISTS') {
        sendJson(response, 409, { error: 'SHARED_TRIP_NAME_EXISTS', slug: error.id });
        return;
      }

      throw error;
    }
    return;
  }

  const sharedTripMatch = url.pathname.match(/^\/api\/shared-trips\/([^/]+)$/);
  if (sharedTripMatch && request.method === 'GET') {
    const shareId = safeDecodeValue(sharedTripMatch[1]);
    const exportedTrip = await readSharedTripExport(shareId);

    if (!exportedTrip) {
      sendJson(response, 404, { error: 'SHARED_TRIP_NOT_FOUND' });
      return;
    }

    sendJson(response, 200, exportedTrip);
    return;
  }

  if (sharedTripMatch) {
    sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/trips') {
    if (!(await requireDatabase(response))) return;

    const result = await pool.query('SELECT trip FROM saved_trips ORDER BY updated_at DESC');
    sendJson(
      response,
      200,
      result.rows.map((row) => row.trip),
    );
    return;
  }

  const tripMatch = url.pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (!tripMatch) {
    sendJson(response, 404, { error: 'NOT_FOUND' });
    return;
  }

  const tripId = decodeURIComponent(tripMatch[1]);

  if (request.method === 'PUT') {
    if (!(await requireDatabase(response))) return;

    const trip = normalizeTrip(await readJsonBody(request));
    if (!trip || trip.id !== tripId) {
      sendJson(response, 400, { error: 'INVALID_TRIP' });
      return;
    }

    const updatedAt = Number.isNaN(new Date(trip.updatedAt).getTime())
      ? new Date()
      : new Date(trip.updatedAt);

    const result = await pool.query(
      `
        INSERT INTO saved_trips (id, trip, updated_at)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (id) DO UPDATE
        SET trip = EXCLUDED.trip,
            updated_at = EXCLUDED.updated_at
        RETURNING trip
      `,
      [trip.id, JSON.stringify(trip), updatedAt],
    );

    sendJson(response, 200, result.rows[0].trip);
    return;
  }

  if (request.method === 'DELETE') {
    if (!(await requireDatabase(response))) return;

    await pool.query('DELETE FROM saved_trips WHERE id = $1', [tripId]);
    sendEmpty(response, 204);
    return;
  }

  sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return '/';
  }
}

function safeDecodeValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

async function serveStatic(request, response, url) {
  const requestPath = safeDecodePathname(url.pathname);
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(distDir, normalizedPath === '/' ? 'index.html' : normalizedPath);
  const safePath = filePath.startsWith(distDir) ? filePath : path.join(distDir, 'index.html');
  const fallbackPath = path.join(distDir, 'index.html');
  const targetPath = existsSync(safePath) ? safePath : fallbackPath;

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) throw new Error('NOT_A_FILE');

    const extension = path.extname(targetPath);
    response.writeHead(200, {
      'content-type': mimeTypes.get(extension) || 'application/octet-stream',
      'cache-control': targetPath === fallbackPath ? 'no-store' : 'public, max-age=31536000, immutable',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(targetPath).pipe(response);
  } catch {
    const html = await readFile(fallbackPath, 'utf8');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'SERVER_ERROR' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Road Trip Planner listening on ${port}`);
  if (!pool) {
    console.log('DATABASE_URL is not set; saved trips will use browser fallback storage.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await pool?.end();
    process.exit(0);
  });
}
