import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Page action contracts: named, native, touch-sized and focus-visible
// controls on staff pages (one block per page).

describe('ai-context-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/AiContextSettings.jsx'), 'utf8');

  describe('AI context settings actions accessibility contract', () => {
    it('keeps add, save, and cancel actions native, touch-sized, and focus-visible', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
      expect(source).toContain('Close new context form');
    });

    it('names edit and delete actions for the affected context entry', () => {
      expect(source).toContain('aria-label={`Edit AI context ${item.key}`}');
      expect(source).toContain('aria-label={`Delete AI context ${item.key}`}');
    });
  });
});

describe('auth-recovery-accessibility-contract.test.js', () => {
  const login = readFileSync(resolve(process.cwd(), 'src/pages/Login.jsx'), 'utf8');
  const forgot = readFileSync(resolve(process.cwd(), 'src/pages/ForgotPassword.jsx'), 'utf8');

  describe('authentication recovery accessibility contract', () => {
    it('keeps password visibility controls touch-sized and visibly focused', () => {
      expect(login).toContain('aria-label={showPassword ?');
      expect(login).toContain('min-h-11 min-w-11');
      expect(login).toContain('focus-visible:outline-hidden');
    });

    it('keeps recovery navigation actions explicit and visibly focused', () => {
      expect(forgot).toContain('type="button"');
      expect(forgot).toContain('focus-visible:ring-2');
    });
  });
});

describe('automation-approval-actions-accessibility-contract.test.js', () => {
  const automations = readFileSync(resolve(process.cwd(), 'src/pages/Automations.jsx'), 'utf8');
  const approvals = readFileSync(resolve(process.cwd(), 'src/pages/ApprovalQueue.jsx'), 'utf8');

  describe('automation and approval actions accessibility contract', () => {
    it('keeps automation pagination named, typed, focused, and touch-sized', () => {
      expect(automations).toContain('aria-label="Previous automation page"');
      expect(automations).toContain('aria-label="Next automation page"');
      expect(automations).toContain('min-h-11 min-w-11');
      expect(automations).toContain('focus-visible:ring-2');
    });

    it('names approval selection controls and exposes their state', () => {
      expect(approvals).toContain('type="button"');
      expect(approvals).toContain('aria-label={`');
      expect(approvals).toContain('aria-expanded={isSelected}');
      expect(approvals).toContain('focus-visible:ring-2');
    });
  });
});

describe('calendar-toolbar-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/Calendar.jsx'), 'utf8');

  describe('calendar toolbar accessibility contract', () => {
    it('names and sizes calendar navigation actions', () => {
      expect(source).toContain('aria-label="Go to today"');
      expect(source).toContain('aria-label="Previous month"');
      expect(source).toContain('aria-label="Next month"');
      expect(source).toContain('aria-label="New Event (create calendar event)"');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps toolbar controls explicit buttons', () => {
      expect(source).toContain('type="button"');
    });
  });
});

describe('chat-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Chat.jsx'), 'utf8');

  describe('chat actions accessibility contract', () => {
    it('keeps conversation selection and suggestions named and touch-sized', () => {
      expect(source).toContain('aria-label={`Open conversation ${c.title}`}');
      expect(source).toContain('aria-label={`Use suggestion: ${s}`}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps chat action buttons explicit', () => {
      expect(source).toContain('type="button"');
    });
  });
});

describe('clients-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Clients.jsx'), 'utf8');

  describe('clients actions accessibility contract', () => {
    it('keeps client toolbar and onboarding controls explicit and focused', () => {
      expect(source).toContain('aria-label="Toggle client health"');
      expect(source).toContain('aria-label="Close client onboarding"');
      expect(source).toContain('type="button"');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps client health and expansion actions named and touch-sized', () => {
      expect(source).toContain('aria-label={`Open client health for');
      expect(source).toContain('aria-expanded={isExpanded}');
      expect(source).toContain("isExpanded ? 'Collapse client ' : 'Expand client '");
      expect(source).toContain('min-h-11 min-w-11');
    });
  });
});

