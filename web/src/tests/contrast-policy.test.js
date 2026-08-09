import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function rgb(hex) {
  return hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
}

function hsl(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - chroma / 2;
  let channels;
  if (hue < 60) channels = [chroma, x, 0];
  else if (hue < 120) channels = [x, chroma, 0];
  else if (hue < 180) channels = [0, chroma, x];
  else if (hue < 240) channels = [0, x, chroma];
  else if (hue < 300) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];
  return channels.map((channel) => Math.round((channel + m) * 255));
}

function luminance(channels) {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const white = rgb('ffffff');
const cream = rgb('faf9f2');

describe('WCAG contrast policy', () => {
  it.each([
    ['portal muted on white', '6b667f', 'ffffff'],
    ['portal muted on cream', '6b667f', 'faf9f2'],
    ['success text on white', '15803d', 'ffffff'],
    ['warning text on white', 'b45309', 'ffffff'],
    ['danger text on white', 'b91c1c', 'ffffff'],
    ['green badge', '166534', 'dcfce7'],
    ['lime badge', '4d7c0f', 'ecfccb'],
    ['orange badge', '9a3412', 'ffedd5'],
    ['red badge', 'b91c1c', 'fee2e2'],
    ['blue badge', '1d4ed8', 'dbeafe'],
    ['purple badge', '6d28d9', 'ede9fe'],
  ])('%s meets 4.5:1 for normal text', (_label, foreground, background) => {
    expect(ratio(rgb(foreground), rgb(background))).toBeGreaterThanOrEqual(4.5);
  });

  it('portal and shell control boundaries meet 3:1', () => {
    expect(ratio(rgb('918c9f'), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(rgb('918c9f'), cream)).toBeGreaterThanOrEqual(3);
    expect(ratio(hsl(250, 12, 60), white)).toBeGreaterThanOrEqual(3);
    expect(ratio(hsl(250, 12, 60), cream)).toBeGreaterThanOrEqual(3);
    expect(ratio(hsl(250, 15, 45), hsl(250, 39, 10))).toBeGreaterThanOrEqual(3);
  });

  it('semantic solid statuses meet 4.5:1 in light and dark themes', () => {
    expect(ratio(white, hsl(142, 72, 28))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(white, hsl(32, 95, 32))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(white, hsl(199, 85, 30))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(white, hsl(142, 70, 30))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(250, 39, 10), hsl(38, 92, 58))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(250, 39, 10), hsl(199, 80, 42))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps inaccessible legacy portal overrides out and defines visible focus', () => {
    const portal = readFileSync(resolve(process.cwd(), 'src/pages/ClientPortal.jsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(portal).not.toContain('#8a85a0');
    expect(portal).not.toMatch(/color:\s*connected \? '#16a34a'/);
    expect(portal).toContain(':focus-visible');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 3px solid hsl(var(--ring))');
  });
});
