#!/usr/bin/env node
// One-off codemod for #118 / #315: rewrites raw Tailwind palette classes in
// web/src to the semantic design tokens from web/src/index.css.
//
//   node scripts/codemods/raw-colors-to-tokens.mjs web/src/pages/Foo.jsx [...]
//
// It only rewrites classes with an unambiguous token equivalent and leaves the
// rest (light text meant for dark surfaces, gradients, categorical accents)
// for a human. `dark:` palette overrides are dropped when the same line now
// uses a token for that property, because tokens already switch with `.dark`.
// Review the diff: the guard test (web/src/tests/raw-color-guard.test.js)
// reports whatever is left.
import { readFileSync, writeFileSync } from 'node:fs';

const NEUTRALS = ['gray', 'slate', 'zinc', 'neutral', 'stone'];
const HUES = {
  red: 'destructive', rose: 'destructive',
  green: 'success', emerald: 'success',
  yellow: 'warning', amber: 'warning', orange: 'warning',
  blue: 'info', sky: 'info', cyan: 'info',
  indigo: 'primary', violet: 'primary', purple: 'primary',
};
const BRAND_HEX = {
  '#2e2958': 'brand-indigo',
  '#e6f354': 'brand-lime',
  '#d0dd9a': 'brand-sage',
  '#faf9f2': 'brand-cream',
};

const TOKEN_FG = {
  primary: 'primary-foreground',
  destructive: 'destructive-foreground',
  success: 'success-foreground',
  warning: 'warning-foreground',
  info: 'info-foreground',
};

function neutral(prefix, shade) {
  const n = Number(shade);
  switch (prefix) {
    case 'text':
      if (n >= 700) return 'text-foreground';
      if (n >= 400) return 'text-muted-foreground';
      return null; // light text on a dark surface: decide by hand
    case 'bg':
      if (n <= 50) return 'bg-muted/50';
      if (n <= 100) return 'bg-muted';
      if (n <= 200) return 'bg-border/30';
      if (n <= 300) return 'bg-border/50';
      return null;
    case 'border':
    case 'divide':
      if (n <= 100) return `${prefix}-border/25`;
      if (n <= 200) return `${prefix}-border/40`;
      if (n <= 300) return `${prefix}-border/60`;
      return `${prefix}-border`;
    case 'ring':
    case 'outline':
      // A dark neutral ring is a focus indicator: use the focus token.
      return n <= 300 ? `${prefix}-border/60` : `${prefix}-ring`;
    case 'placeholder':
      return 'placeholder:text-muted-foreground';
    default:
      return null;
  }
}

function hue(prefix, token, shade, alpha) {
  const n = Number(shade);
  if (alpha) {
    // Already translucent (bg-red-500/10): keep the alpha on the token.
    return ['bg', 'border', 'ring', 'text', 'divide', 'outline'].includes(prefix) ? `${prefix}-${token}/${alpha}` : null;
  }
  switch (prefix) {
    case 'text':
      return n >= 400 ? `text-${token}` : null;
    case 'bg':
      if (n <= 50) return `bg-${token}/5`;
      if (n <= 100) return `bg-${token}/10`;
      if (n <= 200) return `bg-${token}/20`;
      if (n <= 300) return `bg-${token}/40`;
      if (n <= 700) return `bg-${token}`;
      return null;
    case 'border':
    case 'divide':
      if (n <= 200) return `${prefix}-${token}/30`;
      if (n <= 300) return `${prefix}-${token}/40`;
      return `${prefix}-${token}`;
    case 'ring':
    case 'outline':
      return n <= 300 ? `${prefix}-${token}/40` : `${prefix}-${token}`;
    case 'fill':
    case 'stroke':
      return `${prefix}-${token}`;
    default:
      return null;
  }
}

