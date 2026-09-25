// Pure helpers for resilient 1:1 project calls and bounded screen recordings.
// Kept free of React and browser globals so the thresholds can be unit tested.

// ICE restart: a 'disconnected' peer often recovers by itself within a few
// seconds, so only restart after this grace period. 'failed' restarts at once.
export const DISCONNECT_GRACE_MS = 5_000;
// How long one ICE restart attempt may take before the next one starts.
export const ICE_RESTART_TIMEOUT_MS = 10_000;
export const MAX_ICE_RESTART_ATTEMPTS = 3;
// The answerer cannot restart ICE itself; it waits for the offerer's restarts
// and releases the peer if none of them succeed in this window.
export const ANSWERER_RECOVERY_WINDOW_MS = DISCONNECT_GRACE_MS + (MAX_ICE_RESTART_ATTEMPTS + 1) * ICE_RESTART_TIMEOUT_MS;
// A reconnecting socket re-joins its project room before re-signalling; fall
// back after this long if the server never acknowledges the join.
export const JOIN_ACK_TIMEOUT_MS = 3_000;

// Call quality is read locally from getStats() and never sent to the server.
export const STATS_INTERVAL_MS = 5_000;
export const POOR_PACKET_LOSS_RATIO = 0.05;
export const POOR_RTT_MS = 400;

// Screen recordings stop and upload automatically at this length.
export const MAX_RECORDING_DURATION_MS = 15 * 60 * 1000;

/**
 * Reduce an RTCStatsReport to cumulative inbound packet counts and the
 * current round-trip time of the active candidate pair.
 * @param {{ forEach: (fn: (stat: any) => void) => void } | null | undefined} report
 */
export function summarizeStats(report) {
  const summary = { packetsLost: 0, packetsReceived: 0, rttMs: null };
  if (!report?.forEach) return summary;
  let selectedPairId = null;
  const pairs = [];
  report.forEach((stat) => {
    if (stat.type === 'inbound-rtp') {
      summary.packetsLost += Math.max(0, Number(stat.packetsLost) || 0);
      summary.packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0);
    } else if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      selectedPairId = stat.selectedCandidatePairId;
    } else if (stat.type === 'candidate-pair') {
      pairs.push(stat);
    }
  });
  const active = pairs.find((pair) => pair.id === selectedPairId)
    || pairs.find((pair) => pair.state === 'succeeded' && (pair.nominated || pair.selected));
  if (active && Number.isFinite(active.currentRoundTripTime)) summary.rttMs = active.currentRoundTripTime * 1000;
  return summary;
}

/**
 * Classify call quality from two consecutive stats summaries. Packet loss is
 * measured over the interval between samples, not since the call started.
 * @returns {'good' | 'poor' | 'unknown'}
 */
export function classifyQuality(current, previous) {
  if (!current) return 'unknown';
  const lost = current.packetsLost - (previous?.packetsLost ?? 0);
  const received = current.packetsReceived - (previous?.packetsReceived ?? 0);
  const total = lost + received;
  const lossRatio = total > 0 && lost >= 0 ? lost / total : null;
  const rttMs = current.rttMs;
  if (lossRatio === null && rttMs === null) return 'unknown';
  if ((lossRatio !== null && lossRatio >= POOR_PACKET_LOSS_RATIO) || (rttMs !== null && rttMs >= POOR_RTT_MS)) return 'poor';
  return 'good';
}

/**
 * Choose the device to fall back to when the active one disappears: the
 * browser's "default" entry if present, otherwise the first device of that kind.
 * @param {Array<{ kind: string, deviceId: string }>} devices
 * @param {'audioinput' | 'videoinput'} kind
 */
export function pickFallbackDevice(devices, kind) {
  const candidates = (devices || []).filter((device) => device.kind === kind && device.deviceId);
  return candidates.find((device) => device.deviceId === 'default') || candidates[0] || null;
}

/** Format milliseconds as m:ss for recording countdowns. */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
