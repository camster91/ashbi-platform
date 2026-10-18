import fs, { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

// Project page dialogs, media, templates and chat discoverability.

describe('project-chat-discoverability-contract.test.js', () => {
  const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

  describe('project chat discoverability', () => {
    it('mounts the realtime project conversation in the staff project workspace', () => {
      expect(project).toContain("import ProjectChat from '../components/ProjectChat'");
      expect(project).toContain('<ProjectChat key={id} projectId={id} />');
      expect(project).toContain('Project conversation');
    });
  });
});

describe('project-dialog-state-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(testDirectory, '../pages/Project.jsx'), 'utf8');

  describe('Project dialog workflow-state contract', () => {
    it('uses the shared dialog primitive for all three workflows', () => {
      expect(source).toContain("import Modal from '../components/Modal'");
      expect(source.match(/<Modal\b/g)).toHaveLength(3);
      expect(source).not.toContain('className="fixed inset-0 bg-black/');
    });

    it('associates draft and pasted-message fields with visible labels', () => {
      expect(source).toContain('htmlFor="draft-update-notes"');
      expect(source).toContain('id="draft-update-notes"');
      expect(source).toContain('htmlFor="paste-message-source"');
      expect(source).toContain('id="paste-message-source"');
      expect(source).toContain('htmlFor="paste-message-content"');
      expect(source).toContain('id="paste-message-content"');
    });

    it('makes template loading/failure distinct and retryable', () => {
      expect(source).toContain('templatesLoading');
      expect(source).toContain('templatesError');
      expect(source).toContain('refetchTemplates');
      expect(source).toContain('label="Loading task templates…"');
      expect(source).toContain('message="Failed to load task templates"');
    });

    it('keeps pending dialogs open and exposes mutation failures inline', () => {
      expect(source).toContain('if (draftUpdateMutation.isPending) return;');
      expect(source).toContain('if (applyTemplateMutation.isPending) return;');
      expect(source).toContain('if (pasteMutation.isPending) return;');
      expect(source.match(/role="alert"/g).length).toBeGreaterThanOrEqual(3);
    });

    it('reports clipboard success only after the browser confirms the write', () => {
      expect(source).toContain('async function copyPortalLink()');
      expect(source).toContain('async function copyDraftUpdate()');
      expect(source.match(/await navigator\.clipboard\.writeText/g)).toHaveLength(2);
      expect(source).toContain("toast.error('Portal link could not be copied')");
      expect(source).toContain("toast.error('Draft could not be copied')");
    });
  });
});

describe('project-media-contract.test.js', () => {
  const media = readFileSync(resolve(process.cwd(), 'src/components/project/ProjectMedia.jsx'), 'utf8');
  // The recorder itself is shared with the chat capture dialog (docs/chat-media.md).
  const recorderLib = readFileSync(resolve(process.cwd(), 'src/lib/media-recorder.js'), 'utf8');
  const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

  describe('project media collaboration contract', () => {
    it('exposes a project-scoped screen recording flow with a bounded upload', () => {
      expect(media).toContain('navigator.mediaDevices.getDisplayMedia');
      expect(media).toContain('startCappedRecording(stream');
      expect(recorderLib).toContain('Recorder = globalThis.MediaRecorder');
      expect(recorderLib).toContain('new Recorder(stream');
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
});

describe('project-templates-workflow-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(testDirectory, '../pages/ProjectTemplates.jsx'), 'utf8');

  describe('Project Templates workflow contract', () => {
    it('uses shared loading, error, empty, and dialog primitives', () => {
      expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
      expect(source).toContain('LoadingState');
      expect(source).toContain('templatesError');
      expect(source).toContain('message="Failed to load project templates"');
      expect(source).toContain('isOpen={showCreateDialog}');
      expect(source).not.toContain('className="fixed inset-0');
    });

    it('distinguishes client loading/failure and preserves create input', () => {
      expect(source).toContain('clientsLoading');
      expect(source).toContain('clientsError');
      expect(source).toContain('message="Failed to load clients"');
      expect(source).toContain('if (createFromTemplate.isPending) return;');
      expect(source).toContain('role="alert"');
    });

    it('labels fields and protects template deletion from duplicate requests', () => {
      expect(source).toContain('htmlFor="template-project-name"');
      expect(source).toContain('htmlFor="template-project-client"');
      expect(source).toContain('aria-label={`Delete template ${template.name}`}');
      expect(source).toContain('disabled={deleteTemplate.isPending}');
      expect(source).toContain('min-h-11 min-w-11');
    });
  });
});
