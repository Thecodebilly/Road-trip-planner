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
4. Start the app:
   ```bash
   npm run dev
   ```

## Railway deployment

1. Deploy this repository from GitHub to Railway.
2. In Railway project variables, add:
   - `VITE_GOOGLE_MAPS_API_KEY` with your real API key.
3. Railway will build and run using:
   - Build: `npm run build`
   - Start: `npm run start`

> Do not commit real API keys. Keep them in local `.env` files and Railway environment variables.
