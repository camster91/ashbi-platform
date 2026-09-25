import { describe, expect, it } from 'vitest';
import {
  POOR_PACKET_LOSS_RATIO,
  POOR_RTT_MS,
  classifyQuality,
  formatDuration,
  pickFallbackDevice,
  summarizeStats,
} from '../lib/call-resilience';

const report = (stats) => ({ forEach: (fn) => stats.forEach(fn) });

describe('call quality from getStats()', () => {
  it('sums inbound packets and reads RTT from the selected candidate pair', () => {
    const summary = summarizeStats(report([
      { type: 'inbound-rtp', kind: 'audio', packetsLost: 2, packetsReceived: 98 },
      { type: 'inbound-rtp', kind: 'video', packetsLost: 3, packetsReceived: 197 },
      { type: 'transport', selectedCandidatePairId: 'cp2' },
      { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.9 },
      { type: 'candidate-pair', id: 'cp2', state: 'succeeded', nominated: true, currentRoundTripTime: 0.12 },
    ]));
    expect(summary).toEqual({ packetsLost: 5, packetsReceived: 295, rttMs: 120 });
  });

  it('falls back to a nominated succeeded pair when no transport stat names one', () => {
    const summary = summarizeStats(report([
      { type: 'candidate-pair', id: 'cp1', state: 'in-progress', currentRoundTripTime: 2 },
      { type: 'candidate-pair', id: 'cp2', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
    ]));
    expect(summary.rttMs).toBe(50);
  });

  it('is unknown without data', () => {
    expect(classifyQuality(summarizeStats(null), null)).toBe('unknown');
    expect(classifyQuality(null, null)).toBe('unknown');
  });

  it('classifies packet loss over the sample interval against the threshold', () => {
    const previous = { packetsLost: 100, packetsReceived: 1000, rttMs: null };
    const justBelow = Math.floor(POOR_PACKET_LOSS_RATIO * 1000) - 1;
    expect(classifyQuality({ packetsLost: 100 + justBelow, packetsReceived: 1000 + (1000 - justBelow), rttMs: null }, previous)).toBe('good');
    const atThreshold = POOR_PACKET_LOSS_RATIO * 1000;
    expect(classifyQuality({ packetsLost: 100 + atThreshold, packetsReceived: 1000 + (1000 - atThreshold), rttMs: null }, previous)).toBe('poor');
    // Loss earlier in the call does not keep a recovered call marked poor.
    expect(classifyQuality({ packetsLost: 100, packetsReceived: 2000, rttMs: null }, previous)).toBe('good');
  });

  it('classifies round-trip time against the threshold', () => {
    expect(classifyQuality({ packetsLost: 0, packetsReceived: 0, rttMs: POOR_RTT_MS - 1 }, null)).toBe('good');
    expect(classifyQuality({ packetsLost: 0, packetsReceived: 0, rttMs: POOR_RTT_MS }, null)).toBe('poor');
  });
});

describe('device fallback and durations', () => {
  it('prefers the browser default device, then the first of that kind', () => {
    const devices = [
      { kind: 'videoinput', deviceId: 'cam1' },
      { kind: 'audioinput', deviceId: 'usb' },
      { kind: 'audioinput', deviceId: 'default' },
    ];
    expect(pickFallbackDevice(devices, 'audioinput').deviceId).toBe('default');
    expect(pickFallbackDevice(devices, 'videoinput').deviceId).toBe('cam1');
    expect(pickFallbackDevice([], 'audioinput')).toBeNull();
  });

  it('formats a countdown as m:ss', () => {
    expect(formatDuration(15 * 60 * 1000)).toBe('15:00');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
