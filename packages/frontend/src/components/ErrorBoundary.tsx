import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <div className="max-w-2xl w-full space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-8 w-8" />
              <h1 className="text-2xl font-bold">Something went wrong</h1>
            </div>

            {/* Error Message */}
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <h2 className="font-semibold text-destructive mb-2">
                {this.state.error?.name || 'Error'}
              </h2>
              <p className="text-sm text-destructive/80 font-mono">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
            </div>

            {/* Stack Trace */}
            {this.state.error?.stack && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Show stack trace
                </summary>
                <pre className="mt-2 p-4 rounded-lg bg-muted text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            {/* Component Stack */}
            {this.state.errorInfo?.componentStack && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Show component stack
                </summary>
                <pre className="mt-2 p-4 rounded-lg bg-muted text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button onClick={this.handleReset} variant="outline">
                Try Again
              </Button>
              <Button onClick={this.handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
