import { useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindowF, MarkerF, PolylineF, useLoadScript } from '@react-google-maps/api';
import tripStops from './tripStops.json';

type TripStop = {
  order: number;
  date: string;
  label: string;
  lat: number;
  lng: number;
  notes: string;
  remoteWork?: boolean;
};

const mapContainerStyle = { width: '100%', height: '100%' };
const usCenter = { lat: 39.8283, lng: -98.5795 };

const stops = [...(tripStops as TripStop[])].sort((a, b) => a.order - b.order);
const path = stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));

function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapRef = useRef<google.maps.Map | null>(null);
  const [selectedStopOrder, setSelectedStopOrder] = useState<number | null>(null);

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || '',
  });

  const selectedStop = useMemo(
    () => stops.find((stop) => stop.order === selectedStopOrder) || null,
    [selectedStopOrder],
  );

  const fitAllStops = (map: google.maps.Map) => {
    const bounds = new google.maps.LatLngBounds();
    stops.forEach((stop) => bounds.extend({ lat: stop.lat, lng: stop.lng }));
    map.fitBounds(bounds, 80);
  };

  const handleMapLoad = (map: google.maps.Map) => {
    mapRef.current = map;
    fitAllStops(map);
  };

  const focusStop = (stop: TripStop) => {
    if (!mapRef.current) return;
    mapRef.current.panTo({ lat: stop.lat, lng: stop.lng });
    mapRef.current.setZoom(8);
    setSelectedStopOrder(stop.order);
  };

  if (!apiKey) {
    return (
      <div className="state-card error">
        <h1>Road Trip Planner</h1>
        <p>Google Maps API key is missing.</p>
        <p>
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="state-card error">
        <h1>Road Trip Planner</h1>
        <p>We couldn&apos;t load Google Maps.</p>
        <p>Please verify your API key, billing, and allowed referrers, then reload.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="state-card loading">
        <h1>Road Trip Planner</h1>
        <p>Loading your route map...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1>Road Trip Planner</h1>
        <p className="subtitle">2026 USA itinerary</p>
        <ol>
          {stops.map((stop) => (
            <li key={stop.order}>
              <button
                type="button"
                className={`stop-button ${stop.remoteWork ? 'remote' : ''}`}
                onClick={() => focusStop(stop)}
              >
                <span className="order">{stop.order}</span>
                <span>
                  <strong>{stop.label}</strong>
                  <small>{stop.date}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="map-panel">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={usCenter}
          zoom={4}
          onLoad={handleMapLoad}
          options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
        >
          <PolylineF
            path={path}
            options={{
              strokeColor: '#1f6feb',
              strokeOpacity: 0.9,
              strokeWeight: 4,
            }}
          />

          {stops.map((stop) => (
            <MarkerF
              key={stop.order}
              position={{ lat: stop.lat, lng: stop.lng }}
              onClick={() => setSelectedStopOrder(stop.order)}
              label={{
                text: String(stop.order),
                color: '#ffffff',
                fontWeight: '700',
              }}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: stop.remoteWork ? '#9333ea' : '#1f6feb',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 1.5,
                scale: 11,
              }}
            />
          ))}

          {selectedStop && (
            <InfoWindowF
              position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
              onCloseClick={() => setSelectedStopOrder(null)}
            >
              <div className="info-window">
                <p>{selectedStop.date}</p>
                <h2>{selectedStop.label}</h2>
                <p>{selectedStop.notes}</p>
                {selectedStop.remoteWork && <span className="remote-badge">Remote-work stop</span>}
              </div>
            </InfoWindowF>
          )}
        </GoogleMap>
      </section>
    </div>
  );
}

export default App;
