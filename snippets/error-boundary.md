# error-boundary

## Purpose
React error boundary with Sentry reporting.

## Code
```tsx
import * as Sentry from '@sentry/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.captureException(error, { extra: errorInfo });
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
```
