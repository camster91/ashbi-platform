import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Light public portal pages (#317, #118). They now use design tokens (card
// surfaces on the cream background). The root `.dark` class follows the OS
// preference even on public pages, so each page calls usePortalLightTheme()
// to pin the light token set while mounted; otherwise `text-muted-foreground`
// would flip to a light colour. PortalIntakeForm is intentionally excluded:
// it is a dark (slate-950/900) page where slate-300/400 text is the
// high-contrast choice (it is on the raw-colour allowlist).
const LIGHT_PORTAL_PAGES = [
  'src/pages/Portal.jsx',
  'src/pages/PortalBooking.jsx',
  'src/pages/PortalContract.jsx',
  'src/pages/PortalEstimate.jsx',
  'src/pages/PortalInvoice.jsx',
  'src/pages/PortalProposal.jsx',
];

const SHELL_COMPONENTS = [
  'src/components/KanbanBoard.jsx',
  'src/components/Milestones.jsx',
  'src/components/Notes.jsx',
  'src/components/ProjectChat.jsx',
];

const TAILWIND = {
  white: 'ffffff',
  'slate-50': 'f8fafc',
  'slate-100': 'f1f5f9',
  'slate-500': '64748b',
  'slate-600': '475569',
  'gray-100': 'f3f4f6',
  'gray-500': '6b7280',
  'gray-600': '4b5563',
};

function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground, background) {
  const a = luminance(TAILWIND[foreground]);
  const b = luminance(TAILWIND[background]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Matches the bare utility and prefixed variants (placeholder:, hover:), but
// not dark: variants, which render on dark surfaces.
const LOW_CONTRAST = /(?<!dark:)\btext-(?:gray|slate)-(?:300|400)\b/;

describe('portal and shell muted text contrast (#317)', () => {
  it.each([...LIGHT_PORTAL_PAGES, ...SHELL_COMPONENTS])('%s has no light-gray text on light surfaces', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    const offenders = source.split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => LOW_CONTRAST.test(line))
      .map(([lineNumber, line]) => `${file}:${lineNumber}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it.each(LIGHT_PORTAL_PAGES)('%s pins the light token set', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toContain("import usePortalLightTheme from '../hooks/usePortalLightTheme';");
    expect(source).toMatch(/export default function \w+\([^)]*\) \{\r?\n {2}usePortalLightTheme\(\);/);
  });

  it.each([
    ['slate-500', 'white'],
    ['slate-500', 'slate-50'],
    ['slate-600', 'slate-100'],
    ['gray-500', 'white'],
    ['gray-600', 'gray-100'],
  ])('replacement %s on %s meets 4.5:1', (foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
