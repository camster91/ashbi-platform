/**
 * StatCard Component Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCard from '../components/ui/StatCard';
import { Activity } from 'lucide-react';

describe('StatCard Component', () => {
  it('renders label and value correctly', () => {
    render(<StatCard label="Total Revenue" value="$50,000" />);
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
  });

  it('renders trend information when provided', () => {
    render(<StatCard label="Leads" value="120" trend="up" trendValue="+12%" />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('vs last period')).toBeInTheDocument();
    
    // Check for success color class on trend
    const trendElement = screen.getByText('+12%');
    expect(trendElement.className).toContain('text-success');
  });

  it('renders icon when provided', () => {
    render(<StatCard label="Activity" value="Active" icon={Activity} />);
    // Activity is rendered as an SVG
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    const { container } = render(<StatCard label="Alert" value="High" variant="danger" />);
    const card = container.firstChild;
    expect(card.className).toContain('bg-destructive/5');
    
    const value = screen.getByText('High');
    expect(value.className).toContain('text-destructive');
  });
});
