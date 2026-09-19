import { NOMINATIM_USER_AGENT, SEARCH_RADIUS_MILES } from '../constants/config';
import type { GasStation } from './gasApi';
import { getArrow, getInstruction, type RouteStep } from './navigation';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LngLat { lng: number; lat: number }

export interface RouteResult {
  geometry: GeoJSON.LineString;
  distanceMiles: number;
  durationMinutes: number;
  bbox: [number, number, number, number];
  steps: RouteStep[];
}

declare global {
  namespace GeoJSON {
    interface LineString { type: 'LineString'; coordinates: [number, number][] }
  }
}

// ─── Geocoding via Nominatim (OpenStreetMap) ──────────────────────────────────
// Free, no API key, no account. Rate limit: 1 req/sec — fine for MVP usage.
export async function geocode(query: string): Promise<LngLat | null> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&format=json&limit=1&addressdetails=0`;

  const res  = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT },
  });
  const json = await res.json() as Array<{ lat: string; lon: string }>;
  if (!json?.length) return null;

  return { lng: parseFloat(json[0].lon), lat: parseFloat(json[0].lat) };
}

// ─── Routing via OSRM (Open Source Routing Machine) ──────────────────────────
// Public demo server, free, no API key. For production use, self-host OSRM.
export async function getRoute(
  origin: LngLat,
  destination: LngLat,
): Promise<RouteResult | null> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?geometries=geojson&overview=full&steps=true`;

  const res  = await fetch(url);
  const json = await res.json() as {
    code: string;
    routes: Array<{
      geometry: GeoJSON.LineString;
      distance: number;
      duration: number;
      legs: Array<{
        steps: Array<{
          distance: number;
          duration: number;
          name: string;
          maneuver: {
            type: string;
            modifier?: string;
            bearing_before: number;
            bearing_after: number;
            location: [number, number]; // [lng, lat]
          };
        }>;
      }>;
    }>;
  };

  if (json.code !== 'Ok' || !json.routes?.length) return null;

  const route           = json.routes[0];
  const distanceMiles   = route.distance * 0.000621371;
  const durationMinutes = route.duration / 60;

  const lngs = route.geometry.coordinates.map(c => c[0]);
  const lats  = route.geometry.coordinates.map(c => c[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...lngs), Math.min(...lats),
    Math.max(...lngs), Math.max(...lats),
  ];

  // Parse turn-by-turn steps from all legs (usually just one leg)
  const steps: RouteStep[] = route.legs.flatMap(leg =>
    leg.steps.map(s => {
      const type     = s.maneuver.type;
      const modifier = s.maneuver.modifier;
      const street   = s.name ?? '';
      return {
        maneuverType: type,
        modifier,
        streetName:   street,
        distanceM:    s.distance,
        durationS:    s.duration,
        maneuverLng:  s.maneuver.location[0],
        maneuverLat:  s.maneuver.location[1],
        instruction:  getInstruction(type, modifier, street),
        arrowSymbol:  getArrow(type, modifier),
      };
    }),
  );

  return { geometry: route.geometry, distanceMiles, durationMinutes, bbox, steps };
}


// ─── Gas stations via Overpass API (OpenStreetMap) ────────────────────────────
// Completely free, no key. Samples points along the route and queries OSM.

interface OverpassNode {
  id: number;
  lat: number;
  lon: number;
  tags?: { name?: string; 'addr:state'?: string; brand?: string };
}

