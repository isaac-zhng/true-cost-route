import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapScreen from './screens/MapScreen';

// ─── Color Tokens (Clean, utilitarian Google/Linear-inspired light palette) ───
const C = {
  bg: '#F8F9FA',
  card: '#FFFFFF',
  border: '#E8EAED',
  borderHover: '#DADCE0',
  text: '#202124',
  textMuted: '#5F6368',
  textDim: '#80868B',
  emerald: '#137333',
  emeraldDim: '#E6F4EA',
  rose: '#C5221F',
  roseDim: '#FCE8E6',
  amber: '#B45309',
  accent: '#1A73E8',
  accentDim: '#E8F0FE',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen = 'home' | 'calculator' | 'map';

interface InputField {
  key: keyof Inputs;
  label: string;
  unit: string;
  step: number;
  min: number;
  decimals: number;
}

interface Inputs {
  mpg: number;
  gallons: number;
  localPrice: number;
  detourPrice: number;
  detourDistance: number;
  detourTime: number;
  hourlyValue: number;
}

// ─── Field Definitions ───────────────────────────────────────────────────────
const FIELDS: InputField[] = [
  { key: 'mpg',           label: 'Vehicle Efficiency',    unit: 'MPG',   step: 1,    min: 1,    decimals: 0 },
  { key: 'gallons',       label: 'Gallons Needed',        unit: 'gal',   step: 1,    min: 0.1,  decimals: 1 },
  { key: 'localPrice',    label: 'Local Gas Price',       unit: '$/gal', step: 0.05, min: 0.01, decimals: 2 },
  { key: 'detourPrice',   label: 'Detour Gas Price',      unit: '$/gal', step: 0.05, min: 0.01, decimals: 2 },
  { key: 'detourDistance',label: 'Detour Extra Distance', unit: 'mi',    step: 0.5,  min: 0,    decimals: 1 },
  { key: 'detourTime',    label: 'Detour Extra Time',     unit: 'min',   step: 1,    min: 0,    decimals: 0 },
  { key: 'hourlyValue',   label: 'Your Time Value',       unit: '$/hr',  step: 1,    min: 0,    decimals: 0 },
];

const DEFAULTS: Inputs = {
  mpg: 25, gallons: 12, localPrice: 3.80,
  detourPrice: 3.35, detourDistance: 8, detourTime: 15, hourlyValue: 25,
};

const CAR_PRESETS = [
  { label: 'Sedan (32 MPG)', mpg: 32 },
  { label: 'SUV (22 MPG)', mpg: 22 },
  { label: 'Hybrid (48 MPG)', mpg: 48 },
  { label: 'Truck (17 MPG)', mpg: 17 },
] as const;

// ─── Math ────────────────────────────────────────────────────────────────────
function calculate(i: Inputs) {
  const grossSavings   = i.gallons * (i.localPrice - i.detourPrice);
  const fuelWastedCost = (i.detourDistance / i.mpg) * i.detourPrice;
  const timeCost       = (i.detourTime / 60) * i.hourlyValue;
  const netSavings     = grossSavings - (fuelWastedCost + timeCost);
  const detourHrs      = i.detourTime / 60;
  const effectiveRate  = detourHrs > 0 ? (grossSavings - fuelWastedCost) / detourHrs : 0;
  const breakevenPrice = i.localPrice - ((fuelWastedCost + timeCost) / i.gallons);
  return { grossSavings, fuelWastedCost, timeCost, netSavings, effectiveRate, breakevenPrice };
}

function fmt(n: number, decimals = 2, prefix = '$') {
  const abs  = Math.abs(n).toFixed(decimals);
  const sign = n < 0 ? '−' : '';
  return `${sign}${prefix}${abs}`;
}

// ─── Step Input ───────────────────────────────────────────────────────────────
function StepInput({ field, value, onChange }: {
  field: InputField; value: number; onChange: (key: keyof Inputs, val: number) => void;
}) {
  const [text,    setText]    = useState(value.toFixed(field.decimals));
  const [focused, setFocused] = useState(false);

  const commit = useCallback((raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= field.min) { onChange(field.key, n); setText(n.toFixed(field.decimals)); }
    else setText(value.toFixed(field.decimals));
  }, [field, value, onChange]);

  const adjust = useCallback((dir: 1 | -1) => {
    const next = Math.max(field.min, parseFloat((value + dir * field.step).toFixed(field.decimals + 2)));
    onChange(field.key, next);
    setText(next.toFixed(field.decimals));
  }, [field, value, onChange]);

  React.useEffect(() => { if (!focused) setText(value.toFixed(field.decimals)); }, [value, focused, field.decimals]);

  return (
    <View style={styles.inputRow}>
      <View style={styles.inputLabelCol}>
        <Text style={styles.inputLabel}>{field.label}</Text>
        <Text style={styles.inputUnit}>{field.unit}</Text>
      </View>
      <View style={styles.stepper}>
        <TouchableOpacity onPress={() => adjust(-1)} style={styles.stepBtn} activeOpacity={0.7}>
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.numInput}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(text); }}
          onSubmitEditing={() => { setFocused(false); commit(text); }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          returnKeyType="done"
        />
        <TouchableOpacity onPress={() => adjust(1)} style={styles.stepBtn} activeOpacity={0.7}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Verdict Card ─────────────────────────────────────────────────────────────
function VerdictCard({ netSavings }: { netSavings: number }) {
  const isWorth = netSavings > 0;
  const color   = isWorth ? C.emerald : C.rose;
  const dimBg   = isWorth ? C.emeraldDim : C.roseDim;
  return (
    <View style={[styles.verdictCard, { borderColor: color, backgroundColor: dimBg }]}>
      <Text style={[styles.verdictTitle, { color }]}>{isWorth ? 'WORTH THE DETOUR' : 'SKIP THE DETOUR'}</Text>
      <Text style={[styles.verdictAmount, { color: isWorth ? C.emerald : C.rose }]}>
        {netSavings >= 0 ? '+' : ''}{fmt(netSavings, 2)}
        <Text style={styles.verdictAmountSub}> net</Text>
      </Text>
    </View>
  );
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent ? { color: accent } : {}]}>{value}</Text>
    </View>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.insightRow}>
      <Text style={styles.insightLabel}>{label}</Text>
      <Text style={styles.insightValue}>{value}</Text>
    </View>
  );
}

