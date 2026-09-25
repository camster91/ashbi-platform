import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Activity, Mic, MicOff, MonitorUp, Phone, PhoneOff, Radio, Video, VideoOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';
import {
  ANSWERER_RECOVERY_WINDOW_MS,
  DISCONNECT_GRACE_MS,
  ICE_RESTART_TIMEOUT_MS,
  JOIN_ACK_TIMEOUT_MS,
  MAX_ICE_RESTART_ATTEMPTS,
  MAX_RECORDING_DURATION_MS,
  STATS_INTERVAL_MS,
  classifyQuality,
  formatDuration,
  pickFallbackDevice,
  summarizeStats,
} from '../../lib/call-resilience';

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const MAX_RECORDING_MINUTES = Math.round(MAX_RECORDING_DURATION_MS / 60_000);
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CONNECTION_LOST_MESSAGE = `The call connection was lost and could not be restored after ${MAX_ICE_RESTART_ATTEMPTS} reconnection attempts. You are still in the call; the other participant can rejoin.`;
const QUALITY_LABELS = { good: 'Good', poor: 'Poor — audio or video may stutter', unknown: 'Checking…' };

function makeCallId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Join the project room and wait for the server to authorize it, so signals
// sent right after a (re)connect are not dropped for arriving before the join.
function joinProjectRoom(socket, projectId) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, JOIN_ACK_TIMEOUT_MS);
    socket.emit('join-project', projectId, () => { clearTimeout(timer); resolve(); });
  });
}

function trackDeviceId(track) {
  return track?.getSettings?.().deviceId || '';
}

