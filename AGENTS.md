# AGENTS.md

Road Trip Planner: a single-page web app for planning a multi-stop road trip on a map (dates, sleeping arrangements, remote-work days, gas and hotel estimates, an AI route editor). Users are anonymous; each browser gets its own access key. See README.md for user-facing setup and the access-key SQL.

## Stack

- Frontend: React 18.3, TypeScript 5.9 (strict), Vite 6.4. Google Maps via `@react-google-maps/api` (road routes with `Route.computeRoutes` in chunks of 25 stops, hotels with `Place.searchNearby`, both cached in localStorage) when a Maps key is set, otherwise a Leaflet/OpenStreetMap fallback. Icons from `lucide-react`.
- Backend: one plain `node:http` server (`server.js`, ES module, no framework) that serves `dist/` and a JSON API. Postgres via `pg`. OpenAI Responses API over `fetch`.
- Nothing pins Node (no `engines` field or `.nvmrc`), so Railway uses the Nixpacks default unless a Railway variable sets a version; it can be older than the Node 24 used to verify the commands below.

## Where it runs

- Railway, built with Nixpacks from `railway.json`: build `npm run build`, start `npm run start`.
- Pushing or merging to `main` deploys production. Do not push to `main` to test something.
- Without a working database (no `DATABASE_URL`, or Postgres unreachable when the server boots) the app still works: workspaces and trips stay in browser localStorage, and shared trips go to `.data/shared-trips.json` (gitignored, newest 500 kept). That file is on local disk, so it only survives a redeploy if the host keeps the disk.

## Repo map

- `server.js` (about 2,100 lines) - HTTP server: static files from `dist/`, all `/api/*` routes, DB table setup, OpenAI calls, AI rate limit. AI replies are re-checked in code after the model returns (`enforceRouteAssistantLocks`, `optimizeEditedDrivingStops`, `enforceTripStarterRules`): anchors, the date range, remote-work dates, friend stays, travel modes and driving order are enforced there, so changing the prompt alone does not change those rules.
- `src/App.tsx` (about 7,200 lines) - the whole frontend (types, storage, share links, routing math, `App`, `MapCanvas` for Google, `OpenStreetMapCanvas` for Leaflet). Search both big files by function name instead of reading them whole.
- `src/App.css` - all styles. `src/main.tsx` - React entry. `index.html` - Vite entry.
- `src/tripStops.json` - stops of the built-in sample trip.
- `scripts/check-access.mjs` - the only test: checks rows are private per access key.
- `vite.config.ts` - Vite build and dev-server config. Its `preview` block (allowed hosts, `RAILWAY_PUBLIC_DOMAIN`) is read only by `vite preview`, which neither `package.json` nor `railway.json` runs; production runs `node server.js`.
- `.env.example` - sample values for the Maps, database and OpenAI variables. It leaves out `OPENAI_API_KEY`, `PORT` and `RAILWAY_PUBLIC_DOMAIN`, and its model and reasoning-effort values differ from the code defaults listed under Configuration.

## Commands

- Install: `npm ci` (verified).
- Build: `npm run build` = `tsc && vite build`, output in `dist/` (verified). `tsc` is the only type check and covers `src/` and `vite.config.ts`, not `server.js`.
- Frontend dev server: `npm run dev` (not run: needs a browser to check). It has no API proxy, so `/api` calls fail and the app uses browser storage.
- Full app locally: `npm run build && npm start`, serves on `PORT` or 3000 (verified: serves `dist/`; without `DATABASE_URL` the data routes return 503 `DATABASE_NOT_CONFIGURED`).
- Test: `npm test` (verified). Without `DATABASE_URL` it prints "Skipped" and exits 0. To really run it, use a throwaway Postgres: `docker run -d --rm --name rtp-pg -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=rtp -p 127.0.0.1:55471:5432 postgres:16-alpine`, wait with `until docker exec rtp-pg pg_isready -h 127.0.0.1 -U postgres -d rtp; do sleep 1; done`, run `DATABASE_URL=postgresql://postgres:throwaway@127.0.0.1:55471/rtp npm test` (verified: "all assertions passed"), then `docker stop rtp-pg`. Started before Postgres accepts TCP connections, the server's one-time table setup fails and the test gets 503s. The test inserts and deletes rows and starts the server on port 5329; never point it at a real database.
- Lint: none configured.
- Deploy: automatic from `main` on Railway (not run).

## Configuration

`server.js` loads `.env` with `dotenv`. Names only:

