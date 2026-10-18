import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Shell (Layout.jsx) source contracts: navigation, skip link, quick create,
// mobile menu, user actions and the shortcuts modal.

describe('layout-mobile-menu-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

  describe('layout mobile menu accessibility contract', () => {
    it('keeps More-menu theme and logout actions native and focus-visible', () => {
      expect(source).toContain('aria-label="Change theme"');
      expect(source).toContain('aria-label="Log out"');
      expect(source).toContain('role="menuitem"');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps mobile navigation and menu links at the touch-target minimum', () => {
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:outline-hidden');
    });
  });
});

describe('layout-route-discoverability-contract.test.js', () => {
  const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

  describe('shell route discoverability contract', () => {
    it('exposes registered chat and docs workflows in the primary shell navigation', () => {
      expect(layout).toContain("{ name: 'Chat', href: '/chat'");
      expect(layout).toContain("{ name: 'Docs', href: '/docs'");
      expect(layout).toContain("key: 'money', label: 'Money'");
    });

    it('exposes previously orphaned staff and admin workflows from the shell', () => {
      expect(layout).toContain("key: 'studio', label: 'Studio'");
      expect(layout).toContain("key: 'sales', label: 'Sales'");
      expect(layout).toContain("{ name: 'Assets', href: '/assets'");
      expect(layout).toContain("{ name: 'Project Planner', href: '/project-planner'");
      expect(layout).toContain("{ name: 'Templates', href: '/project-templates'");
      expect(layout).toContain("{ name: 'Semantic Search', href: '/semantic-search'");
      expect(layout).toContain("{ name: 'Approvals', href: '/approvals'");
      expect(layout).toContain("{ name: 'Retainers', href: '/retainers'");
      expect(layout).toContain("{ name: 'Invoice Chaser', href: '/invoice-chaser'");

      for (const path of [
        '/assets',
        '/project-planner',
        '/project-templates',
        '/semantic-search',
        '/approvals',
        '/retainers',
        '/invoice-chaser',
      ]) {
        expect(app).toContain(`path="${path}"`);
      }
    });

    it('keeps discoverable navigation links keyboard-visible', () => {
      expect(layout).toContain('flex min-h-11 items-center');
      expect(layout).toContain('focus-visible:outline-hidden focus-visible:ring-2');
    });
  });
});

describe('layout-shell-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

  describe('layout shell accessibility contract', () => {
    it('names and exposes collapsible navigation state', () => {
      expect(source).toContain('aria-expanded={show}');
      expect(source).toContain('aria-label={`${show ? \'Collapse\' : \'Expand\'} ${label}`}');
      expect(source).toContain('type="button"');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('keeps header and mobile controls named and touch-sized', () => {
      expect(source).toContain('aria-label={isDark ? \'Switch to light mode\' : \'Switch to dark mode\'}');
      expect(source).toContain('aria-label="Open Settings navigation options"');
      expect(source).toContain('aria-label="Dismiss install banner"');
    });

    it('keeps the skip link keyboard-visible and touch-sized', () => {
      expect(source).toContain('focus-visible:not-sr-only');
      expect(source).toContain('focus-visible:min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('makes quick-create controls named, native, and keyboard-visible', () => {
      expect(source).toContain('<span className="sr-only sm:not-sr-only">Create</span>');
      expect(source).not.toContain('aria-label="Create: open quick create menu"');
      expect(source).toContain('aria-label={label}');
      expect(source).toContain('role="menuitem"');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});

describe('layout-shortcuts-modal-contract.test.js', () => {
  const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

  describe('keyboard shortcuts dialog contract', () => {
    it('uses the shared focus-managed modal with a labelled title', () => {
      expect(layout).toContain("import Modal, { ModalFooter } from './Modal';");
      expect(layout).toMatch(/<Modal\s+isOpen\s+onClose=\{onClose\}\s+title="Keyboard Shortcuts"/);
    });

    it('uses the shared footer action instead of a bespoke overlay', () => {
      expect(layout).toContain('<ModalFooter>');
      expect(layout).not.toContain('z-[60] flex items-center justify-center bg-foreground/30');
    });
  });
});

describe('layout-user-actions-accessibility-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

  describe('layout user actions accessibility contract', () => {
    it('keeps collapsed and expanded logout controls native, named, and touch-sized', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-label="Logout"');
      expect(source).toContain('min-h-11 min-w-11');
    });

    it('keeps settings links keyboard-visible and touch-sized', () => {
      expect(source).toContain('aria-label="Settings"');
      expect(source).toContain('focus-visible:ring-2');
    });
  });
});
