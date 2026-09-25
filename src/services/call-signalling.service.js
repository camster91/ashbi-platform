// WebRTC call signalling over Socket.IO.
//
// Media never traverses this server; Socket.IO only relays bounded
// offer/answer/ICE messages. Calls are 1:1: presence is announced to the
// authorized project room so members know someone is waiting, but every
// negotiation message is addressed to one participant and delivered only to
// that user's sockets that are themselves in the same project room. Other
// project members never receive another pair's SDP or ICE candidates.

const MAX_SIGNAL_BYTES = 16_000;
const SIGNAL_TYPES = new Set(['offer', 'answer', 'ice', 'hangup']);
const PRESENCE_STATES = new Set(['joined', 'left']);

function projectRoom(projectId) {
  return `project:${projectId}`;
}

function boundedCallId(callId) {
  return callId.slice(0, 128);
}

/**
 * Register call signalling handlers for one authenticated socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket & { userId?: string }} socket
 */
export function registerCallSignalling(io, socket) {
  socket.on('call:signal', async ({ projectId, callId, to, signal } = {}) => {
    if (
      typeof projectId !== 'string' || typeof callId !== 'string' ||
      typeof to !== 'string' || !to || to === socket.userId ||
      !signal || typeof signal !== 'object' || !SIGNAL_TYPES.has(signal.type) ||
      !socket.rooms.has(projectRoom(projectId))
    ) return;
    if (JSON.stringify(signal).length > MAX_SIGNAL_BYTES) return;

    // Deliver only to the addressed participant, and only to their sockets
    // that are authorized for this project (joined via join-project). With the
    // in-memory adapter this resolves in order, so an offer still reaches the
    // callee before its ICE candidates.
    let recipients;
    try {
      recipients = await io.in(`user:${to}`).fetchSockets();
    } catch {
      return; // A dropped signal fails the call visibly; never crash the server.
    }
    const message = { projectId, callId: boundedCallId(callId), from: socket.userId, signal };
    for (const recipient of recipients) {
      if (recipient.rooms.has(projectRoom(projectId))) recipient.emit('call:signal', message);
    }
  });

  socket.on('call:presence', ({ projectId, callId, state } = {}) => {
    if (
      typeof projectId !== 'string' || typeof callId !== 'string' ||
      !PRESENCE_STATES.has(state) || !socket.rooms.has(projectRoom(projectId))
    ) return;
    socket.to(projectRoom(projectId)).emit('call:presence', {
      projectId,
      callId: boundedCallId(callId),
      userId: socket.userId,
      state,
    });
  });
}

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function isIceServer(value) {
  if (!value || typeof value !== 'object') return false;
  const urls = Array.isArray(value.urls) ? value.urls : [value.urls];
  if (!urls.length || !urls.every((url) => typeof url === 'string' && /^(stun|stuns|turn|turns):/.test(url))) return false;
  if (value.username !== undefined && typeof value.username !== 'string') return false;
  if (value.credential !== undefined && typeof value.credential !== 'string') return false;
  return true;
}

/**
 * ICE servers for browser peers. WEBRTC_ICE_SERVERS is a JSON array of
 * RTCIceServer objects, which lets a deployment add a TURN relay so calls
 * connect across restrictive NATs. Invalid configuration falls back to the
 * public STUN server rather than breaking calls.
 * @param {string | undefined} raw
 */
export function resolveIceServers(raw) {
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length && parsed.every(isIceServer)) {
      return parsed.map(({ urls, username, credential }) => ({
        urls,
        ...(username !== undefined && { username }),
        ...(credential !== undefined && { credential }),
      }));
    }
  } catch {
    // Fall through to the default below.
  }
  return DEFAULT_ICE_SERVERS;
}
