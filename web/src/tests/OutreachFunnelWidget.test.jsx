import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OutreachFunnelWidget from '../components/widgets/OutreachFunnelWidget';

describe('Outreach pipeline widget', () => {
  it('renders populated channel stages without crashing', () => {
    render(<OutreachFunnelWidget outreach={{ Contacted: 2 }} coldEmail={{ Replied: 1 }} linkedIn={{ Connected: 3 }} />);
    expect(screen.getByRole('heading', { name: 'Outreach Pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Outreach (2)')).toBeInTheDocument();
    expect(screen.getByText('Cold Email (1)')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn (3)')).toBeInTheDocument();
    expect(screen.getByText('Contacted')).toBeInTheDocument();
    expect(screen.getByText('Replied')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('omits the widget when all channels are empty', () => {
    const { container } = render(<OutreachFunnelWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
