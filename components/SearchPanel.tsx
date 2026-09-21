import React, { useState, useCallback, useRef, useEffect } from 'react';
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

import { geocode, getRoute, getStationsAlongRoute, fetchAddressSuggestions, type AddressSuggestion } from '../lib/routing';
import { assignPrices }                             from '../lib/gasApi';
import { rankStations }                             from '../lib/optimizer';
import type { TripInputs, RankedStation }           from '../lib/optimizer';
import type { RouteResult, LngLat }                 from '../lib/routing';
import type { UserPreferences }                     from '../screens/SettingsScreen';

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
  onRouteFound:         (r: RouteResult, o: LngLat, d: LngLat) => void;
  onStationsFound:      (s: RankedStation[]) => void;
  onSelectStation:      (s: RankedStation | null) => void;
  selectedStation:      RankedStation | null;
  stations:             RankedStation[];
  onOpenCalculator:     () => void;
  onOpenSettings:       () => void;
  onUpdatePreferences?: (prefs: UserPreferences) => void;
  preferences?:         UserPreferences;
  userLat?:             number | null;
  userLng?:             number | null;
  onOriginSelect?:      (coords: LngLat, label: string) => void;
  onUserLocation?:      (lat: number, lng: number) => void;
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
  const absNet  = Math.abs(station.netSavings).toFixed(2);

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
          <Text style={styles.bestBadgeText}>BEST STOP · LOWEST TRUE COST</Text>
        </View>
      )}

      {station.programName && (
        <View style={[
          styles.membershipCardBadge,
          station.programType === 'grocery' && { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
          station.programType === 'loyalty' && { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
        ]}>
          <Text style={[
            styles.membershipCardBadgeText,
            station.programType === 'grocery' && { color: '#15803D' },
            station.programType === 'loyalty' && { color: '#B45309' },
          ]}>
            {station.programName.toUpperCase()} {station.isMembershipRequired ? 'MEMBER PRICING' : 'REWARDS'}
            {station.discountPerGallon ? ` (SAVE ~$${station.discountPerGallon.toFixed(2)}/GAL)` : ''}
          </Text>
        </View>
      )}

      <View style={styles.cardRow}>
        {/* Left: name + meta */}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>{station.name}</Text>
          <Text style={styles.cardMeta}>
            +{station.detourMiles.toFixed(1)} mi · +{Math.round(station.detourMinutes)} min detour
            {station.queueWaitMinutes ? ` (incl. ~${station.queueWaitMinutes}m line)` : ''}
          </Text>
          {isSelected && (
            <Text style={{ fontSize: 11, color: T.blue, fontWeight: '600', marginTop: 3 }}>
              Projected route on map
            </Text>
          )}
        </View>

        {/* Right: price + savings */}
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>${station.pricePerGallon.toFixed(3)}</Text>
          {station.discountPerGallon && station.regularPricePerGallon ? (
            <Text style={{ fontSize: 10, color: T.text3, textDecorationLine: 'line-through' }}>
              ${station.regularPricePerGallon.toFixed(3)}
            </Text>
          ) : null}
          <View style={[
            styles.savingsPill,
            { backgroundColor: isWorth ? T.greenBg : T.redBg },
          ]}>
            <Text style={[styles.savingsPillText, { color: isWorth ? T.green : T.red }]}>
              {isWorth ? `Save $${absNet}` : `Lose $${absNet}`}
            </Text>
          </View>
          <Text style={styles.savingsSubtext}>
            {isWorth ? 'net in pocket' : 'detour costs extra'}
          </Text>
        </View>
      </View>

      {/* Expanded True Cost breakdown when selected */}
      {isSelected && (
        <View style={styles.cardBreakdown}>
          <View style={styles.breakdownHeader}>
            <Text style={styles.breakdownTitle}>TRUE COST BREAKDOWN</Text>
            <Text style={styles.breakdownSubtitle}>Price + Distance + Time calculation</Text>
          </View>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Pump discount (cheaper gas)</Text>
            <Text style={[styles.breakdownVal, { color: T.green }]}>
              +${Math.abs(station.grossSavingsVsLocal).toFixed(2)}
            </Text>
          </View>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Fuel burned (+{station.detourMiles.toFixed(1)} mi)
            </Text>
            <Text style={[styles.breakdownVal, { color: T.red }]}>
              −${station.fuelWastedCost.toFixed(2)}
            </Text>
          </View>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Time value (+{Math.round(station.detourMinutes)} min)
            </Text>
            <Text style={[styles.breakdownVal, { color: T.red }]}>
              −${station.timeCost.toFixed(2)}
            </Text>
          </View>

          {station.queueWaitMinutes ? (
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: T.text2 }]}>
                ↳ {station.programName ?? 'Club'} queue wait
              </Text>
              <Text style={[styles.breakdownVal, { color: T.text2 }]}>
                ~{station.queueWaitMinutes} min in line
              </Text>
            </View>
          ) : null}

          <View style={styles.breakdownDivider} />

          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, { fontWeight: '700', color: T.text1 }]}>
              {isWorth ? 'Net in your pocket:' : 'Net detour loss:'}
            </Text>
            <Text style={[styles.breakdownVal, { fontWeight: '800', fontSize: 14, color: isWorth ? T.green : T.red }]}>
              {isWorth ? `Save $${absNet}` : `Lose $${absNet}`}
            </Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
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
  onOpenSettings,
  preferences,
  userLat = null,
  userLng = null,
  onOriginSelect,
  onUserLocation,
}: SearchPanelProps) {
  const [origin,            setOrigin]            = useState('');
  const [destination,       setDestination]       = useState('');
  const [originCoords,      setOriginCoords]      = useState<LngLat | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<LngLat | null>(null);

  // Suggestions state
  const [activeField,       setActiveField]       = useState<'origin' | 'destination' | null>(null);
  const [suggestions,       setSuggestions]       = useState<AddressSuggestion[]>([]);
  const [isSuggesting,      setIsSuggesting]      = useState(false);
  const [isLocating,        setIsLocating]        = useState(false);
  const debounceTimerRef                          = useRef<any>(null);

  const [mpg,         setMpg]         = useState(preferences ? String(preferences.mpg) : '25');
  const [gallons,     setGallons]     = useState(preferences ? String(preferences.gallons) : '12');
  const [hourlyValue, setHourlyValue] = useState(preferences ? String(preferences.hourlyValue) : '25');
  const [ignoreTime,  setIgnoreTime]  = useState(preferences ? preferences.ignoreTime : false);
  const [enrolledProgramIds, setEnrolledProgramIds] = useState<string[]>(
    preferences ? preferences.enrolledProgramIds : ['costco', 'sams_club']
  );
  const [stage,       setStage]       = useState<Stage>('idle');
  const [errorMsg,    setErrorMsg]    = useState('');

  const rawStationsRef       = useRef<any[]>([]);
  const rawPricedStationsRef = useRef<any[]>([]);

  // Keep vehicle & program settings in sync with user preferences saved in SettingsScreen
  useEffect(() => {
    if (!preferences) return;
    setMpg(String(preferences.mpg));
    setGallons(String(preferences.gallons));
    setHourlyValue(String(preferences.hourlyValue));
    setIgnoreTime(preferences.ignoreTime);
    setEnrolledProgramIds(preferences.enrolledProgramIds);

    // If stations were already fetched, re-price and re-rank immediately
    if (rawStationsRef.current.length > 0) {
      assignPrices(rawStationsRef.current, preferences.enrolledProgramIds).then(priced => {
        rawPricedStationsRef.current = priced;
        const inputs: TripInputs = {
          mpg: preferences.mpg,
          gallons: preferences.gallons,
          hourlyTimeValue: preferences.ignoreTime ? 0 : preferences.hourlyValue,
          enrolledProgramIds: preferences.enrolledProgramIds,
        };
        onStationsFound(rankStations(priced, inputs));
      });
    }
  }, [preferences, onStationsFound]);

  const handleSwap = () => {
    const prevOrigin = origin;
    const prevCoords = originCoords;
    setOrigin(destination);
    setOriginCoords(destinationCoords);
    setDestination(prevOrigin);
    setDestinationCoords(prevCoords);
    setSuggestions([]);
    setActiveField(null);
  };

  const isLoading = stage !== 'idle' && stage !== 'done' && stage !== 'error';
  const isDone    = stage === 'done';

  // ── Debounced address suggestions fetch ──
  const fetchDebounced = useCallback((text: string, field: 'origin' | 'destination') => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setIsSuggesting(false);
      return;
    }

    setIsSuggesting(true);
    debounceTimerRef.current = setTimeout(async () => {
      // If destination, bias to originCoords if available, otherwise user location
      const biasLat = field === 'destination' && originCoords ? originCoords.lat : (userLat ?? undefined);
      const biasLng = field === 'destination' && originCoords ? originCoords.lng : (userLng ?? undefined);

      const res = await fetchAddressSuggestions(text, biasLat, biasLng);
      setSuggestions(res);
      setIsSuggesting(false);
    }, 260);
  }, [originCoords, userLat, userLng]);

  const handleOriginChange = (text: string) => {
    setOrigin(text);
    setOriginCoords(null);
    setActiveField('origin');
    fetchDebounced(text, 'origin');
  };

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    setDestinationCoords(null);
    setActiveField('destination');
    fetchDebounced(text, 'destination');
  };

  const handleSelectSuggestion = (s: AddressSuggestion) => {
    if (activeField === 'origin') {
      setOrigin(s.fullText);
      setOriginCoords(s.coords);
      onOriginSelect?.(s.coords, s.fullText);
    } else if (activeField === 'destination') {
      setDestination(s.fullText);
      setDestinationCoords(s.coords);
    }
    setSuggestions([]);
    setActiveField(null);
  };

  const handleUseCurrentLocation = useCallback(() => {
    if (userLat !== null && userLng !== null) {
      setOrigin('Your current location');
      const coords: LngLat = { lat: userLat, lng: userLng };
      setOriginCoords(coords);
      onOriginSelect?.(coords, 'Your current location');
      setSuggestions([]);
      setActiveField(null);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        pos => {
          setIsLocating(false);
          const coords: LngLat = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setOrigin('Your current location');
          setOriginCoords(coords);
          onUserLocation?.(coords.lat, coords.lng);
          onOriginSelect?.(coords, 'Your current location');
          setSuggestions([]);
          setActiveField(null);
        },
        err => {
          setIsLocating(false);
          console.warn('[GPS] Failed to get current location:', err);
          setErrorMsg(
            err.code === 1
              ? 'Location permission was denied in your browser settings.'
              : 'Unable to detect your location. Please type your starting address.',
          );
          setStage('error');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    } else {
      setErrorMsg('Geolocation is not supported by your browser.');
      setStage('error');
    }
  }, [userLat, userLng, onOriginSelect, onUserLocation]);

  const handleSearch = useCallback(async () => {
    if (!origin.trim() || !destination.trim()) {
      setErrorMsg('Enter both an origin and a destination to continue.');
      setStage('error');
      return;
    }
    setSuggestions([]);
    setActiveField(null);
    setErrorMsg('');
    setStage('geocoding');
    try {
      // Use pre-resolved coordinates from suggestion selection if available
      const [o, d] = await Promise.all([
        originCoords ? Promise.resolve(originCoords) : geocode(origin),
        destinationCoords ? Promise.resolve(destinationCoords) : geocode(destination),
      ]);
      if (!o) throw new Error(`Could not find "${origin}"`);
      if (!d) throw new Error(`Could not find "${destination}"`);

      setStage('routing');
      const route = await getRoute(o, d);
      if (!route) throw new Error('Route calculation failed. Check your connection.');
      onRouteFound(route, o, d);

      setStage('fetching_stations');
      const raw = await getStationsAlongRoute(route.geometry);
      if (!raw.length) throw new Error('No gas stations found within 5 miles of this route.');
      rawStationsRef.current = raw;

      setStage('fetching_prices');
      const priced = await assignPrices(raw, enrolledProgramIds);
      rawPricedStationsRef.current = priced;

      setStage('ranking');
      const inputs: TripInputs = {
        mpg:             parseFloat(mpg)         || 25,
        gallons:         parseFloat(gallons)      || 12,
        hourlyTimeValue: ignoreTime ? 0 : (parseFloat(hourlyValue) || 25),
        enrolledProgramIds,
      };
      onStationsFound(rankStations(priced, inputs));
      setStage('done');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStage('error');
    }
  }, [origin, destination, originCoords, destinationCoords, mpg, gallons, hourlyValue, ignoreTime, enrolledProgramIds, onRouteFound, onStationsFound]);

  return (
    <View style={styles.panel}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appName}>True Cost Route</Text>
          <Text style={styles.appTagline}>Find the cheapest gas along your drive</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={onOpenCalculator}
            style={styles.iconBtn}
            accessibilityLabel="Open calculator"
            activeOpacity={0.7}
          >
            <Text style={styles.iconBtnText}>⌗</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onOpenSettings}
            style={styles.iconBtn}
            accessibilityLabel="Open vehicle & membership settings"
            activeOpacity={0.7}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setActiveField(null)}
      >

        {/* ── Route search ── */}
        <View style={styles.routeCard}>
          {/* Origin input row */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotWrap}>
              <View style={[styles.routeDot, { backgroundColor: '#34A853' }]} />
            </View>
            <TextInput
              style={styles.routeInput}
              placeholder="Starting point"
              placeholderTextColor={T.text3}
              value={origin}
              onChangeText={handleOriginChange}
              onFocus={() => {
                setActiveField('origin');
                if (origin.trim().length >= 2) fetchDebounced(origin, 'origin');
              }}
              returnKeyType="next"
              editable={!isLoading}
            />
            {isLocating ? (
              <ActivityIndicator size="small" color={T.blue} style={{ marginRight: 6 }} />
            ) : origin.length === 0 ? (
              <TouchableOpacity
                onPress={handleUseCurrentLocation}
                style={styles.locateInputBtn}
                accessibilityLabel="Use current location"
                activeOpacity={0.7}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                </svg>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setOrigin('');
                  setOriginCoords(null);
                  setSuggestions([]);
                }}
                style={styles.clearBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.clearBtnText}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Origin suggestions dropdown */}
          {activeField === 'origin' && (
            <View style={styles.dropdown}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={handleUseCurrentLocation}
                activeOpacity={0.7}
              >
                <View style={[styles.dropdownIconWrap, { backgroundColor: T.blueBg }]}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                  </svg>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dropdownPrimary, { color: T.blue }]}>Your current location</Text>
                  <Text style={styles.dropdownSecondary}>
                    {isLocating ? 'Detecting GPS coordinates…' : 'Use GPS coordinates'}
                  </Text>
                </View>
                {isLocating && <ActivityIndicator size="small" color={T.blue} />}
              </TouchableOpacity>

              {isSuggesting && (
                <View style={styles.dropdownLoading}>
                  <ActivityIndicator size="small" color={T.blue} />
                  <Text style={styles.dropdownLoadingText}>Finding nearby addresses…</Text>
                </View>
              )}

              {suggestions.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.dropdownItem}
                  onPress={() => handleSelectSuggestion(s)}
                  activeOpacity={0.7}
                >
                  <View style={styles.dropdownIconWrap}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.text3 }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownPrimary} numberOfLines={1}>{s.primaryText}</Text>
                    {!!s.secondaryText && (
                      <Text style={styles.dropdownSecondary} numberOfLines={1}>{s.secondaryText}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}

              {!isSuggesting && suggestions.length === 0 && origin.trim().length >= 2 && (
                <View style={styles.dropdownEmpty}>
                  <Text style={styles.dropdownEmptyText}>No matching locations found</Text>
                </View>
              )}
            </View>
          )}

          {/* Connecting line + Swap button */}
          <View style={styles.routeConnector}>
            <View style={styles.connectorLine} />
            <TouchableOpacity
              onPress={handleSwap}
              style={styles.swapBtn}
              accessibilityLabel="Reverse start and destination"
              activeOpacity={0.7}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.text2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/>
              </svg>
            </TouchableOpacity>
          </View>

          {/* Destination input row */}
          <View style={styles.routeRow}>
            <View style={styles.routeDotWrap}>
              <View style={[styles.routeDot, { backgroundColor: '#EA4335', borderRadius: 3 }]} />
            </View>
            <TextInput
              style={styles.routeInput}
              placeholder="Destination"
              placeholderTextColor={T.text3}
              value={destination}
              onChangeText={handleDestinationChange}
              onFocus={() => {
                setActiveField('destination');
                if (destination.trim().length >= 2) fetchDebounced(destination, 'destination');
              }}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              editable={!isLoading}
            />
            {destination.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setDestination('');
                  setDestinationCoords(null);
                  setSuggestions([]);
                }}
                style={styles.clearBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.clearBtnText}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Destination suggestions dropdown */}
          {activeField === 'destination' && (
            <View style={styles.dropdown}>
              {isSuggesting && (
                <View style={styles.dropdownLoading}>
                  <ActivityIndicator size="small" color={T.blue} />
                  <Text style={styles.dropdownLoadingText}>Finding nearby addresses…</Text>
                </View>
              )}

              {suggestions.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.dropdownItem}
                  onPress={() => handleSelectSuggestion(s)}
                  activeOpacity={0.7}
                >
                  <View style={styles.dropdownIconWrap}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.text3 }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownPrimary} numberOfLines={1}>{s.primaryText}</Text>
                    {!!s.secondaryText && (
                      <Text style={styles.dropdownSecondary} numberOfLines={1}>{s.secondaryText}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}

              {!isSuggesting && suggestions.length === 0 && destination.trim().length >= 2 && (
                <View style={styles.dropdownEmpty}>
                  <Text style={styles.dropdownEmptyText}>No matching locations found</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── Quick Preferences Summary Bar ── */}
        <TouchableOpacity
          style={styles.prefsBanner}
          onPress={onOpenSettings}
          activeOpacity={0.7}
        >
          <View style={styles.prefsBannerLeft}>
            <View style={styles.prefsGearIcon}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.text2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </View>
            <Text style={styles.prefsBannerText} numberOfLines={1}>
              {mpg} MPG · {ignoreTime ? '$0/hr (Free time)' : `$${hourlyValue}/hr`} · {enrolledProgramIds.length} {enrolledProgramIds.length === 1 ? 'Program' : 'Programs'}
            </Text>
          </View>
          <Text style={styles.prefsBannerEdit}>Edit</Text>
        </TouchableOpacity>

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
            {/* Guide Explainer Banner */}
            <View style={styles.guideBanner}>
              <View style={styles.guideHeader}>
                <Text style={styles.guideTitle}>The Detour Math</Text>
              </View>
              <Text style={styles.guideText}>
                We balance pump price, extra fuel burned (+mi), and your time (+min) to calculate your true net savings:
              </Text>
              <View style={styles.guidePillsRow}>
                <View style={[styles.guidePill, { backgroundColor: T.greenBg }]}>
                  <Text style={[styles.guidePillText, { color: T.green }]}>
                    Save: Real money in your pocket
                  </Text>
                </View>
                <View style={[styles.guidePill, { backgroundColor: T.redBg }]}>
                  <Text style={[styles.guidePillText, { color: T.red }]}>
                    Lose: Detour costs extra
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.resultsHeader}>
              {stations.length} stations ranked along route
            </Text>
            <Text style={styles.resultsHint}>
              Tap any station to project its route and view full cost breakdown
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

        {/* Footer signature */}
        <View style={styles.panelFooter}>
          <Text style={styles.panelFooterText}>
            Built by Isaac · Free & client-side · Real EIA gas prices
          </Text>
        </View>

        <View style={{ height: 16 }} />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 34,
    paddingRight: 12,
    height: 20,
  },
  connectorLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.border,
  },
  swapBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // Quick Preferences Summary Bar
  prefsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  prefsBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  prefsGearIcon: {
    marginRight: 8,
  },
  prefsBannerText: {
    fontSize: 12,
    color: T.text2,
    fontWeight: '500',
    flex: 1,
  },
  prefsBannerEdit: {
    fontSize: 12,
    color: T.blue,
    fontWeight: '700',
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
  membershipCardBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  membershipCardBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1D4ED8',
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
  savingsSubtext: {
    fontSize: 10,
    color: T.text3,
    marginTop: 2,
    textAlign: 'right',
  },

  // Card breakdown
  cardBreakdown: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F4',
  },
  breakdownHeader: {
    marginBottom: 6,
  },
  breakdownTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: T.text2,
    letterSpacing: 0.5,
  },
  breakdownSubtitle: {
    fontSize: 10,
    color: T.text3,
    marginTop: 1,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  breakdownLabel: {
    fontSize: 12,
    color: T.text2,
  },
  breakdownVal: {
    fontSize: 12,
    fontWeight: '600',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: '#E8EAED',
    marginVertical: 6,
  },

  // Guide explainer banner
  guideBanner: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: T.border,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  guideTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: T.text1,
  },
  guideText: {
    fontSize: 11,
    color: T.text2,
    lineHeight: 16,
    marginBottom: 8,
  },
  guidePillsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  guidePill: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  guidePillText: {
    fontSize: 11,
    fontWeight: '600',
  },

  emptyText: {
    fontSize: 13,
    color: T.text2,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 20,
  },

  // Clear button in route input
  clearBtn: {
    padding: 4,
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearBtnText: {
    fontSize: 12,
    color: T.text3,
    fontWeight: '600',
  },
  locateInputBtn: {
    padding: 4,
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Address suggestions dropdown
  dropdown: {
    backgroundColor: T.white,
    borderTopWidth: 1,
    borderTopColor: T.border,
    maxHeight: 220,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  dropdownIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  dropdownPrimary: {
    fontSize: 13,
    fontWeight: '600',
    color: T.text1,
  },
  dropdownSecondary: {
    fontSize: 11,
    color: T.text3,
    marginTop: 1,
  },
  dropdownLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  dropdownLoadingText: {
    fontSize: 12,
    color: T.text3,
  },
  dropdownEmpty: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dropdownEmptyText: {
    fontSize: 12,
    color: T.text3,
    fontStyle: 'italic',
  },

  // Panel footer signature
  panelFooter: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.border,
    alignItems: 'center',
  },
  panelFooterText: {
    fontSize: 11,
    color: T.text3,
    letterSpacing: 0.2,
  },
});
