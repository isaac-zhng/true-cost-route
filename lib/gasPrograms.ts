/**
 * gasPrograms.ts — Registry and area discovery for personalized gas pricing programs.
 * Covers:
 * 1. Wholesale Clubs (Mandatory membership to pump): Costco, Sam's Club, BJ's.
 * 2. Supermarket & Grocery Fuel Rewards: Kroger, Safeway, HEB, Meijer, Giant/Stop & Shop, Hy-Vee.
 * 3. Station Loyalty Programs & Apps: Circle K, Wawa, Sheetz, Cumberland Farms, Shell, Murphy USA.
 */

export type ProgramType = 'wholesale' | 'grocery' | 'loyalty';

export interface GasProgram {
  id: string;
  name: string;
  type: ProgramType;
  /** Typical discount in $/gal */
  typicalDiscount: number;
  /** Estimated line queue wait in minutes */
  queueWaitMinutes: number;
  /** Whether membership is strictly required to pump (true for wholesale clubs) */
  isMandatory: boolean;
  /** Search keywords for matching OSM name, brand, or operator tags */
  keywords: string[];
  /** Short badge text for UI */
  badgeLabel: string;
}

export interface DiscoveredProgram extends GasProgram {
  /** Distance in miles to the closest location in the user's area */
  distanceMiles: number;
  /** Name of the closest station */
  closestStationName: string;
}

// ─── Program Registry ─────────────────────────────────────────────────────────
export const GAS_PROGRAMS: GasProgram[] = [
  // Wholesale Clubs
  {
    id: 'costco',
    name: 'Costco Wholesale',
    type: 'wholesale',
    typicalDiscount: 0.28,
    queueWaitMinutes: 7,
    isMandatory: true,
    keywords: ['costco'],
    badgeLabel: 'Costco Member',
  },
  {
    id: 'sams_club',
    name: "Sam's Club",
    type: 'wholesale',
    typicalDiscount: 0.24,
    queueWaitMinutes: 6,
    isMandatory: true,
    keywords: ["sam's club", 'sams club', "sam's"],
    badgeLabel: "Sam's Club Member",
  },
  {
    id: 'bjs',
    name: "BJ's Wholesale",
    type: 'wholesale',
    typicalDiscount: 0.20,
    queueWaitMinutes: 5,
    isMandatory: true,
    keywords: ["bj's", 'bjs wholesale', 'bjs gas'],
    badgeLabel: "BJ's Member",
  },

  // Supermarket & Grocery Rewards
  {
    id: 'kroger',
    name: 'Kroger Fuel Points',
    type: 'grocery',
    typicalDiscount: 0.15,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['kroger', 'ralphs', 'fred meyer', 'king soopers', "fry's fuel", "fry's food", 'dillons', 'smiths fuel'],
    badgeLabel: 'Kroger Rewards',
  },
  {
    id: 'safeway',
    name: 'Safeway / Albertsons (for U)',
    type: 'grocery',
    typicalDiscount: 0.15,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['safeway', 'albertsons', 'vons', 'jewel-osco', "shaw's", 'shaws', 'tom thumb', 'randalls'],
    badgeLabel: 'Safeway / for U',
  },
  {
    id: 'heb',
    name: 'H-E-B Fuel',
    type: 'grocery',
    typicalDiscount: 0.10,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['h-e-b', 'heb fuel', 'heb'],
    badgeLabel: 'H-E-B Rewards',
  },
  {
    id: 'meijer',
    name: 'Meijer (mPerks)',
    type: 'grocery',
    typicalDiscount: 0.10,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['meijer'],
    badgeLabel: 'mPerks',
  },
  {
    id: 'giant',
    name: 'Giant / Stop & Shop',
    type: 'grocery',
    typicalDiscount: 0.12,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['stop & shop', 'giant food', 'giant gas', 'martin’s'],
    badgeLabel: 'Giant / Stop & Shop',
  },

  // Station Loyalty & Apps
  {
    id: 'circle_k',
    name: 'Circle K (Inner Circle)',
    type: 'loyalty',
    typicalDiscount: 0.08,
    queueWaitMinutes: 0,
    isMandatory: false,
    keywords: ['circle k', 'circle-k'],
    badgeLabel: 'Inner Circle',
  },
  {
    id: 'wawa',
    name: 'Wawa Rewards',
    type: 'loyalty',
    typicalDiscount: 0.08,
    queueWaitMinutes: 1,
    isMandatory: false,
    keywords: ['wawa'],
    badgeLabel: 'Wawa Rewards',
  },
  {
    id: 'sheetz',
    name: 'Sheetz Rewardz',
    type: 'loyalty',
    typicalDiscount: 0.05,
    queueWaitMinutes: 1,
    isMandatory: false,
    keywords: ['sheetz'],
    badgeLabel: 'Sheetz Rewardz',
  },
  {
    id: 'cumberland',
    name: 'Cumberland Farms (SmartPay)',
    type: 'loyalty',
    typicalDiscount: 0.10,
    queueWaitMinutes: 0,
    isMandatory: false,
    keywords: ['cumberland farms', 'cumberland'],
    badgeLabel: 'SmartPay',
  },
  {
    id: 'shell',
    name: 'Shell (Fuel Rewards)',
    type: 'loyalty',
    typicalDiscount: 0.05,
    queueWaitMinutes: 0,
    isMandatory: false,
    keywords: ['shell'],
    badgeLabel: 'Fuel Rewards',
  },
  {
    id: 'murphy',
    name: 'Murphy USA (Walmart+)',
    type: 'loyalty',
    typicalDiscount: 0.10,
    queueWaitMinutes: 2,
    isMandatory: false,
    keywords: ['murphy usa', 'murphy express', 'walmart fuel'],
    badgeLabel: 'Walmart+ / Murphy',
  },
];

