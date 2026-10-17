import { act, fireEvent, render as renderUI, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWERER_RECOVERY_WINDOW_MS,
  DISCONNECT_GRACE_MS,
  ICE_RESTART_TIMEOUT_MS,
  MAX_ICE_RESTART_ATTEMPTS,
  MAX_RECORDING_DURATION_MS,
  STATS_INTERVAL_MS,
} from '../lib/call-resilience';

const { socket, apiMock, auth } = vi.hoisted(() => {
  const handlers = new Map();
  const socket = {
    connected: true,
    emitted: [],
    on(event, handler) { handlers.set(event, [...(handlers.get(event) || []), handler]); },
    off(event, handler) { handlers.set(event, (handlers.get(event) || []).filter((item) => item !== handler)); },
    emit(event, ...args) {
      socket.emitted.push({ event, args });
      const ack = args[args.length - 1];
      if (typeof ack === 'function' && event === 'join-project') ack(socket.joinResult);
    },
    trigger(event, payload) { return Promise.all((handlers.get(event) || []).map((handler) => handler(payload))); },
    joinResult: { joined: true },
    reset() { handlers.clear(); socket.emitted = []; socket.connected = true; socket.joinResult = { joined: true }; },
  };
  const apiMock = {
    getAttachments: async () => [],
    getIceServers: async () => ({ iceServers: [{ urls: 'stun:example.test' }] }),
    uploadAttachment: async () => ({}),
  };
  return { socket, apiMock, auth: { user: { id: 'alice', organizationId: 'org-1' } } };
});

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket }) }));

const { default: ProjectMedia } = await import('../components/project/ProjectMedia');

const PROJECT = 'p1';

function render(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderUI(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...view, client };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const REMOTE = 'bob';

class FakeTrack {
  constructor(kind, deviceId) {
    this.kind = kind;
    this.deviceId = deviceId;
    this.enabled = true;
    this.readyState = 'live';
    this.stop = vi.fn(() => { this.readyState = 'ended'; });
  }
  getSettings() { return { deviceId: this.deviceId }; }
}

class FakeStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter((item) => item !== track); }
}

class FakePeer {
  static instances = [];
  static holdNext = {};
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this.currentRemoteDescription = null;
    this.senders = [];
    this.createOffer = vi.fn(async (options) => {
      const held = FakePeer.holdNext.createOffer;
      FakePeer.holdNext.createOffer = null;
      return held || { type: 'offer', sdp: options?.iceRestart ? 'restart-offer' : 'offer' };
    });
    this.createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer' }));
    this.setLocalDescription = vi.fn(async (description) => {
      this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    });
    this.setRemoteDescription = vi.fn(async (description) => {
      const held = FakePeer.holdNext.setRemoteDescription;
      FakePeer.holdNext.setRemoteDescription = null;
      if (held) await held;
      this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
      this.currentRemoteDescription = description;
    });
    this.addIceCandidate = vi.fn(async () => {});
    this.getStats = vi.fn(async () => ({ forEach: () => {} }));
    this.close = vi.fn(() => { this.connectionState = 'closed'; });
    FakePeer.instances.push(this);
  }
  addTrack(track) {
    const sender = { track, replaceTrack: vi.fn(async (next) => { sender.track = next; }) };
    this.senders.push(sender);
    return sender;
  }
  getSenders() { return this.senders; }
  setConnectionState(state) { this.connectionState = state; this.onconnectionstatechange?.(); }
  setIceConnectionState(state) { this.iceConnectionState = state; this.oniceconnectionstatechange?.(); }
}

let devices;
let deviceListeners;
let mediaDevices;

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function joinCall() {
  const view = render(<ProjectMedia projectId={PROJECT} />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Join call for project audio and video' }));
  await flush();
  expect(screen.getByText('Waiting for another project member to join…')).toBeInTheDocument();
  return view;
}

const signals = () => socket.emitted.filter(({ event }) => event === 'call:signal').map(({ args }) => args[0]);
const offersSent = () => signals().filter((message) => message.signal.type === 'offer');

async function receive(event, payload) {
  await act(async () => { await socket.trigger(event, { projectId: PROJECT, ...payload }); });
  await flush();
}

async function connectAsOfferer() {
  const view = await joinCall();
  await receive('call:presence', { callId: 'remote-call', userId: REMOTE, state: 'joined' });
  const peer = FakePeer.instances[0];
  await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'a' }, seq: offersSent()[0].signal.seq } });
  expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
  await act(async () => { peer.setConnectionState('connected'); });
  expect(screen.getByText('Call connected')).toBeInTheDocument();
  peer.view = view;
  return peer;
}

