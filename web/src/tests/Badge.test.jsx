/**
 * Badge Component Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from '../components/ui/Badge';

describe('Badge Component', () => {
  it('renders children correctly', () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders a dot when specified', () => {
    const { container } = render(<Badge dot>With Dot</Badge>);
    // The dot is a span with rounded-full class
    const dot = container.querySelector('.rounded-full.w-1\\.5');
    expect(dot).toBeInTheDocument();
  });

  it('applies variant and color classes correctly', () => {
    const { rerender } = render(<Badge color="success" variant="solid">Success Solid</Badge>);
    let badge = screen.getByText('Success Solid');
    expect(badge.className).toContain('bg-success');
    expect(badge.className).toContain('text-white');

    rerender(<Badge color="danger" variant="outline">Danger Outline</Badge>);
    badge = screen.getByText('Danger Outline');
    expect(badge.className).toContain('border-destructive');
    expect(badge.className).toContain('border-2');
  });

  it('applies size classes', () => {
    const { rerender } = render(<Badge size="xs">Extra Small</Badge>);
    expect(screen.getByText('Extra Small').className).toContain('px-1.5');

    rerender(<Badge size="lg">Large</Badge>);
    expect(screen.getByText('Large').className).toContain('px-3');
  });
});
