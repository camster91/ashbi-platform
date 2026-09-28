/**
 * Input primitive unit tests
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input, { inputStyles } from '../components/ui/Input';

describe('Input Component', () => {
  it('renders a labelled text input with token styling', () => {
    render(<Input aria-label="Email" />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input.className).toContain('border-border');
    expect(input.className).toContain('focus:ring-ring');
  });

  it('shares its look with selects and textareas through inputStyles', () => {
    const classes = inputStyles('text-base sm:text-sm');
    expect(classes).toContain('border-border');
    expect(classes).toContain('text-base');
    expect(classes).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
});