async function connectAsAnswerer() {
  await joinCall();
  await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' } } });
  const peer = FakePeer.instances[0];
  await act(async () => { peer.setConnectionState('connected'); });
  return peer;
}

beforeEach(() => {
  vi.useFakeTimers();
  socket.reset();
  auth.user = { id: 'alice', organizationId: 'org-1' };
  URL.createObjectURL = vi.fn(() => 'blob:recording');
  URL.revokeObjectURL = vi.fn();
  FakePeer.instances = [];
  FakePeer.holdNext = {};
  devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default microphone' },
    { kind: 'audioinput', deviceId: 'usb-mic', label: 'USB microphone' },
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Built-in camera' },
  ];
  deviceListeners = new Set();
  mediaDevices = {
    getUserMedia: vi.fn(async (constraints) => {
      const tracks = [];
      if (constraints.audio) tracks.push(new FakeTrack('audio', constraints.audio.deviceId?.exact || 'usb-mic'));
      if (constraints.video) tracks.push(new FakeTrack('video', constraints.video.deviceId?.exact || 'cam-1'));
      return new FakeStream(tracks);
    }),
    enumerateDevices: vi.fn(async () => devices),
    getDisplayMedia: vi.fn(),
    addEventListener: vi.fn((event, handler) => deviceListeners.add(handler)),
    removeEventListener: vi.fn((event, handler) => deviceListeners.delete(handler)),
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.stubGlobal('RTCSessionDescription', class { constructor(init) { Object.assign(this, init); } });
  vi.stubGlobal('RTCIceCandidate', class { constructor(init) { Object.assign(this, init); } });
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('m-local-call');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete navigator.mediaDevices;
});

