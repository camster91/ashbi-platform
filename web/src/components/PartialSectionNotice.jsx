import Alert from './ui/Alert';
import Button from './ui/Button';
import SlowNotice from './ui/SlowNotice';
import { getQueryErrorGuidance } from './QueryErrorState';

/**
 * "Partial" workflow state (docs/workflow-state-matrix.md): a page composed of
 * several queries where one section failed. Render this in place of the
 * failed section only, keep the loaded sections visible, and retry only the
 * failed read.
 *
 * Uses a polite status (not role=alert) because the rest of the page is still
 * usable and polling pages must not repeatedly interrupt assistive technology.
 */
export default function PartialSectionNotice({
  section,
  title,
  detail = 'Everything else on this page loaded and is still usable.',
  error,
  onRetry,
  isRetrying = false,
  className,
}) {
  const guidance = getQueryErrorGuidance(error);
  const heading = title || `${section} is temporarily unavailable`;
  return (
    <div className={className} data-partial-section={section}>
      <Alert
        variant="warning"
        role="status"
        aria-live="polite"
        title={heading}
        action={
          onRetry ? (
            <Button
              type="button"
              onClick={onRetry}
              variant="outline"
              size="sm"
              disabled={isRetrying}
              slowAfterMs={false}
              aria-label={isRetrying ? `Retrying ${section}` : `Retry ${section}`}
            >
              {isRetrying ? 'Retrying…' : 'Retry'}
            </Button>
          ) : undefined
        }
      >
        {detail} {guidance.detail}
      </Alert>
      <SlowNotice active={isRetrying} kind="read" className="mt-2" />
    </div>
  );
}
