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
  });

  it('uses authenticated project signalling for audio/video calls', () => {
    expect(media).toContain("socket.emit('join-project', projectId)");
    expect(media).toContain("socket.emit('call:signal'");
    expect(media).toContain('new RTCPeerConnection');
    expect(media).toContain('navigator.mediaDevices.getUserMedia');
  });

  it('places the controls in the real project workspace', () => {
    expect(project).toContain("import ProjectMedia from '../components/project/ProjectMedia'");
    expect(project).toContain('<ProjectMedia projectId={id} />');
  });
});
