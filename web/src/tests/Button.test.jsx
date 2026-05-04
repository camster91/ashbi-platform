/**
 * Button Component Unit Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../components/ui/Button';

describe('Button Component', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>Click me</Button>);
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('shows loading state', () => {
    render(<Button isLoading>Click me</Button>);
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    // Loader icon should be present (lucide-react uses SVGs)
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders icons', () => {
    const LeftIcon = <span data-testid="left-icon">L</span>;
    const RightIcon = <span data-testid="right-icon">R</span>;
    
    render(
      <Button leftIcon={LeftIcon} rightIcon={RightIcon}>
        With Icons
      </Button>
    );
    
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('applies variant and size classes', () => {
    const { rerender } = render(<Button variant="danger" size="lg">Danger Large</Button>);
    let button = screen.getByRole('button');
    
    // Check for some expected classes from the Button implementation
    expect(button.className).toContain('bg-destructive');
    expect(button.className).toContain('h-12');
    
    rerender(<Button variant="outline" size="sm">Outline Small</Button>);
    button = screen.getByRole('button');
    expect(button.className).toContain('border-2');
    expect(button.className).toContain('h-8');
  });
});
