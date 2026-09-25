import { Component, createRef } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Copy } from 'lucide-react';
import { createErrorReference, getSupportContact } from '../lib/support';

const buttonBase =
  'min-h-11 min-w-11 inline-flex items-center justify-center gap-2 px-5 py-3 font-medium rounded-lg transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

/**
 * "Fatal" workflow state (docs/workflow-state-matrix.md).
 *
 * Explains that the view cannot continue, offers an in-place retry and a full
 * reload (with an unsaved-work warning), and gives support guidance plus a
 * copyable error reference. The raw error message and stack are deliberately
 * not rendered: they can contain personal or client data. The reference is
 * passed to `onError` so monitoring can be searched by it.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.titleRef = createRef();
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      promiseError: null,
      reference: null,
      copyStatus: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, reference: createErrorReference(), copyStatus: null };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    this.logError(error, errorInfo, 'React Error', this.state.reference);
  }

  handleUnhandledRejection = (event) => {
    const error = event.reason;
    const reference = createErrorReference();
    this.setState({
      hasError: true,
      promiseError: error,
      error: error,
      reference,
      copyStatus: null,
    });
    this.logError(error, null, 'Unhandled Promise Rejection', reference);
  };

  logError = (error, errorInfo, errorType, reference) => {
    console.group(`%c${errorType}`, 'color: #ef4444; font-weight: bold; font-size: 14px;');
    console.error('Reference:', reference);
    console.error('Error:', error?.message || error);
    if (error?.stack) {
      console.error('Stack trace:', error.stack);
    }
    if (errorInfo?.componentStack) {
      console.error('Component stack:', errorInfo.componentStack);
    }
    console.groupEnd();

    // Optional: Send to monitoring service
    if (this.props.onError) {
      this.props.onError(error, errorInfo, errorType, reference);
    }
  };

  componentDidMount() {
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    if (this.state.hasError) this.titleRef.current?.focus();
  }

  componentDidUpdate(_prevProps, prevState) {
    // Move focus to the recovery surface so keyboard and screen-reader users
    // land on the explanation rather than on a control that no longer exists.
    if (!prevState.hasError && this.state.hasError) {
      this.titleRef.current?.focus();
    }
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  handleTryAgain = () => {
    // Re-render the children in place without discarding in-memory state
    // elsewhere in the app. If the fault persists the boundary catches again.
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      promiseError: null,
      reference: null,
      copyStatus: null,
    });
  };

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      promiseError: null
    });
    // Attempt to reload the app
    window.location.reload();
  };

  handleCopyReference = async () => {
    try {
      await navigator.clipboard.writeText(this.state.reference);
      this.setState({ copyStatus: 'copied' });
    } catch {
      this.setState({ copyStatus: 'failed' });
    }
  };

  renderSupport() {
    const support = this.props.support || getSupportContact();
    if (support.url || support.email) {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          If this keeps happening,{' '}
          {support.url && (
            <a
              href={support.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-700 dark:text-blue-400 underline underline-offset-2"
            >
              contact support
            </a>
          )}
          {support.url && support.email && ' or email '}
          {!support.url && support.email && 'email '}
          {support.email && (
            <a
              href={`mailto:${support.email}`}
              className="font-medium text-blue-700 dark:text-blue-400 underline underline-offset-2 break-all"
            >
              {support.email}
            </a>
          )}{' '}
          and include the error reference.
        </p>
      );
    }
    return <p className="text-sm text-slate-600 dark:text-slate-400">If this keeps happening, {support.fallbackText.charAt(0).toLowerCase() + support.fallbackText.slice(1)}</p>;
  }

  render() {
    if (this.state.hasError) {
      const isPromiseError = !!this.state.promiseError;
      const { reference, copyStatus } = this.state;

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
          <section
            aria-labelledby="fatal-error-title"
            className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 text-center"
          >
            <div className="mb-6">
              <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle aria-hidden="true" className="w-8 h-8 text-red-500" />
              </div>
            </div>

            <h1 id="fatal-error-title" ref={this.titleRef} tabIndex={-1} className="focus:outline-none text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Something went wrong
            </h1>

            <p className="text-slate-600 dark:text-slate-400 mb-1">
              {isPromiseError
                ? 'An unexpected error occurred while processing your request.'
                : 'The application encountered an unexpected error.'}
            </p>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              This view cannot continue. Try again, or reload the application.
            </p>

            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-4 mb-4 text-left">
              <p id="fatal-error-reference-label" className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Error reference
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code
                  aria-labelledby="fatal-error-reference-label"
                  data-testid="error-reference"
                  className="font-mono text-sm text-slate-900 dark:text-slate-100 break-all select-all"
                >
                  {reference}
                </code>
                <button
                  type="button"
                  onClick={this.handleCopyReference}
                  className={`${buttonBase} px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700`}
                >
                  <Copy aria-hidden="true" className="w-4 h-4" />
                  Copy reference
                </button>
              </div>
              <p role="status" aria-live="polite" className="mt-1 text-xs text-slate-600 dark:text-slate-400 min-h-4">
                {copyStatus === 'copied' && 'Reference copied.'}
                {copyStatus === 'failed' && 'Could not copy automatically. Select the reference and copy it manually.'}
              </p>
            </div>

            <div className="mb-6">{this.renderSupport()}</div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Reloading may discard unsaved changes. Copy anything you need to keep before reloading.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleTryAgain}
                className={`${buttonBase} border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700`}
              >
                <RotateCcw aria-hidden="true" className="w-4 h-4" />
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleRetry}
                className={`${buttonBase} px-6 bg-blue-600 hover:bg-blue-700 text-white`}
              >
                <RefreshCw aria-hidden="true" className="w-4 h-4" />
                Reload application
              </button>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
