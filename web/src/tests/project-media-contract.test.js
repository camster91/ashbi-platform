import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const media = readFileSync(resolve(process.cwd(), 'src/components/project/ProjectMedia.jsx'), 'utf8');
const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

describe('project media collaboration contract', () => {
  it('exposes a project-scoped screen recording flow with a bounded upload', () => {
    expect(media).toContain('navigator.mediaDevices.getDisplayMedia');
    expect(media).toContain('new MediaRecorder');
    expect(media).toContain("api.uploadAttachment(file, 'PROJECT', projectId)");
    expect(media).toContain('MAX_RECORDING_BYTES');
    expect(media).toContain('MAX_RECORDING_DURATION_MS');
  });

  it('uses authenticated project signalling for audio/video calls', () => {
    expect(media).toContain("socket.emit('join-project', projectId)");
    expect(media).toContain("socket.emit('call:signal'");
    expect(media).toContain('new RTCPeerConnection');
    expect(media).toContain('navigator.mediaDevices.getUserMedia');
    expect(media).toContain("getUserMedia({ video: false, audio: true })");
    expect(media).toContain('toggleMicrophone');
    expect(media).toContain('toggleCamera');
  });

  it('addresses every call signal to one bound participant and uses server ICE config', () => {
    const emits = media.match(/socket\.emit\('call:signal', \{[^}]*\}/g) || [];
    expect(emits.length).toBeGreaterThan(0);
    for (const emit of emits) expect(emit).toMatch(/\bto: /);
    expect(media).toContain('remoteUserRef.current !== from');
    expect(media).toContain('api.getIceServers()');
    // A participant who leaves or disconnects without a hangup releases the binding.
    expect(media).toContain("if (remoteUserRef.current === userId) releasePeer();");
    expect(media).toContain("} else if (state === 'closed') {");
    // A failed or long-disconnected peer is recovered by a bounded ICE restart first.
    expect(media).toContain('createOffer({ iceRestart: true })');
    expect(media).toContain('MAX_ICE_RESTART_ATTEMPTS');
    expect(media).not.toContain("iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }");
  });

  it('places the controls in the real project workspace', () => {
    expect(project).toContain("import ProjectMedia from '../components/project/ProjectMedia'");
    expect(project).toContain('<ProjectMedia projectId={id} />');
  });
});