export default function ProjectMedia({ projectId }) {
  const { socket } = useSocket();
  const micSelectId = useId();
  const cameraSelectId = useId();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [recordingNotice, setRecordingNotice] = useState('');
  const [recordingRemainingMs, setRecordingRemainingMs] = useState(MAX_RECORDING_DURATION_MS);
  const [recordings, setRecordings] = useState([]);
  const [callState, setCallState] = useState('idle');
  const [callError, setCallError] = useState('');
  const [callNotice, setCallNotice] = useState('');
  const [signallingOffline, setSignallingOffline] = useState(false);
  const [callQuality, setCallQuality] = useState('unknown');
  const [remoteParticipant, setRemoteParticipant] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [audioInputs, setAudioInputs] = useState([]);
  const [videoInputs, setVideoInputs] = useState([]);
  const [activeMicId, setActiveMicId] = useState('');
  const [activeCameraId, setActiveCameraId] = useState('');
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingTimersRef = useRef({});
  const callIdRef = useRef(null);
  // Calls are 1:1: the peer is bound to one remote user, and every signal is
  // addressed to that user instead of the whole project room.
  const remoteUserRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const localStreamRef = useRef(null);
  const peerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  // Only the side that made the original offer restarts ICE, so both sides
  // never offer at once during recovery.
  const isOffererRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const pendingRestartRef = useRef(false);
  const disconnectTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const answererTimerRef = useRef(null);

  const refreshRecordings = useCallback(async () => {
    try {
      const attachments = await api.getAttachments('PROJECT', projectId);
      setRecordings((attachments || []).filter((item) => item.mimeType?.startsWith('video/')));
    } catch {
      // The primary call and recording controls remain usable if history cannot load.
    }
  }, [projectId]);

  useEffect(() => { refreshRecordings(); }, [refreshRecordings]);

  const stopLocalTracks = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const resetRecovery = useCallback(() => {
    clearTimeout(disconnectTimerRef.current);
    clearTimeout(restartTimerRef.current);
    clearTimeout(answererTimerRef.current);
    disconnectTimerRef.current = null;
    restartTimerRef.current = null;
    answererTimerRef.current = null;
    restartAttemptsRef.current = 0;
    pendingRestartRef.current = false;
  }, []);

  const leaveCall = useCallback(() => {
    const callId = callIdRef.current;
    const remoteUser = remoteUserRef.current;
    if (socket && callId) {
      if (remoteUser) socket.emit('call:signal', { projectId, callId, to: remoteUser, signal: { type: 'hangup' } });
      socket.emit('call:presence', { projectId, callId, state: 'left' });
    }
    resetRecovery();
    peerRef.current?.close();
    peerRef.current = null;
    stopLocalTracks();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    callIdRef.current = null;
    remoteUserRef.current = null;
    isOffererRef.current = false;
    setRemoteParticipant(false);
    setCallNotice('');
    setCallQuality('unknown');
    setSignallingOffline(false);
    setCallState('idle');
  }, [projectId, resetRecovery, socket, stopLocalTracks]);

  // Drop the current peer but stay in the call, waiting for a participant.
  const releasePeer = useCallback((message) => {
    resetRecovery();
    const peer = peerRef.current;
    peerRef.current = null;
    peer?.close();
    remoteUserRef.current = null;
    isOffererRef.current = false;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteParticipant(false);
    setCallQuality('unknown');
    setCallNotice('');
    if (typeof message === 'string' && message) setCallError(message);
    if (callIdRef.current) setCallState('waiting');
  }, [resetRecovery]);

  const performIceRestart = useCallback(async (peer) => {
    if (peerRef.current !== peer || !remoteUserRef.current) return;
    // Signals sent while the socket is down would be dropped by the server;
    // the reconnect handler performs the restart once the room is rejoined.
    if (!socket?.connected) { pendingRestartRef.current = true; return; }
    pendingRestartRef.current = false;
    try {
      const offer = await peer.createOffer({ iceRestart: true });
      if (peerRef.current !== peer) return;
      await peer.setLocalDescription(offer);
      socket.emit('call:signal', { projectId, callId: callIdRef.current, to: remoteUserRef.current, signal: { type: 'offer', sdp: offer, renegotiate: true } });
    } catch {
      // The attempt timer moves on to the next bounded attempt.
    }
  }, [projectId, socket]);

  const recoverPeer = useCallback((peer) => {
    if (peerRef.current !== peer) return;
    setCallState('reconnecting');
    if (!isOffererRef.current) {
      // The answerer waits for the offerer's restarts, but not forever.
      setCallNotice('Connection interrupted. Waiting for the other participant to reconnect…');
      if (!answererTimerRef.current) {
        answererTimerRef.current = setTimeout(() => {
          answererTimerRef.current = null;
          if (peerRef.current === peer) releasePeer(CONNECTION_LOST_MESSAGE);
        }, ANSWERER_RECOVERY_WINDOW_MS);
      }
      return;
    }
    if (restartTimerRef.current) return; // An attempt is already in flight.
    const attempt = () => {
      if (peerRef.current !== peer) return;
      if (restartAttemptsRef.current >= MAX_ICE_RESTART_ATTEMPTS) return releasePeer(CONNECTION_LOST_MESSAGE);
      restartAttemptsRef.current += 1;
      setCallNotice(`Connection interrupted. Reconnecting (attempt ${restartAttemptsRef.current} of ${MAX_ICE_RESTART_ATTEMPTS})…`);
      performIceRestart(peer);
      restartTimerRef.current = setTimeout(() => { restartTimerRef.current = null; attempt(); }, ICE_RESTART_TIMEOUT_MS);
    };
    attempt();
  }, [performIceRestart, releasePeer]);

  const ensurePeer = useCallback((remoteUser) => {
    if (peerRef.current) return peerRef.current;
    remoteUserRef.current = remoteUser;
    const peer = new RTCPeerConnection({ iceServers: iceServersRef.current });
    localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && socket && callIdRef.current && remoteUserRef.current) {
        socket.emit('call:signal', { projectId, callId: callIdRef.current, to: remoteUserRef.current, signal: { type: 'ice', candidate } });
      }
    };
    peer.ontrack = ({ streams }) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = streams[0];
      setRemoteParticipant(true);
      setCallState('connected');
    };
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      const state = peer.connectionState;
      if (state === 'connected') {
        resetRecovery();
        setCallNotice('');
        setCallState('connected');
      } else if (state === 'disconnected') {
        // Often transient (Wi-Fi handover): give it a moment before restarting.
        setCallState('reconnecting');
        setCallNotice('Connection interrupted. Trying to reconnect…');
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;
            if (peer.connectionState !== 'connected') recoverPeer(peer);
          }, DISCONNECT_GRACE_MS);
        }
      } else if (state === 'failed') {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        recoverPeer(peer);
      } else if (state === 'closed') {
        // The other side vanished without a hangup: release the 1:1 binding
        // so they, or someone else, can join again.
        releasePeer();
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed' && peerRef.current === peer) recoverPeer(peer);
    };
    peerRef.current = peer;
    return peer;
  }, [projectId, recoverPeer, releasePeer, resetRecovery, socket]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === 'audioinput' && device.deviceId));
      setVideoInputs(devices.filter((device) => device.kind === 'videoinput' && device.deviceId));
      return devices;
    } catch {
      return [];
    }
  }, []);

  // Swap the local mic or camera in place: replaceTrack keeps the negotiated
  // session, so no renegotiation (or remote glitch beyond the switch) occurs.
  const switchDevice = useCallback(async (kind, deviceId) => {
    const stream = localStreamRef.current;
    const isAudio = kind === 'audioinput';
    const oldTrack = isAudio ? stream?.getAudioTracks()[0] : stream?.getVideoTracks()[0];
    if (!stream || !oldTrack || !deviceId) return false;
    try {
      const media = await navigator.mediaDevices.getUserMedia(isAudio
        ? { audio: { deviceId: { exact: deviceId } }, video: false }
        : { video: { deviceId: { exact: deviceId } }, audio: false });
      const newTrack = isAudio ? media.getAudioTracks()[0] : media.getVideoTracks()[0];
      if (!newTrack) return false;
      if (localStreamRef.current !== stream) { newTrack.stop(); return false; }
      newTrack.enabled = oldTrack.enabled;
      // While screen sharing, the video sender carries the screen; the new
      // camera is picked up again when the share ends.
      const sender = peerRef.current?.getSenders().find((item) => item.track === oldTrack);
      if (sender) await sender.replaceTrack(newTrack);
      stream.removeTrack(oldTrack);
      stream.addTrack(newTrack);
      oldTrack.stop();
      const activeId = trackDeviceId(newTrack) || deviceId;
      if (isAudio) setActiveMicId(activeId);
      else setActiveCameraId(activeId);
      return true;
    } catch {
      setCallError(isAudio ? 'Could not switch to that microphone.' : 'Could not switch to that camera.');
      return false;
    }
  }, []);

  const joinCall = useCallback(async () => {
    setCallError('');
    if (!socket?.connected) return setCallError('Realtime connection is unavailable. Reconnect and try again.');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) {
      return setCallError('This browser does not support secure audio/video calls.');
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (error) {
        if (!['NotAllowedError', 'NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setCallError('Camera is unavailable, so you joined with audio only. You can continue the call or enable a camera in your browser settings.');
      }
      try {
        const { iceServers } = await api.getIceServers();
        if (Array.isArray(iceServers) && iceServers.length) iceServersRef.current = iceServers;
      } catch {
        // Fall back to public STUN; the call can still connect on open networks.
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setMicrophoneEnabled(stream.getAudioTracks().some((track) => track.enabled));
      setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
      setActiveMicId(trackDeviceId(stream.getAudioTracks()[0]));
      setActiveCameraId(trackDeviceId(stream.getVideoTracks()[0]));
      refreshDevices();
      const callId = makeCallId();
      callIdRef.current = callId;
      await joinProjectRoom(socket, projectId);
      if (callIdRef.current !== callId) return;
      socket.emit('call:presence', { projectId, callId, state: 'joined' });
      setCallState('waiting');
    } catch (error) {
      setCallError(error.name === 'NotAllowedError' ? 'Camera and microphone access was not granted.' : 'Could not start your camera and microphone.');
      stopLocalTracks();
    }
  }, [projectId, refreshDevices, socket, stopLocalTracks]);

  const toggleMicrophone = () => {
    const nextEnabled = !microphoneEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = nextEnabled; });
    setMicrophoneEnabled(nextEnabled);
  };

  const toggleCamera = () => {
    const nextEnabled = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextEnabled; });
    setCameraEnabled(nextEnabled);
  };

  useEffect(() => {
    if (!socket || !projectId) return undefined;
    socket.emit('join-project', projectId);
    const onPresence = async ({ projectId: incomingProject, callId, userId, state }) => {
      if (incomingProject !== projectId || !userId || !callIdRef.current || callId === callIdRef.current) return;
      if (state === 'left') {
        if (remoteUserRef.current === userId) releasePeer();
        return;
      }
      if (state !== 'joined') return;
      // Already in a call with someone: ignore further participants.
      if (peerRef.current || remoteUserRef.current) return;
      try {
        const peer = ensurePeer(userId);
        isOffererRef.current = true;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit('call:signal', { projectId, callId: callIdRef.current, to: userId, signal: { type: 'offer', sdp: offer } });
      } catch { setCallError('Could not connect the call.'); }
    };
    const onSignal = async ({ projectId: incomingProject, callId, from, signal }) => {
      if (incomingProject !== projectId || !from || !callIdRef.current || callId === callIdRef.current) return;
      // Only the bound participant may negotiate; an offer may bind a new one.
      if (remoteUserRef.current && remoteUserRef.current !== from) return;
      if (!remoteUserRef.current && signal.type !== 'offer') return;
      try {
        if (signal.type === 'hangup') return leaveCall();
        if (signal.type === 'ice') {
          // A candidate for a superseded or ignored offer is harmless to drop.
          if (signal.candidate) await peerRef.current?.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
          return;
        }
        // A fresh (non-renegotiation) offer on an established peer means the
        // other side rebuilt its connection: start a new peer for it.
        if (signal.type === 'offer' && !signal.renegotiate && peerRef.current?.currentRemoteDescription) {
          const stale = peerRef.current;
          peerRef.current = null;
          resetRecovery();
          stale.close();
        }
        const fresh = !peerRef.current;
        const peer = ensurePeer(from);
        if (signal.type === 'offer') {
          if (fresh) isOffererRef.current = false;
          if (peer.signalingState !== 'stable') {
            // Glare: both sides offered at once. The side with the lower call
            // id yields and answers; the other ignores the incoming offer.
            if (callIdRef.current > callId) return;
            await peer.setLocalDescription({ type: 'rollback' });
            isOffererRef.current = false;
          }
          await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('call:signal', { projectId, callId: callIdRef.current, to: from, signal: { type: 'answer', sdp: answer } });
        } else if (signal.type === 'answer') {
          // Ignore a stale answer (e.g. to a restart offer already superseded).
          if (peer.signalingState !== 'have-local-offer') return;
          await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
      } catch { setCallError('The call negotiation failed. Leave and try again.'); }
    };
    // A brief network blip reconnects the socket with fresh rooms: rejoin the
    // project, re-announce presence, and finish any restart that was waiting.
    const onConnect = async () => {
      await joinProjectRoom(socket, projectId);
      setSignallingOffline(false);
      if (!callIdRef.current) return;
      socket.emit('call:presence', { projectId, callId: callIdRef.current, state: 'joined' });
      if (pendingRestartRef.current && peerRef.current) performIceRestart(peerRef.current);
    };
    const onDisconnect = () => { if (callIdRef.current) setSignallingOffline(true); };
    socket.on('call:presence', onPresence);
    socket.on('call:signal', onSignal);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:presence', onPresence);
      socket.off('call:signal', onSignal);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      leaveCall();
    };
  }, [ensurePeer, leaveCall, performIceRestart, projectId, releasePeer, resetRecovery, socket]);

  // If the active mic or camera is unplugged, fall back to the default device.
  const inCall = callState !== 'idle';
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!inCall || !mediaDevices?.addEventListener) return undefined;
    const onDeviceChange = async () => {
      const devices = await refreshDevices();
      const stream = localStreamRef.current;
      if (!stream) return;
      for (const [kind, track, name] of [['audioinput', stream.getAudioTracks()[0], 'microphone'], ['videoinput', stream.getVideoTracks()[0], 'camera']]) {
        if (!track) continue;
        const id = trackDeviceId(track);
        const present = track.readyState !== 'ended' && (!id || devices.some((device) => device.kind === kind && device.deviceId === id));
        if (present) continue;
        const fallback = pickFallbackDevice(devices, kind);
        if (fallback && await switchDevice(kind, fallback.deviceId)) {
          setCallNotice(`Your ${name} was disconnected, so the call switched to ${fallback.label || `the default ${name}`}.`);
        } else if (!fallback) {
          setCallError(`Your ${name} was disconnected and no other ${name} is available.`);
        }
      }
    };
    mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [inCall, refreshDevices, switchDevice]);

  // Local-only call quality: read getStats() while connected. Nothing is sent
  // to the server.
  useEffect(() => {
    const peer = peerRef.current;
    if (callState !== 'connected' || !peer?.getStats) return undefined;
    let previous = null;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const current = summarizeStats(await peer.getStats());
        if (cancelled) return;
        setCallQuality(classifyQuality(current, previous));
        previous = current;
      } catch {
        // Stats are advisory; a failed read keeps the last indicator.
      }
    }, STATS_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [callState]);

  const shareCallScreen = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (sender && track) await sender.replaceTrack(track);
      track.onended = () => {
        const camera = localStreamRef.current?.getVideoTracks()[0];
        if (sender && camera) sender.replaceTrack(camera);
      };
    } catch (error) {
      if (error.name !== 'NotAllowedError') setCallError('Screen share could not start.');
    }
  };

  const clearRecordingTimers = () => {
    clearInterval(recordingTimersRef.current.tick);
    clearTimeout(recordingTimersRef.current.limit);
    recordingTimersRef.current = {};
  };

  const stopRecording = () => recorderRef.current?.state === 'recording' && recorderRef.current.stop();

  const startRecording = async () => {
    setRecordingError('');
    setRecordingNotice('');
    if (!navigator.mediaDevices?.getDisplayMedia || !globalThis.MediaRecorder) {
      return setRecordingError('This browser does not support screen recording.');
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? { mimeType: 'video/webm;codecs=vp9,opus' } : undefined);
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onstop = async () => {
        clearRecordingTimers();
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (!blob.size) return setRecordingError('No recording data was captured.');
        if (blob.size > MAX_RECORDING_BYTES) return setRecordingError('This recording is over the 50 MB project upload limit. Record a shorter clip.');
        setUploading(true);
        try {
          const file = new File([blob], `screen-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, { type: 'video/webm' });
          await api.uploadAttachment(file, 'PROJECT', projectId);
          await refreshRecordings();
        } catch (error) { setRecordingError(error.message || 'Recording upload failed.'); }
        finally { setUploading(false); }
      };
      stream.getVideoTracks()[0].onended = stopRecording;
      recorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recorder.start(1000);
      setRecording(true);
      // Cap duration alongside the 50 MB size limit: count down, then stop and upload.
      const startedAt = Date.now();
      setRecordingRemainingMs(MAX_RECORDING_DURATION_MS);
      recordingTimersRef.current = {
        tick: setInterval(() => setRecordingRemainingMs(Math.max(0, MAX_RECORDING_DURATION_MS - (Date.now() - startedAt))), 1000),
        limit: setTimeout(() => {
          setRecordingNotice(`Recording reached the ${MAX_RECORDING_MINUTES}-minute limit, so it stopped and is being uploaded.`);
          stopRecording();
        }, MAX_RECORDING_DURATION_MS),
      };
    } catch (error) {
      if (error.name !== 'NotAllowedError') setRecordingError('Screen recording could not start.');
    }
  };

  useEffect(() => () => {
    clearInterval(recordingTimersRef.current.tick);
    clearTimeout(recordingTimersRef.current.limit);
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const callStatusText = callState === 'connected' ? 'Call connected'
    : callState === 'reconnecting' ? 'Reconnecting the call…'
      : 'Waiting for another project member to join…';
  const selectClass = 'min-h-11 max-w-full rounded-lg border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return <section className="bg-card rounded-xl border border-border" aria-label="Project media collaboration">
    <div className="border-b border-border px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-foreground flex items-center gap-2"><Radio className="w-5 h-5 text-primary" /> Live calls & recordings</h2><p className="mt-1 text-sm text-muted-foreground">Private to project members. Camera, microphone, and screen access always require your browser’s consent.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {recording && <p role="timer" aria-label={`Recording time left: ${formatDuration(recordingRemainingMs)}`} className="text-sm tabular-nums text-muted-foreground">{formatDuration(recordingRemainingMs)} left</p>}
        <button type="button" onClick={recording ? stopRecording : startRecording} disabled={uploading} className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={recording ? 'Stop and upload screen recording' : 'Record a project screen share'}><MonitorUp className="w-4 h-4" />{recording ? 'Stop recording' : uploading ? 'Uploading…' : 'Record screen'}</button>
        {callState === 'idle' ? <button type="button" onClick={joinCall} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Join project audio and video call"><Phone className="w-4 h-4" /> Join call</button> : <button type="button" onClick={leaveCall} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Leave project audio and video call"><PhoneOff className="w-4 h-4" /> Leave call</button>}
      </div>
    </div>
    <div className="p-5 space-y-4">
      {(recordingError || callError) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{recordingError || callError}</p>}
      {recordingNotice && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{recordingNotice}</p>}
      {callState !== 'idle' && <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{callStatusText}</p>
            {callState === 'connected' && <p role="status" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground" data-quality={callQuality}><Activity className={`w-3.5 h-3.5 ${callQuality === 'poor' ? 'text-destructive' : ''}`} aria-hidden="true" />Connection quality: {QUALITY_LABELS[callQuality]}</p>}
          </div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={toggleMicrophone} aria-pressed={microphoneEnabled} className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{microphoneEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}{microphoneEnabled ? 'Mute mic' : 'Unmute mic'}</button><button type="button" onClick={toggleCamera} aria-pressed={cameraEnabled} className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}{cameraEnabled ? 'Camera on' : 'Camera off'}</button>{callState === 'connected' && <button type="button" onClick={shareCallScreen} className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Share screen in call</button>}</div>
        </div>
        {(callNotice || signallingOffline) && <p role="status" className="mt-2 text-sm">{signallingOffline ? 'Realtime connection lost. Your call continues and will resync when the connection returns.' : callNotice}</p>}
        {(audioInputs.length > 0 || (videoInputs.length > 0 && activeCameraId)) && <div className="mt-3 flex flex-wrap gap-3">
          {audioInputs.length > 0 && <div className="flex flex-col gap-1"><label htmlFor={micSelectId} className="text-xs font-medium text-muted-foreground">Microphone</label><select id={micSelectId} value={activeMicId} onChange={(event) => switchDevice('audioinput', event.target.value)} className={selectClass}>{audioInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></div>}
          {videoInputs.length > 0 && activeCameraId && <div className="flex flex-col gap-1"><label htmlFor={cameraSelectId} className="text-xs font-medium text-muted-foreground">Camera</label><select id={cameraSelectId} value={activeCameraId} onChange={(event) => switchDevice('videoinput', event.target.value)} className={selectClass}>{videoInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></div>}
        </div>}
        <p className="mt-2 text-xs text-muted-foreground">Turn camera off for an audio-only call. Your microphone and camera remain under your control throughout the call.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><video ref={localVideoRef} muted autoPlay playsInline className="aspect-video w-full rounded-md bg-black object-cover" aria-label="Your camera preview" /><video ref={remoteVideoRef} autoPlay playsInline className="aspect-video w-full rounded-md bg-black object-cover" aria-label={remoteParticipant ? 'Call participant video' : 'Waiting for call participant video'} /></div></div>}
      <div><h3 className="text-sm font-medium text-foreground">Screen recordings</h3><p className="mt-1 text-xs text-muted-foreground">Record a browser tab, window, or screen with the audio your browser makes available. Recordings stop automatically after {MAX_RECORDING_MINUTES} minutes or 50 MB, then upload to this project; they require an authenticated project session to access.</p>{recordings.length ? <ul className="mt-3 space-y-2">{recordings.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span className="min-w-0 truncate">{item.originalName}</span><a className="min-h-11 inline-flex items-center rounded-lg px-3 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/api/attachments/uploads/${encodeURIComponent(item.filename)}`} target="_blank" rel="noreferrer">Watch</a></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No screen recordings yet.</p>}</div>
      <p className="text-xs text-muted-foreground"><Mic className="mr-1 inline w-3.5 h-3.5" /><Video className="mr-1 inline w-3.5 h-3.5" />Calls use encrypted WebRTC media. This first release uses public STUN for discovery; add a managed TURN service before relying on calls across restrictive corporate networks.</p>
    </div>
  </section>;
}
