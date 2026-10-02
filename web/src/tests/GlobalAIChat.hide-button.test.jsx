import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import GlobalAIChat from '../components/GlobalAIChat';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam' } }) }));
vi.mock('../lib/api', () => ({ api: { aiChat: vi.fn() } }));

function renderChat(props) {
  return render(<MemoryRouter><GlobalAIChat {...props} /></MemoryRouter>);
}

describe('GlobalAIChat floating button', () => {
  it('shows by default', () => {
    renderChat();
    const button = screen.getByRole('button', { name: 'Open AI Chat' });
    expect(button.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(button.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('steps aside while the mobile More menu or navigation drawer is open', () => {
    renderChat({ hideButton: true });
    const button = screen.getByRole('button', { name: 'Open AI Chat', hidden: true });
    expect(button.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(button.className).not.toMatch(/(^|\s)flex(\s|$)/);
  });
});
