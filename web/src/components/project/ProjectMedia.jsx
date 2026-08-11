import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MonitorUp, Phone, PhoneOff, Radio, Video } from 'lucide-react';
import { api } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const rtcConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function makeCallId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ProjectMedia({ projectId }) {
  const { socket } = useSocket();
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [callState, setCallState] = useState('idle');
  const [callError, setCallError] = useState('');
  const [remoteParticipant, setRemoteParticipant] = useState(false);
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const callIdRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

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

  const leaveCall = useCallback(() => {
    const callId = callIdRef.current;
    if (socket && callId) {
      socket.emit('call:signal', { projectId, callId, signal: { type: 'hangup' } });
      socket.emit('call:presence', { projectId, callId, state: 'left' });
    }
    peerRef.current?.close();
    peerRef.current = null;
    stopLocalTracks();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    callIdRef.current = null;
    setRemoteParticipant(false);
    setCallState('idle');
  }, [projectId, socket, stopLocalTracks]);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;
    const peer = new RTCPeerConnection(rtcConfiguration);
    localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && socket && callIdRef.current) {
        socket.emit('call:signal', { projectId, callId: callIdRef.current, signal: { type: 'ice', candidate } });
      }
    };
    peer.ontrack = ({ streams }) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = streams[0];
      setRemoteParticipant(true);
      setCallState('connected');
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) setRemoteParticipant(false);
    };
    peerRef.current = peer;
    return peer;
  }, [projectId, socket]);

  const joinCall = useCallback(async () => {
    setCallError('');
    if (!socket?.connected) return setCallError('Realtime connection is unavailable. Reconnect and try again.');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) {
      return setCallError('This browser does not support secure audio/video calls.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      const callId = makeCallId();
      callIdRef.current = callId;
      socket.emit('join-project', projectId);
      socket.emit('call:presence', { projectId, callId, state: 'joined' });
      setCallState('waiting');
    } catch (error) {
      setCallError(error.name === 'NotAllowedError' ? 'Camera and microphone access was not granted.' : 'Could not start your camera and microphone.');
      stopLocalTracks();
    }
  }, [projectId, socket, stopLocalTracks]);

  useEffect(() => {
    if (!socket || !projectId) return undefined;
    socket.emit('join-project', projectId);
    const onPresence = async ({ projectId: incomingProject, callId, state }) => {
      if (incomingProject !== projectId || state !== 'joined' || !callIdRef.current || callId === callIdRef.current) return;
      try {
        const peer = ensurePeer();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit('call:signal', { projectId, callId: callIdRef.current, signal: { type: 'offer', sdp: offer } });
      } catch { setCallError('Could not connect the call.'); }
    };
    const onSignal = async ({ projectId: incomingProject, callId, signal }) => {
      if (incomingProject !== projectId || !callIdRef.current || callId === callIdRef.current) return;
      try {
        if (signal.type === 'hangup') return leaveCall();
        const peer = ensurePeer();
        if (signal.type === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('call:signal', { projectId, callId: callIdRef.current, signal: { type: 'answer', sdp: answer } });
        } else if (signal.type === 'answer') await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        else if (signal.type === 'ice' && signal.candidate) await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch { setCallError('The call negotiation failed. Leave and try again.'); }
    };
    socket.on('call:presence', onPresence);
    socket.on('call:signal', onSignal);
    return () => {
      socket.off('call:presence', onPresence);
      socket.off('call:signal', onSignal);
      leaveCall();
    };
  }, [ensurePeer, leaveCall, projectId, socket]);

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

  const stopRecording = () => recorderRef.current?.state === 'recording' && recorderRef.current.stop();

  const startRecording = async () => {
    setRecordingError('');
    if (!navigator.mediaDevices?.getDisplayMedia || !globalThis.MediaRecorder) {
      return setRecordingError('This browser does not support screen recording.');
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? { mimeType: 'video/webm;codecs=vp9,opus' } : undefined);
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onstop = async () => {
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
    } catch (error) {
      if (error.name !== 'NotAllowedError') setRecordingError('Screen recording could not start.');
    }
  };

  useEffect(() => () => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return <section className="bg-card rounded-xl border border-border" aria-label="Project media collaboration">
    <div className="border-b border-border px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-foreground flex items-center gap-2"><Radio className="w-5 h-5 text-primary" /> Live calls & recordings</h2><p className="mt-1 text-sm text-muted-foreground">Private to project members. Camera, microphone, and screen access always require your browser’s consent.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={recording ? stopRecording : startRecording} disabled={uploading} className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={recording ? 'Stop and upload screen recording' : 'Record a project screen share'}><MonitorUp className="w-4 h-4" />{recording ? 'Stop recording' : uploading ? 'Uploading…' : 'Record screen'}</button>
        {callState === 'idle' ? <button type="button" onClick={joinCall} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Join project audio and video call"><Phone className="w-4 h-4" /> Join call</button> : <button type="button" onClick={leaveCall} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Leave project audio and video call"><PhoneOff className="w-4 h-4" /> Leave call</button>}
      </div>
    </div>
    <div className="p-5 space-y-4">
      {(recordingError || callError) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{recordingError || callError}</p>}
      {callState !== 'idle' && <div className="rounded-lg border border-border bg-muted/30 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{callState === 'connected' ? 'Call connected' : 'Waiting for another project member to join…'}</p>{callState === 'connected' && <button type="button" onClick={shareCallScreen} className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Share screen in call</button>}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><video ref={localVideoRef} muted autoPlay playsInline className="aspect-video w-full rounded-md bg-black object-cover" aria-label="Your camera preview" /><video ref={remoteVideoRef} autoPlay playsInline className="aspect-video w-full rounded-md bg-black object-cover" aria-label={remoteParticipant ? 'Call participant video' : 'Waiting for call participant video'} /></div></div>}
      <div><h3 className="text-sm font-medium text-foreground">Screen recordings</h3><p className="mt-1 text-xs text-muted-foreground">Recorded clips are uploaded to this project and require an authenticated project session to access.</p>{recordings.length ? <ul className="mt-3 space-y-2">{recordings.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span className="min-w-0 truncate">{item.originalName}</span><a className="min-h-11 inline-flex items-center rounded-lg px-3 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/api/attachments/uploads/${encodeURIComponent(item.filename)}`} target="_blank" rel="noreferrer">Watch</a></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No screen recordings yet.</p>}</div>
      <p className="text-xs text-muted-foreground"><Mic className="mr-1 inline w-3.5 h-3.5" /><Video className="mr-1 inline w-3.5 h-3.5" />Calls use encrypted WebRTC media. This first release uses public STUN for discovery; add a managed TURN service before relying on calls across restrictive corporate networks.</p>
    </div>
  </section>;
}