// ─── Home / Landing ───────────────────────────────────────────────────────────
function HomeScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  return (
    <View style={styles.homeRoot}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.homeContent}>
        <Text style={styles.homeTitle}>True Cost Route</Text>
        <Text style={styles.homeSub}>
          Detouring 10 minutes for 8¢ cheaper gas usually loses you money. Calculate the true cost of price, extra distance, and your time.
        </Text>

        <TouchableOpacity
          style={[styles.homeBtn, { backgroundColor: C.accent }]}
          onPress={() => onNavigate('map')}
          activeOpacity={0.85}
        >
          <Text style={styles.homeBtnTitle}>Route Optimizer</Text>
          <Text style={styles.homeBtnSub}>
            Enter origin → destination to find the cheapest gas stop along your route
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.homeBtn, { backgroundColor: C.card, borderColor: C.border, borderWidth: 1 }]}
          onPress={() => onNavigate('calculator')}
          activeOpacity={0.85}
        >
          <Text style={[styles.homeBtnTitle, { color: C.text }]}>Quick Calculator</Text>
          <Text style={[styles.homeBtnSub, { color: C.textMuted }]}>
            Compare two gas prices manually and see the full cost breakdown
          </Text>
        </TouchableOpacity>

        <Text style={styles.homeFooter}>
          Built by Isaac · 100% free · OpenStreetMap & EIA gas data
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Calculator Screen ────────────────────────────────────────────────────────
function CalculatorScreen({ onBack }: { onBack: () => void }) {
  const { width } = useWindowDimensions();
  const isDesktop  = width >= 800;
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);
  const [ignoreTime, setIgnoreTime] = useState(false);

  const handleChange = useCallback((key: keyof Inputs, val: number) => {
    setInputs(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleSelectCarPreset = (mpgVal: number) => {
    setInputs(prev => ({ ...prev, mpg: mpgVal }));
  };

  const handleToggleIgnoreTime = () => {
    const next = !ignoreTime;
    setIgnoreTime(next);
    setInputs(prev => ({ ...prev, hourlyValue: next ? 0 : 25 }));
  };

  const r = calculate(inputs);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isDesktop && styles.scrollContentDesktop]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back to map</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>Quick Detour Calculator</Text>
          <Text style={styles.headerSub}>
            Detouring 10 minutes for 8¢ cheaper gas usually loses you money. Check the real math below.
          </Text>
        </View>

        <View style={isDesktop ? styles.dualCol : styles.singleCol}>
          <View style={[styles.panel, isDesktop && styles.panelLeft]}>
            <Text style={styles.sectionTitle}>Trip Parameters</Text>

            {/* Car Presets */}
            <View style={styles.presetsSection}>
              <Text style={styles.presetHeading}>Quick Car Presets</Text>
              <View style={styles.presetsRow}>
                {CAR_PRESETS.map(car => {
                  const isActive = inputs.mpg === car.mpg;
                  return (
                    <TouchableOpacity
                      key={car.label}
                      onPress={() => handleSelectCarPreset(car.mpg)}
                      style={[styles.presetPill, isActive && styles.presetPillActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.presetPillText, isActive && styles.presetPillTextActive]}>
                        {car.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Time value toggle */}
            <View style={styles.presetsSection}>
              <TouchableOpacity
                onPress={handleToggleIgnoreTime}
                style={[styles.timeTogglePill, ignoreTime && styles.timeTogglePillActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.timeTogglePillText, ignoreTime && styles.timeTogglePillTextActive]}>
                  {ignoreTime ? '✓ Ignoring time value ($0/hr)' : 'Include time value ($25/hr)'}
                </Text>
              </TouchableOpacity>
            </View>

            {FIELDS.map(field => (
              <StepInput key={field.key} field={field} value={inputs[field.key]} onChange={handleChange} />
            ))}
          </View>

          <View style={[styles.panel, isDesktop && styles.panelRight]}>
            <VerdictCard netSavings={r.netSavings} />

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Cost Breakdown</Text>
            <View style={styles.grid2x2}>
              <MetricTile label="Gross Savings"  value={fmt(r.grossSavings)}   accent={r.grossSavings >= 0 ? C.emerald : C.rose} />
              <MetricTile label="Fuel Wasted"    value={fmt(r.fuelWastedCost)} accent={C.amber} />
              <MetricTile label="Time Cost"      value={fmt(r.timeCost)}       accent={C.amber} />
              <MetricTile label="Net Bottom Line" value={fmt(r.netSavings)}    accent={r.netSavings >= 0 ? C.emerald : C.rose} />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Cost Insights</Text>
            <View style={styles.insightsBox}>
              <InsightRow label="Effective Detour Hourly Rate" value={`${fmt(r.effectiveRate, 2)}/hr`} />
              <View style={styles.insightDivider} />
              <InsightRow label="Breakeven Detour Price"       value={`${fmt(r.breakevenPrice, 3)}/gal`} />
              <View style={styles.insightNote}>
                <Text style={styles.insightNoteText}>
                  Detour only pays if pump price ≤{' '}
                  <Text style={{ color: C.accent, fontWeight: '700' }}>{fmt(r.breakevenPrice, 3)}/gal</Text>
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          Built by Isaac · All calculations run locally in your browser · 100% free
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [showCalculator, setShowCalculator] = useState(false);

  if (showCalculator) {
    return <CalculatorScreen onBack={() => setShowCalculator(false)} />;
  }
  return <MapScreen onOpenCalculator={() => setShowCalculator(true)} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Home
  homeRoot: { flex: 1, backgroundColor: C.bg },
  homeContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 60,
    maxWidth: 480,
    alignSelf: 'center' as const,
    width: '100%',
  },
  homeTitle: { fontSize: 32, fontWeight: '800', color: C.text, textAlign: 'center', letterSpacing: -0.5 },
  homeSub:   { fontSize: 15, color: C.textMuted, textAlign: 'center', lineHeight: 23, marginTop: 12, marginBottom: 36 },
  homeBtn: {
    width: '100%',
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
  },
  homeBtnTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  homeBtnSub:   { fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
  homeFooter:   { marginTop: 40, fontSize: 12, color: C.textDim, textAlign: 'center', letterSpacing: 0.2 },

  // Calculator / shared
  backBtn:     { marginBottom: 16 },
  backBtnText: { color: C.accent, fontSize: 14, fontWeight: '600' },
  scroll:      { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 32, paddingBottom: 48 },
  scrollContentDesktop: { paddingHorizontal: 40, maxWidth: 1200, alignSelf: 'center' as const, width: '100%' },
  header:      { marginBottom: 28, alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  headerSub:   { fontSize: 14, color: C.textMuted, marginTop: 6, textAlign: 'center', maxWidth: 500 },
  dualCol:     { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  singleCol:   { flexDirection: 'column', gap: 16 },
  panel:       { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 22, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' as any },
  panelLeft:   { flex: 1 },
  panelRight:  { flex: 1 },
  sectionTitle:{ fontSize: 12, fontWeight: '700', color: C.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 },

  // Presets
  presetsSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  presetHeading:  { fontSize: 11, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  presetsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetPill:     { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  presetPillActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  presetPillText: { fontSize: 12, fontWeight: '500', color: C.textMuted },
  presetPillTextActive: { color: C.accent, fontWeight: '700' },

  timeTogglePill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: 'flex-start',
  },
  timeTogglePillActive: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  timeTogglePillText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  timeTogglePillTextActive: { color: '#B45309', fontWeight: '700' },

  inputRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  inputLabelCol:{ flex: 1, marginRight: 12 },
  inputLabel:  { fontSize: 14, color: C.text, fontWeight: '500' },
  inputUnit:   { fontSize: 11, color: C.textDim, marginTop: 2 },
  stepper:     { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  stepBtn:     { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  stepBtnText: { fontSize: 17, color: C.text, lineHeight: 18, fontWeight: '400' },
  numInput: {
    width: 68, height: 34, textAlign: 'center', color: C.text, fontSize: 14, fontWeight: '600', backgroundColor: C.bg,
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  verdictCard:    { borderRadius: 12, borderWidth: 1.5, padding: 20, alignItems: 'center' },
  verdictTitle:   { fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  verdictAmount:  { fontSize: 38, fontWeight: '800', lineHeight: 42, fontVariant: ['tabular-nums'] },
  verdictAmountSub:{ fontSize: 15, fontWeight: '500', color: C.textMuted },
  grid2x2:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile:     { flex: 1, minWidth: 120, backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 14 },
  metricLabel:    { fontSize: 11, color: C.textMuted, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  metricValue:    { fontSize: 20, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  insightsBox:    { backgroundColor: C.accentDim, borderRadius: 10, borderWidth: 1, borderColor: '#D2E3FC', padding: 16 },
  insightRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  insightLabel:   { fontSize: 13, color: C.textMuted, flex: 1 },
  insightValue:   { fontSize: 15, fontWeight: '700', color: C.text, marginLeft: 12, fontVariant: ['tabular-nums'] },
  insightDivider: { height: 1, backgroundColor: '#D2E3FC', marginVertical: 8 },
  insightNote:    { marginTop: 10, backgroundColor: '#FFFFFF', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#D2E3FC' },
  insightNoteText:{ fontSize: 12, color: C.textMuted, lineHeight: 18 },
  footer:         { marginTop: 36, textAlign: 'center', fontSize: 12, color: C.textDim, letterSpacing: 0.2 },
});
