/**
 * Card Component Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';

describe('Card Component', () => {
  it('renders children correctly', () => {
    render(<Card>Card Content</Card>);
    expect(screen.getByText('Card Content')).toBeInTheDocument();
  });

  it('applies variant and padding classes', () => {
    const { container } = render(<Card variant="elevated" padding="lg">Test</Card>);
    const card = container.firstChild;
    expect(card.className).toContain('shadow-md');
    expect(card.className).toContain('p-6');
  });

  it('handles interactive state', () => {
    const { container } = render(<Card isInteractive>Interactive</Card>);
    const card = container.firstChild;
    expect(card.className).toContain('cursor-pointer');
    expect(card.className).toContain('hover:-translate-y-1');
  });

  it('renders sub-components correctly', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
    
    // Title should be an h3
    expect(screen.getByText('Title').tagName).toBe('H3');
  });
});
