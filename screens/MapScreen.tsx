/**
 * MapScreen.tsx — Orchestrates the full navigation experience.
 *
 * Responsibilities:
 *  - Full-screen map with floating right panel
 *  - Geolocation watchPosition for live GPS tracking
 *  - Turn-by-turn step advancement
 *  - Voice announcement via Web Speech API
 *  - NavigationBar overlay when navigating
 *  - "Start Navigation" floating button when route is ready
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, StyleSheet, useWindowDimensions, Text,
  TouchableOpacity, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import SearchPanel    from '../components/SearchPanel';
import NavigationBar  from '../components/NavigationBar';
import { haversineM, speak, cancelSpeech, ANNOUNCE_THRESHOLDS } from '../lib/navigation';
import type { RouteStep }    from '../lib/navigation';
import type { RankedStation } from '../lib/optimizer';
import { getRoute, type RouteResult, type LngLat } from '../lib/routing';

// ─── Types & constants ────────────────────────────────────────────────────────
const PANEL_W    = 380;
const MARGIN     = 16;
const STEP_ADV_M = 50;     // advance step when within this many meters of maneuver

// Lazy-load web-only MapView
let MapViewComponent: React.ComponentType<{
  route: RouteResult | null;
  baseRoute?: RouteResult | null;
  stations: RankedStation[];
  selectedStation: RankedStation | null;
  onSelectStation: (s: RankedStation | null) => void;
  isNavigating?: boolean;
  isLoadingDetour?: boolean;
  userLat?: number | null;
  userLng?: number | null;
  userHeading?: number | null;
  originCoords?: LngLat | null;
  onUserLocation?: (lat: number, lng: number) => void;
}> | null = null;

if (Platform.OS === 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  MapViewComponent = require('../components/MapView.web').default;
}

import type { UserPreferences } from './SettingsScreen';

interface MapScreenProps {
  onOpenCalculator: () => void;
  onOpenSettings:   () => void;
  onUpdatePreferences?: (prefs: UserPreferences) => void;
  preferences?:     UserPreferences;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MapScreen({
  onOpenCalculator,
  onOpenSettings,
  onUpdatePreferences,
  preferences,
}: MapScreenProps) {
  const { width } = useWindowDimensions();
  const isWide    = width >= 720;

  // ── Route / station state ──
  const [baseRoute,       setBaseRoute]       = useState<RouteResult | null>(null);
  const [route,           setRoute]           = useState<RouteResult | null>(null);
  const [originCoords,    setOriginCoords]    = useState<LngLat | null>(null);
  const [destCoords,      setDestCoords]      = useState<LngLat | null>(null);
  const [stations,        setStations]        = useState<RankedStation[]>([]);
  const [selectedStation, setSelectedStation] = useState<RankedStation | null>(null);
  const [isLoadingDetour, setIsLoadingDetour] = useState<boolean>(false);
  const [sheetOpen,       setSheetOpen]       = useState(true);

  // In-memory cache of projected detour routes keyed by station ID
  const projectedRoutesCache = useRef<Map<string, RouteResult>>(new Map());

  // ── Navigation state ──
  const [isNavigating,    setIsNavigating]    = useState(false);
  const [stepIdx,         setStepIdx]         = useState(0);
  const [distanceToStep,  setDistanceToStep]  = useState(0);
  const [totalRemainM,    setTotalRemainM]    = useState(0);
  const [voiceMuted,      setVoiceMuted]      = useState(false);
  const [geoError,        setGeoError]        = useState<string | null>(null);

  // ── Live location state ──
  const [userLat,     setUserLat]     = useState<number | null>(null);
  const [userLng,     setUserLng]     = useState<number | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [userSpeedMs, setUserSpeedMs] = useState<number | null>(null);

  // ── Refs (avoid stale closures in geolocation callback) ──
  const watchIdRef      = useRef<number | null>(null);
  const announcedRef    = useRef(new Set<string>());
  const stepIdxRef      = useRef(0);
  const stepsRef        = useRef<RouteStep[]>([]);
  const voiceMutedRef   = useRef(false);

  // Keep refs in sync
  useEffect(() => { stepIdxRef.current    = stepIdx;    }, [stepIdx]);
  useEffect(() => { voiceMutedRef.current = voiceMuted; }, [voiceMuted]);

  // ── Route / stations handlers ──
  const handleRouteFound = useCallback((r: RouteResult, o: LngLat, d: LngLat) => {
    setBaseRoute(r);
    setRoute(r);
    setOriginCoords(o);
    setDestCoords(d);
    setSelectedStation(null);
    projectedRoutesCache.current.clear();
    stepsRef.current = r.steps;
    // Compute initial total distance
    const total = r.steps.reduce((acc, s) => acc + s.distanceM, 0);
    setTotalRemainM(total);
  }, []);

  const handleStationsFound = useCallback((s: RankedStation[]) => {
    setStations(s);
    setSelectedStation(null);
  }, []);

  const handleUserLocation = useCallback((lat: number, lng: number) => {
    setUserLat(lat);
    setUserLng(lng);
  }, []);

  const handleOriginSelect = useCallback((coords: LngLat, _label: string) => {
    setOriginCoords(coords);
  }, []);

  // When a gas station is selected, immediately project the detour route through that station
  const handleSelectStation = useCallback(async (station: RankedStation | null) => {
    if (!station) {
      setSelectedStation(null);
      setRoute(baseRoute);
      if (baseRoute) {
        stepsRef.current = baseRoute.steps;
        const total = baseRoute.steps.reduce((acc, st) => acc + st.distanceM, 0);
        setTotalRemainM(total);
      }
      return;
    }

    setSelectedStation(station);

    // 1. Check cache for instant display
    const cached = projectedRoutesCache.current.get(station.id);
    if (cached) {
      setRoute(cached);
      stepsRef.current = cached.steps;
      const total = cached.steps.reduce((acc, st) => acc + st.distanceM, 0);
      setTotalRemainM(total);
      return;
    }

    // 2. Fetch projected route: origin -> gas station -> destination
    if (originCoords && destCoords) {
      setIsLoadingDetour(true);
      try {
        const projected = await getRoute(originCoords, destCoords, [{ lat: station.lat, lng: station.lng }]);
        if (projected) {
          projectedRoutesCache.current.set(station.id, projected);
          setSelectedStation(current => {
            if (current?.id === station.id) {
              setRoute(projected);
              stepsRef.current = projected.steps;
              const total = projected.steps.reduce((acc, st) => acc + st.distanceM, 0);
              setTotalRemainM(total);
            }
            return current;
          });
        }
      } catch (err) {
        console.warn('[MapScreen] Failed to calculate projected route for station:', err);
      } finally {
        setIsLoadingDetour(false);
      }
    }
  }, [baseRoute, originCoords, destCoords]);

  // ── Geolocation position handler ──
  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
    console.log(`[GPS] lat=${latitude.toFixed(5)} lng=${longitude.toFixed(5)} acc=${accuracy?.toFixed(0)}m`);

    setUserLat(latitude);
    setUserLng(longitude);
    setUserHeading(typeof heading === 'number' && !isNaN(heading) ? heading : null);
    setUserSpeedMs(typeof speed === 'number' && speed >= 0 ? speed : null);

    const steps = stepsRef.current;
    if (!steps.length) return;

    const idx = stepIdxRef.current;
    if (idx >= steps.length) return;

    const step = steps[idx];
    const dist = haversineM(latitude, longitude, step.maneuverLat, step.maneuverLng);

    setDistanceToStep(dist);

    // Compute remaining distance
    const stepsLeft = steps.slice(idx);
    const remaining = stepsLeft.reduce((acc, s, i) => acc + (i === 0 ? dist : s.distanceM), 0);
    setTotalRemainM(remaining);

    // ── Voice announcements ──
    for (const [threshold, prefix] of ANNOUNCE_THRESHOLDS) {
      const key = `${idx}-${threshold}`;
      if (dist <= threshold && !announcedRef.current.has(key)) {
        announcedRef.current.add(key);
        const text = `${prefix}${step.instruction}`;
        speak(text, voiceMutedRef.current);
        break; // only announce one threshold per position update
      }
    }

    // ── Step advancement ──
    if (dist <= STEP_ADV_M && idx + 1 < steps.length) {
      const nextIdx = idx + 1;
      announcedRef.current.delete(`${idx}-500`);
      announcedRef.current.delete(`${idx}-150`);
      announcedRef.current.delete(`${idx}-50`);
      stepIdxRef.current = nextIdx;
      setStepIdx(nextIdx);

      // Announce the NEXT step proactively
      const next = steps[nextIdx];
      if (next.maneuverType !== 'arrive') {
        speak(`Continue, then ${next.instruction}`, voiceMutedRef.current);
      } else {
        speak('You have arrived at your destination.', voiceMutedRef.current);
      }
    }
  }, []);

  // ── Start navigation ──
  const startNavigation = useCallback(() => {
    if (!route?.steps.length) return;
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setGeoError(null);
    setStepIdx(0);
    stepIdxRef.current = 0;
    announcedRef.current.clear();
    stepsRef.current = route.steps;
    setIsNavigating(true);

    const destName = selectedStation ? `gas stop at ${selectedStation.name}` : 'destination';
    speak(`Starting navigation to ${destName}. ${route.steps[0].instruction}`, voiceMutedRef.current);

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        setGeoError(
          err.code === 1
            ? 'Location access denied. Please allow location in your browser settings.'
            : 'Unable to get your location. Try again.',
        );
        setIsNavigating(false);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }, [route, selectedStation, handlePosition]);

  // ── Stop navigation ──
  const stopNavigation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    cancelSpeech();
    setIsNavigating(false);
    setStepIdx(0);
    setUserLat(null);
    setUserLng(null);
    setUserHeading(null);
    setUserSpeedMs(null);
    announcedRef.current.clear();
  }, []);

  // Query initial location for search suggestions bias
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation && userLat === null) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setUserLat(pos.coords.latitude);
          setUserLng(pos.coords.longitude);
        },
        err => {
          console.log('[GPS] Initial location check:', err.message);
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
      );
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    cancelSpeech();
  }, []);

  if (Platform.OS !== 'web' || !MapViewComponent) {
    return (
      <View style={styles.notWeb}>
        <Text style={styles.notWebText}>
          The interactive map is only available on web.{'\n\n'}Run: expo start --web
        </Text>
      </View>
    );
  }

  const MV           = MapViewComponent;
  const currentStep  = route?.steps[stepIdx] ?? null;
  const hasRoute     = !!route;

  // ── Navigation bar (overlays top of entire screen) ──
  const navBar = isNavigating && currentStep ? (
    <View style={[styles.navBarWrap, isWide ? styles.navBarDesktop : styles.navBarMobile]}>
      <NavigationBar
        step={currentStep}
        distanceM={distanceToStep}
        speedMs={userSpeedMs}
        totalRemainM={totalRemainM}
        voiceMuted={voiceMuted}
        onToggleMute={() => setVoiceMuted(v => !v)}
        onStop={stopNavigation}
      />
    </View>
  ) : null;

  // ── Start navigation button (docked with the right-side panel) ──
  const startBtn = hasRoute && !isNavigating ? (
    <View style={styles.panelFooter}>
      {geoError && <Text style={styles.geoError}>{geoError}</Text>}
      <TouchableOpacity style={styles.startBtn} onPress={startNavigation} activeOpacity={0.85}>
        <Text style={styles.startBtnText}>
          {selectedStation
            ? `Start Navigation (via ${selectedStation.name})`
            : 'Start Navigation'}
        </Text>
      </TouchableOpacity>
    </View>
  ) : null;

  if (isWide) {
    return (
      <View style={styles.root}>
        <StatusBar style="auto" />

        {/* Full-screen map (flex fills root height) */}
        <View style={styles.mapFlex}>
          <MV
            route={route}
            baseRoute={baseRoute}
            stations={stations}
            selectedStation={selectedStation}
            onSelectStation={handleSelectStation}
            isNavigating={isNavigating}
            isLoadingDetour={isLoadingDetour}
            userLat={userLat}
            userLng={userLng}
            userHeading={userHeading}
            originCoords={originCoords}
            onUserLocation={handleUserLocation}
          />
        </View>

        {/* Floating right panel with integrated Start Navigation */}
        <View style={styles.floatingPanel}>
          <SearchPanel
            onRouteFound={handleRouteFound}
            onStationsFound={handleStationsFound}
            onSelectStation={handleSelectStation}
            selectedStation={selectedStation}
            stations={stations}
            onOpenCalculator={onOpenCalculator}
            onOpenSettings={onOpenSettings}
            onUpdatePreferences={onUpdatePreferences}
            preferences={preferences}
            userLat={userLat}
            userLng={userLng}
            onOriginSelect={handleOriginSelect}
            onUserLocation={handleUserLocation}
          />
          {startBtn}
        </View>

        {/* Navigation bar — top center overlay */}
        {navBar}
      </View>
    );
  }

  // ── Mobile ──
  return (
    <View style={styles.root}>
      <StatusBar style="auto" />

      <View style={styles.mapFlex}>
        <MV
          route={route}
          baseRoute={baseRoute}
          stations={stations}
          selectedStation={selectedStation}
          onSelectStation={handleSelectStation}
          isNavigating={isNavigating}
          isLoadingDetour={isLoadingDetour}
          userLat={userLat}
          userLng={userLng}
          userHeading={userHeading}
          originCoords={originCoords}
          onUserLocation={handleUserLocation}
        />
      </View>

      {/* Navigation bar (full width at top) */}
      {navBar}

      {/* Bottom sheet with integrated Start Navigation */}
      {!isNavigating && (
        <View style={styles.bottomContainer}>
          <TouchableOpacity style={styles.sheetPill} onPress={() => setSheetOpen(p => !p)} activeOpacity={0.8}>
            <View style={styles.pillHandle} />
            <Text style={styles.pillLabel}>{sheetOpen ? 'Hide search' : 'Search & results'}</Text>
          </TouchableOpacity>
          {sheetOpen && (
            <View style={styles.bottomSheet}>
              <SearchPanel
                onRouteFound={handleRouteFound}
                onStationsFound={handleStationsFound}
                onSelectStation={handleSelectStation}
                selectedStation={selectedStation}
                stations={stations}
                onOpenCalculator={onOpenCalculator}
                onOpenSettings={onOpenSettings}
                onUpdatePreferences={onUpdatePreferences}
                preferences={preferences}
                userLat={userLat}
                userLng={userLng}
                onOriginSelect={handleOriginSelect}
                onUserLocation={handleUserLocation}
              />
              {startBtn}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const panelShadow: object = Platform.OS === 'web'
  ? { boxShadow: '-2px 0 24px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08)' }
  : { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: -2, height: 4 }, elevation: 12 };

const sheetShadow: object = Platform.OS === 'web'
  ? { boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' }
  : { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: -4 }, elevation: 8 };

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#E5E3DF' },
  mapFlex: { flex: 1 },

  // Desktop floating panel
  floatingPanel: {
    position: 'absolute',
    top:    MARGIN,
    right:  MARGIN,
    bottom: MARGIN,
    width:  PANEL_W,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...(panelShadow as object),
  },

  // Navigation bar wrap
  navBarWrap: {
    position: 'absolute',
    zIndex: 100,
  },
  navBarDesktop: {
    top:   MARGIN,
    left:  MARGIN,
    right: PANEL_W + MARGIN * 2 + MARGIN,
  },
  navBarMobile: {
    top: 0,
    left: 0,
    right: 0,
  },

  // Panel footer with Start Navigation button
  panelFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8EAED',
    backgroundColor: '#FFFFFF',
  },
  startBtn: {
    backgroundColor: '#1A73E8',
    borderRadius: 24,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 2px 8px rgba(26,115,232,0.35)' } as object)
      : { shadowColor: '#1A73E8', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }),
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  geoError: {
    color: '#C5221F',
    fontSize: 12,
    textAlign: 'center',
    backgroundColor: '#FCE8E6',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    width: '100%',
  },

  // Mobile bottom sheet
  bottomContainer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
  },
  sheetPill: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
    ...(sheetShadow as object),
  },
  pillHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#DADCE0', marginBottom: 6,
  },
  pillLabel: {
    fontSize: 13, fontWeight: '600', color: '#5F6368',
  },
  bottomSheet: {
    height: 440,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },

  notWeb: {
    flex: 1, backgroundColor: '#F8F9FA',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  notWebText: {
    fontSize: 16, color: '#5F6368',
    textAlign: 'center', lineHeight: 26,
  },
});
