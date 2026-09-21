import { NOMINATIM_USER_AGENT, SEARCH_RADIUS_MILES } from '../constants/config';
import type { GasStation } from './gasApi';
import { matchGasProgram } from './gasPrograms';
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

// ─── Address Suggestions (Autocomplete with Location Bias) ────────────────────
export interface AddressSuggestion {
  id: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
  coords: LngLat;
}

/**
 * Fetch address suggestions as the user types, biased to their current location.
 * Uses Photon (OSM-based autocomplete) with a graceful fallback to Nominatim.
 */
export async function fetchAddressSuggestions(
  query: string,
  userLat?: number | null,
  userLng?: number | null,
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // 1. Try Photon (specifically optimized for typeahead search with lat/lon bias)
  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=5`;
    if (typeof userLat === 'number' && typeof userLng === 'number' && !isNaN(userLat) && !isNaN(userLng)) {
      url += `&lat=${userLat}&lon=${userLng}`;
    }

    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json() as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties?: {
            osm_id?: number;
            name?: string;
            housenumber?: string;
            street?: string;
            locality?: string;
            district?: string;
            city?: string;
            state?: string;
            postcode?: string;
            country?: string;
          };
        }>;
      };

      if (json.features && json.features.length > 0) {
        return json.features.map(f => {
          const p = f.properties || {};
          const coords: LngLat = {
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          };

          let primary = p.name || '';
          if (p.housenumber && p.street) {
            if (primary && primary !== p.housenumber && primary !== p.street) {
              primary = `${primary}, ${p.housenumber} ${p.street}`;
            } else {
              primary = `${p.housenumber} ${p.street}`;
            }
          } else if (!primary && p.street) {
            primary = p.street;
          } else if (!primary) {
            primary = p.city || p.locality || p.state || p.country || 'Location';
          }

          const parts: string[] = [];
          if (p.city && p.city !== primary) parts.push(p.city);
          else if (p.district) parts.push(p.district);
          if (p.state) parts.push(p.state);
          if (p.postcode) parts.push(p.postcode);
          if (p.country) parts.push(p.country);

          const secondary = parts.join(', ');
          const full = secondary ? `${primary}, ${secondary}` : primary;

          return {
            id: `${p.osm_id ?? Math.random()}-${coords.lat}-${coords.lng}`,
            primaryText: primary,
            secondaryText: secondary,
            fullText: full,
            coords,
          };
        });
      }
    }
  } catch (err) {
    console.warn('[routing] Photon autocomplete failed, trying Nominatim fallback:', err);
  }

  // 2. Fallback to Nominatim
  try {
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5&addressdetails=1`;
    if (typeof userLat === 'number' && typeof userLng === 'number' && !isNaN(userLat) && !isNaN(userLng)) {
      url += `&viewbox=${userLng - 0.5},${userLat + 0.5},${userLng + 0.5},${userLat - 0.5}&bounded=0`;
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
    });
    if (res.ok) {
      const list = await res.json() as Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
      }>;

      return list.map(item => {
        const parts = item.display_name.split(',').map(s => s.trim());
        const primary = parts[0] || item.display_name;
        const secondary = parts.slice(1).join(', ');
        return {
          id: `nom-${item.place_id}`,
          primaryText: primary,
          secondaryText: secondary,
          fullText: item.display_name,
          coords: { lng: parseFloat(item.lon), lat: parseFloat(item.lat) },
        };
      });
    }
  } catch (err) {
    console.warn('[routing] Nominatim fallback failed:', err);
  }

  return [];
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
  waypoints?: LngLat[],
): Promise<RouteResult | null> {
  const allPoints = [origin, ...(waypoints ?? []), destination];
  const coords = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
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

  // Parse turn-by-turn steps from all legs (supports multi-leg detour routes)
  const steps: RouteStep[] = route.legs.flatMap((leg, legIdx) =>
    leg.steps.map(s => {
      const type     = s.maneuver.type;
      const modifier = s.maneuver.modifier;
      const street   = s.name ?? '';
      const isIntermediateStop = type === 'arrive' && legIdx < route.legs.length - 1;
      const instruction = isIntermediateStop
        ? 'Arrive at gas station'
        : getInstruction(type, modifier, street);
      return {
        maneuverType: type,
        modifier,
        streetName:   street,
        distanceM:    s.distance,
        durationS:    s.duration,
        maneuverLng:  s.maneuver.location[0],
        maneuverLat:  s.maneuver.location[1],
        instruction,
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
  tags?: { name?: string; 'addr:state'?: string; brand?: string; operator?: string };
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
    const program       = matchGasProgram(el.tags?.name, el.tags?.brand, el.tags?.operator);

    stations.push({
      id:                   String(el.id),
      name:                 el.tags?.name ?? el.tags?.brand ?? (program ? `${program.name} Gas` : 'Gas Station'),
      lat:                  el.lat,
      lng:                  el.lon,
      state,
      detourMiles,
      detourMinutes,
      programId:            program?.id,
      programName:          program?.name,
      programType:          program?.type,
      isMembershipRequired: program?.isMandatory,
      queueWaitMinutes:     program?.queueWaitMinutes,
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