const COLOR_NAMES = [...NEUTRALS, ...Object.keys(HUES), 'lime', 'teal', 'pink', 'fuchsia'];
const CLASS = new RegExp(
  String.raw`(?<![\w\-\[/])((?:[\w\-\[\]=&>*]+:)*)(bg|text|border(?:-[trblxy])?|divide|ring|outline|fill|stroke|placeholder)-(${COLOR_NAMES.join('|')})-(50|[1-9]00|950)(?:/(\d+))?(?![\w\-])`,
  'g'
);

function mapClass(modifiers, prefix, color, shade, alpha) {
  // Side borders (border-l-red-500) map like `border`, keeping the side.
  const side = prefix.startsWith('border-') ? prefix : null;
  const base = side ? 'border' : prefix;
  let mapped;
  if (NEUTRALS.includes(color)) mapped = alpha ? null : neutral(base, shade);
  else mapped = HUES[color] ? hue(base, HUES[color], shade, alpha) : null;
  return mapped && side ? mapped.replace(/^border-/, `${side}-`) : mapped;
}

export function migrateLine(line) {
  let out = line.replace(CLASS, (match, modifiers, prefix, color, shade, alpha) => {
    if (modifiers.split(':').includes('dark')) return match; // handled below
    const mapped = mapClass(modifiers, prefix, color, shade, alpha);
    return mapped ? `${modifiers}${mapped}` : match;
  });
  // bg-white surfaces become the card token (not on switch knobs, which sit on
  // a coloured track in both themes).
  if (!/translate-x/.test(out)) out = out.replace(/(?<![\w\-/:])((?:[\w-]+:)*)bg-white(?![\w\-/])/g, (m, mods) => (mods.includes('dark:') ? m : `${mods}bg-card`));
  // Brand hex arbitrary values -> the fixed brand colours from tailwind.config.
  out = out.replace(/\[(#[0-9a-fA-F]{6})\]/g, (m, hex) => BRAND_HEX[hex.toLowerCase()] ? `@@${BRAND_HEX[hex.toLowerCase()]}@@` : m)
    .replace(/-@@([\w-]+)@@/g, '-$1');
  // White text on a solid token fill reads badly once the fill flips in dark
  // mode (primary becomes lime); use the fill's foreground token.
  for (const [token, fg] of Object.entries(TOKEN_FG)) {
    if (new RegExp(String.raw`(?<![\w\-:/])bg-${token}(?![\w\-/])`).test(out)) {
      out = out.replace(/(?<![\w\-:/])text-white(?![\w\-/])/g, `text-${fg}`);
      break;
    }
  }
  // Drop `dark:` palette overrides for properties this line now expresses
  // with a token.
  out = out.replace(CLASS, (match, modifiers, prefix) => {
    if (!modifiers.split(':').includes('dark')) return match;
    const tokenOnLine = new RegExp(String.raw`(?<![\w\-:])(?:[\w-]+:)*${prefix}-(?:foreground|muted|muted-foreground|card|border|background|primary|destructive|success|warning|info|accent)(?:/\d+)?(?![\w-])`);
    return tokenOnLine.test(out.replace(match, '')) ? '@@DROP@@' : match;
  });
  out = out.replace(/ @@DROP@@/g, '').replace(/@@DROP@@ ?/g, '');
  // `bg-blue-600 hover:bg-blue-700` maps both shades to one token; keep a
  // visible hover the way Button does (`hover:bg-primary/90`).
  out = out.replace(/(?<![\w\-:/])(hover|active):(bg|text)-(primary|destructive|success|warning|info|foreground|muted-foreground)(?![\w\-/])/g,
    (m, state, prefix, token) => (new RegExp(String.raw`(?<![\w\-:/])${prefix}-${token}(?![\w\-/])`).test(out.replace(m, ''))
      ? `${state}:${prefix}-${token}/${prefix === 'bg' ? 90 : 80}`
      : m));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const src = readFileSync(file, 'utf8');
    const next = src.split('\n').map(migrateLine).join('\n');
    if (next !== src) {
      writeFileSync(file, next);
      console.log(`migrated ${file}`);
    }
  }
}