describe('ICE restart and reconnection', () => {
  it('restarts ICE from the offerer when ICE fails, then gives up after bounded attempts', async () => {
    const peer = await connectAsOfferer();
    expect(offersSent()).toHaveLength(1);

    await act(async () => { peer.setIceConnectionState('failed'); });
    await flush();
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(offersSent()).toHaveLength(2);
    expect(offersSent()[1]).toMatchObject({ to: REMOTE, signal: { type: 'offer', renegotiate: true } });
    expect(screen.getByText(`Connection interrupted. Reconnecting (attempt 1 of ${MAX_ICE_RESTART_ATTEMPTS})…`)).toBeInTheDocument();

    // A repeated failure event during an in-flight attempt does not add attempts.
    await act(async () => { peer.setConnectionState('failed'); });
    await flush();
    expect(offersSent()).toHaveLength(2);

    await flush(ICE_RESTART_TIMEOUT_MS);
    await flush(ICE_RESTART_TIMEOUT_MS);
    expect(offersSent()).toHaveLength(1 + MAX_ICE_RESTART_ATTEMPTS);
    expect(peer.close).not.toHaveBeenCalled();

    await flush(ICE_RESTART_TIMEOUT_MS);
    expect(offersSent()).toHaveLength(1 + MAX_ICE_RESTART_ATTEMPTS);
    expect(peer.close).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(`could not be restored after ${MAX_ICE_RESTART_ATTEMPTS} reconnection attempts`);
    expect(screen.getByText('Waiting for another project member to join…')).toBeInTheDocument();
  });

  it('restarts only after the connection stays disconnected past the grace period', async () => {
    const peer = await connectAsOfferer();
    await act(async () => { peer.setConnectionState('disconnected'); });
    expect(screen.getByText('Reconnecting the call…')).toBeInTheDocument();
    await flush(DISCONNECT_GRACE_MS - 100);
    await act(async () => { peer.setConnectionState('connected'); });
    await flush(1_000);
    expect(offersSent()).toHaveLength(1);
    expect(screen.getByText('Call connected')).toBeInTheDocument();

    await act(async () => { peer.setConnectionState('disconnected'); });
    await flush(DISCONNECT_GRACE_MS);
    expect(offersSent()).toHaveLength(2);
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });

    // A successful restart resets the attempt budget.
    await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'a2' }, seq: offersSent()[1].signal.seq } });
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(2);
    await act(async () => { peer.setConnectionState('connected'); });
    await flush(ICE_RESTART_TIMEOUT_MS * 5);
    expect(offersSent()).toHaveLength(2);
    expect(peer.close).not.toHaveBeenCalled();
  });

  it('defers a restart while the socket is down and rejoins the room on reconnect', async () => {
    const peer = await connectAsOfferer();
    socket.connected = false;
    await act(async () => { await socket.trigger('disconnect'); });
    expect(screen.getByText(/Realtime connection lost/)).toBeInTheDocument();
    await act(async () => { peer.setIceConnectionState('failed'); });
    await flush();
    expect(offersSent()).toHaveLength(1);

    socket.connected = true;
    socket.emitted = [];
    await act(async () => { await socket.trigger('connect'); });
    await flush();
    const events = socket.emitted.map(({ event }) => event);
    expect(events.slice(0, 3)).toEqual(['join-project', 'call:presence', 'call:signal']);
    expect(socket.emitted[1].args[0]).toMatchObject({ projectId: PROJECT, callId: 'm-local-call', state: 'joined' });
    expect(offersSent()[0]).toMatchObject({ to: REMOTE, signal: { type: 'offer', renegotiate: true } });
    expect(screen.queryByText(/Realtime connection lost/)).not.toBeInTheDocument();
  });

  it('answers re-offers on the same peer and never restarts ICE as the answerer', async () => {
    const peer = await connectAsAnswerer();
    const answers = () => signals().filter((message) => message.signal.type === 'answer');
    expect(answers()).toHaveLength(1);

    await act(async () => { peer.setIceConnectionState('failed'); });
    await flush();
    expect(peer.createOffer).not.toHaveBeenCalled();
    expect(screen.getByText('Connection interrupted. Waiting for the other participant to reconnect…')).toBeInTheDocument();

    await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'restart' }, renegotiate: true } });
    expect(FakePeer.instances).toHaveLength(1);
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(2);
    expect(answers()).toHaveLength(2);
    await act(async () => { peer.setConnectionState('connected'); });
    expect(screen.getByText('Call connected')).toBeInTheDocument();
  });

  it('releases the peer if the offerer never restores the connection', async () => {
    const peer = await connectAsAnswerer();
    await act(async () => { peer.setConnectionState('failed'); });
    await flush(ANSWERER_RECOVERY_WINDOW_MS - 1);
    expect(peer.close).not.toHaveBeenCalled();
    await flush(1);
    expect(peer.close).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('The call connection was lost');
  });

  it('replaces the peer when the remote side sends a fresh offer after rebuilding its connection', async () => {
    const first = await connectAsAnswerer();
    await receive('call:signal', { callId: 'remote-call-2', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'new' } } });
    expect(first.close).toHaveBeenCalled();
    expect(FakePeer.instances).toHaveLength(2);
    expect(FakePeer.instances[1].setRemoteDescription).toHaveBeenCalled();
  });

  it('resolves offer glare: the lower call id yields, the higher ignores', async () => {
    await joinCall();
    await receive('call:presence', { callId: 'z-remote', userId: REMOTE, state: 'joined' });
    const peer = FakePeer.instances[0];
    expect(peer.signalingState).toBe('have-local-offer');
    await receive('call:signal', { callId: 'z-remote', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' } } });
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
    expect(signals().filter((message) => message.signal.type === 'answer')).toHaveLength(1);
  });

  it('ignores a colliding offer from a peer with a lower call id', async () => {
    await joinCall();
    await receive('call:presence', { callId: 'a-remote', userId: REMOTE, state: 'joined' });
    const peer = FakePeer.instances[0];
    await receive('call:signal', { callId: 'a-remote', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' } } });
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(signals().filter((message) => message.signal.type === 'answer')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('device changes', () => {
  it('switches to the default microphone via replaceTrack when the active one is unplugged', async () => {
    const peer = await connectAsOfferer();
    const audioSender = peer.senders.find((sender) => sender.track.kind === 'audio');
    const oldTrack = audioSender.track;
    expect(oldTrack.deviceId).toBe('usb-mic');

    devices = devices.filter((device) => device.deviceId !== 'usb-mic');
    await act(async () => { await Promise.all([...deviceListeners].map((listener) => listener())); });
    await flush();

    expect(mediaDevices.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'default' } }, video: false });
    expect(audioSender.replaceTrack).toHaveBeenCalledTimes(1);
    expect(audioSender.track.deviceId).toBe('default');
    expect(oldTrack.stop).toHaveBeenCalled();
    expect(peer.createOffer).toHaveBeenCalledTimes(1); // No renegotiation.
    expect(screen.getByText('Your microphone was disconnected, so the call switched to Default microphone.')).toBeInTheDocument();
  });

  it('offers labelled microphone and camera selectors that switch devices in place', async () => {
    devices.push({ kind: 'videoinput', deviceId: 'cam-2', label: 'External camera' });
    const peer = await connectAsOfferer();
    const microphone = screen.getByLabelText('Microphone');
    const camera = screen.getByLabelText('Camera');
    expect(microphone.tagName).toBe('SELECT');
    expect(camera).toHaveValue('cam-1');

    fireEvent.change(camera, { target: { value: 'cam-2' } });
    await flush();
    const videoSender = peer.senders.find((sender) => sender.track.kind === 'video');
    expect(videoSender.replaceTrack).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'cam-2' }));
    expect(screen.getByLabelText('Camera')).toHaveValue('cam-2');

    fireEvent.change(microphone, { target: { value: 'default' } });
    await flush();
    expect(screen.getByLabelText('Microphone')).toHaveValue('default');
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
  });
});

describe('call quality indicator', () => {
  const stats = (lost, received, rtt) => ({
    forEach: (fn) => [
      { type: 'inbound-rtp', packetsLost: lost, packetsReceived: received },
      { type: 'candidate-pair', id: 'cp', state: 'succeeded', nominated: true, currentRoundTripTime: rtt },
    ].forEach(fn),
  });

  it('shows good or poor quality from periodic local stats', async () => {
    const peer = await connectAsOfferer();
    expect(screen.getByText(/Connection quality: Checking/)).toBeInTheDocument();
    peer.getStats.mockResolvedValueOnce(stats(0, 1000, 0.08));
    await flush(STATS_INTERVAL_MS);
    expect(screen.getByText('Connection quality: Good')).toBeInTheDocument();

    peer.getStats.mockResolvedValueOnce(stats(100, 1900, 0.08));
    await flush(STATS_INTERVAL_MS);
    expect(screen.getByText(/Connection quality: Poor/)).toBeInTheDocument();

    peer.getStats.mockResolvedValueOnce(stats(100, 2900, 0.6));
    await flush(STATS_INTERVAL_MS);
    expect(screen.getByText(/Connection quality: Poor/)).toBeInTheDocument();

    peer.getStats.mockResolvedValueOnce(stats(100, 3900, 0.05));
    await flush(STATS_INTERVAL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Connection quality: Good');
    expect(socket.emitted.some(({ event }) => /stat|quality/i.test(event))).toBe(false);
  });
});

describe('screen recording duration limit', () => {
  it('refreshes uploaded recordings without disconnecting an established call', async () => {
    const peer = await connectAsOfferer();
    const callStream = await mediaDevices.getUserMedia.mock.results[0].value;
    class Recorder {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable({ data: new Blob(['frame'], { type: 'video/webm' }) });
        this.onstop();
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const screenTrack = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValue(new FakeStream([screenTrack]));
    vi.spyOn(apiMock, 'getAttachments').mockResolvedValue([{ id: 'new-video', mimeType: 'video/webm', originalName: 'New recording.webm', filename: 'new.webm' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording and upload screen share' }));
    await flush();
    expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/api/attachments/uploads/new.webm');
    expect(screen.getByText('Call connected')).toBeInTheDocument();
    expect(peer.close).not.toHaveBeenCalled();
    expect(callStream.getTracks().every((track) => track.stop.mock.calls.length === 0)).toBe(true);
    expect(socket.emitted.some(({ event, args }) => event === 'call:presence' && args[0]?.state === 'left')).toBe(false);
    expect(screenTrack.stop).toHaveBeenCalled();
  });

  it('counts down and auto-stops and uploads at the maximum duration', async () => {
    const recorders = [];
    class FakeRecorder {
      static isTypeSupported() { return true; }
      constructor(stream) { this.stream = stream; this.state = 'inactive'; recorders.push(this); }
      start() { this.state = 'recording'; }
      stop = vi.fn(() => {
        this.state = 'inactive';
        this.ondataavailable({ data: new Blob(['frame'], { type: 'video/webm' }) });
        this.onstop();
      });
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const screenTrack = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValue(new FakeStream([screenTrack]));
    const upload = vi.spyOn(apiMock, 'uploadAttachment');

    render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    expect(screen.getByRole('timer')).toHaveTextContent('15:00 left');

    await flush(60_000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:00 left');
    expect(recorders[0].stop).not.toHaveBeenCalled();

    await flush(MAX_RECORDING_DURATION_MS - 60_000);
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(screenTrack.stop).toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(expect.any(File), 'PROJECT', PROJECT);
    expect(screen.getByText('Recording reached the 15-minute limit, so it stopped and is being uploaded.')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

const answersSent = () => signals().filter((message) => message.signal.type === 'answer');

describe('negotiation edge cases', () => {
  it('treats an offer arriving while ours is still being created as glare (polite side yields)', async () => {
    await joinCall();
    const pending = deferred();
    FakePeer.holdNext.createOffer = pending.promise;
    const presence = socket.trigger('call:presence', { projectId: PROJECT, callId: 'z-remote', userId: REMOTE, state: 'joined' });
    await flush();
    const peer = FakePeer.instances[0];
    expect(peer.signalingState).toBe('stable'); // Still creating the offer.
    const incoming = socket.trigger('call:signal', { projectId: PROJECT, callId: 'z-remote', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' }, seq: 1 } });
    await flush();
    await act(async () => { pending.resolve({ type: 'offer', sdp: 'late' }); await presence; await incoming; });
    await flush();
    // Our late offer is abandoned, neither applied nor sent; the remote one is answered.
    expect(peer.setLocalDescription).not.toHaveBeenCalledWith({ type: 'offer', sdp: 'late' });
    expect(offersSent()).toHaveLength(0);
    expect(answersSent()).toHaveLength(1);
    expect(answersSent()[0].signal.seq).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an offer arriving while the impolite side is still creating its own', async () => {
    await joinCall();
    const pending = deferred();
    FakePeer.holdNext.createOffer = pending.promise;
    const presence = socket.trigger('call:presence', { projectId: PROJECT, callId: 'a-remote', userId: REMOTE, state: 'joined' });
    await flush();
    const peer = FakePeer.instances[0];
    await receive('call:signal', { callId: 'a-remote', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' } } });
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ type: 'offer', sdp: 'mine' }); await presence; });
    await flush();
    expect(offersSent()).toHaveLength(1);
    expect(answersSent()).toHaveLength(0);
  });

  it('drops an answer to a superseded restart offer', async () => {
    const peer = await connectAsOfferer();
    await act(async () => { peer.setIceConnectionState('failed'); });
    await flush();
    await flush(ICE_RESTART_TIMEOUT_MS);
    const [, firstRestart, secondRestart] = offersSent();
    expect(secondRestart.signal.seq).toBeGreaterThan(firstRestart.signal.seq);
    await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'stale' }, seq: firstRestart.signal.seq } });
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'fresh' }, seq: secondRestart.signal.seq } });
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(2);
    expect(peer.setRemoteDescription).toHaveBeenLastCalledWith(expect.objectContaining({ sdp: 'fresh' }));
  });

  it('stays quiet when the user leaves mid-negotiation', async () => {
    await joinCall();
    const pending = deferred();
    FakePeer.holdNext.setRemoteDescription = pending.promise;
    const incoming = socket.trigger('call:signal', { projectId: PROJECT, callId: 'remote-call', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'o' } } });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call for project audio and video' }));
    await act(async () => { pending.reject(new Error('InvalidStateError: closed')); await incoming; });
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(answersSent()).toHaveLength(0);
  });

  it('re-subscribes quality polling to a rebuilt peer', async () => {
    const first = await connectAsAnswerer();
    await flush(STATS_INTERVAL_MS);
    expect(first.getStats).toHaveBeenCalledTimes(1);
    await receive('call:signal', { callId: 'remote-call-2', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'new' } } });
    const second = FakePeer.instances[1];
    await flush(STATS_INTERVAL_MS);
    expect(second.getStats).toHaveBeenCalledTimes(1);
    expect(first.getStats).toHaveBeenCalledTimes(1);
  });
});

describe('joining', () => {
  it('shows an accessible error and releases media when the room join is refused', async () => {
    socket.joinResult = { joined: false };
    render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Join call for project audio and video' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to calls in this project.');
    const stream = await mediaDevices.getUserMedia.mock.results[0].value;
    expect(stream.getTracks().every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(socket.emitted.some(({ event }) => event === 'call:presence')).toBe(false);
    expect(screen.getByRole('button', { name: 'Join call for project audio and video' })).toBeEnabled();
  });

  it('ignores a double click while joining and never opens a second stream', async () => {
    const pending = deferred();
    mediaDevices.getUserMedia.mockImplementationOnce(() => pending.promise);
    render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    const join = screen.getByRole('button', { name: 'Join call for project audio and video' });
    fireEvent.click(join);
    fireEvent.click(join);
    await flush();
    expect(join).toBeDisabled();
    expect(join).toHaveTextContent('Joining…');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(new FakeStream([new FakeTrack('audio', 'usb-mic'), new FakeTrack('video', 'cam-1')])); });
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Waiting for another project member to join…')).toBeInTheDocument();
  });

  it('stops media acquired by a join that was abandoned by unmounting', async () => {
    const pending = deferred();
    mediaDevices.getUserMedia.mockImplementationOnce(() => pending.promise);
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Join call for project audio and video' }));
    view.unmount();
    const tracks = [new FakeTrack('audio', 'usb-mic'), new FakeTrack('video', 'cam-1')];
    await act(async () => { pending.resolve(new FakeStream(tracks)); });
    await flush();
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });
});

