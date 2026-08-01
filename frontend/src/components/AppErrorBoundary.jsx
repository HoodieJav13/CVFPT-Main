import React from 'react';
import { Button } from '@/components/ui/button';
import { trackProductEvent } from '@/lib/telemetry';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    trackProductEvent('frontend_error', { route: window.location.pathname });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6" role="alert" data-testid="app-error-boundary">
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-card p-6 text-center">
          <h1 className="font-display text-2xl font-semibold">CVF PT hit a problem</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your saved information is still in the app. Reload to try this screen again.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Reload app</Button>
        </div>
      </main>
    );
  }
}
