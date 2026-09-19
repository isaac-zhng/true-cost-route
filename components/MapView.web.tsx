/**
 * MapView.web.tsx — Web map with a clean Google Maps-inspired visual style.
 * Light positron base map, blue route polyline, colored station pins, white popups.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import Map, {
  Source,
  Layer,
  Marker,
  Popup,
  type MapRef,
  type LayerProps,
} from 'react-map-gl/maplibre';

import { AVAILABLE_MAP_STYLES } from '../constants/config';
import type { RankedStation } from '../lib/optimizer';
import type { RouteResult } from '../lib/routing';

interface MapViewProps {
  route:           RouteResult | null;
  stations:        RankedStation[];
  selectedStation: RankedStation | null;
  onSelectStation: (s: RankedStation | null) => void;
  // Navigation
  isNavigating?:   boolean;
  userLat?:        number | null;
  userLng?:        number | null;
  userHeading?:    number | null;
}

// ─── Route layer styles ───────────────────────────────────────────────────────
const routeOutlineLayer: LayerProps = {
  id: 'route-outline',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.9 },
};

const routeLineLayer: LayerProps = {
  id: 'route-line',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#4285F4', 'line-width': 5, 'line-opacity': 1 },
};

// ─── Color scale: green → yellow → red by price ──────────────────────────────
function pinColor(price: number, min: number, max: number): string {
  if (max === min) return '#34A853';
  const t = (price - min) / (max - min);
  if (t < 0.5) {
    const s = t * 2;
    return `rgb(${Math.round(52 + 200 * s)},${Math.round(168 - 90 * s)},${Math.round(83 - 83 * s)})`;
  }
  const s = (t - 0.5) * 2;
  return `rgb(${Math.round(252 - 18 * s)},${Math.round(78 - 20 * s)},${Math.round(0 + 58 * s)})`;
}

function fmtAbs(n: number, d = 2) {
  return `$${Math.abs(n).toFixed(d)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MapView({
  route, stations, selectedStation, onSelectStation,
  isNavigating = false, userLat = null, userLng = null, userHeading = null,
}: MapViewProps) {
  const mapRef   = useRef<MapRef>(null);
  const minPrice = stations.length ? Math.min(...stations.map(s => s.pricePerGallon)) : 0;
  const maxPrice = stations.length ? Math.max(...stations.map(s => s.pricePerGallon)) : 0;
  const best     = stations.find(s => s.isWorthIt) ?? null;

  // Style state & menu
  const [selectedStyleId, setSelectedStyleId] = React.useState<string>('bright');
  const [showStyleMenu, setShowStyleMenu]     = React.useState<boolean>(false);

  const activeStyle = AVAILABLE_MAP_STYLES.find(s => s.id === selectedStyleId) ?? AVAILABLE_MAP_STYLES[0];

  // Load maplibre CSS from CDN (Metro can't bundle node_modules CSS)
  useEffect(() => {
    const id = 'maplibre-gl-css';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css';
    document.head.appendChild(link);

    const override = document.createElement('style');
    override.textContent = `
      .maplibregl-popup-content { padding: 0; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.18); overflow: hidden; }
      .maplibregl-popup-tip { display: none; }
      .maplibregl-ctrl-attrib { font-size: 10px; }
      @keyframes loc-pulse {
        0%   { transform: scale(1);   opacity: 0.5; }
        100% { transform: scale(2.5); opacity: 0; }
      }
    `;
    document.head.appendChild(override);
  }, []);

  // ── Camera follow: when navigating, track the user's position ──
  useEffect(() => {
    if (!isNavigating || !mapRef.current || userLat === null || userLng === null) return;
    mapRef.current.easeTo({
      center:   [userLng, userLat],
      bearing:  userHeading ?? 0,
      zoom:     17,
      pitch:    55,
      duration: 800,
    });
  }, [isNavigating, userLat, userLng, userHeading]);

  // Reset pitch/bearing when navigation stops
  useEffect(() => {
    if (isNavigating || !mapRef.current) return;
    mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }, [isNavigating]);

  const onMapLoad = useCallback(() => {
    if (!route || !mapRef.current) return;
    const [w, s, e, n] = route.bbox;
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 80, duration: 900 });
  }, [route]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -98.5795, latitude: 39.8283, zoom: 4 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={activeStyle.url as any}
        onLoad={onMapLoad}
        onClick={() => onSelectStation(null)}
        onError={(err) => {
          console.warn('Map style loading error, recovering:', err);
          if (selectedStyleId !== 'bright') {
            setSelectedStyleId('bright');
          }
        }}
      >
      {/* User location marker */}
      {userLat !== null && userLng !== null && (
        <Marker longitude={userLng} latitude={userLat} anchor="center">
          <div style={{ position: 'relative', width: 24, height: 24 }}>
            {/* Pulsing accuracy ring */}
            <div style={{
              position: 'absolute',
              inset: -4,
              borderRadius: '50%',
              backgroundColor: '#4285F4',
              animation: 'loc-pulse 1.8s ease-out infinite',
            }} />
            {/* Outer white ring */}
            <div style={{
              position: 'absolute',
              inset: -2,
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            }} />
            {/* Blue dot */}
            <div style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              backgroundColor: '#4285F4',
            }} />
            {/* Heading chevron */}
            {userHeading !== null && (
              <div style={{
                position: 'absolute',
                top: -14,
                left: '50%',
                transform: `translateX(-50%) rotate(${userHeading}deg)`,
                width: 0,
                height: 0,
                borderLeft:   '5px solid transparent',
                borderRight:  '5px solid transparent',
                borderBottom: '12px solid #4285F4',
                transformOrigin: '50% calc(100% + 12px)',
              }} />
            )}
          </div>
        </Marker>
      )}

      {/* Route */}
      {route && (
        <Source id="route" type="geojson" data={{ type: 'Feature', geometry: route.geometry, properties: {} }}>
          <Layer {...routeOutlineLayer} />
          <Layer {...routeLineLayer} />
        </Source>
      )}

      {/* Station pins */}
      {stations.map(station => {
        const isBest     = best?.id === station.id;
        const isSelected = selectedStation?.id === station.id;
        const color      = pinColor(station.pricePerGallon, minPrice, maxPrice);
        const size       = isBest ? 32 : isSelected ? 26 : 20;

        return (
          <Marker
            key={station.id}
            longitude={station.lng}
            latitude={station.lat}
            anchor="center"
            onClick={(e: { originalEvent: Event }) => {
              e.originalEvent.stopPropagation();
              onSelectStation(station);
            }}
          >
            <div
              style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: isBest ? '#FBBC04' : color,
                border: `${isBest ? 3 : 2}px solid ${isBest ? '#fff' : isSelected ? '#4285F4' : '#fff'}`,
                boxShadow: isBest
                  ? '0 2px 8px rgba(251,188,4,0.6), 0 0 0 3px rgba(251,188,4,0.2)'
                  : `0 2px 6px rgba(0,0,0,0.25)`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isBest ? 14 : 0,
                transition: 'all 0.15s ease',
              }}
            >
              {isBest ? '★' : ''}
            </div>
          </Marker>
        );
      })}

      {/* Popup — clean white card */}
      {selectedStation && (
        <Popup
          longitude={selectedStation.lng}
          latitude={selectedStation.lat}
          anchor="bottom"
          offset={14}
          closeButton={false}
          onClose={() => onSelectStation(null)}
        >
          <div style={{
            width: 248,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            backgroundColor: '#fff',
            borderRadius: 12,
            overflow: 'hidden',
          }}>
            {/* Accent stripe */}
            <div style={{
              height: 4,
              background: selectedStation.isWorthIt
                ? 'linear-gradient(90deg,#34A853,#4285F4)'
                : 'linear-gradient(90deg,#EA4335,#FBBC04)',
            }} />

            <div style={{ padding: '12px 14px 14px' }}>
              {/* Station name + close */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ flex: 1, marginRight: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#202124', lineHeight: '1.3' }}>
                    {selectedStation.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#5F6368', marginTop: 1 }}>
                    +{selectedStation.detourMiles.toFixed(1)} mi · +{Math.round(selectedStation.detourMinutes)} min detour
                  </div>
                </div>
                <button
                  onClick={() => onSelectStation(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#80868B', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>

              {/* Price */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 10 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: '#202124', lineHeight: 1 }}>
                  ${selectedStation.pricePerGallon.toFixed(3)}
                </span>
                <span style={{ fontSize: 12, color: '#5F6368' }}>/gal regular</span>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 10 }}>
                {[
                  { label: 'Gross savings', val: selectedStation.grossSavingsVsLocal, prefix: true },
                  { label: 'Fuel cost',     val: -selectedStation.fuelWastedCost,     prefix: false },
                  { label: 'Time cost',     val: -selectedStation.timeCost,           prefix: false },
                  { label: 'Net savings',   val: selectedStation.netSavings,          prefix: true, bold: true },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: 10, color: '#80868B', marginBottom: 1 }}>{item.label}</div>
                    <div style={{
                      fontSize: item.bold ? 15 : 13,
                      fontWeight: item.bold ? 700 : 500,
                      color: item.val >= 0 ? '#137333' : '#C5221F',
                    }}>
                      {item.val >= 0 ? '+' : '−'}{fmtAbs(item.val)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Verdict pill */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: selectedStation.isWorthIt ? '#E6F4EA' : '#FCE8E6',
                color: selectedStation.isWorthIt ? '#137333' : '#C5221F',
              }}>
                <span>{selectedStation.isWorthIt ? '✓' : '✕'}</span>
                <span>{selectedStation.isWorthIt ? 'Worth the detour' : 'Skip this station'}</span>
              </div>
            </div>
          </div>
        </Popup>
      )}

      {/* Layer Switcher Button & Menu (Google Maps style, bottom-left) */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: 24,
        zIndex: 50,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        {showStyleMenu && (
          <div style={{
            position: 'absolute',
            bottom: 50,
            left: 0,
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            padding: '8px 6px',
            minWidth: 190,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#80868B',
              padding: '4px 10px',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              Map Types
            </div>
            {AVAILABLE_MAP_STYLES.map(style => (
              <button
                key={style.id}
                onClick={() => {
                  setSelectedStyleId(style.id);
                  setShowStyleMenu(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: selectedStyleId === style.id ? '#E8F0FE' : 'transparent',
                  color: selectedStyleId === style.id ? '#1A73E8' : '#202124',
                  fontWeight: selectedStyleId === style.id ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.15s ease',
                }}
              >
                <span style={{ fontSize: 16 }}>{style.icon}</span>
                <span>{style.label}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowStyleMenu(!showStyleMenu)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            color: '#202124',
            cursor: 'pointer',
            transition: 'box-shadow 0.15s ease, transform 0.15s ease',
          }}
        >
          <span>{activeStyle.icon}</span>
          <span>{activeStyle.label}</span>
          <span style={{ fontSize: 10, color: '#5F6368', marginLeft: 2 }}>{showStyleMenu ? '▼' : '▲'}</span>
        </button>
      </div>
    </Map>
    </div>
  );
}
