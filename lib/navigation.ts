/**
 * lib/navigation.ts
 *
 * Navigation helpers: turn-by-turn instruction generation, distance formatting,
 * step tracking, and Web Speech API voice announcements.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteStep {
  maneuverType: string;
  modifier?:    string;
  streetName:   string;
  distanceM:    number;   // length of THIS segment
  durationS:    number;
  maneuverLat:  number;   // where the maneuver happens (GeoJSON is [lng, lat])
  maneuverLng:  number;
  instruction:  string;   // "Turn left onto Oak St"
  arrowSymbol:  string;   // "←"
}

// ─── Arrow symbols ───────────────────────────────────────────────────────────

const MODIFIER_ARROW: Record<string, string> = {
  left:          '←',
  'sharp left':  '↙',
  'slight left': '↖',
  right:         '→',
  'sharp right': '↘',
  'slight right':'↗',
  straight:      '↑',
  uturn:         '↩',
};

const TYPE_ARROW: Record<string, string> = {
  depart:           '↑',
  arrive:           '◉',
  roundabout:       '↻',
  rotary:           '↻',
  'exit roundabout':'↗',
  'off ramp':       '↗',
  'on ramp':        '↗',
};

export function getArrow(type: string, modifier?: string): string {
  if (TYPE_ARROW[type]) return TYPE_ARROW[type];
  if (modifier && MODIFIER_ARROW[modifier]) return MODIFIER_ARROW[modifier];
  return '↑';
}

// ─── Instruction text ─────────────────────────────────────────────────────────

export function getInstruction(
  type: string,
  modifier: string | undefined,
  street: string,
): string {
  const onto = street ? ` onto ${street}` : '';
  const on   = street ? ` on ${street}`   : '';

  switch (type) {
    case 'depart':
      return `Head ${cardinalFromModifier(modifier)}${on}`;
    case 'arrive':
      return 'You have arrived';
    case 'turn': {
      if (!modifier)                    return `Turn${onto}`;
      if (modifier.startsWith('slight'))return `Bear ${modifier.replace('slight ', '')}${onto}`;
      if (modifier.startsWith('sharp')) return `Turn sharp ${modifier.replace('sharp ', '')}${onto}`;
      return `Turn ${modifier}${onto}`;
    }
    case 'continue':
    case 'new name':
      return `Continue${onto || on}`;
    case 'roundabout':
    case 'rotary':
      return 'Enter the roundabout';
    case 'exit roundabout':
      return `Exit the roundabout${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'on ramp':
      return `Take the ramp${onto}`;
    default:
      return street ? `Continue on ${street}` : 'Continue';
  }
}

function cardinalFromModifier(modifier?: string): string {
  const MAP: Record<string, string> = {
    north: 'north', south: 'south', east: 'east', west: 'west',
    northeast: 'northeast', northwest: 'northwest',
    southeast: 'southeast', southwest: 'southwest',
  };
  return modifier ? (MAP[modifier] ?? '') : '';
}

// ─── Distance formatting ─────────────────────────────────────────────────────

export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  const feet  = meters * 3.28084;
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
  const rounded = Math.max(50, Math.round(feet / 50) * 50);
  return `${rounded} ft`;
}

// ─── Haversine (meters) ───────────────────────────────────────────────────────

export function haversineM(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R    = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Voice guidance ───────────────────────────────────────────────────────────

export function speak(text: string, muted: boolean): void {
  if (muted) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u   = new SpeechSynthesisUtterance(text);
  u.rate    = 1.05;
  u.pitch   = 1.0;
  u.volume  = 1.0;
  window.speechSynthesis.speak(u);
}

export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// ─── Voice announcement thresholds ───────────────────────────────────────────
// Each threshold: [distance in meters, spoken prefix]
export const ANNOUNCE_THRESHOLDS: [number, string][] = [
  [500, 'In half a mile, '],
  [160, 'In 500 feet, '],
  [50,  ''],   // "Turn left now"
];

