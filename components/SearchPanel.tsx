/**
 * SearchPanel.tsx — Google Maps-inspired search + results panel.
 *
 * Visual language: clean white cards, 8px spacing grid, minimal color (one blue
 * accent), proper typographic hierarchy, no emoji in UI labels.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';

import { geocode, getRoute, getStationsAlongRoute } from '../lib/routing';
import { assignPrices }                             from '../lib/gasApi';
import { rankStations }                             from '../lib/optimizer';
import type { TripInputs, RankedStation }           from '../lib/optimizer';
import type { RouteResult, LngLat }                 from '../lib/routing';

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  white:    '#FFFFFF',
  surface:  '#F8F9FA',
  border:   '#E8EAED',
  text1:    '#202124',   // primary
  text2:    '#5F6368',   // secondary
  text3:    '#80868B',   // tertiary
  blue:     '#1A73E8',
  blueBg:   '#E8F0FE',
  green:    '#137333',
  greenBg:  '#E6F4EA',
  red:      '#C5221F',
  redBg:    '#FCE8E6',
  gold:     '#B45309',
  goldBg:   '#FEF3C7',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────
type Stage =
  | 'idle' | 'geocoding' | 'routing'
  | 'fetching_stations' | 'fetching_prices' | 'ranking'
  | 'done' | 'error';

interface SearchPanelProps {
  onRouteFound:     (r: RouteResult, o: LngLat, d: LngLat) => void;
  onStationsFound:  (s: RankedStation[]) => void;
  onSelectStation:  (s: RankedStation | null) => void;
  selectedStation:  RankedStation | null;
  stations:         RankedStation[];
  onOpenCalculator: () => void;
}

const STAGE_LABEL: Record<Stage, string> = {
  idle:             '',
  geocoding:        'Finding locations…',
  routing:          'Calculating route…',
  fetching_stations:'Scanning gas stations…',
  fetching_prices:  'Fetching live prices…',
  ranking:          'Ranking by true cost…',
  done:             '',
  error:            '',
};

function fmtSavings(n: number) {
  const abs = Math.abs(n).toFixed(2);
  return n >= 0 ? `+$${abs}` : `−$${abs}`;
}

// ─── Station result card ──────────────────────────────────────────────────────
function StationCard({
  station, rank, isSelected, onPress,
}: {
  station: RankedStation; rank: number; isSelected: boolean; onPress: () => void;
}) {
  const isBest  = rank === 0 && station.isWorthIt;
  const isWorth = station.isWorthIt;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && styles.cardSelected,
        isBest     && styles.cardBest,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {isBest && (
        <View style={styles.bestBadge}>
          <Text style={styles.bestBadgeText}>Best stop</Text>
        </View>
      )}

      <View style={styles.cardRow}>
        {/* Left: name + meta */}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>{station.name}</Text>
          <Text style={styles.cardMeta}>
            +{station.detourMiles.toFixed(1)} mi · +{Math.round(station.detourMinutes)} min
          </Text>
        </View>

        {/* Right: price + savings */}
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>${station.pricePerGallon.toFixed(3)}</Text>
          <View style={[
            styles.savingsPill,
            { backgroundColor: isWorth ? T.greenBg : T.redBg },
          ]}>
            <Text style={[styles.savingsPillText, { color: isWorth ? T.green : T.red }]}>
              {fmtSavings(station.netSavings)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Inline stepper for vehicle params ───────────────────────────────────────
function ParamChip({
  label, value, onChangeText,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <TextInput
        style={styles.chipInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        returnKeyType="done"
      />
    </View>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export default function SearchPanel({
  onRouteFound,
  onStationsFound,
  onSelectStation,
  selectedStation,
  stations,
  onOpenCalculator,
}: SearchPanelProps) {
  const [origin,      setOrigin]      = useState('');
  const [destination, setDestination] = useState('');
  const [mpg,         setMpg]         = useState('25');
  const [gallons,     setGallons]     = useState('12');
  const [hourlyValue, setHourlyValue] = useState('25');
  const [stage,       setStage]       = useState<Stage>('idle');
  const [errorMsg,    setErrorMsg]    = useState('');

  const isLoading = stage !== 'idle' && stage !== 'done' && stage !== 'error';
  const isDone    = stage === 'done';

  const handleSearch = useCallback(async () => {
    if (!origin.trim() || !destination.trim()) {
      setErrorMsg('Enter both an origin and a destination to continue.');
      setStage('error');
      return;
    }
    setErrorMsg('');
    setStage('geocoding');
    try {
      const [o, d] = await Promise.all([geocode(origin), geocode(destination)]);
      if (!o) throw new Error(`Could not find "${origin}"`);
      if (!d) throw new Error(`Could not find "${destination}"`);

      setStage('routing');
      const route = await getRoute(o, d);
      if (!route) throw new Error('Route calculation failed. Check your connection.');
      onRouteFound(route, o, d);

      setStage('fetching_stations');
      const raw = await getStationsAlongRoute(route.geometry);
      if (!raw.length) throw new Error('No gas stations found within 5 miles of this route.');

      setStage('fetching_prices');
      const priced = await assignPrices(raw);

      setStage('ranking');
      const inputs: TripInputs = {
        mpg:             parseFloat(mpg)         || 25,
        gallons:         parseFloat(gallons)      || 12,
        hourlyTimeValue: parseFloat(hourlyValue)  || 25,
      };
      onStationsFound(rankStations(priced, inputs));
      setStage('done');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStage('error');
    }
  }, [origin, destination, mpg, gallons, hourlyValue, onRouteFound, onStationsFound]);

  return (
    <View style={styles.panel}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appName}>True Cost Route</Text>
          <Text style={styles.appTagline}>Find the cheapest gas along your drive</Text>
        </View>
        <TouchableOpacity
          onPress={onOpenCalculator}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.iconBtnText}>⌗</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Route search ── */}
        <View style={styles.routeCard}>
          {/* Origin */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotWrap}>
              <View style={[styles.routeDot, { backgroundColor: '#34A853' }]} />
            </View>
            <TextInput
              style={styles.routeInput}
              placeholder="Starting point"
              placeholderTextColor={T.text3}
              value={origin}
              onChangeText={setOrigin}
              returnKeyType="next"
              editable={!isLoading}
            />
          </View>

          {/* Connecting line */}
          <View style={styles.routeConnector}>
            <View style={styles.connectorLine} />
          </View>

          {/* Destination */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotWrap}>
              <View style={[styles.routeDot, { backgroundColor: '#EA4335', borderRadius: 3 }]} />
            </View>
            <TextInput
              style={styles.routeInput}
              placeholder="Destination"
              placeholderTextColor={T.text3}
              value={destination}
              onChangeText={setDestination}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              editable={!isLoading}
            />
          </View>
        </View>

        {/* ── Vehicle params ── */}
        <View style={styles.chipsRow}>
          <ParamChip label="MPG"      value={mpg}         onChangeText={setMpg} />
          <ParamChip label="Gallons"  value={gallons}      onChangeText={setGallons} />
          <ParamChip label="$/hr"     value={hourlyValue}  onChangeText={setHourlyValue} />
        </View>

        {/* ── Search button ── */}
        <TouchableOpacity
          style={[styles.searchBtn, isLoading && styles.searchBtnDisabled]}
          onPress={handleSearch}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.searchBtnLabel}>{STAGE_LABEL[stage]}</Text>
            </View>
          ) : (
            <Text style={styles.searchBtnLabel}>
              {isDone ? 'Search again' : 'Find cheapest gas'}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── Error ── */}
        {stage === 'error' && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* ── Results ── */}
        {isDone && stations.length > 0 && (
          <View style={styles.results}>
            <Text style={styles.resultsHeader}>
              {stations.length} stations along route
            </Text>
            <Text style={styles.resultsHint}>
              Tap a card or map pin for full breakdown
            </Text>

            {stations.map((s, i) => (
              <StationCard
                key={s.id}
                station={s}
                rank={i}
                isSelected={selectedStation?.id === s.id}
                onPress={() => onSelectStation(selectedStation?.id === s.id ? null : s)}
              />
            ))}
          </View>
        )}

        {isDone && stations.length === 0 && (
          <Text style={styles.emptyText}>
            No gas stations found within 5 miles of this route.
          </Text>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const webShadow = Platform.OS === 'web'
  ? ({ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' } as object)
  : { shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 };

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: T.white,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  headerLeft: { flex: 1 },
  appName: {
    fontSize: 16,
    fontWeight: '700',
    color: T.text1,
    letterSpacing: -0.2,
  },
  appTagline: {
    fontSize: 12,
    color: T.text2,
    marginTop: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  iconBtnText: {
    fontSize: 18,
    color: T.text2,
    lineHeight: 20,
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  // Route card
  routeCard: {
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 4,
    marginBottom: 12,
    ...webShadow,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  routeDotWrap: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeInput: {
    flex: 1,
    fontSize: 14,
    color: T.text1,
    height: 24,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  routeConnector: {
    paddingLeft: 22,
    height: 1,
  },
  connectorLine: {
    height: 1,
    backgroundColor: T.border,
    marginLeft: 12,
  },

  // Vehicle param chips
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: T.text2,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  chipInput: {
    fontSize: 15,
    fontWeight: '700',
    color: T.text1,
    textAlign: 'center',
    width: '100%',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },

  // Search button
  searchBtn: {
    backgroundColor: T.blue,
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 14,
  },
  searchBtnDisabled: { opacity: 0.65 },
  searchBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Error
  errorRow: {
    backgroundColor: T.redBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F5C6C6',
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    color: T.red,
    lineHeight: 18,
  },

  // Results
  results: {
    marginTop: 4,
  },
  resultsHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: T.text1,
    marginBottom: 2,
  },
  resultsHint: {
    fontSize: 11,
    color: T.text3,
    marginBottom: 12,
  },

  // Station card
  card: {
    backgroundColor: T.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    padding: 12,
    marginBottom: 8,
    ...webShadow,
  },
  cardSelected: {
    borderColor: T.blue,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: `0 0 0 3px rgba(26,115,232,0.12), 0 2px 12px rgba(0,0,0,0.10)` } as object)
      : {}),
  },
  cardBest: {
    borderColor: '#F59E0B',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: `0 0 0 3px rgba(245,158,11,0.15), 0 2px 12px rgba(0,0,0,0.10)` } as object)
      : {}),
  },
  bestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  bestBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: T.gold,
    letterSpacing: 0.5,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
    color: T.text1,
    marginBottom: 3,
  },
  cardMeta: {
    fontSize: 12,
    color: T.text3,
  },
  cardRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: T.text1,
    marginBottom: 4,
  },
  savingsPill: {
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  savingsPillText: {
    fontSize: 12,
    fontWeight: '700',
  },

  emptyText: {
    fontSize: 13,
    color: T.text2,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 20,
  },
});
