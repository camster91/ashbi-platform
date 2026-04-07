import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      promiseError: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    this.logError(error, errorInfo, 'React Error');
  }

  handleUnhandledRejection = (event) => {
    const error = event.reason;
    this.setState({
      hasError: true,
      promiseError: error,
      error: error
    });
    this.logError(error, null, 'Unhandled Promise Rejection');
  };

  logError = (error, errorInfo, errorType) => {
    console.group(`%c${errorType}`, 'color: #ef4444; font-weight: bold; font-size: 14px;');
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
      this.props.onError(error, errorInfo, errorType);
    }
  };

  componentDidMount() {
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

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

  render() {
    if (this.state.hasError) {
      const isPromiseError = !!this.state.promiseError;
      const errorMessage = this.state.error?.message || 'An unexpected error occurred';

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
            <div className="mb-6">
              <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Something went wrong
            </h1>

            <p className="text-slate-600 dark:text-slate-400 mb-4">
              {isPromiseError
                ? 'An unexpected error occurred while processing your request.'
                : 'The application encountered an unexpected error.'}
            </p>

            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-lg p-4 mb-6 max-h-32 overflow-auto">
              <p className="text-sm text-slate-600 dark:text-slate-400 font-mono break-all">
                {errorMessage}
              </p>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-500 mb-6">
              This error has been logged. If this problem persists, please contact support.
            </p>

            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;