describe('contracts-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

  describe('contracts actions accessibility contract', () => {
    it('keeps create-form cancellation from submitting and names the AI result copy action', () => {
      expect(source).toContain('<Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>');
      expect(source).toContain('aria-label="Copy AI result to clipboard"');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('exposes state and entity names for contract controls', () => {
      expect(source).toContain('aria-expanded={isExpanded}');
      expect(source).toContain('aria-label={`${isExpanded ? \'Collapse\' : \'Expand\'} contract ${contract.title}`}');
      expect(source).toContain('aria-label={`Refine contract ${contract.title} with AI`}');
      expect(source).toContain('aria-label={`Copy signing link for ${contract.title}`}');
    });
  });
});

describe('docs-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

  describe('docs actions accessibility contract', () => {
    it('keeps search, type filters, and note form dismissal named and touch-sized', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-label="Clear note search"');
      expect(source).toContain('aria-label="Close new document form"');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('names project and note expansion controls', () => {
      expect(source).toContain('<span className="sr-only">Toggle project </span>');
      expect(source).not.toContain('aria-label={`Toggle project');
      expect(source).toContain('aria-label={`Toggle note ${note.title}`}');
    });
  });
});

describe('estimate-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Estimates.jsx'), 'utf8');

  describe('estimate actions accessibility contract', () => {
    it('keeps estimate filters explicit and keyboard-visible', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-pressed={filterStatus === s}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('names both line-item removal and add-item actions', () => {
      expect(source).toContain('aria-label={`Remove estimate line item ${idx + 1}`');
      expect(source).toContain('aria-label="Add estimate line item"');
      expect(source).toContain('min-h-11 min-w-11');
    });
  });
});

describe('global-ai-chat-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/GlobalAIChat.jsx'), 'utf8');

  describe('global AI chat accessibility contract', () => {
    it('keeps the launcher and drawer named with explicit state', () => {
      expect(source).toContain('aria-expanded={isOpen}');
      expect(source).toContain('aria-controls="global-ai-chat-drawer"');
      expect(source).toContain('role="dialog"');
      expect(source).toContain('aria-labelledby="global-ai-chat-title"');
    });

    it('keeps chat controls touch-sized, focus-visible, and pending-aware', () => {
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('aria-label="Ask Ash about your work"');
      expect(source).toContain('aria-busy={isLoading}');
      expect(source).toContain('focus-visible:outline-hidden focus-visible:ring-2');
    });
  });
});

describe('global-search-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/GlobalSearch.jsx'), 'utf8');

  describe('global search actions accessibility contract', () => {
    it('keeps filters explicit, keyboard-visible, and touch-sized', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-pressed={filter === f.value}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('gives each search result a descriptive accessible name', () => {
      expect(source).toContain('aria-label={`Open ${result.type}');
      expect(source).toContain('w-full min-h-11');
    });
  });
});

describe('invoice-line-item-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');

  describe('invoice line-item actions accessibility contract', () => {
    it('keeps template and add-item actions explicit and focus-visible', () => {
      expect(source).toContain('aria-label={`Apply invoice template');
      expect(source).toContain('aria-label="Add invoice line item"');
      expect(source).toContain('focus-visible:ring-2');
      expect(source).toContain('min-h-11');
    });

    it('names both desktop and mobile line-item removal controls', () => {
      expect(source).toContain('aria-label={`Remove line item ${idx + 1}`');
      expect(source).toContain('min-h-11 min-w-11');
    });
  });
});