/**
 * Match an OpenStreetMap station against the program registry.
 */
export function matchGasProgram(name?: string, brand?: string, operator?: string): GasProgram | null {
  const combined = `${name ?? ''} ${brand ?? ''} ${operator ?? ''}`.toLowerCase();
  for (const prog of GAS_PROGRAMS) {
    for (const kw of prog.keywords) {
      if (combined.includes(kw)) {
        return prog;
      }
    }
  }
  return null;
}

/**
 * Haversine distance in miles between two coordinates.
 */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// In-memory cache of discovered programs by coordinate grid (~10km precision)
const areaCache = new Map<string, DiscoveredProgram[]>();

/**
 * Scan the user's geographic area (~20 mile radius) for all fuel stations
 * and return the programs that actually exist near them, sorted by distance.
 */
export async function findProgramsInArea(
  lat: number,
  lng: number,
  radiusMiles = 20,
): Promise<DiscoveredProgram[]> {
  const gridKey = `${lat.toFixed(1)}_${lng.toFixed(1)}`;
  if (areaCache.has(gridKey)) {
    return areaCache.get(gridKey)!;
  }

  const radiusM = radiusMiles * 1609.34;

  // Build a fast regex for all program keywords
  const allKeywords = GAS_PROGRAMS.flatMap(p => p.keywords).map(k => k.replace(/['’]/g, '.?'));
  const regex = allKeywords.join('|');

  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="fuel"]["name"~"${regex}",i](around:${radiusM},${lat},${lng});
      node["amenity"="fuel"]["brand"~"${regex}",i](around:${radiusM},${lat},${lng});
      node["amenity"="fuel"]["operator"~"${regex}",i](around:${radiusM},${lat},${lng});
    );
    out tags,center;
  `;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const json = (await res.json()) as {
      elements: Array<{
        id: number;
        lat: number;
        lon: number;
        tags?: { name?: string; brand?: string; operator?: string };
      }>;
    };

    const bestByProgram = new Map<string, { distanceMiles: number; stationName: string }>();

    for (const el of json.elements ?? []) {
      const prog = matchGasProgram(el.tags?.name, el.tags?.brand, el.tags?.operator);
      if (!prog) continue;

      const dist = haversineMiles(lat, lng, el.lat, el.lon);
      const name = el.tags?.name ?? el.tags?.brand ?? prog.name;

      const existing = bestByProgram.get(prog.id);
      if (!existing || dist < existing.distanceMiles) {
        bestByProgram.set(prog.id, { distanceMiles: dist, stationName: name });
      }
    }

    const discovered: DiscoveredProgram[] = [];
    for (const prog of GAS_PROGRAMS) {
      const match = bestByProgram.get(prog.id);
      if (match) {
        discovered.push({
          ...prog,
          distanceMiles: +match.distanceMiles.toFixed(1),
          closestStationName: match.stationName,
        });
      }
    }

    // Sort by distance (closest programs first)
    discovered.sort((a, b) => a.distanceMiles - b.distanceMiles);

    areaCache.set(gridKey, discovered);
    return discovered;
  } catch (err) {
    console.warn('[gasPrograms] Failed to discover programs in area:', err);
    // Fallback: return wholesale clubs as default if scan fails
    return GAS_PROGRAMS.filter(p => p.type === 'wholesale').map(p => ({
      ...p,
      distanceMiles: 0,
      closestStationName: p.name,
    }));
  }
}

