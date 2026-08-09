import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Modal, { ModalFooter } from '../components/Modal';

describe('Modal', () => {
  it('does not render while closed', () => {
    render(<Modal isOpen={false} onClose={vi.fn()} title="Hidden">content</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has an accessible name, moves focus inside, and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Create note">
        <input aria-label="Title" />
        <button>Save</button>
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Create note' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Close modal' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('contains keyboard focus and restores it to the trigger', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Keyboard test">
            <button>First action</button>
            <button>Last action</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    const close = screen.getByRole('button', { name: 'Close modal' });
    await vi.waitFor(() => expect(close).toHaveFocus());

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('restores the previous body overflow value', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <Modal isOpen onClose={vi.fn()} ariaLabel="Untitled dialog">content</Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Modal isOpen={false} onClose={vi.fn()} ariaLabel="Untitled dialog">content</Modal>);
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('keeps footer gutters within the mobile content inset', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Mobile footer">
        <ModalFooter><button>Continue</button></ModalFooter>
      </Modal>
    );
    const footer = screen.getByRole('button', { name: 'Continue' }).parentElement;
    expect(footer).toHaveClass('-mx-4', 'px-4', 'sm:-mx-6', 'sm:px-6');
  });
});
