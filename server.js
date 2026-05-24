import 'dotenv/config';

import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;
const openaiToken = process.env.OPENAI_TOKEN || process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || 'gpt-5-mini';
const maxBodyBytes = 2 * 1024 * 1024;

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
            required: ['id', 'order', 'date', 'label', 'lat', 'lng', 'notes', 'remoteWork'],
            properties: {
              id: { type: 'string' },
              order: { type: 'number' },
              date: { type: 'string' },
              label: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
              notes: { type: 'string' },
              remoteWork: { type: 'boolean' },
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
    }))
    .filter((stop) => stop.lat >= -90 && stop.lat <= 90 && stop.lng >= -180 && stop.lng <= 180)
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index + 1 }));

  if (!stops.length) return null;

  return {
    id: value.id,
    name: value.name.trim() || 'Untitled trip',
    notes: typeof value.notes === 'string' ? value.notes : '',
    stops,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
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
  };
}

function enforceRouteAssistantLocks(originalTrip, proposedTrip) {
  const lockedStart = originalTrip.stops[0];
  const lockedEnd = originalTrip.stops[originalTrip.stops.length - 1];
  const hasDistinctEnd = originalTrip.stops.length > 1;
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

  const stops = hasDistinctEnd
    ? [makeLockedStop(lockedStart, 1), ...proposedMiddle, makeLockedStop(lockedEnd, proposedMiddle.length + 2)]
    : [makeLockedStop(lockedStart, 1), ...proposedMiddle];

  return normalizeTrip({
    ...proposedTrip,
    stops,
  }) || proposedTrip;
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;

  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n');
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

async function handleApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/route-assistant') {
    if (!openaiToken) {
      sendJson(response, 503, { error: 'OPENAI_NOT_CONFIGURED' });
      return;
    }

    const body = await readJsonBody(request);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const trip = normalizeTrip(body.trip);

    if (!instruction || instruction.length > 1600 || !trip) {
      sendJson(response, 400, { error: 'INVALID_ROUTE_ASSISTANT_REQUEST' });
      return;
    }

    const lockedAnchors = buildRouteAssistantLocks(trip);

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
          'The first and last stops are locked anchors. Keep them as the first and last stops with the same date, label, latitude, and longitude.',
          'The locked start/end date range cannot change. Keep all dated stops inside that inclusive range when both dates are known.',
          'If the user asks to change a locked start/end date or location, ignore that part and explain in the summary that those anchors stayed locked.',
          'Preserve useful existing dates, notes, remoteWork flags, and stops unless the user asks to change them.',
          'Use approximate latitude and longitude for well-known places when adding stops.',
          'Every stop must have order starting at 1, a human-readable label, numeric lat/lng, notes, date, and remoteWork.',
          'Keep dates as YYYY-MM-DD strings when dates are known; otherwise use an empty string.',
          'Do not save anything. This is only a proposed draft trip for the user to review.',
        ].join(' '),
        input: JSON.stringify({
          instruction,
          lockedAnchors,
          trip,
        }),
        max_output_tokens: 12000,
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
    let proposal = null;
    try {
      proposal = outputText ? JSON.parse(outputText) : null;
    } catch {
      proposal = null;
    }
    const proposedTrip = normalizeTrip(proposal?.trip);

    if (!proposal || typeof proposal.summary !== 'string' || !proposedTrip) {
      sendJson(response, 502, { error: 'INVALID_OPENAI_RESPONSE' });
      return;
    }

    const anchoredTrip = enforceRouteAssistantLocks(trip, proposedTrip);

    sendJson(response, 200, {
      summary: `${proposal.summary} Start/end date and locations stayed locked.`,
      trip: anchoredTrip,
    });
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

    const trip = await readJsonBody(request);
    if (!isTrip(trip) || trip.id !== tripId) {
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

async function serveStatic(request, response, url) {
  const requestPath = decodeURIComponent(url.pathname);
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
