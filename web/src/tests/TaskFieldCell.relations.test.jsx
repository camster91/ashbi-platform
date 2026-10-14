import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { it, expect } from 'vitest';
import TaskFieldCell from '../components/TaskFieldCell';

it('renders authorized names and excludes links for unavailable relations', () => {
  const { rerender } = render(<MemoryRouter><TaskFieldCell field={{ type: 'RELATION', target: 'CLIENT' }} value="c1" relation={{ id: 'c1', name: 'Canonical client' }} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Canonical client' })).toHaveAttribute('href', '/client/c1');
  rerender(<MemoryRouter><TaskFieldCell field={{ type: 'RELATION', target: 'CLIENT' }} value="foreign" relation={null} /></MemoryRouter>);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('Unavailable related record')).toBeInTheDocument();
  rerender(<MemoryRouter><TaskFieldCell field={{ type: 'RELATION', target: 'PERSON' }} value="person" relation={{ id: 'person', name: 'Teammate' }} /></MemoryRouter>);
  expect(screen.getByText('Teammate')).toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
