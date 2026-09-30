/**
 * Field, Select and Textarea primitives.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Textarea from '../components/ui/Textarea';

describe('Field', () => {
  it('labels its control and links the hint through aria-describedby', () => {
    render(
      <Field label="Email" hint="We never share it.">
        <Input type="email" />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAccessibleDescription('We never share it.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and describes it with the error', () => {
    render(
      <Field label="Name" hint="Your full name" error="Name is required" required>
        <Input aria-describedby="extra" />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: /Name/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    const ids = input.getAttribute('aria-describedby').split(' ');
    expect(ids[0]).toBe('extra');
    expect(ids).toHaveLength(3);
    expect(document.getElementById(ids[2])).toHaveTextContent('Name is required');
    expect(document.getElementById(ids[2]).className).toContain('text-destructive');
    // The asterisk is visual only; `required` carries the meaning.
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    // Invalid inputs switch to the destructive border through aria-invalid.
    expect(input.className).toContain('aria-[invalid=true]:border-destructive');
  });

  it('keeps a caller id and supports a render-prop control', () => {
    render(
      <Field label="Notes" id="notes" error="Too long">
        {(control) => <textarea {...control} />}
      </Field>
    );
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea).toHaveAttribute('id', 'notes');
    expect(textarea).toHaveAttribute('aria-describedby', 'notes-error');
  });
});

describe('Select', () => {
  it('renders options with a disabled placeholder and the Input look', () => {
    render(
      <Field label="Currency">
        <Select
          defaultValue=""
          placeholder="Choose…"
          options={[{ value: 'CAD', label: 'Canadian dollar' }, { value: 'USD', label: 'US dollar', disabled: true }]}
        />
      </Field>
    );
    const select = screen.getByRole('combobox', { name: 'Currency' });
    expect(select.className).toContain('border-border');
    expect(select.className).toContain('min-h-11');
    expect(screen.getByRole('option', { name: 'Choose…' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'US dollar' })).toBeDisabled();
  });

  it('accepts option children', () => {
    render(
      <Select aria-label="Size">
        <option value="s">Small</option>
      </Select>
    );
    expect(screen.getByRole('option', { name: 'Small' })).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('renders a resizable token-styled textarea with four rows by default', () => {
    render(<Textarea aria-label="Message" />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea).toHaveAttribute('rows', '4');
    expect(textarea.className).toContain('border-border');
    expect(textarea.className).toContain('resize-y');
  });
});
