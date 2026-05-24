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
const maxBodyBytes = 2 * 1024 * 1024;

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