describe('overlapping device switches', () => {
  it('serializes switches of one kind and leaves no orphaned track', async () => {
    devices.push({ kind: 'videoinput', deviceId: 'cam-2', label: 'Camera two' }, { kind: 'videoinput', deviceId: 'cam-3', label: 'Camera three' });
    const peer = await connectAsOfferer();
    const videoSender = peer.senders.find((sender) => sender.track.kind === 'video');
    const firstPending = deferred();
    const created = [];
    mediaDevices.getUserMedia.mockImplementationOnce(() => firstPending.promise);
    mediaDevices.getUserMedia.mockImplementation(async (constraints) => {
      const track = new FakeTrack('video', constraints.video.deviceId.exact);
      created.push(track);
      return new FakeStream([track]);
    });

    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'cam-2' } });
    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'cam-3' } });
    await flush();
    // The second switch waits for the first instead of racing it.
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);

    const cam2 = new FakeTrack('video', 'cam-2');
    await act(async () => { firstPending.resolve(new FakeStream([cam2])); });
    await flush();

    expect(videoSender.replaceTrack.mock.calls.map(([track]) => track.deviceId)).toEqual(['cam-2', 'cam-3']);
    expect(videoSender.track.deviceId).toBe('cam-3');
    expect(cam2.stop).toHaveBeenCalled();
    expect(created[0].stop).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Camera')).toHaveValue('cam-3');
  });

  it('stops the new track if the call ends while a switch is in flight', async () => {
    await connectAsOfferer();
    const pending = deferred();
    mediaDevices.getUserMedia.mockImplementationOnce(() => pending.promise);
    fireEvent.change(screen.getByLabelText('Microphone'), { target: { value: 'default' } });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call for project audio and video' }));
    const orphan = new FakeTrack('audio', 'default');
    await act(async () => { pending.resolve(new FakeStream([orphan])); });
    await flush();
    expect(orphan.stop).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});