describe('invoices-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');

  describe('invoices accessibility contract', () => {
    it('keeps tabs and status filters native and state-announced', () => {
      // The views use the Tabs primitive (tablist/tab/tabpanel roles, arrow keys).
      expect(source).toContain('<Tabs value={activeTab} onValueChange={setActiveTab}');
      expect(source).toContain('<TabList aria-label="Invoice views">');
      expect(source).toContain('<TabPanel value="list"');
      expect(source).toContain('<TabPanel value="collections"');
      expect(source).toContain('aria-pressed={filterStatus === s}');
      expect(source).toContain('type="button"');
    });

    it('keeps invoice row actions named, focused, and touch-sized', () => {
      expect(source).toContain('aria-label="View invoice"');
      expect(source).toContain('aria-label="Void invoice"');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('notes-action-accessibility-contract.test.js', () => {
  const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');
  const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

  describe('notes action accessibility contract', () => {
    it.each([
      ['Project Notes', project],
      ['Docs NoteCard', docs],
    ])('%s gives every icon action a named 44px keyboard target', (_surface, source) => {
      expect(source).toContain("aria-label={`${note.isPinned ? 'Unpin' : 'Pin'} ${note.title}`}");
      expect(source).toContain('aria-label={`Edit ${note.title}`}');
      expect(source).toContain('aria-label={`Delete ${note.title}`}');
      expect(source).toContain('min-h-11 min-w-11');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('notifications-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/NotificationsDropdown.jsx'), 'utf8');

  describe('notifications accessibility contract', () => {
    it('keeps notification actions native, named, and touch-sized', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-label={`Notifications');
      expect(source).toContain('aria-label="Mark as read"');
      expect(source).toContain('min-h-11 min-w-11');
    });

    it('keeps notification rows keyboard operable without nested interactive controls', () => {
      expect(source).toContain('role="button"');
      expect(source).toContain('onKeyDown={(event) => {');
      expect(source).not.toContain('<button\n                        onClick={() => handleNotificationClick(notification)}');
    });
  });
});

describe('notifications-page-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Notifications.jsx'), 'utf8');

  describe('notifications page accessibility contract', () => {
    it('keeps notification actions explicit, named, and touch-sized', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-label="Mark notification as read"');
      expect(source).toContain('min-h-11 min-w-11');
    });

    it('keeps visible focus treatment on notification actions', () => {
      expect(source).toContain('focus-visible:outline-hidden');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('pipeline-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Pipeline.jsx'), 'utf8');

  describe('pipeline actions accessibility contract', () => {
    it('names and sizes deal action popovers', () => {
      expect(source).toContain('aria-label={`Move ${deal.title} to another stage`}');
      expect(source).toContain('aria-label={`Show AI lead score for ${deal.title}`}');
      expect(source).toContain('role="menuitem"');
      expect(source).toContain('min-h-11 min-w-11');
    });

    it('keeps deal row actions visible while one of them has keyboard focus', () => {
      expect(source).toContain('group-focus-within:opacity-100');
      expect(source).toContain('aria-label={`Delete ${deal.title}`}');
    });

    it('exposes expanded state on the stage toggles (one toggle per stage, all breakpoints)', () => {
      expect(source).toContain('aria-expanded={isOpen}');
      expect(source).toContain('aria-controls={isOpen ? panelId : undefined}');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('proposal-contract-accessibility-contract.test.js', () => {
  const proposals = readFileSync(resolve(process.cwd(), 'src/pages/Proposals.jsx'), 'utf8');
  const contracts = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

  describe('proposal and contract accessibility contract', () => {
    it('keeps proposal actions explicit, named, and focus-visible', () => {
      expect(proposals).toContain('type="button"');
      expect(proposals).toContain('aria-pressed={filterStatus === s}');
      expect(proposals).toContain('aria-label="Close proposal generator"');
      expect(proposals).toContain('focus-visible:ring-2');
    });

    it('keeps contract filters and proposal picker keyboard-safe', () => {
      expect(contracts).toContain('aria-pressed={filterStatus === s}');
      expect(contracts).toContain('type="button"');
      expect(contracts).toContain('focus-visible:outline-hidden');
      expect(contracts).toContain('min-h-11');
    });
  });
});

describe('retainers-expenses-accessibility-contract.test.js', () => {
  const retainers = readFileSync(resolve(process.cwd(), 'src/pages/Retainers.jsx'), 'utf8');
  const expenses = readFileSync(resolve(process.cwd(), 'src/pages/Expenses.jsx'), 'utf8');

  describe('retainers and expenses accessibility contract', () => {
    it('keeps retainer controls explicit, named, and focus-visible', () => {
      expect(retainers).toContain('aria-label="Close retainer form"');
      expect(retainers).toContain('aria-label="Generate monthly invoice"');
      expect(retainers).toContain('aria-label={`Edit retainer');
      expect(retainers).toContain('min-h-11 min-w-11');
      expect(retainers).toContain('focus-visible:ring-2');
    });

    it('keeps expense filter and form controls keyboard-safe', () => {
      expect(expenses).toContain('aria-label="Clear expense filters"');
      expect(expenses).toContain('aria-label="Close expense form"');
      expect(expenses).toContain('type="button"');
      expect(expenses).toContain('focus-visible:outline-hidden');
    });
  });
});
