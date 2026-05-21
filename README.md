# Road Trip Planner

A lightweight road trip planning web app that:

- Integrates with Google Maps to display an interactive map
- Lets you click to mark locations and save stops
- Supports photo uploads for saved stops
- Stores plans and stops in a local SQLite database
- Searches ideas to do generally or along a selected route
- Exports plan details by email through SMTP

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables:
   - `GOOGLE_MAPS_API_KEY` (required for map/search features)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (required for email export)
   - Optional: `SMTP_SECURE=true|false` to override SMTP TLS mode
   - Optional: `SMTP_FROM`, `PORT`
   - For security, restrict the Google Maps API key to your allowed domains/referrers in Google Cloud Console.
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`

## Data storage

The app creates a SQLite database at `data/roadtrip.sqlite` automatically.
Uploaded images are stored in `uploads/`.
