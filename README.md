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
4. Optionally add a Postgres connection string to persist saved trips outside the browser:
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

To test database-backed saved trips locally, build and run the production server:
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

The server creates a `saved_trips` table automatically when `DATABASE_URL` is configured. If the database is not configured or unavailable, saved trips fall back to browser storage.

> Do not commit real API keys. Keep them in local `.env` files and Railway environment variables.
