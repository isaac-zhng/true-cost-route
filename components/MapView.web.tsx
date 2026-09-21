/**
 * MapView.web.tsx — Web map with a clean Google Maps-inspired visual style.
 * Light positron base map, blue route polyline, colored station pins, white popups.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
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
import type { RouteResult, LngLat } from '../lib/routing';

// Configure MapLibre Web Worker for Metro / Expo Web bundler
if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl('https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl-worker.mjs');
}

interface MapViewProps {
  route:           RouteResult | null;
  baseRoute?:      RouteResult | null;
  stations:        RankedStation[];
  selectedStation: RankedStation | null;
  onSelectStation: (s: RankedStation | null) => void;
  // Navigation
  isNavigating?:   boolean;
  isLoadingDetour?: boolean;
  userLat?:        number | null;
  userLng?:        number | null;
  userHeading?:    number | null;
  originCoords?:   LngLat | null;
  onUserLocation?: (lat: number, lng: number) => void;
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

// Subtle / faded line for the original direct route when a detour is projected
const baseRouteOutlineLayer: LayerProps = {
  id: 'base-route-outline',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-opacity': 0.6 },
};

const baseRouteLineLayer: LayerProps = {
  id: 'base-route-line',
  type: 'line',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: {
    'line-color': '#9AA0A6',
    'line-width': 4,
    'line-opacity': 0.8,
  },
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
  route, baseRoute, stations, selectedStation, onSelectStation,
  isNavigating = false, isLoadingDetour = false, userLat = null, userLng = null, userHeading = null,
  originCoords = null, onUserLocation,
}: MapViewProps) {
  const mapRef   = useRef<MapRef>(null);
  const minPrice = stations.length ? Math.min(...stations.map(s => s.pricePerGallon)) : 0;
  const maxPrice = stations.length ? Math.max(...stations.map(s => s.pricePerGallon)) : 0;
  const best     = stations.find(s => s.isWorthIt) ?? null;

  // Style state & menu
  const [selectedStyleId, setSelectedStyleId] = React.useState<string>('liberty');
  const [showStyleMenu, setShowStyleMenu]     = React.useState<boolean>(false);
  const [is3D, setIs3D]                       = React.useState<boolean>(false);

  const activeStyle = AVAILABLE_MAP_STYLES.find(s => s.id === selectedStyleId) ?? AVAILABLE_MAP_STYLES[0];

  const toggle3D = useCallback(() => {
    if (!mapRef.current) return;
    const next = !is3D;
    setIs3D(next);
    mapRef.current.easeTo({
      pitch: next ? 45 : 0,
      duration: 500,
    });
  }, [is3D]);

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
      @keyframes spin {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
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
    mapRef.current.easeTo({ pitch: is3D ? 40 : 0, bearing: 0, duration: 600 });
  }, [isNavigating, is3D]);

  // ── Smooth camera adjustment when route or projected detour changes ──
  useEffect(() => {
    if (!route || !mapRef.current || isNavigating) return;
    const [w, s, e, n] = route.bbox;
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 80, duration: 800, pitch: is3D ? 35 : 0 });
  }, [route, isNavigating, is3D]);

  // ── Camera: Zoom into user location or selected origin when provided ──
  const lastCenteredCoordRef = useRef<string | null>(null);

  useEffect(() => {
    if (route || !mapRef.current) return;
    const targetLng = originCoords?.lng ?? userLng;
    const targetLat = originCoords?.lat ?? userLat;
    if (targetLng === null || targetLat === null || targetLng === undefined || targetLat === undefined) return;

    const coordKey = `${targetLng.toFixed(5)},${targetLat.toFixed(5)}`;
    if (lastCenteredCoordRef.current === coordKey) return;
    lastCenteredCoordRef.current = coordKey;

    try {
      const map = mapRef.current.getMap ? mapRef.current.getMap() : mapRef.current;
      map.flyTo({
        center:   [targetLng, targetLat],
        zoom:     14,
        pitch:    is3D ? 40 : 0,
        duration: 1000,
        essential: true,
      });
    } catch (err) {
      console.warn('[MapView] flyTo user location failed:', err);
    }
  }, [userLat, userLng, originCoords, route, is3D]);

  // If user coordinates are not yet set, request browser geolocation on mount with generous timeout
  useEffect(() => {
    if (route) return;
    if (typeof navigator !== 'undefined' && navigator.geolocation && userLat === null && userLng === null) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          onUserLocation?.(pos.coords.latitude, pos.coords.longitude);
          if (mapRef.current && !lastCenteredCoordRef.current) {
            lastCenteredCoordRef.current = `${pos.coords.longitude.toFixed(5)},${pos.coords.latitude.toFixed(5)}`;
            const map = mapRef.current.getMap ? mapRef.current.getMap() : mapRef.current;
            map.flyTo({
              center:   [pos.coords.longitude, pos.coords.latitude],
              zoom:     14,
              pitch:    is3D ? 40 : 0,
              duration: 1000,
              essential: true,
            });
          }
        },
        err => {
          console.log('[GPS] Map mount location check:', err.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    }
  }, [userLat, userLng, route, is3D, onUserLocation]);

  // ── Keyboard zoom shortcuts (+ / -) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        mapRef.current?.zoomIn({ duration: 250 });
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        mapRef.current?.zoomOut({ duration: 250 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const onMapLoad = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap ? mapRef.current.getMap() : mapRef.current;
    if (map.scrollZoom) {
      map.scrollZoom.setWheelZoomRate(1 / 200); // 2x more responsive mouse wheel zoom
      map.scrollZoom.setZoomRate(1 / 50);      // smooth, responsive trackpad zoom
    }
    if (route) {
      const [w, s, e, n] = route.bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 80, duration: 900, pitch: is3D ? 35 : 0 });
    } else {
      const targetLng = originCoords?.lng ?? userLng;
      const targetLat = originCoords?.lat ?? userLat;
      if (targetLng !== null && targetLat !== null && targetLng !== undefined && targetLat !== undefined) {
        lastCenteredCoordRef.current = `${targetLng.toFixed(5)},${targetLat.toFixed(5)}`;
        map.flyTo({
          center:   [targetLng, targetLat],
          zoom:     14,
          pitch:    is3D ? 40 : 0,
          duration: 1000,
          essential: true,
        });
      }
    }
  }, [route, originCoords, userLat, userLng, is3D]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={{
          longitude: userLng ?? -98.5795,
          latitude:  userLat ?? 39.8283,
          zoom:      userLat !== null ? 14 : 11,
          pitch:     0,
          bearing:   0,
        }}
        maxPitch={75}
        dragRotate={true}
        pitchWithRotate={true}
        style={{ width: '100%', height: '100%' }}
        mapStyle={activeStyle.url as any}
        onLoad={onMapLoad}
        onClick={() => onSelectStation(null)}
        onError={(err) => {
          console.warn('Map style loading error, recovering to Streets:', err);
          if (selectedStyleId !== 'liberty') {
            setSelectedStyleId('liberty');
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

      {/* Origin marker (when user selected an address / origin and route is not yet computed) */}
      {!route && originCoords && (originCoords.lat !== userLat || originCoords.lng !== userLng) && (
        <Marker longitude={originCoords.lng} latitude={originCoords.lat} anchor="center">
          <div style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            backgroundColor: '#34A853',
            border: '2px solid #FFFFFF',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
          </div>
        </Marker>
      )}

      {/* Base direct route (rendered as subtle gray line when detour route is active) */}
      {baseRoute && selectedStation && route && baseRoute !== route && (
        <Source id="base-route" type="geojson" data={{ type: 'Feature', geometry: baseRoute.geometry, properties: {} }}>
          <Layer {...baseRouteOutlineLayer} />
          <Layer {...baseRouteLineLayer} />
        </Source>
      )}

      {/* Active route (projected detour route if station selected, or base route if none) */}
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
              {isBest ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#FFFFFF">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ) : null}
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
            width: 275,
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
                  {selectedStation.programName && (
                    <div style={{
                      display: 'inline-block',
                      backgroundColor:
                        selectedStation.programType === 'grocery'
                          ? '#F0FDF4'
                          : selectedStation.programType === 'loyalty'
                          ? '#FFFBEB'
                          : '#EFF6FF',
                      border: `1px solid ${
                        selectedStation.programType === 'grocery'
                          ? '#BBF7D0'
                          : selectedStation.programType === 'loyalty'
                          ? '#FDE68A'
                          : '#BFDBFE'
                      }`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 700,
                      color:
                        selectedStation.programType === 'grocery'
                          ? '#15803D'
                          : selectedStation.programType === 'loyalty'
                          ? '#B45309'
                          : '#1D4ED8',
                      marginTop: 3,
                    }}>
                      {selectedStation.programName.toUpperCase()}{' '}
                      {selectedStation.isMembershipRequired ? 'MEMBER PRICING' : 'REWARDS'}
                      {selectedStation.discountPerGallon
                        ? ` (SAVE ~$${selectedStation.discountPerGallon.toFixed(2)}/GAL)`
                        : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#5F6368', marginTop: 2 }}>
                    +{selectedStation.detourMiles.toFixed(1)} mi · +{Math.round(selectedStation.detourMinutes)} min detour
                    {selectedStation.queueWaitMinutes ? ` (incl. ~${selectedStation.queueWaitMinutes}m line)` : ''}
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
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: '#202124', lineHeight: 1 }}>
                  ${selectedStation.pricePerGallon.toFixed(3)}
                </span>
                {selectedStation.discountPerGallon && selectedStation.regularPricePerGallon ? (
                  <span style={{ fontSize: 13, color: '#80868B', textDecoration: 'line-through' }}>
                    ${selectedStation.regularPricePerGallon.toFixed(3)}
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: '#5F6368' }}>/gal regular</span>
              </div>

              {/* True Cost Breakdown */}
              <div style={{
                backgroundColor: '#F8F9FA',
                borderRadius: 8,
                padding: '9px 10px',
                marginBottom: 10,
                border: '1px solid #E8EAED',
              }}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#5F6368',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 6,
                }}>
                  True Cost Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ color: '#202124', fontWeight: 500 }}>Pump discount</span>
                      <div style={{ fontSize: 10, color: '#80868B' }}>Cheaper gas at station</div>
                    </div>
                    <span style={{ fontWeight: 600, color: '#137333' }}>
                      +${Math.abs(selectedStation.grossSavingsVsLocal).toFixed(2)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ color: '#202124', fontWeight: 500 }}>Fuel burned</span>
                      <div style={{ fontSize: 10, color: '#80868B' }}>Driving +{selectedStation.detourMiles.toFixed(1)} mi</div>
                    </div>
                    <span style={{ fontWeight: 600, color: '#C5221F' }}>
                      −${selectedStation.fuelWastedCost.toFixed(2)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ color: '#202124', fontWeight: 500 }}>Time value</span>
                      <div style={{ fontSize: 10, color: '#80868B' }}>Driving +{Math.round(selectedStation.detourMinutes)} min</div>
                    </div>
                    <span style={{ fontWeight: 600, color: '#C5221F' }}>
                      −${selectedStation.timeCost.toFixed(2)}
                    </span>
                  </div>

                  {selectedStation.queueWaitMinutes ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#5F6368' }}>
                      <span>↳ {selectedStation.programName ?? 'Club'} queue wait</span>
                      <span>~{selectedStation.queueWaitMinutes} min in line</span>
                    </div>
                  ) : null}

                  <div style={{ height: 1, backgroundColor: '#E8EAED', margin: '2px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 12, color: '#202124' }}>
                        {selectedStation.isWorthIt ? 'Net in pocket:' : 'Net detour loss:'}
                      </span>
                      <div style={{ fontSize: 10, color: selectedStation.isWorthIt ? '#137333' : '#C5221F' }}>
                        {selectedStation.isWorthIt ? 'Real money saved' : 'Detour costs extra'}
                      </div>
                    </div>
                    <span style={{
                      fontWeight: 800,
                      fontSize: 14,
                      color: selectedStation.isWorthIt ? '#137333' : '#C5221F',
                    }}>
                      {selectedStation.isWorthIt
                        ? `Save $${selectedStation.netSavings.toFixed(2)}`
                        : `Lose $${Math.abs(selectedStation.netSavings).toFixed(2)}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Verdict pill + Route projection status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  backgroundColor: selectedStation.isWorthIt ? '#E6F4EA' : '#FCE8E6',
                  color: selectedStation.isWorthIt ? '#137333' : '#C5221F',
                }}>
                  <span>{selectedStation.isWorthIt ? 'Worth the detour' : 'Skip this station'}</span>
                </div>

                {isLoadingDetour ? (
                  <span style={{ fontSize: 11, color: '#1A73E8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, border: '2px solid #1A73E8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Projecting…
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#137333', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#137333' }} />
                    Route projected
                  </span>
                )}
              </div>
            </div>
          </div>
        </Popup>
      )}

      {/* Bottom control bar: Map Types + Zoom Controls + Fit Route */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: 24,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        {/* Layer Switcher */}
        <div style={{ position: 'relative' }}>
          {showStyleMenu && (
            <div style={{
              position: 'absolute',
              bottom: 48,
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
              height: 38,
              boxSizing: 'border-box',
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '0 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#202124',
              cursor: 'pointer',
              transition: 'box-shadow 0.15s ease, transform 0.15s ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#202124" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
            <span>{activeStyle.label}</span>
            <span style={{ fontSize: 10, color: '#5F6368', marginLeft: 2 }}>{showStyleMenu ? '▴' : '▾'}</span>
          </button>
        </div>

        {/* 2D / 3D Perspective Toggle */}
        <button
          onClick={toggle3D}
          title={is3D ? 'Switch to 2D flat view' : 'Switch to 3D perspective view'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 38,
            boxSizing: 'border-box',
            backgroundColor: is3D ? '#E8F0FE' : '#FFFFFF',
            borderRadius: 24,
            border: is3D ? '1px solid #D2E3FC' : '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '0 13px',
            fontSize: 13,
            fontWeight: 700,
            color: is3D ? '#1A73E8' : '#5F6368',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            if (!is3D) e.currentTarget.style.backgroundColor = '#F8FAFD';
          }}
          onMouseLeave={e => {
            if (!is3D) e.currentTarget.style.backgroundColor = '#FFFFFF';
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={is3D ? '#1A73E8' : '#5F6368'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span>{is3D ? '3D' : '2D'}</span>
        </button>

        {/* Zoom Controls Pill (+ / −) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          height: 38,
          boxSizing: 'border-box',
        }}>
          <button
            onClick={() => mapRef.current?.zoomIn({ duration: 250 })}
            title="Zoom In (or press +)"
            style={{
              width: 38,
              height: 38,
              boxSizing: 'border-box',
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: 18,
              fontWeight: 700,
              color: '#202124',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F1F3F4')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            +
          </button>
          <div style={{ width: 1, height: 18, backgroundColor: '#E8EAED' }} />
          <button
            onClick={() => mapRef.current?.zoomOut({ duration: 250 })}
            title="Zoom Out (or press −)"
            style={{
              width: 38,
              height: 38,
              boxSizing: 'border-box',
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: 20,
              fontWeight: 700,
              color: '#202124',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F1F3F4')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            −
          </button>
        </div>

        {/* Center on My Location Button */}
        <button
          onClick={() => {
            if (userLat !== null && userLng !== null) {
              const map = mapRef.current?.getMap ? mapRef.current.getMap() : mapRef.current;
              map?.flyTo({
                center: [userLng, userLat],
                zoom: 15,
                pitch: is3D ? 40 : 0,
                duration: 800,
                essential: true,
              });
            } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                pos => {
                  onUserLocation?.(pos.coords.latitude, pos.coords.longitude);
                  const map = mapRef.current?.getMap ? mapRef.current.getMap() : mapRef.current;
                  map?.flyTo({
                    center: [pos.coords.longitude, pos.coords.latitude],
                    zoom: 15,
                    pitch: is3D ? 40 : 0,
                    duration: 800,
                    essential: true,
                  });
                },
                err => {
                  console.warn('[GPS] Center on location failed:', err);
                },
                { enableHighAccuracy: true, timeout: 10000 },
              );
            }
          }}
          title="Center on my location"
          style={{
            width: 38,
            height: 38,
            boxSizing: 'border-box',
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFD')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
          </svg>
        </button>

        {/* Fit Route Button (shown when route exists) */}
        {route && (
          <button
            onClick={() => {
              const [w, s, e, n] = route.bbox;
              mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 80, duration: 600, pitch: is3D ? 35 : 0 });
            }}
            title="Fit Route to Screen"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              boxSizing: 'border-box',
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '0 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#1A73E8',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8FAFD')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="7"/>
              <line x1="12" y1="1" x2="12" y2="4"/>
              <line x1="12" y1="20" x2="12" y2="23"/>
              <line x1="1" y1="12" x2="4" y2="12"/>
              <line x1="20" y1="12" x2="23" y2="12"/>
            </svg>
            <span>Fit Route</span>
          </button>
        )}
      </div>
    </Map>
    </div>
  );
}