export async function getStationsAlongRoute(
  geometry: GeoJSON.LineString,
): Promise<Array<Omit<GasStation, 'pricePerGallon'>>> {
  const coords    = geometry.coordinates;
  const radiusM   = SEARCH_RADIUS_MILES * 1609.34;

  const sampleCount = Math.min(coords.length, 20);
  const step        = Math.max(1, Math.floor(coords.length / sampleCount));
  const sampled     = coords.filter((_, i) => i % step === 0);

  const nodeFilters = sampled
    .map(([lng, lat]) => `node["amenity"="fuel"](around:${radiusM},${lat},${lng});`)
    .join('\n');

  const query = `
    [out:json][timeout:25];
    (
      ${nodeFilters}
    );
    out body;
  `;

  const res  = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body:   `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const json = await res.json() as { elements: OverpassNode[] };

  const seen = new Set<number>();
  const stations: Array<Omit<GasStation, 'pricePerGallon'>> = [];

  for (const el of json.elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);

    const state         = el.tags?.['addr:state'] ?? inferState(el.lat, el.lon);
    const nearestDist   = nearestPointDistanceMiles(el.lat, el.lon, sampled);
    const detourMiles   = +(nearestDist * 2).toFixed(2);
    const detourMinutes = +(detourMiles / 30 * 60).toFixed(1);

    stations.push({
      id:            String(el.id),
      name:          el.tags?.name ?? el.tags?.brand ?? 'Gas Station',
      lat:           el.lat,
      lng:           el.lon,
      state,
      detourMiles,
      detourMinutes,
    });
  }

  return stations;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R   = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(d: number) { return d * (Math.PI / 180); }

function nearestPointDistanceMiles(lat: number, lon: number, pts: [number, number][]): number {
  let min = Infinity;
  for (const [rLng, rLat] of pts) {
    const d = haversine(lat, lon, rLat, rLng);
    if (d < min) min = d;
  }
  return min;
}

function inferState(lat: number, lng: number): string {
  if (lat > 47 && lng < -116)                            return 'WA';
  if (lat > 42 && lat < 47 && lng < -116)               return 'OR';
  if (lat > 32 && lat < 42 && lng < -114)               return 'CA';
  if (lat > 31 && lat < 37 && lng > -115 && lng < -109) return 'AZ';
  if (lat > 37 && lat < 42 && lng > -115 && lng < -109) return 'NV';
  if (lat > 36 && lat < 42 && lng > -109 && lng < -102) return 'CO';
  if (lat > 31 && lat < 37 && lng > -109 && lng < -103) return 'NM';
  if (lat > 25 && lat < 37 && lng > -107 && lng < -93)  return 'TX';
  if (lat > 33 && lat < 37 && lng > -100 && lng < -94)  return 'OK';
  if (lat > 37 && lat < 40 && lng > -102 && lng < -94)  return 'KS';
  if (lat > 40 && lat < 43 && lng > -104 && lng < -95)  return 'NE';
  if (lat > 43 && lat < 49 && lng > -105 && lng < -96)  return 'SD';
  if (lat > 25 && lat < 31 && lng > -87 && lng < -80)   return 'FL';
  if (lat > 30 && lat < 35 && lng > -88 && lng < -80)   return 'GA';
  if (lat > 35 && lat < 37 && lng > -84 && lng < -75)   return 'NC';
  if (lat > 37 && lat < 39 && lng > -83 && lng < -75)   return 'VA';
  if (lat > 39 && lat < 42 && lng > -80 && lng < -74)   return 'PA';
  if (lat > 40 && lat < 42 && lng > -74 && lng < -71)   return 'NY';
  if (lat > 41 && lng > -74 && lng < -69)               return 'MA';
  if (lat > 41 && lat < 42 && lng > -72 && lng < -71)   return 'CT';
  if (lat > 39 && lat < 41 && lng > -76 && lng < -73)   return 'NJ';
  if (lat > 38 && lat < 40 && lng > -79 && lng < -74)   return 'MD';
  if (lat > 41 && lat < 43 && lng > -88 && lng < -84)   return 'MI';
  if (lat > 37 && lat < 42 && lng > -88 && lng < -84)   return 'OH';
  if (lat > 37 && lat < 42 && lng > -88 && lng < -86)   return 'IN';
  if (lat > 41 && lat < 43 && lng > -90 && lng < -87)   return 'WI';
  if (lat > 40 && lat < 43 && lng > -92 && lng < -89)   return 'MN';
  if (lat > 36 && lat < 40 && lng > -91 && lng < -88)   return 'IL';
  if (lat > 36 && lat < 40 && lng > -95 && lng < -91)   return 'MO';
  return 'TX';
}
