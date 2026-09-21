/**
 * SettingsScreen.tsx — Dedicated configuration screen for vehicle, time value,
 * and gas membership programs. Keeps the main route navigation screen clean.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  GAS_PROGRAMS,
  findProgramsInArea,
  type DiscoveredProgram,
  type GasProgram,
  type ProgramType,
} from '../lib/gasPrograms';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg:         '#F8F9FA',
  card:       '#FFFFFF',
  border:     '#E8EAED',
  borderDark: '#DADCE0',
  text1:      '#202124',
  text2:      '#5F6368',
  text3:      '#80868B',
  blue:       '#1A73E8',
  blueBg:     '#E8F0FE',
  blueBorder: '#BFDBFE',
  green:      '#137333',
  greenBg:    '#E6F4EA',
  greenBorder:'#A8DAB5',
  amber:      '#B45309',
  amberBg:    '#FEF3C7',
  amberBorder:'#FDE68A',
} as const;

export interface Vehicle {
  id: string;
  name: string;
  mpg: number;
  gallons: number;
}

export interface UserPreferences {
  vehicles: Vehicle[];
  activeVehicleId: string;
  mpg: number;
  gallons: number;
  hourlyValue: number;
  ignoreTime: boolean;
  enrolledProgramIds: string[];
}

export const DEFAULT_VEHICLES: Vehicle[] = [
  { id: 'v_default', name: 'My Car', mpg: 28, gallons: 13 },
];

export const DEFAULT_PREFERENCES: UserPreferences = {
  vehicles: DEFAULT_VEHICLES,
  activeVehicleId: 'v_default',
  mpg: 28,
  gallons: 13,
  hourlyValue: 25,
  ignoreTime: false,
  enrolledProgramIds: [],
};

const STORAGE_KEY = 'true_cost_user_preferences_v1';

export function loadStoredPreferences(): UserPreferences {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const item = window.localStorage.getItem(STORAGE_KEY);
      if (item) {
        const parsed = JSON.parse(item);

        let vehicles: Vehicle[] = Array.isArray(parsed.vehicles) && parsed.vehicles.length > 0
          ? parsed.vehicles
          : [];

        // Backwards compatibility migration: if no vehicles list was stored, create from legacy mpg/gallons
        if (vehicles.length === 0) {
          const legacyMpg = typeof parsed.mpg === 'number' && parsed.mpg > 0 ? parsed.mpg : 28;
          const legacyGallons = typeof parsed.gallons === 'number' && parsed.gallons > 0 ? parsed.gallons : 13;
          vehicles = [
            { id: 'v_legacy', name: 'My Car', mpg: legacyMpg, gallons: legacyGallons },
          ];
        }

        const activeId = typeof parsed.activeVehicleId === 'string' && vehicles.some(v => v.id === parsed.activeVehicleId)
          ? parsed.activeVehicleId
          : vehicles[0].id;

        const activeCar = vehicles.find(v => v.id === activeId) || vehicles[0];

        return {
          vehicles,
          activeVehicleId: activeCar.id,
          mpg: activeCar.mpg,
          gallons: activeCar.gallons,
          hourlyValue: typeof parsed.hourlyValue === 'number' ? parsed.hourlyValue : DEFAULT_PREFERENCES.hourlyValue,
          ignoreTime: typeof parsed.ignoreTime === 'boolean' ? parsed.ignoreTime : DEFAULT_PREFERENCES.ignoreTime,
          enrolledProgramIds: Array.isArray(parsed.enrolledProgramIds)
            ? parsed.enrolledProgramIds
            : DEFAULT_PREFERENCES.enrolledProgramIds,
        };
      }
    } catch (e) {
      console.warn('Failed to load stored preferences:', e);
    }
  }
  return DEFAULT_PREFERENCES;
}

export function saveStoredPreferences(prefs: UserPreferences) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn('Failed to save preferences:', e);
    }
  }
}

export const VEHICLE_PRESETS = [
  { label: 'Sedan', mpg: 32, gallons: 14 },
  { label: 'SUV', mpg: 22, gallons: 18 },
  { label: 'Hybrid', mpg: 48, gallons: 11 },
  { label: 'Truck', mpg: 17, gallons: 24 },
] as const;

interface SettingsScreenProps {
  initialPreferences: UserPreferences;
  onSave: (prefs: UserPreferences) => void;
  onBack: () => void;
  userLat?: number | null;
  userLng?: number | null;
}

export default function SettingsScreen({
  initialPreferences,
  onSave,
  onBack,
  userLat = null,
  userLng = null,
}: SettingsScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [vehicles,           setVehicles]           = useState<Vehicle[]>(
    initialPreferences.vehicles && initialPreferences.vehicles.length > 0
      ? initialPreferences.vehicles
      : DEFAULT_VEHICLES
  );
  const [activeVehicleId,    setActiveVehicleId]    = useState<string>(
    initialPreferences.activeVehicleId || (initialPreferences.vehicles?.[0]?.id ?? 'v_sedan')
  );
  const [hourlyValue,        setHourlyValue]        = useState(String(initialPreferences.hourlyValue));
  const [ignoreTime,         setIgnoreTime]         = useState(initialPreferences.ignoreTime);
  const [enrolledIds,        setEnrolledIds]        = useState<string[]>(initialPreferences.enrolledProgramIds);

  // Add / Edit vehicle form state
  const [showCarForm,        setShowCarForm]        = useState(false);
  const [editingVehicleId,   setEditingVehicleId]   = useState<string | null>(null);
  const [carName,            setCarName]            = useState('');
  const [carMpg,             setCarMpg]             = useState('32');
  const [carGallons,         setCarGallons]         = useState('14');

  const [discoveredPrograms, setDiscoveredPrograms] = useState<DiscoveredProgram[]>([]);
  const [isScanning,         setIsScanning]         = useState(false);
  const [activeTab,          setActiveTab]          = useState<'all' | 'wholesale' | 'grocery' | 'loyalty'>('all');

  // Scan 20-mile area for nearby stations
  useEffect(() => {
    if (userLat === null || userLng === null) return;
    let active = true;
    setIsScanning(true);
    findProgramsInArea(userLat, userLng)
      .then(progs => {
        if (active) {
          setDiscoveredPrograms(progs);
          setIsScanning(false);
        }
      })
      .catch(err => {
        console.warn('[Settings] Area programs scan failed:', err);
        if (active) setIsScanning(false);
      });
    return () => {
      active = false;
    };
  }, [userLat, userLng]);

  const toggleProgram = (progId: string) => {
    setEnrolledIds(prev =>
      prev.includes(progId) ? prev.filter(id => id !== progId) : [...prev, progId],
    );
  };

  const handleStartAdd = () => {
    setEditingVehicleId(null);
    setCarName(`Car ${vehicles.length + 1}`);
    setCarMpg('30');
    setCarGallons('14');
    setShowCarForm(true);
  };

  const handleStartEdit = (v: Vehicle) => {
    setEditingVehicleId(v.id);
    setCarName(v.name);
    setCarMpg(String(v.mpg));
    setCarGallons(String(v.gallons));
    setShowCarForm(true);
  };

  const handleCancelForm = () => {
    setEditingVehicleId(null);
    setShowCarForm(false);
  };

  const handleApplyPreset = (preset: typeof VEHICLE_PRESETS[number]) => {
    if (!carName || carName.startsWith('Car ') || VEHICLE_PRESETS.some(p => p.label === carName)) {
      setCarName(preset.label);
    }
    setCarMpg(String(preset.mpg));
    setCarGallons(String(preset.gallons));
  };

  const handleSaveVehicle = () => {
    const parsedMpg = Math.max(1, parseFloat(carMpg) || 25);
    const parsedGallons = Math.max(0.1, parseFloat(carGallons) || 12);
    const trimmedName = carName.trim() || `Car ${vehicles.length + 1}`;

    if (editingVehicleId) {
      setVehicles(prev => prev.map(v => v.id === editingVehicleId ? {
        ...v,
        name: trimmedName,
        mpg: parsedMpg,
        gallons: parsedGallons,
      } : v));
      setEditingVehicleId(null);
      setShowCarForm(false);
    } else {
      const newId = `v_${Date.now()}`;
      const newVehicle: Vehicle = {
        id: newId,
        name: trimmedName,
        mpg: parsedMpg,
        gallons: parsedGallons,
      };
      setVehicles(prev => [...prev, newVehicle]);
      setActiveVehicleId(newId);
      setShowCarForm(false);
    }
  };

  const handleDeleteVehicle = (id: string) => {
    if (vehicles.length <= 1) return;
    const remaining = vehicles.filter(v => v.id !== id);
    setVehicles(remaining);
    if (activeVehicleId === id) {
      setActiveVehicleId(remaining[0].id);
    }
    if (editingVehicleId === id) {
      setEditingVehicleId(null);
      setShowCarForm(false);
    }
  };

  const handleToggleIgnoreTime = () => {
    const next = !ignoreTime;
    setIgnoreTime(next);
    if (next) {
      setHourlyValue('0');
    } else {
      setHourlyValue('25');
    }
  };

  const handleResetDefaults = () => {
    setVehicles(DEFAULT_PREFERENCES.vehicles);
    setActiveVehicleId(DEFAULT_PREFERENCES.activeVehicleId);
    setHourlyValue(String(DEFAULT_PREFERENCES.hourlyValue));
    setIgnoreTime(DEFAULT_PREFERENCES.ignoreTime);
    setEnrolledIds(DEFAULT_PREFERENCES.enrolledProgramIds);
    setEditingVehicleId(null);
    setShowCarForm(false);
  };

  const handleSaveAndExit = () => {
    const activeCar = vehicles.find(v => v.id === activeVehicleId) || vehicles[0];
    const parsedHourly = ignoreTime ? 0 : Math.max(0, parseFloat(hourlyValue) || 25);

    const updated: UserPreferences = {
      vehicles,
      activeVehicleId: activeCar.id,
      mpg: activeCar.mpg,
      gallons: activeCar.gallons,
      hourlyValue: parsedHourly,
      ignoreTime,
      enrolledProgramIds: enrolledIds,
    };

    saveStoredPreferences(updated);
    onSave(updated);
  };

  const discoveredMap = new Map<string, DiscoveredProgram>();
  discoveredPrograms.forEach(p => discoveredMap.set(p.id, p));

  const filteredPrograms = GAS_PROGRAMS.filter(p => {
    if (activeTab === 'all') return true;
    return p.type === activeTab;
  });

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* ── Top Navigation Bar ── */}
      <View style={styles.navBar}>
        <View style={styles.navBarInner}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.text1} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <Text style={styles.backBtnText}>Map</Text>
          </TouchableOpacity>

          <Text style={styles.navBarTitle}>Vehicle & Preferences</Text>

          <TouchableOpacity onPress={handleSaveAndExit} style={styles.doneBtn} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isDesktop && styles.scrollContentDesktop]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introHeader}>
          <Text style={styles.pageHeading}>Personalized Settings</Text>
          <Text style={styles.pageSubheading}>
            Configure your vehicle and pricing programs once. We’ll apply these automatically so your navigation screen stays clean.
          </Text>
        </View>

        {/* ── Section 1: Vehicle Garage ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2 10.9 2 11.2 2 11.5V16c0 .6.4 1 1 1h2" />
                <circle cx="7" cy="17" r="2" />
                <path d="M9 17h6" />
                <circle cx="17" cy="17" r="2" />
              </svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>VEHICLE GARAGE</Text>
              <Text style={styles.cardSubtitle}>
                Choose which vehicle you are driving today or add more cars
              </Text>
            </View>
          </View>

          {/* Garage list */}
          <View style={styles.garageList}>
            {vehicles.map(v => {
              const isActive = v.id === activeVehicleId;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleCard, isActive && styles.vehicleCardActive]}
                  onPress={() => setActiveVehicleId(v.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.vehicleRadio}>
                    <View style={[styles.radioCircle, isActive && styles.radioCircleActive]}>
                      {isActive && <View style={styles.radioDot} />}
                    </View>
                  </View>

                  <View style={styles.vehicleInfo}>
                    <View style={styles.vehicleNameRow}>
                      <Text style={[styles.vehicleName, isActive && styles.vehicleNameActive]}>
                        {v.name}
                      </Text>
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <Text style={styles.activeBadgeText}>ACTIVE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.vehicleSpecs}>
                      {v.mpg} MPG · {v.gallons} gal tank fill
                    </Text>
                  </View>

                  <View style={styles.vehicleActions}>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleStartEdit(v);
                      }}
                      style={styles.vehicleActionBtn}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Edit vehicle"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </TouchableOpacity>

                    {vehicles.length > 1 && (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleDeleteVehicle(v.id);
                        }}
                        style={[styles.vehicleActionBtn, styles.vehicleDeleteBtn]}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Delete vehicle"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Add Car Toggle Button */}
          {!showCarForm && (
            <TouchableOpacity
              style={styles.addVehicleBtn}
              onPress={handleStartAdd}
              activeOpacity={0.7}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <Text style={styles.addVehicleBtnText}>Add Another Vehicle</Text>
            </TouchableOpacity>
          )}

          {/* Add / Edit Form Drawer */}
          {showCarForm && (
            <View style={styles.carFormBox}>
              <View style={styles.carFormHeader}>
                <Text style={styles.carFormTitle}>
                  {editingVehicleId ? 'Edit Vehicle' : 'Add New Vehicle'}
                </Text>
                <TouchableOpacity
                  onPress={handleCancelForm}
                  style={styles.carFormCloseBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.carFormCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              {/* Name input */}
              <View style={styles.formGroup}>
                <Text style={styles.formGroupLabel}>Vehicle Nickname</Text>
                <TextInput
                  style={styles.formTextInput}
                  value={carName}
                  onChangeText={setCarName}
                  placeholder="e.g. Honda Civic, Family SUV"
                  placeholderTextColor={C.text3}
                />
              </View>

              {/* Quick Presets */}
              <View style={styles.formGroup}>
                <Text style={styles.formGroupLabel}>Quick Presets</Text>
                <View style={styles.presetsRow}>
                  {VEHICLE_PRESETS.map(preset => {
                    const active = carMpg === String(preset.mpg) && carGallons === String(preset.gallons);
                    return (
                      <TouchableOpacity
                        key={preset.label}
                        onPress={() => handleApplyPreset(preset)}
                        style={[styles.presetChip, active && styles.presetChipActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                          {preset.label} ({preset.mpg} MPG)
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* MPG and Gallons steppers */}
              <View style={styles.inputsGrid}>
                <View style={styles.inputBox}>
                  <Text style={styles.inputBoxLabel}>Fuel Efficiency (MPG)</Text>
                  <View style={styles.inputControlRow}>
                    <TouchableOpacity
                      onPress={() => setCarMpg(String(Math.max(1, (parseFloat(carMpg) || 25) - 1)))}
                      style={styles.stepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.textInput}
                      value={carMpg}
                      onChangeText={setCarMpg}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      onPress={() => setCarMpg(String((parseFloat(carMpg) || 25) + 1))}
                      style={styles.stepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputBox}>
                  <Text style={styles.inputBoxLabel}>Tank Size (Gallons)</Text>
                  <View style={styles.inputControlRow}>
                    <TouchableOpacity
                      onPress={() => setCarGallons(String(Math.max(1, (parseFloat(carGallons) || 12) - 1)))}
                      style={styles.stepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.textInput}
                      value={carGallons}
                      onChangeText={setCarGallons}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      onPress={() => setCarGallons(String((parseFloat(carGallons) || 12) + 1))}
                      style={styles.stepBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Form Action Buttons */}
              <View style={styles.carFormActions}>
                <TouchableOpacity
                  onPress={handleCancelForm}
                  style={styles.carFormCancelBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.carFormCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveVehicle}
                  style={styles.carFormSubmitBtn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.carFormSubmitText}>
                    {editingVehicleId ? 'Update Vehicle' : 'Save to Garage'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Section 2: Value of Time ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardHeaderIcon, { backgroundColor: C.amberBg }]}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>TIME VALUATION</Text>
              <Text style={styles.cardSubtitle}>Determines if an extra 10–15 min detour is worth the savings</Text>
            </View>
          </View>

          <View style={styles.timeToggleRow}>
            <TouchableOpacity
              onPress={handleToggleIgnoreTime}
              style={[styles.timeTogglePill, ignoreTime && styles.timeTogglePillActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.timeTogglePillText, ignoreTime && styles.timeTogglePillTextActive]}>
                {ignoreTime ? '✓ My time is free ($0/hr detour penalty)' : 'Count detour time penalty'}
              </Text>
            </TouchableOpacity>
          </View>

          {!ignoreTime && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.fieldLabel}>Hourly Time Value ($/hr)</Text>
              <View style={styles.singleControlRow}>
                <TouchableOpacity
                  onPress={() => setHourlyValue(String(Math.max(0, (parseFloat(hourlyValue) || 25) - 5)))}
                  style={styles.stepBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.stepBtnText}>−$5</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.textInput, { flex: 1 }]}
                  value={hourlyValue}
                  onChangeText={setHourlyValue}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                <TouchableOpacity
                  onPress={() => setHourlyValue(String((parseFloat(hourlyValue) || 25) + 5))}
                  style={styles.stepBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.stepBtnText}>+$5</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldHint}>
                At $25/hr, a 12-minute detour penalizes net savings by $5.00.
              </Text>
            </View>
          )}
        </View>

        {/* ── Section 3: Memberships & Loyalty Programs ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardHeaderIcon, { backgroundColor: C.greenBg }]}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>DISCOUNTS & MEMBERSHIP PROGRAMS</Text>
              <Text style={styles.cardSubtitle}>
                Select the wholesale clubs and loyalty cards you belong to
              </Text>
            </View>
          </View>

          {/* Area Scanner Status */}
          <View style={styles.scanBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanTitle}>
                {isScanning
                  ? 'Scanning 20 miles for local stations…'
                  : discoveredPrograms.length > 0
                  ? `Found ${discoveredPrograms.length} programs with stations near you`
                  : userLat !== null
                  ? 'Area scanned: all major programs listed below'
                  : 'Enable location on map to see station distances'}
              </Text>
              <Text style={styles.scanSubtitle}>
                Programs with stations in your area display their nearest distance.
              </Text>
            </View>
            {isScanning && <ActivityIndicator size="small" color={C.blue} />}
          </View>

          {/* Category tabs */}
          <View style={styles.tabsRow}>
            {(
              [
                { id: 'all', label: `All (${enrolledIds.length})` },
                { id: 'wholesale', label: 'Wholesale Clubs' },
                { id: 'grocery', label: 'Grocery Points' },
                { id: 'loyalty', label: 'Station Apps' },
              ] as const
            ).map(tab => (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[styles.tabChip, activeTab === tab.id && styles.tabChipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabChipText, activeTab === tab.id && styles.tabChipTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Program list */}
          <View style={styles.programList}>
            {filteredPrograms.map((prog: GasProgram) => {
              const isEnrolled = enrolledIds.includes(prog.id);
              const discovered = discoveredMap.get(prog.id);

              return (
                <TouchableOpacity
                  key={prog.id}
                  style={[styles.programRow, isEnrolled && styles.programRowActive]}
                  onPress={() => toggleProgram(prog.id)}
                  activeOpacity={0.75}
                >
                  {/* Checkbox circle */}
                  <View style={[styles.checkbox, isEnrolled && styles.checkboxActive]}>
                    {isEnrolled && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </View>

                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.programName}>{prog.name}</Text>
                      {prog.isMandatory ? (
                        <View style={styles.badgeMandatory}>
                          <Text style={styles.badgeMandatoryText}>MEMBER ONLY</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeRewards}>
                          <Text style={styles.badgeRewardsText}>APP REWARDS</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.programDetails}>
                      Save ~${prog.typicalDiscount.toFixed(2)}/gal
                      {prog.queueWaitMinutes > 0 ? ` · ~${prog.queueWaitMinutes} min queue` : ' · No wait line'}
                      {discovered ? ` · ${discovered.distanceMiles} mi away (${discovered.closestStationName})` : ''}
                    </Text>
                  </View>

                  <View style={[styles.togglePill, isEnrolled ? styles.togglePillActive : styles.togglePillInactive]}>
                    <Text style={[styles.togglePillText, isEnrolled ? styles.togglePillTextActive : styles.togglePillTextInactive]}>
                      {isEnrolled ? 'Enrolled' : 'Add'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Footer Actions ── */}
        <View style={styles.footerRow}>
          <TouchableOpacity onPress={handleResetDefaults} style={styles.resetBtn} activeOpacity={0.7}>
            <Text style={styles.resetBtnText}>Reset to defaults</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSaveAndExit} style={styles.saveMainBtn} activeOpacity={0.85}>
            <Text style={styles.saveMainBtnText}>Save & Return to Map</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Navbar
  navBar: {
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingTop: Platform.OS === 'web' ? 14 : 44,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  navBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text1,
  },
  navBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text1,
    letterSpacing: -0.2,
  },
  doneBtn: {
    backgroundColor: C.blue,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  scrollContentDesktop: {
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },

  introHeader: {
    marginBottom: 20,
  },
  pageHeading: {
    fontSize: 26,
    fontWeight: '800',
    color: C.text1,
    letterSpacing: -0.5,
  },
  pageSubheading: {
    fontSize: 14,
    color: C.text2,
    lineHeight: 20,
    marginTop: 6,
  },

  // Card
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? ({ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as object) : {}),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  cardHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.blueBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.text2,
    letterSpacing: 0.6,
  },
  cardSubtitle: {
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text1,
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 11,
    color: C.text3,
    marginTop: 6,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 16,
  },

  // Garage
  garageList: {
    flexDirection: 'column',
    gap: 8,
    marginBottom: 12,
  },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  vehicleCardActive: {
    backgroundColor: '#F4F9FF',
    borderColor: C.blue,
  },
  vehicleRadio: {
    marginRight: 12,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.borderDark,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: C.blue,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.blue,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text1,
  },
  vehicleNameActive: {
    color: C.blue,
  },
  activeBadge: {
    backgroundColor: C.blueBg,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  activeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: C.blue,
    letterSpacing: 0.5,
  },
  vehicleSpecs: {
    fontSize: 12,
    color: C.text2,
    marginTop: 2,
  },
  vehicleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vehicleActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleDeleteBtn: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  addVehicleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.blueBorder,
    marginTop: 4,
  },
  addVehicleBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.blue,
  },

  // Car Form Box
  carFormBox: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.blueBorder,
    padding: 14,
    marginTop: 8,
  },
  carFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  carFormTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text1,
  },
  carFormCloseBtn: {
    padding: 4,
  },
  carFormCloseText: {
    fontSize: 18,
    color: C.text3,
    fontWeight: '600',
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 12,
  },
  formGroupLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text2,
    marginBottom: 6,
  },
  formTextInput: {
    height: 40,
    backgroundColor: C.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: C.text1,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  carFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  carFormCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  carFormCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text2,
  },
  carFormSubmitBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: C.blue,
  },
  carFormSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Presets
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  presetChipActive: {
    backgroundColor: C.blueBg,
    borderColor: C.blue,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: C.text2,
  },
  presetChipTextActive: {
    color: C.blue,
    fontWeight: '700',
  },

  // Stepper inputs
  inputsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  inputBox: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputBoxLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text2,
    marginBottom: 8,
  },
  inputControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  singleControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text1,
  },
  textInput: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text1,
    textAlign: 'center',
    paddingHorizontal: 8,
    height: 40,
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },

  // Time toggle
  timeToggleRow: {
    flexDirection: 'row',
  },
  timeTogglePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  timeTogglePillActive: {
    backgroundColor: C.amberBg,
    borderColor: C.amberBorder,
  },
  timeTogglePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text2,
  },
  timeTogglePillTextActive: {
    color: C.amber,
    fontWeight: '700',
  },

  // Area scan banner
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  scanTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text1,
  },
  scanSubtitle: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },

  // Tabs
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  tabChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabChipActive: {
    backgroundColor: C.blueBg,
    borderColor: C.blue,
  },
  tabChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text2,
  },
  tabChipTextActive: {
    color: C.blue,
    fontWeight: '700',
  },

  // Programs list
  programList: {
    flexDirection: 'column',
    gap: 8,
  },
  programRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  programRowActive: {
    backgroundColor: '#F4F9FF',
    borderColor: '#BFDBFE',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.borderDark,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxActive: {
    backgroundColor: C.blue,
    borderColor: C.blue,
  },
  programName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text1,
  },
  programDetails: {
    fontSize: 11,
    color: C.text2,
    marginTop: 3,
    lineHeight: 15,
  },
  badgeMandatory: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeMandatoryText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 0.3,
  },
  badgeRewards: {
    backgroundColor: '#EFF6FF',
    borderColor: '#DBEAFE',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeRewardsText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#2563EB',
    letterSpacing: 0.3,
  },

  togglePill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  togglePillActive: {
    backgroundColor: C.blueBg,
    borderColor: C.blueBorder,
  },
  togglePillInactive: {
    backgroundColor: C.card,
    borderColor: C.border,
  },
  togglePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  togglePillTextActive: {
    color: C.blue,
    fontWeight: '700',
  },
  togglePillTextInactive: {
    color: C.text3,
  },

  // Footer
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  resetBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  resetBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text2,
  },
  saveMainBtn: {
    flex: 1,
    backgroundColor: C.blue,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveMainBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
});

