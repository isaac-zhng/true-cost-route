import type { GasStation } from './gasApi';
import { MAX_DETOUR_MILES, MAX_STATIONS_SHOWN } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TripInputs {
  mpg: number;
  gallons: number;
  hourlyTimeValue: number;
}

export interface RankedStation extends GasStation {
  grossSavingsVsLocal: number;    // vs paying at a hypothetical "local" reference price
  fuelWastedCost: number;
  timeCost: number;
  netSavings: number;
  effectiveHourlyRate: number;
  isWorthIt: boolean;
  /** Reference price = avg of all stations along route (acts as "local" price) */
  referencePrice: number;
}

// ─── Core ranking engine ──────────────────────────────────────────────────────

/**
 * Apply True Cost math to each station, using the median station price
 * along the route as the "local" reference price.
 *
 * Returns stations sorted by netSavings descending, capped at MAX_STATIONS_SHOWN.
 */
export function rankStations(
  stations: GasStation[],
  inputs: TripInputs,
): RankedStation[] {
  if (!stations.length) return [];

  // Filter out unrealistic detours
  const candidates = stations.filter(s => s.detourMiles <= MAX_DETOUR_MILES);
  if (!candidates.length) return [];

  // Reference price = median of all candidate prices
  const sorted = [...candidates].sort((a, b) => a.pricePerGallon - b.pricePerGallon);
  const mid    = Math.floor(sorted.length / 2);
  const referencePrice =
    sorted.length % 2 === 0
      ? (sorted[mid - 1].pricePerGallon + sorted[mid].pricePerGallon) / 2
      : sorted[mid].pricePerGallon;

  const ranked: RankedStation[] = candidates.map(station => {
    const { mpg, gallons, hourlyTimeValue } = inputs;
    const { pricePerGallon, detourMiles, detourMinutes } = station;

    // True Cost formulas (same as main calculator)
    const grossSavingsVsLocal = gallons * (referencePrice - pricePerGallon);
    const fuelWastedCost      = (detourMiles / mpg) * pricePerGallon;
    const timeCost            = (detourMinutes / 60) * hourlyTimeValue;
    const netSavings          = grossSavingsVsLocal - (fuelWastedCost + timeCost);
    const detourHrs           = detourMinutes / 60;
    const effectiveHourlyRate =
      detourHrs > 0 ? (grossSavingsVsLocal - fuelWastedCost) / detourHrs : 0;

    return {
      ...station,
      referencePrice,
      grossSavingsVsLocal,
      fuelWastedCost,
      timeCost,
      netSavings,
      effectiveHourlyRate,
      isWorthIt: netSavings > 0,
    };
  });

  // Sort by net savings (best first)
  ranked.sort((a, b) => b.netSavings - a.netSavings);

  return ranked.slice(0, MAX_STATIONS_SHOWN);
}