// Use a real Blob/File and the shared capped recorder so retry coverage proves
// that the stopped bytes survive, rather than mocking the capture callback.
function installRecording(bytes = 'known recording bytes', { holdStop = false } = {}) {
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const complete = () => {
        this.ondataavailable({ data: new Blob([bytes], { type: 'video/webm' }) });
        this.onstop();
      };
      if (holdStop) track.completeStop = complete;
      else complete();
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const track = new FakeTrack('video', 'recording-screen');
  mediaDevices.getDisplayMedia.mockResolvedValue(new FakeStream([track]));
  return track;
}

async function captureRecording() {
  fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording and upload screen share' }));
  await flush();
}

const fileText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsText(file);
});

describe('stopped recording recovery', () => {
  it('saves exact captured bytes and deliberately retries the same File without recapture', async () => {
    installRecording('unique frame bytes 123');
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({});
    render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    await captureRecording();
    const file = upload.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    const savedFile = URL.createObjectURL.mock.calls[0][0];
    expect(savedFile).toBe(file);
    // FileReader is asynchronous independently of the fake recorder timers.
    vi.useRealTimers();
    expect(await fileText(savedFile)).toBe('unique frame bytes 123');
    vi.useFakeTimers();
    expect(screen.getByRole('link', { name: 'Save recording' })).toHaveAttribute('download', file.name);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be confirmed');
    await flush(60_000);
    expect(upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0]).toBe(file);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
  });

  it('does not offer another upload after the request succeeds but list refresh fails', async () => {
    installRecording();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockResolvedValue({});
    const view = render(<ProjectMedia projectId={PROJECT} />);
    vi.spyOn(view.client, 'invalidateQueries').mockRejectedValue(new Error('Refresh failed'));
    await flush();
    await captureRecording();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Recording uploaded. The file list could not refresh/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
  });

  it('keeps local recovery but blocks retry after changing project within the same identity', async () => {
    installRecording();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockRejectedValue(new Error('Offline'));
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    await captureRecording();
    view.rerender(<ProjectMedia projectId="p2" />);
    await flush();
    expect(screen.getByRole('link', { name: 'Save recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    expect(screen.getByRole('button', { name: 'Record screen for this project' })).toBeEnabled();
  });

  it.each(['organization', 'actor'])('purges and revokes private recovery after a %s change, even when switching back', async (kind) => {
    installRecording();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockRejectedValue(new Error('Offline'));
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    await captureRecording();
    const original = auth.user;
    auth.user = { ...original, [kind === 'actor' ? 'id' : 'organizationId']: 'new-identity' };
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    auth.user = original;
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Record screen for this project' })).toBeEnabled();
  });

  it.each(['organization', 'actor'])('ignores late old recording bytes after a %s transition and return', async (kind) => {
    const track = installRecording('private old bytes', { holdStop: true });
    const upload = vi.spyOn(apiMock, 'uploadAttachment');
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    const original = auth.user;
    auth.user = { ...original, [kind === 'actor' ? 'id' : 'organizationId']: 'new-identity' };
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    expect(track.stop).toHaveBeenCalled();
    auth.user = original;
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    await act(async () => track.completeStop());
    await flush();
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not let a late old-actor stop clear a new actor recording', async () => {
    const oldTrack = installRecording('old private bytes', { holdStop: true });
    const upload = vi.spyOn(apiMock, 'uploadAttachment');
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    auth.user = { ...auth.user, id: 'new-actor' };
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    const currentTrack = new FakeTrack('video', 'current-actor-screen');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([currentTrack]));
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    await act(async () => oldTrack.completeStop());
    await flush();
    expect(screen.getByRole('button', { name: 'Stop recording and upload screen share' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(currentTrack.stop).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops a recording on context switch and keeps the stopped take without uploading it', async () => {
    const track = installRecording();
    const upload = vi.spyOn(apiMock, 'uploadAttachment');
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    await flush();
    view.rerender(<ProjectMedia projectId="p2" />);
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Save recording' })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
  });

  it.each(['switch', 'unmount'])('stops a late recording picker after %s without recording or uploading', async (cancel) => {
    installRecording();
    const pending = deferred();
    mediaDevices.getDisplayMedia.mockReturnValueOnce(pending.promise);
    const upload = vi.spyOn(apiMock, 'uploadAttachment');
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Record screen for this project' }));
    if (cancel === 'switch') view.rerender(<ProjectMedia projectId="p2" />);
    else view.unmount();
    const track = new FakeTrack('video', 'late');
    await act(async () => pending.resolve(new FakeStream([track])));
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('never retargets an in-flight upload or its refresh after the project changes', async () => {
    installRecording();
    const pending = deferred();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockReturnValueOnce(pending.promise);
    const view = render(<ProjectMedia projectId={PROJECT} />);
    const refresh = vi.spyOn(view.client, 'invalidateQueries');
    await flush();
    await captureRecording();
    expect(upload).toHaveBeenCalledWith(expect.any(File), 'PROJECT', PROJECT);
    view.rerender(<ProjectMedia projectId="p2" />);
    await flush();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
    await act(async () => pending.resolve({}));
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['project-files', PROJECT] }, { throwOnError: true });
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
  });

  it('does not recreate private recovery or refresh files after an in-flight upload crosses an actor transition', async () => {
    installRecording();
    const pending = deferred();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockReturnValueOnce(pending.promise);
    const view = render(<ProjectMedia projectId={PROJECT} />);
    const refresh = vi.spyOn(view.client, 'invalidateQueries');
    await flush();
    await captureRecording();
    auth.user = { ...auth.user, id: 'other-actor' };
    view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    await act(async () => pending.resolve({}));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Save recording' })).not.toBeInTheDocument();
  });

  it('ignores a late upload failure after unmount and releases its local recording URL', async () => {
    installRecording();
    const pending = deferred();
    const upload = vi.spyOn(apiMock, 'uploadAttachment').mockReturnValue(pending.promise);
    const view = render(<ProjectMedia projectId={PROJECT} />);
    await flush();
    await captureRecording();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    await act(async () => pending.reject(new Error('late failure')));
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('call display stream ownership', () => {
  it('stops the replaced share and current share on leave, preserving the call across unrelated rerenders', async () => {
    const peer = await connectAsOfferer();
    const first = new FakeTrack('video', 'share-1');
    const second = new FakeTrack('video', 'share-2');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([first])).mockResolvedValueOnce(new FakeStream([second]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    peer.view.rerender(<ProjectMedia projectId={PROJECT} />);
    await flush();
    expect(first.stop).not.toHaveBeenCalled();
    expect(peer.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    expect(first.stop).toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call for project audio and video' }));
    expect(second.stop).toHaveBeenCalled();
  });

  it('restores the current camera when the current share ends and releases all display tracks', async () => {
    devices.push({ kind: 'videoinput', deviceId: 'cam-2', label: 'Second camera' });
    const peer = await connectAsOfferer();
    const display = new FakeTrack('video', 'screen');
    const extra = new FakeTrack('audio', 'display-audio');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([display, extra]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    const sender = peer.getSenders().find((item) => item.track === display);
    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'cam-2' } });
    await flush();
    await act(async () => display.onended());
    await flush();
    expect(sender.track.deviceId).toBe('cam-2');
    expect(display.stop).toHaveBeenCalled();
    expect(extra.stop).toHaveBeenCalled();
  });

  it.each(['leave', 'unmount', 'peer replacement'])('stops a late display picker after %s without replacing a track', async (cancel) => {
    const peer = await connectAsOfferer();
    const sender = peer.getSenders().find((item) => item.track.kind === 'video');
    const pending = deferred();
    mediaDevices.getDisplayMedia.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    if (cancel === 'leave') fireEvent.click(screen.getByRole('button', { name: 'Leave call for project audio and video' }));
    else if (cancel === 'unmount') peer.view.unmount();
    else await receive('call:signal', { callId: 'remote-new', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'new' } } });
    const track = new FakeTrack('video', 'late-screen');
    await act(async () => pending.resolve(new FakeStream([track])));
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(sender.replaceTrack).not.toHaveBeenCalled();
  });

  it('stops an active share on unmount and does not restore a stale share into another peer', async () => {
    const peer = await connectAsOfferer();
    const display = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([display]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    const ended = display.onended;
    const sender = peer.getSenders().find((item) => item.track === display);
    peer.view.unmount();
    expect(display.stop).toHaveBeenCalled();
    await act(async () => ended());
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1);
  });

  it('stops an active display when the peer is replaced and ignores the old ended callback', async () => {
    const peer = await connectAsOfferer();
    const display = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([display]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    const ended = display.onended;
    const oldSender = peer.getSenders().find((item) => item.track === display);
    await receive('call:signal', { callId: 'remote-new', from: REMOTE, signal: { type: 'offer', sdp: { type: 'offer', sdp: 'new' } } });
    expect(display.stop).toHaveBeenCalled();
    await act(async () => ended());
    expect(oldSender.replaceTrack).toHaveBeenCalledTimes(1);
    const nextSender = FakePeer.instances[1].getSenders().find((item) => item.track.kind === 'video');
    expect(nextSender.track.deviceId).toBe('cam-1');
    expect(nextSender.replaceTrack).not.toHaveBeenCalled();
  });

  it('releases a display immediately when leaving during replaceTrack and suppresses its late failure', async () => {
    const peer = await connectAsOfferer();
    const sender = peer.getSenders().find((item) => item.track.kind === 'video');
    const replacement = deferred();
    sender.replaceTrack.mockReturnValueOnce(replacement.promise);
    const display = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([display]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call for project audio and video' }));
    expect(display.stop).toHaveBeenCalled();
    await act(async () => replacement.reject(new Error('closed')));
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping display replacements so the newest share wins', async () => {
    const peer = await connectAsOfferer();
    const sender = peer.getSenders().find((item) => item.track.kind === 'video');
    const replacement = deferred();
    sender.replaceTrack.mockImplementationOnce(async (track) => { await replacement.promise; sender.track = track; });
    const first = new FakeTrack('video', 'share-1');
    const second = new FakeTrack('video', 'share-2');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([first])).mockResolvedValueOnce(new FakeStream([second]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    expect(first.stop).toHaveBeenCalled();
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1);
    await act(async () => replacement.resolve());
    await flush();
    expect(sender.replaceTrack).toHaveBeenCalledTimes(2);
    expect(sender.track).toBe(second);
    expect(second.stop).not.toHaveBeenCalled();
  });

  it('stops the display if replaceTrack rejects and reports a visible error', async () => {
    const peer = await connectAsOfferer();
    const sender = peer.getSenders().find((item) => item.track.kind === 'video');
    sender.replaceTrack.mockRejectedValueOnce(new Error('replacement rejected'));
    const display = new FakeTrack('video', 'screen');
    mediaDevices.getDisplayMedia.mockResolvedValueOnce(new FakeStream([display]));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen in call' }));
    await flush();
    expect(display.stop).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Screen share could not start');
  });
});