- `VITE_GOOGLE_MAPS_API_KEY` - Google Maps browser key; read by Vite at build time and baked into the client bundle. Changing it needs a rebuild.
- `DATABASE_URL` - Postgres connection string; enables server storage of workspaces, trips and shared trips.
- `OPENAI_TOKEN` (fallback `OPENAI_API_KEY`) - enables `/api/trip-starter`, `/api/route-assistant` and `/api/openai-models`.
- `OPENAI_MODEL` (default `gpt-5`) and `OPENAI_TRIP_STARTER_MODEL` (default `gpt-5-mini`) apply only when a request has no `settings.model`; the `/AI` page lets each browser pick its own model. `OPENAI_REASONING_EFFORT` (default `low`) is server-wide and takes `none`, `minimal`, `low`, `medium`, `high` or `xhigh`; `default`, `auto` or `off` sends no reasoning setting, and any other value becomes `high`.
- `PORT` - server port (default 3000; Vite dev 5173). `RAILWAY_PUBLIC_DOMAIN` - added to the `vite preview` allowed hosts; no effect on `server.js`.

## Conventions

- Routes are an `if` chain in `handleApi` in `server.js`, matched on `request.method` and `url.pathname` or a regex. Replies go through `sendJson`/`sendEmpty`; errors are UPPER_SNAKE codes such as `ACCESS_KEY_REQUIRED`. Add new routes above the final `/api/trips/:id` block, which returns 404 for anything unmatched. The missing-key 401 only matches `/api/workspaces[/<id>]` and `/api/trips[/<id>]`, so a new per-user route must check `owner` itself and store ids as `${owner}${id}`.
- There are no migrations. Tables `saved_trips`, `workspaces` and `shared_trips` (jsonb payload plus timestamps) are created with `CREATE TABLE IF NOT EXISTS` at startup. Schema changes must stay additive and safe to run on every boot. That setup runs once at boot and is not retried: if it fails (bad SQL, or Postgres not reachable yet) the server keeps running, workspace and trip routes return 503 `DATABASE_UNAVAILABLE` until a restart, and new shared trips go to `.data/`.
- Trip and stop shapes are normalized twice, field by field: `normalizeTrip` in `src/App.tsx` and `normalizeTrip` in `server.js`. A new trip or stop field must be added to both or it is dropped. A new stop field must also go in the stop schema of `routeProposalSchema` in `server.js` (strict: list it in `required`; `additionalProperties: false`), or every stop the AI returns loses it. Trip fields left out of the schema keep their original value, because `normalizeRouteProposal` spreads the original trip first; `getRouteAssistantTripInput` picks the trip fields the AI sees. Server share links carry whatever both `normalizeTrip`s keep; `parseCompactSharedTrip` reads the old compact `t=` format, which nothing in the app creates any more.
- localStorage keys are `road-trip-planner.<name>.v1` constants near the top of `App.tsx`. Saved and active trips are stored per workspace under `<key>.<workspaceId>` (`workspaceStorageKey`), and the bare keys are still read as legacy data for `workspace-default`. Changing a stored shape without reading the old one loses users' local trips.
- These values are defined in both `src/App.tsx` and `server.js` and must change together: `defaultWorkspaceId`, `tripExportFormat`, the 12000-character AI prompt limit, the 5 AI context messages, and the access-key pattern (`isAccessKey` / `getOwnerPrefix`).

## Gotchas

- Workspaces and trips are stored under `<sha256(access key)>:<id>`. The key lives in localStorage (`road-trip-planner.accessKey.v1`) and in `#key=` sync links. Changing `getOwnerPrefix` or the key format orphans every existing row. Rows saved before keys existed have no prefix and are reachable only through the README SQL.
- `/api/workspaces*` and `/api/trips*` need a valid `x-access-key` header; `/api/shared-trips` is public by slug on purpose.
- The default workspace id `workspace-default` cannot be deleted (403). Deleting another workspace also deletes its trips.
- After a browser syncs with the database, the app deletes that workspace's saved-trip list from localStorage (`removeWorkspaceSavedTrips`), so the database holds the only stored copy. Never drop or truncate `saved_trips`, `workspaces` or `shared_trips`, and do not point production `DATABASE_URL` at another database, or unset it, without moving the rows.
- There is no CI and `railway.json` sets no health check. `npm run build` never loads `server.js`, so a syntax or startup error there still builds, deploys from `main` and can take production down. Start the server locally (`npm start`, or `npm test` with a throwaway database) before merging a `server.js` change.
- `/api/trip-starter` and `/api/route-assistant` share one server-wide 30 second cooldown (`aiRequestCooldownMs`), so any second AI request within 30 s gets a 429 with `retry-after`; `/api/openai-models` is not limited.
- Share links are `/share/<slug>` (`createShortTripShareUrl`). Older share links use `share`, `t` or `trip` in the hash or query, saved-trip links use `route`, and sync links use `#key=`; all of them must keep parsing (`getTripShareSourceFromUrl`, `getSavedRouteIdFromUrl`, `getAccessKey`). `/share/<slug>`, `/AI` and `/workspaces` are client-side views that work only because `serveStatic` returns `dist/index.html` for any non-`/api/` path that is not a file in `dist/`.
- `server.js` serves static files only from `dist/`, so in production files at the repo root (including this one) are not web-served. Files in `dist/` other than `index.html` are sent with a one-year immutable cache, so only content-hashed build output belongs there.
- Never commit real keys or connection strings; set them as Railway variables.
