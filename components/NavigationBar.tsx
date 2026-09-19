/**
 * NavigationBar.tsx — Overlay navigation banner, Google Maps-style.
 *
 * Shows the upcoming maneuver arrow, instruction, and distance.
 * Floats at the top of the screen (desktop) or top of the map (mobile).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import type { RouteStep }   from '../lib/navigation';
import { formatDistance }   from '../lib/navigation';

interface NavigationBarProps {
  step:         RouteStep | null;
  distanceM:    number;           // meters to the next maneuver
  speedMs:      number | null;    // current speed in m/s (null if unknown)
  totalRemainM: number;           // total meters left on route
  voiceMuted:   boolean;
  onToggleMute: () => void;
  onStop:       () => void;
}

function mphStr(ms: number | null): string | null {
  if (ms === null || ms < 0.5) return null;
  return `${Math.round(ms * 2.237)} mph`;
}

export default function NavigationBar({
  step,
  distanceM,
  speedMs,
  totalRemainM,
  voiceMuted,
  onToggleMute,
  onStop,
}: NavigationBarProps) {
  if (!step) return null;

  const isArrive = step.maneuverType === 'arrive';
  const speed    = mphStr(speedMs);

  return (
    <View style={styles.bar}>
      {/* ── Next maneuver ── */}
      <View style={styles.maneuver}>
        <View style={styles.arrowBox}>
          <Text style={styles.arrow}>{step.arrowSymbol}</Text>
        </View>
        <View style={styles.instructionCol}>
          <Text style={styles.instruction} numberOfLines={2}>
            {step.instruction}
          </Text>
          {!isArrive && (
            <Text style={styles.distance}>
              {formatDistance(distanceM)}
            </Text>
          )}
        </View>
      </View>

      {/* ── Right controls ── */}
      <View style={styles.controls}>
        {/* Speed badge */}
        {speed && (
          <View style={styles.speedBadge}>
            <Text style={styles.speedNum}>{speed.split(' ')[0]}</Text>
            <Text style={styles.speedUnit}>mph</Text>
          </View>
        )}

        {/* Total remaining */}
        {!isArrive && (
          <Text style={styles.remaining}>
            {formatDistance(totalRemainM)} left
          </Text>
        )}

        {/* Mute toggle */}
        <TouchableOpacity
          onPress={onToggleMute}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          {voiceMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </TouchableOpacity>

        {/* Stop navigation */}
        <TouchableOpacity
          onPress={onStop}
          style={styles.stopBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.stopBtnText}>End Route</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const barShadow: object = Platform.OS === 'web'
  ? { boxShadow: '0 4px 16px rgba(0,0,0,0.22)' }
  : { shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10 };

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1F36',   // deep navy — readable over any map
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 12,
    ...(barShadow as object),
  },

  // Left: arrow + instruction
  maneuver: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrowBox: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#2D3450',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  arrow: {
    fontSize: 28,
    color: '#FFFFFF',
    lineHeight: 34,
  },
  instructionCol: {
    flex: 1,
  },
  instruction: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 22,
  },
  distance: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4ADE80',   // bright green — distance is positive context
    marginTop: 2,
  },

  // Right: controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  speedBadge: {
    backgroundColor: '#2D3450',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  speedNum: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 22,
  },
  speedUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  remaining: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2D3450',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    fontSize: 16,
  },
  stopBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stopBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

