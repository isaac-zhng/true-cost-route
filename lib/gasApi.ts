import { EIA_API_KEY } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GasStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Price in $/gal for regular unleaded */
  pricePerGallon: number;
  /** State abbreviation e.g. "CA" */
  state: string;
  /** Estimated detour distance in miles from the direct route */
  detourMiles: number;
  /** Estimated detour time in minutes */
  detourMinutes: number;
}

// ─── EIA Series IDs for regular gasoline by state ────────────────────────────
// These use the EIA's EMM series (weekly retail regular gasoline prices).
// Format: PET.EMM_EPMR_PTE_<STATE>_DPG.W
// Full state list: https://www.eia.gov/petroleum/gasdiesel/
const STATE_SERIES: Record<string, string> = {
  CT: 'PET.EMM_EPMR_PTE_SCT_DPG.W',
  ME: 'PET.EMM_EPMR_PTE_SME_DPG.W',
  MA: 'PET.EMM_EPMR_PTE_SMA_DPG.W',
  NH: 'PET.EMM_EPMR_PTE_SNH_DPG.W',
  RI: 'PET.EMM_EPMR_PTE_SRI_DPG.W',
  VT: 'PET.EMM_EPMR_PTE_SVT_DPG.W',
  DE: 'PET.EMM_EPMR_PTE_SDE_DPG.W',
  MD: 'PET.EMM_EPMR_PTE_SMD_DPG.W',
  NJ: 'PET.EMM_EPMR_PTE_SNJ_DPG.W',
  NY: 'PET.EMM_EPMR_PTE_SNY_DPG.W',
  PA: 'PET.EMM_EPMR_PTE_SPA_DPG.W',
  FL: 'PET.EMM_EPMR_PTE_SFL_DPG.W',
  GA: 'PET.EMM_EPMR_PTE_SGA_DPG.W',
  NC: 'PET.EMM_EPMR_PTE_SNC_DPG.W',
  SC: 'PET.EMM_EPMR_PTE_SSC_DPG.W',
  VA: 'PET.EMM_EPMR_PTE_SVA_DPG.W',
  IL: 'PET.EMM_EPMR_PTE_SIL_DPG.W',
  IN: 'PET.EMM_EPMR_PTE_SIN_DPG.W',
  MI: 'PET.EMM_EPMR_PTE_SMI_DPG.W',
  MN: 'PET.EMM_EPMR_PTE_SMN_DPG.W',
  OH: 'PET.EMM_EPMR_PTE_SOH_DPG.W',
  WI: 'PET.EMM_EPMR_PTE_SWI_DPG.W',
  MO: 'PET.EMM_EPMR_PTE_SMO_DPG.W',
  KS: 'PET.EMM_EPMR_PTE_SKS_DPG.W',
  OK: 'PET.EMM_EPMR_PTE_SOK_DPG.W',
  TX: 'PET.EMM_EPMR_PTE_STX_DPG.W',
  CO: 'PET.EMM_EPMR_PTE_SCO_DPG.W',
  ID: 'PET.EMM_EPMR_PTE_SID_DPG.W',
  MT: 'PET.EMM_EPMR_PTE_SMT_DPG.W',
  WY: 'PET.EMM_EPMR_PTE_SWY_DPG.W',
  AZ: 'PET.EMM_EPMR_PTE_SAZ_DPG.W',
  NV: 'PET.EMM_EPMR_PTE_SNV_DPG.W',
  CA: 'PET.EMM_EPMR_PTE_SCA_DPG.W',
  OR: 'PET.EMM_EPMR_PTE_SOR_DPG.W',
  WA: 'PET.EMM_EPMR_PTE_SWA_DPG.W',
  // Fallback national series for states without specific data
  _US: 'PET.EMM_EPMR_PTE_NUS_DPG.W',
};

// In-memory price cache so we don't spam EIA on every render
const priceCache: Record<string, number> = {};

/**
 * Fetch the latest weekly average regular unleaded price for a US state.
 * Falls back to national average if state not found.
 */
export async function fetchStatePricePerGallon(state: string): Promise<number> {
  const stateUpper = state.toUpperCase();
  if (priceCache[stateUpper] !== undefined) return priceCache[stateUpper];

  const seriesId = STATE_SERIES[stateUpper] ?? STATE_SERIES['_US'];

  try {
    const url =
      `https://api.eia.gov/v2/petroleum/pri/gnd/data/` +
      `?api_key=${EIA_API_KEY}` +
      `&frequency=weekly` +
      `&data[0]=value` +
      `&facets[series][]=${encodeURIComponent(seriesId)}` +
      `&sort[0][column]=period&sort[0][direction]=desc` +
      `&length=1` +
      `&offset=0`;

    const res  = await fetch(url);
    const json = await res.json();
    const value = json?.response?.data?.[0]?.value as number | undefined;

    if (value && value > 0) {
      priceCache[stateUpper] = value;
      return value;
    }
  } catch (err) {
    console.warn('[gasApi] EIA fetch failed, using fallback price', err);
  }

  // Fallback: US national average of ~$3.50 if API is unavailable / no key yet
  priceCache[stateUpper] = 3.5;
  return 3.5;
}

/**
 * Assign realistic gas prices to an array of stations that already have `state` set.
 * Runs all state lookups in parallel.
 */
export async function assignPrices(
  stations: Omit<GasStation, 'pricePerGallon'>[],
): Promise<GasStation[]> {
  const uniqueStates = [...new Set(stations.map(s => s.state))];
  const prices = await Promise.all(uniqueStates.map(st => fetchStatePricePerGallon(st)));
  const stateMap: Record<string, number> = {};
  uniqueStates.forEach((st, i) => (stateMap[st] = prices[i]));

  return stations.map(s => ({
    ...s,
    // Add ±5 cent variation to simulate station-level differences
    pricePerGallon: +(stateMap[s.state] + (Math.random() - 0.5) * 0.1).toFixed(3),
  }));
}

