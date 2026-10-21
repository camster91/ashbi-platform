import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Project page source contracts.

describe('project-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

  describe('project actions accessibility contract', () => {
    it('keeps project toolbar actions explicit and focus-visible', () => {
      expect(source).toContain('aria-label="Share project with client"');
      // Secondary actions (template, paste, refresh) live in a named overflow menu.
      expect(source).toContain('aria-label="More project actions"');
      expect(source).toContain("label: 'Apply template'");
      expect(source).toContain('aria-label="Draft project update"');
      expect(source).toContain('type="button"');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps revision and notes actions named and touch-sized', () => {
      expect(source).toContain('aria-label="New revision round"');
      expect(source).toContain('aria-label={`Approve revision');
      expect(source).toContain('aria-label="Create new note"');
      expect(source).toContain('min-h-11 min-w-11');
    });
  });
});

describe('project-chat-delivery-recovery-contract.test.js', () => {
  it('keeps a failed project-chat message available for an explicit retry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
    expect(source).toContain('sendError');
    expect(source).toContain('onClick={sendCurrent}');
    expect(source).toContain('Message not sent. Try again.');
  });

  // Chat media (docs/chat-media.md): files upload before the message is sent and
  // the send claims them atomically, so a failed send never leaves a message
  // without its files; the text and uploaded files stay in the composer (the
  // draft is cleared only on success) and "Try again" resends both.
  it('sends uploaded files with the message and clears them only after a successful send', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
    expect(source).toContain('api.uploadChatFile(projectId, file, options)');
    expect(source).toContain('attachmentIds.length ? { content, visibility, attachmentIds } : { content, visibility }');
    const onSuccess = source.slice(source.indexOf('onSuccess: (created'), source.indexOf('onError: (error)'));
    expect(onSuccess.indexOf('onSuccess')).toBe(0);
    // Only the files that were sent leave the tray (one added mid-send stays).
    expect(onSuccess).toContain('draft.clear(attachmentIds)');
    expect(source.slice(source.indexOf('onError: (error)'), source.indexOf('const canSend'))).not.toContain('draft.clear(');
    expect(source).not.toContain("api.uploadAttachment(retryAttachment, 'CHAT', messageId)");
  });
});

describe('project-communications-detail-contract.test.js', () => {
  const component = readFileSync(resolve(process.cwd(), 'src/components/project/ProjectCommunications.jsx'), 'utf8');
  const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');

  describe('project communications detail workflow', () => {
    it('loads the selected communication by project and communication id', () => {
      expect(api).toContain('getProjectCommunication: (projectId, communicationId)');
      expect(api).toContain('/communications/${communicationId}');
      expect(component).toContain("queryKey: ['project-communication-full', projectId, expandedId]");
      expect(component).toContain('api.getProjectCommunication(projectId, expandedId)');
      expect(component).not.toContain("enabled: false");
    });

    it('keeps list and selected-detail failures distinct and retryable', () => {
      expect(component).toContain("import QueryErrorState from '../QueryErrorState';");
      expect(component).toContain('communicationsError');
      expect(component).toContain('refetchCommunications');
      expect(component).toContain('detailError');
      expect(component).toContain('refetchDetail');
    });

    it('uses an accessible disclosure and semantic theme tokens', () => {
      expect(component).toContain('aria-expanded={isExpanded}');
      expect(component).toContain('aria-controls={`communication-${comm.id}-detail`}');
      expect(component).toContain('id={`communication-${comm.id}-detail`}');
      expect(component).not.toMatch(/(?:text|bg|border|hover:bg|hover:text)-(?:gray|blue|red|green)-\d+/);
      expect(component).not.toContain('bg-white');
      expect(component).toContain('focus-visible:ring-2');
    });
  });
});

describe('project-planner-mutation-feedback-contract.test.js', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/ProjectPlanner.jsx'), 'utf8');

  describe('project planner mutation feedback', () => {
    it('announces template save failures with the returned message', () => {
      expect(page).toContain('{saveTemplate.isError && (');
      expect(page).toContain('<p role="alert"');
      expect(page).toContain("{saveTemplate.error?.message || 'Failed to save template. Please try again.'}");
    });
  });
});

describe('project-task-category-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

  describe('project task category accessibility contract', () => {
    it('makes the task category disclosure keyboard-operable and named', () => {
      expect(source).toContain('role="button"');
      expect(source).toContain('tabIndex={0}');
      expect(source).toContain('aria-expanded={!isCollapsed}');
      expect(source).toContain('aria-label={`${isCollapsed ? \'Expand\' : \'Collapse\'} ${title} tasks`}');
      expect(source).toContain("e.key === 'Enter' || e.key === ' '");
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});
