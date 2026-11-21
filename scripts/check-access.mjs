// Checks that workspaces and saved trips are private to each access key.
// Usage: DATABASE_URL=<throwaway postgres> node scripts/check-access.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.log('Skipped: set DATABASE_URL to a throwaway Postgres database.');
  process.exit(0);
}

const port = 5329;
const base = `http://127.0.0.1:${port}`;
const keyA = randomBytes(24).toString('hex');
const keyB = randomBytes(24).toString('hex');
const legacyId = `legacy-trip-${randomBytes(4).toString('hex')}`;
const trip = (id, name, workspaceId = 'workspace-default') => ({
  id,
  workspaceId,
  name,
  updatedAt: new Date().toISOString(),
  stops: [{ id: 'stop-1', label: 'Jacksonville, FL', lat: 30.33, lng: -81.66 }],
});
const call = (method, path, key, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'x-access-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const names = async (key) => (await (await call('GET', '/api/trips', key)).json()).map((saved) => saved.name);

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await fetch(`${base}/`).then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const [method, path] of [['GET', '/api/trips'], ['GET', '/api/workspaces'], ['PUT', '/api/trips/x'], ['DELETE', '/api/trips/x'], ['DELETE', '/api/workspaces/x']]) {
    assert.equal((await call(method, path)).status, 401, `${method} ${path} without a key`);
  }
  assert.equal((await call('GET', '/api/trips', 'short')).status, 401, 'malformed key');

  assert.equal((await call('PUT', '/api/trips/same-id', keyA, trip('same-id', 'A trip', 'workspace-a'))).status, 200);
  assert.equal((await call('PUT', '/api/workspaces/workspace-a', keyA, { id: 'workspace-a', name: 'A' })).status, 200);
  assert.equal((await call('PUT', '/api/trips/same-id', keyB, trip('same-id', 'B trip'))).status, 200);
  assert.deepEqual(await names(keyA), ['A trip'], 'same client id under two keys stays separate');
  assert.deepEqual(await names(keyB), ['B trip']);
  assert.deepEqual((await (await call('GET', '/api/workspaces', keyB)).json()), [], 'B cannot list A workspaces');

  await call('DELETE', '/api/trips/same-id', keyB);
  await call('DELETE', '/api/workspaces/workspace-a', keyB);
  assert.deepEqual(await names(keyA), ['A trip'], 'B deletes cannot touch A rows');
  assert.equal((await (await call('GET', '/api/workspaces', keyA)).json()).length, 1);

  await db.query('INSERT INTO saved_trips (id, trip) VALUES ($1, $2::jsonb)', [legacyId, trip(legacyId, 'Legacy trip')]);
  assert.equal((await call('PUT', `/api/trips/${legacyId}`, keyB, trip(legacyId, 'Overwrite'))).status, 200);
  const legacy = await db.query('SELECT trip FROM saved_trips WHERE id = $1', [legacyId]);
  assert.equal(legacy.rows[0].trip.name, 'Legacy trip', 'legacy rows cannot be overwritten');
  assert.ok(!(await names(keyA)).includes('Legacy trip'), 'legacy rows are not listed');

  await call('DELETE', '/api/workspaces/workspace-a', keyA);
  assert.deepEqual(await names(keyA), [], 'owner can delete its workspace and trips');
  console.log('check-access: all assertions passed');
} finally {
  await db.query('DELETE FROM saved_trips WHERE id = $1 OR id LIKE $2', [legacyId, `%:${legacyId}`]).catch(() => {});
  await call('DELETE', '/api/trips/same-id', keyB).catch(() => {});
  await db.end();
  server.kill();
}
