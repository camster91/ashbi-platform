import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Skeleton, { SkeletonAvatar, SkeletonText } from '../components/ui/Skeleton';

describe('Skeleton', () => {
  it('is decorative and respects reduced-motion preferences by default', () => {
    const { container } = render(<Skeleton data-testid="skeleton" />);
    const skeleton = screen.getByTestId('skeleton');

    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
    expect(container).toBeInTheDocument();
  });

  it('allows callers to expose a skeleton when they provide accessible context', () => {
    render(<Skeleton aria-hidden="false" data-testid="visible-skeleton" />);

    expect(screen.getByTestId('visible-skeleton')).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps compound placeholders decorative', () => {
    const { container } = render(<SkeletonText lines={3} />);

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it('falls back to the medium avatar size for an unsupported size', () => {
    render(<SkeletonAvatar size="unsupported" data-testid="avatar" />);

    expect(screen.getByTestId('avatar')).toHaveClass('w-10', 'h-10');
  });
});
