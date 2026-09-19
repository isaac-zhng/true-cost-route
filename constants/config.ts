// ─── API Configuration ────────────────────────────────────────────────────────
// All services below are FREE with NO credit card required.
//
// EIA API Key (gas prices):
//   Sign up at https://www.eia.gov/opendata/register.php
//   Takes ~1 minute, no credit card. Key arrives by email immediately.
//   Without a key: all stations fall back to a $3.50/gal average — still works!
//
// Map tiles:  OpenFreeMap  — no key, no account, no CC
// Routing:    OSRM         — no key, no account, no CC
// Geocoding:  Nominatim    — no key, no account, no CC

export const EIA_API_KEY =
  process.env.EXPO_PUBLIC_EIA_KEY ?? '';

// Tune-able constants
export const SEARCH_RADIUS_MILES = 5;     // gas stations within N miles of route
export const MAX_DETOUR_MILES    = 10;    // never suggest a detour longer than this
export const MAX_STATIONS_SHOWN  = 6;     // top N ranked stations in the sidebar

// Map tile styles — 100% free, no key, no account, no CC
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const AVAILABLE_MAP_STYLES = [
  {
    id: 'liberty',
    label: 'Streets',
    url: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    url: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Esri',
        },
        'esri-transportation': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
        },
        'esri-boundaries': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
        },
      },
      layers: [
        { id: 'satellite-base', type: 'raster', source: 'esri-satellite' },
        { id: 'transportation-overlay', type: 'raster', source: 'esri-transportation' },
        { id: 'boundaries-overlay', type: 'raster', source: 'esri-boundaries' },
      ],
    },
  },
] as const;

// Nominatim user-agent (required by OSM policy — identify your app)
export const NOMINATIM_USER_AGENT = 'TrueCostCommute/1.0 (contact@truecostcommute.app)';
