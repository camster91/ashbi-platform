import { describe, expect, it } from 'vitest';
import fs, { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loading, error, retry and empty states on staff pages (one block per
// area). Finance pages: finance-workflow-state.contract.test.js.

describe('approval-queue-state-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(testDirectory, '../../pages/ApprovalQueue.jsx'), 'utf8');

  describe('Approval Queue workflow-state contract', () => {
    it('distinguishes named loading, failed, and empty collection states', () => {
      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
      expect(source).toContain("import { Button, LoadingState, StatusBadge } from '../components/ui'");
      expect(source).toContain('label="Loading approvals\u2026"');
      expect(source).toContain('<QueryErrorState');
      expect(source).toContain('onRetry={fetchApprovals}');
      expect(source).toMatch(/!loadError\s*&&\s*approvals\.length === 0/);
    });

    it('clears stale read errors before retry and blocks overlapping list requests', () => {
      expect(source).toContain('const [isFetching, setIsFetching] = useState(false)');
      expect(source).toContain('if (fetchingRef.current) return;');
      expect(source).toContain("setLoadError('')");
      expect(source).toContain('isRetrying={isFetching}');
    });

    it('stacks the list and detail panels on narrow screens', () => {
      expect(source).toContain('flex-col lg:flex-row');
      expect(source).toContain('w-full lg:w-80');
    });
  });
});

describe('contracts-workflow-state-contract.test.js', () => {
  const contracts = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

  describe('contracts workflow state contract', () => {
    it('distinguishes contract request failure from an empty collection', () => {
      expect(contracts).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(contracts).toMatch(/contracts = \[\][\s\S]*contractsError[\s\S]*refetchContracts[\s\S]*contractsFetching/);
      expect(contracts).toMatch(/contractsError\s*\?\s*\([\s\S]*<QueryErrorState/);
    });

    it('distinguishes proposal loading and failure from no approved proposals', () => {
      expect(contracts).toContain('proposalsLoading');
      expect(contracts).toContain('proposalsError');
      expect(contracts).toContain('refetchProposals');
      expect(contracts).toMatch(/proposalsLoading\s*\?\s*\([\s\S]*Loading approved proposals/);
      expect(contracts).toMatch(/proposalsError\s*\?\s*\([\s\S]*<QueryErrorState/);
    });
  });
});

describe('detail-workflow-state-contract.test.js', () => {
  const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

  describe('detail workflow states', () => {
    it.each([
      ['Client', 'clientError', 'refetchClient'],
      ['TaskPage', 'taskError', 'refetchTask'],
      ['Thread', 'threadError', 'refetchThread'],
    ])('%s distinguishes request failure from a missing record', (pageName, errorToken, retryToken) => {
      const page = readPage(pageName);
      expect(page).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(page).toContain(errorToken);
      expect(page).toContain(retryToken);
      expect(page).toMatch(new RegExp(`if \\(${errorToken}\\)[\\s\\S]*<QueryErrorState[\\s\\S]*if \\(!`));
    });

    it('keeps optional client insights and task breadcrumbs visibly recoverable', () => {
      const client = readPage('Client');
      const task = readPage('TaskPage');
      expect(client).toContain('insightsError');
      expect(client).toContain('refetchInsights');
      expect(task).toContain('breadcrumbsError');
      expect(task).toContain('refetchBreadcrumbs');
    });
  });
});

describe('docs-workflow-state-contract.test.js', () => {
  const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

  describe('document workflow states', () => {
    it('distinguishes a document request failure from an empty library', () => {
      expect(docs).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(docs).toContain('notesError');
      expect(docs).toContain('refetchNotes');
      expect(docs).toMatch(/notesError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*notes\.length === 0/);
    });

    it('makes form dependency failures recoverable without clearing the draft', () => {
      for (const token of [
        'projectsError',
        'templatesError',
        'teamError',
        'retryNoteFormData',
        'noteFormDataFetching',
      ]) {
        expect(docs).toContain(token);
      }
      expect(docs).toMatch(/showNewNote[\s\S]*noteFormDataError[\s\S]*<QueryErrorState/);
    });
  });
});

describe('manual-load-error-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceRoot = path.resolve(testDirectory, '../..');

  function readPage(name) {
    return fs.readFileSync(path.join(sourceRoot, 'pages', name), 'utf8');
  }

  describe('manual request failure contract', () => {
    it('Chat distinguishes failed conversation and message loads from empty results', () => {
      const source = readPage('Chat.jsx');

      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
      expect(source).toContain('conversationError');
      expect(source).toContain('messageError');
      expect(source).toContain('onRetry={loadConversations}');
      expect(source).toContain('onRetry={() => loadMessages(activeId)}');
    });

    it('Chat exposes separate named controls for opening and deleting a conversation', () => {
      const source = readPage('Chat.jsx');

      expect(source).not.toContain('<button\n                        key={c.id}');
      expect(source).toContain('aria-label={`Delete ${c.title}`}');
      expect(source).toContain('onClick={() => loadMessages(c.id)}');
    });

    it('Trash distinguishes a failed load from an empty trash', () => {
      const source = readPage('Trash.jsx');

      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
      expect(source).toContain('loadError');
      expect(source).toContain('onRetry={loadTrash}');
      expect(source).toMatch(/!loading\s*&&\s*!loadError\s*&&\s*filtered\.length === 0/);
    });

    it('Trash reports operation failures and prevents duplicate destructive requests', () => {
      const source = readPage('Trash.jsx');

      expect(source).toContain('operationError');
      expect(source).toContain('pendingAction');
      expect(source).toContain('role="alert"');
      expect(source).toContain("loading={pendingAction === `restore:${confirmRestore.id}`}");
      expect(source).toContain("loading={pendingAction === `delete:${confirmDelete.id}`}");
      expect(source).toContain("loading={pendingAction === 'empty'}");
      expect(source).toContain('aria-label={`Restore ${item.typeLabel}: ${item.title}`}');
      expect(source).toContain('aria-label={`Permanently delete ${item.typeLabel}: ${item.title}`}');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).not.toContain("console.error('Restore failed:'");
      expect(source).not.toContain("console.error('Permanent delete failed:'");
      expect(source).not.toContain("console.error('Empty trash failed:'");
    });
  });
});

describe('notifications-workflow-state-contract.test.js', () => {
  const notifications = readFileSync(resolve(process.cwd(), 'src/pages/Notifications.jsx'), 'utf8');

  describe('notifications workflow state contract', () => {
    it('distinguishes a failed list request from a truly empty inbox', () => {
      expect(notifications).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(notifications).toMatch(/isError[\s\S]*error[\s\S]*refetch[\s\S]*isFetching/);
      expect(notifications).toMatch(/isError\s*\?\s*\([\s\S]*<QueryErrorState/);
    });

    it('announces mutation failures without claiming notifications changed', () => {
      expect(notifications).toContain('markReadMutation.isError');
      expect(notifications).toContain('markAllReadMutation.isError');
      expect(notifications.match(/role="alert"/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('prevents duplicate mark-read writes and names the icon action', () => {
      expect(notifications).toContain('disabled={markReadMutation.isPending}');
      expect(notifications).toContain('aria-label="Mark notification as read"');
      expect(notifications.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
      expect(notifications).toContain('min-h-11 min-w-11');
    });
  });
});

describe('projects-workflow-state-contract.test.js', () => {
  const projects = readFileSync(resolve(process.cwd(), 'src/pages/Projects.jsx'), 'utf8');

  describe('projects workflow state contract', () => {
    it('shows a retryable request failure instead of an empty Kanban', () => {
      expect(projects).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(projects).toMatch(/isError[\s\S]*error[\s\S]*refetch[\s\S]*isFetching/);
      expect(projects).toMatch(/if \(isError\)[\s\S]*<QueryErrorState/);
    });

    it('does not retain the obsolete hardcoded project fallback', () => {
      expect(projects).not.toContain('ASHBI_DESIGN_PROJECTS');
      expect(projects).not.toMatch(/id:\s*'ashbi-[1-8]'/);
    });
  });
});

describe('query-error-page-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceRoot = path.resolve(testDirectory, '../..');

  const retryablePages = [
    'pages/Automations.jsx',
    'pages/TaskKanban.jsx',
  ];

  describe('retryable page query-error contract', () => {
    it.each(retryablePages)('%s uses QueryErrorState with retry progress', (relativePath) => {
      const source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
      expect(source).toContain('<QueryErrorState');
      expect(source).toMatch(/onRetry=\{(?:\(\) => )?refetch/);
      expect(source).toContain('isRetrying={isFetching}');
    });
  });
});

describe('schedule-workflow-state-contract.test.js', () => {
  const schedule = readFileSync(resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

  describe('schedule workflow states', () => {
    it('makes calendar and upcoming-event failures visible and retryable', () => {
      expect(schedule).toContain("import QueryErrorState from '../components/QueryErrorState';");
      for (const token of [
        'calendarError',
        'refetchCalendar',
        'upcomingError',
        'refetchUpcoming',
      ]) {
        expect(schedule).toContain(token);
      }
      expect(schedule.match(/<QueryErrorState/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('makes project and teammate form dependencies jointly recoverable', () => {
      for (const token of [
        'projectsError',
        'teamError',
        'eventFormDataError',
        'retryEventFormData',
        'eventFormDataFetching',
      ]) {
        expect(schedule).toContain(token);
      }
      expect(schedule).toMatch(/function EventModal\([\s\S]*eventFormDataError[\s\S]*<QueryErrorState/);
    });
  });
});

describe('settings-workflow-state-contract.test.js', () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(testDirectory, '../../pages/Settings.jsx'), 'utf8');

  describe('Settings workflow-state contract', () => {
    it('uses shared named loading and retryable error states for AI settings', () => {
      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
      expect(source).toContain('LoadingState');
      expect(source).toContain('label="Loading AI model settings…"');
      expect(source).toContain('message="Failed to load AI model settings"');
      expect(source).toContain('refetchAIProvider');
      expect(source).toContain('refetchModels');
    });

    it('does not render a false empty API-key state after a failed request', () => {
      expect(source).toContain('keysError');
      expect(source).toContain('message="Failed to load API keys"');
      expect(source).toContain('onRetry={refetchKeys}');
      expect(source).toMatch(/!keysError\s*&&\s*keysData\.keys\.length === 0/);
    });

    it('announces API-key mutation failures and prevents duplicate revocation', () => {
      expect(source).toContain('error={deleteMutation.error?.message}');
      expect(source).toContain('pending={deleteMutation.isPending}');
      expect(source).toContain('title="Revoke API key"');
      expect(source).toContain('role="alert"');
      expect(source).toContain('disabled={deleteMutation.isPending}');
      expect(source).toContain('aria-label={`Revoke ${key.name}`}');
    });
  });
});

describe('time-workflow-state-contract.test.js', () => {
  const timesheets = readFileSync(resolve(process.cwd(), 'src/pages/Timesheets.jsx'), 'utf8');
  const tracking = readFileSync(resolve(process.cwd(), 'src/pages/TimeTracking.jsx'), 'utf8');

  describe('time workflow states', () => {
    it('distinguishes a weekly timesheet failure from a zero-hour week', () => {
      expect(timesheets).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(timesheets).toContain('timesheetsError');
      expect(timesheets).toContain('refetchTimesheets');
      expect(timesheets).toMatch(/timesheetsError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*timesheets\.length === 0/);
    });

    it('keeps time-entry and project-context failures visible and retryable', () => {
      expect(tracking).toContain("import QueryErrorState from '../components/QueryErrorState';");
      for (const token of ['entriesError', 'refetchEntries', 'projectError', 'refetchProject']) {
        expect(tracking).toContain(token);
      }
      expect(tracking).toMatch(/entriesError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*entries\.length === 0/);
    });
  });
});

describe('Gmail reply workflow contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Thread.jsx'), 'utf8');
  it('uses the shared modal and protects an uncertain send', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showGmailReply}');
    expect(source).toContain('if (gmailSendMutation.isPending) return;');
    expect(source).not.toContain('className="fixed inset-0 z-50 flex items-end');
  });

  it('labels required fields and uses native form submission', () => {
    for (const id of ['gmail-reply-to', 'gmail-reply-subject', 'gmail-reply-message']) {
      expect(source).toContain(`htmlFor="${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
    expect(source).toContain('type="submit"');
    expect(source).toContain('required');
  });

  it('keeps draft and send failures visible and announced', () => {
    expect(source).toContain('gmailDraftMutation.error');
    expect(source).toContain('gmailSendMutation.error');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Your draft is still available');
  });
});

describe('Client Brain workflow contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SemanticSearch.jsx'), 'utf8');
  it('does not seed fabricated client knowledge and sends the backend source contract', () => {
    expect(source).not.toContain('Client prefers modern');
    expect(source).not.toContain('Project timeline: 8 weeks');
    expect(source).not.toContain('Budget range: $5,000');
    expect(source).toContain('source: indexDoc.source');
    expect(source).not.toContain('sourceType: doc.source');
  });

  it('uses the shared dialog with preserved input and pending dismissal protection', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showIndex}');
    expect(source).toContain('if (indexMutation.isPending) return;');
    expect(source).toContain('indexMutation.error');
    expect(source).not.toContain('role="button" tabIndex={0}');
  });

  it('distinguishes search and stats failures from empty states and announces rebuild outcomes', () => {
    expect(source).toContain('searchError');
    expect(source).toContain('statsError');
    expect(source).toContain('hasSearched');
    expect(source).toContain('rebuildMutation.error');
    expect(source).toContain('rebuildMutation.data');
  });
});
