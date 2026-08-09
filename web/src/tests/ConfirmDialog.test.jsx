import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('exposes a named dialog and invokes its actions', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete estimate"
        description="Delete Spring campaign? You can undo this action for 10 seconds."
        confirmLabel="Delete estimate"
        onConfirm={confirm}
        onCancel={cancel}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Delete estimate' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete estimate' }));
    expect(confirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('blocks dismissal and duplicate confirmation while pending', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Void invoice"
        description="Void INV-100?"
        confirmLabel="Void invoice"
        onConfirm={confirm}
        onCancel={cancel}
        pending
      />,
    );

    const confirmation = screen.getByRole('button', { name: 'Void invoice' });
    expect(confirmation).toBeDisabled();
    fireEvent.click(confirmation);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('announces an operation failure without dismissing the dialog', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Delete pipeline item"
        description="This cannot be undone."
        confirmLabel="Permanently delete"
        onConfirm={() => {}}
        onCancel={() => {}}
        error="The item could not be deleted."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The item could not be deleted.');
    expect(screen.getByRole('dialog', { name: 'Delete pipeline item' })).toBeInTheDocument();
  });
});
