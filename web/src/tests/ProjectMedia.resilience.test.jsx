import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWERER_RECOVERY_WINDOW_MS,
  DISCONNECT_GRACE_MS,
  ICE_RESTART_TIMEOUT_MS,
  MAX_ICE_RESTART_ATTEMPTS,
  MAX_RECORDING_DURATION_MS,
  STATS_INTERVAL_MS,
} from '../lib/call-resilience';

const { socket, apiMock } = vi.hoisted(() => {
  const handlers = new Map();
  const socket = {
    connected: true,
    emitted: [],
    on(event, handler) { handlers.set(event, [...(handlers.get(event) || []), handler]); },
    off(event, handler) { handlers.set(event, (handlers.get(event) || []).filter((item) => item !== handler)); },
    emit(event, ...args) {
      socket.emitted.push({ event, args });
      const ack = args[args.length - 1];
      if (typeof ack === 'function') ack({ joined: true });
    },
    trigger(event, payload) { return Promise.all((handlers.get(event) || []).map((handler) => handler(payload))); },
    reset() { handlers.clear(); socket.emitted = []; socket.connected = true; },
  };
  const apiMock = {
    getAttachments: async () => [],
    getIceServers: async () => ({ iceServers: [{ urls: 'stun:example.test' }] }),
    uploadAttachment: async () => ({}),
  };
  return { socket, apiMock };
});

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket }) }));

const { default: ProjectMedia } = await import('../components/project/ProjectMedia');

const PROJECT = 'p1';
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
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.signalingState = 'stable';
    this.currentRemoteDescription = null;
    this.senders = [];
    this.createOffer = vi.fn(async (options) => ({ type: 'offer', sdp: options?.iceRestart ? 'restart-offer' : 'offer' }));
    this.createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer' }));
    this.setLocalDescription = vi.fn(async (description) => {
      this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    });
    this.setRemoteDescription = vi.fn(async (description) => {
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
  render(<ProjectMedia projectId={PROJECT} />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Join project audio and video call' }));
  await flush();
  expect(screen.getByText('Waiting for another project member to join…')).toBeInTheDocument();
}

const signals = () => socket.emitted.filter(({ event }) => event === 'call:signal').map(({ args }) => args[0]);
const offersSent = () => signals().filter((message) => message.signal.type === 'offer');

async function receive(event, payload) {
  await act(async () => { await socket.trigger(event, { projectId: PROJECT, ...payload }); });
  await flush();
}

async function connectAsOfferer() {
  await joinCall();
  await receive('call:presence', { callId: 'remote-call', userId: REMOTE, state: 'joined' });
  const peer = FakePeer.instances[0];
  await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'a' } } });
  await act(async () => { peer.setConnectionState('connected'); });
  expect(screen.getByText('Call connected')).toBeInTheDocument();
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
  FakePeer.instances = [];
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
    await receive('call:signal', { callId: 'remote-call', from: REMOTE, signal: { type: 'answer', sdp: { type: 'answer', sdp: 'a2' } } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Record a project screen share' }));
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
