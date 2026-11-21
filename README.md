# Road Trip Planner

A small React + TypeScript + Vite web app that visualizes a USA road trip itinerary on Google Maps.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local env file from the example:
   ```bash
   cp .env.example .env
   ```
3. Add your Google Maps API key to `.env`:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=your_api_key_here
   ```
4. Optionally add a Postgres connection string to persist workspaces and saved trips outside the browser:
   ```env
   DATABASE_URL=postgresql://user:password@host:5432/database
   ```
5. Optionally add OpenAI credentials for the AI route editor:
   ```env
   OPENAI_TOKEN=your_openai_api_token_here
   OPENAI_MODEL=gpt-5
   OPENAI_TRIP_STARTER_MODEL=gpt-5-mini
   OPENAI_REASONING_EFFORT=low
   ```
6. Start the frontend dev server:
   ```bash
   npm run dev
   ```

To test database-backed workspaces and saved trips locally, build and run the production server:
```bash
npm run build
npm start
```

## Railway deployment

1. Deploy this repository from GitHub to Railway.
2. In Railway project variables, add:
   - `VITE_GOOGLE_MAPS_API_KEY` with your real API key.
   - `DATABASE_URL` from a Railway Postgres database, or another Postgres provider.
   - `OPENAI_TOKEN` for the AI route editor.
   - `OPENAI_MODEL` if you want to override the default `gpt-5`.
   - `OPENAI_TRIP_STARTER_MODEL` if you want to override the default `gpt-5-mini`.
   - `OPENAI_REASONING_EFFORT` if you want to override the default `low` reasoning effort.
3. Railway will build and run using:
   - Build: `npm run build`
   - Start: `npm run start`

The server creates `workspaces` and `saved_trips` tables automatically when `DATABASE_URL` is configured. If the database is not configured or unavailable, workspaces and saved trips fall back to browser storage.

## Access keys

Each browser makes a random access key and sends it as `x-access-key`. The server stores rows as `<sha256(key)>:<id>` and only lists, saves or deletes rows for that key. **Workspaces → Copy sync link** opens the same workspaces on another device. Anyone with the link can see and edit them.

Rows saved before access keys existed have no prefix, so no key can see them. To give them to one key, run this once against the database (replace `PASTE_KEY` with the part of a sync link after `#key=`):

```sql
WITH k AS (SELECT encode(sha256(convert_to('PASTE_KEY', 'UTF8')), 'hex') || ':' AS p)
UPDATE workspaces w SET id = k.p || w.id FROM k
WHERE w.id !~ '^[0-9a-f]{64}:' AND NOT EXISTS (SELECT 1 FROM workspaces x WHERE x.id = k.p || w.id);
WITH k AS (SELECT encode(sha256(convert_to('PASTE_KEY', 'UTF8')), 'hex') || ':' AS p)
UPDATE saved_trips t SET id = k.p || t.id FROM k
WHERE t.id !~ '^[0-9a-f]{64}:' AND NOT EXISTS (SELECT 1 FROM saved_trips x WHERE x.id = k.p || t.id);
```

Add `AND w.id IN (...)` / `AND t.trip->>'workspaceId' IN (...)` to hand only some workspaces to a key.

`npm test` runs `scripts/check-access.mjs`, which needs `DATABASE_URL` pointing at a throwaway database.

> Do not commit real API keys. Keep them in local `.env` files and Railway environment variables.
